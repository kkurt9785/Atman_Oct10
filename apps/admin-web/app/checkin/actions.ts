'use server';
import { adminClient } from '@/lib/supabase';
import { requireFacilityAdmin } from '@/lib/facility';
import { todayKST } from '@/lib/date';

export type CheckinResult =
  | { ok: true; workerName: string; shiftDate: string; startTime: string; action: 'checkin' | 'checkout'; gross?: number }
  | { ok: false; message: string };

export type CheckinCoords = { lat: number; lng: number } | null;

// 스캔 기기(관리자)와 병원 사이 허용 거리 — 초과 시 체크인 거부
const GEOFENCE_METERS = 500;

// PostGIS geography(POINT) WKB hex → { lng, lat }
// 형식: 바이트0 endian(01=LE) · uint32 타입(SRID 플래그 포함) · uint32 SRID · float64 x · float64 y
function parseWkbPoint(hex: string): { lng: number; lat: number } | null {
  try {
    if (!hex || hex.length < 50) return null;
    const buf = Buffer.from(hex, 'hex');
    const littleEndian = buf[0] === 1;
    const type = littleEndian ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
    const hasSrid = (type & 0x20000000) !== 0;
    const off = hasSrid ? 9 : 5;
    const lng = littleEndian ? buf.readDoubleLE(off) : buf.readDoubleBE(off);
    const lat = littleEndian ? buf.readDoubleLE(off + 8) : buf.readDoubleBE(off + 8);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return { lng, lat };
  } catch {
    return null;
  }
}

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

export async function recordCheckin(applicationId: string, coords: CheckinCoords = null): Promise<CheckinResult> {
  const sb = adminClient();
  const session = await requireFacilityAdmin();
  if (!sb || !session) return { ok: false, message: '인증이 필요해요' };
  const facilityId = session.facilityId;

  // shift_application + shift + worker 조회
  const { data: app, error } = await sb
    .from('shift_applications')
    .select(`
      id, status,
      shifts ( id, shift_date, start_time, end_time, hourly_wage, facility_id ),
      workers ( id, name, auth_user_id )
    `)
    .eq('id', applicationId)
    .single();

  if (error || !app) return { ok: false, message: '유효하지 않은 QR이에요' };
  if (app.status !== 'accepted') return { ok: false, message: '수락된 시프트가 아니에요' };

  const shift  = app.shifts  as unknown as { id: string; shift_date: string; start_time: string; end_time: string; hourly_wage: number; facility_id: string };
  const worker = app.workers as unknown as { id: string; name: string; auth_user_id: string };
  if (shift.facility_id !== facilityId) return { ok: false, message: '이 병원의 시프트가 아니에요' };

  // GPS 지오펜스 — 스캔 기기 위치가 있으면 병원과의 거리를 검증·기록
  // (위치 미제공: 데스크톱 등 GPS 없는 기기 → 거리 기록 없이 허용)
  let distanceM: number | null = null;
  let scanPoint: string | null = null;
  if (coords) {
    const { data: fac } = await sb.from('facilities').select('location').eq('id', facilityId).single();
    const facPoint = parseWkbPoint((fac?.location as string) ?? '');
    if (facPoint) {
      distanceM = haversineMeters(coords, facPoint);
      if (distanceM > GEOFENCE_METERS) {
        const km = (distanceM / 1000).toFixed(1);
        return { ok: false, message: `병원에서 ${km}km 떨어진 위치예요. 병원 현장에서 스캔해주세요.` };
      }
    }
    scanPoint = `SRID=4326;POINT(${coords.lng} ${coords.lat})`;
  }

  const today = todayKST();

  // 기존 attendance 조회
  const { data: attendance } = await sb
    .from('shift_attendances')
    .select('id, check_in_at, check_out_at')
    .eq('application_id', applicationId)
    .maybeSingle();

  if (attendance?.check_out_at) {
    return { ok: false, message: '이미 체크아웃 완료된 시프트예요' };
  }

  const now = new Date();

  // ── 체크인 ──────────────────────────────────────
  if (!attendance) {
    // 체크인은 당일(KST)만 허용
    if (shift.shift_date !== today) {
      const diff = Math.ceil(
        (new Date(shift.shift_date).getTime() - new Date(today).getTime()) / 86400000
      );
      const msg = diff > 0 ? `${diff}일 후 시프트예요` : '이미 지난 시프트예요';
      return { ok: false, message: msg };
    }
    await sb.from('shift_attendances').insert({
      shift_id:            shift.id,
      worker_id:           worker.id,
      application_id:      applicationId,
      check_in_at:         now.toISOString(),
      check_in_method:     'qr',
      check_in_location:   scanPoint,
      check_in_distance_m: distanceM,
    });
    // shift_applications mirror
    await sb.from('shift_applications')
      .update({ checked_in_at: now.toISOString() })
      .eq('id', applicationId);

    return {
      ok: true,
      workerName: worker.name,
      shiftDate:  shift.shift_date,
      startTime:  shift.start_time,
      action: 'checkin',
    };
  }

  // ── 체크아웃 — 정산 전체를 단일 DB 트랜잭션으로 (checkout_and_settle) ──
  // 임금계산·크레딧차감·상태변경·감사로그가 한 트랜잭션. 실패 시 전체 롤백, 재스캔 멱등.
  const { data: settle, error: settleErr } = await sb.rpc('checkout_and_settle', {
    p_application_id: applicationId,
    p_facility_id: facilityId,
    p_lat: coords?.lat ?? null,
    p_lng: coords?.lng ?? null,
  });

  if (settleErr) {
    return { ok: false, message: '정산 처리에 실패했어요. 다시 시도해 주세요.' };
  }
  const result = settle as { ok: boolean; message?: string; gross?: number };
  if (!result.ok) {
    return { ok: false, message: result.message ?? '정산 처리에 실패했어요.' };
  }

  return {
    ok: true,
    workerName: worker.name,
    shiftDate:  shift.shift_date,
    startTime:  shift.start_time,
    action: 'checkout',
    gross: result.gross,
  };
}
