'use server';

import { revalidatePath } from 'next/cache';
import { refreshFacilityBusinessStatus } from '../business-status';
import { adminClient } from '../supabase';
import { getPlatformAdminSession } from '../platform-admin';
import { approveFacilityCore, rejectFacilityCore } from '../platform-approval';
import { nudgeNotificationDispatch } from '../notify-nudge';
import { todayKST } from '../date';
import { runHealthCheck } from '../ops-health';

export type SelfRegisteredFacility = {
  id: string; name: string; facility_type: string; address_text: string | null; contact_phone: string | null;
  hira_ykiho: string | null; hira_cl_cd: string | null; registration_source: string; business_registration_number: string;
  approved_at: string | null; is_active: boolean; created_at: string;
  admin_user_id: string | null; admin_email: string | null; lng: number | null; lat: number | null;
  brn_submitted: string | null; brn_document_path: string | null;
  documentUrl?: string | null; // 서버에서 서명한 열람 URL(10분)
  business_status?: string | null; business_status_detail?: string | null; business_status_checked_at?: string | null;
};

export type RegistrationRequest = {
  id: string; facility_type: string; facility_name: string; address_text: string; contact_name: string; contact_phone: string;
  note: string | null; status: string; created_at: string; requested_by: string;
};

async function requirePlatform() {
  const session = await getPlatformAdminSession();
  if (!session) throw new Error('잇닿 운영자만 사용할 수 있어요.');
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  return { session, sb };
}

export async function listSelfRegisteredFacilities(pendingOnly = true): Promise<SelfRegisteredFacility[]> {
  const { sb } = await requirePlatform();
  const { data, error } = await sb.rpc('platform_list_self_registered_facilities', { p_pending_only: pendingOnly });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SelfRegisteredFacility[];
  // 등록증은 비공개 버킷 — 운영자 화면에서만 10분짜리 서명 URL로 연다
  await Promise.all(rows.map(async (row) => {
    if (!row.brn_document_path) { row.documentUrl = null; return; }
    const { data: signed } = await sb.storage.from('facility-documents').createSignedUrl(row.brn_document_path, 600);
    row.documentUrl = signed?.signedUrl ?? null;
  }));
  // 국세청 조회 결과(RPC 컬럼에 없어 따로 붙인다)
  const ids = rows.map((row) => row.id);
  if (ids.length) {
    const { data: biz } = await sb.from('facilities').select('id,business_status,business_status_detail,business_status_checked_at').in('id', ids);
    const byId = new Map(((biz ?? []) as Array<{ id: string; business_status: string | null; business_status_detail: string | null; business_status_checked_at: string | null }>).map((item) => [item.id, item]));
    rows.forEach((row) => { const item = byId.get(row.id); row.business_status = item?.business_status ?? null; row.business_status_detail = item?.business_status_detail ?? null; row.business_status_checked_at = item?.business_status_checked_at ?? null; });
  }
  return rows;
}

export type TrialFollowUp = {
  facilityId: string; name: string; planName: string; trialEndsAt: string; daysLeft: number; expired: boolean;
  contactPhone: string | null; adminEmail: string | null;
  staffCount: number; shiftCount: number; acceptedCount: number;
};

// 체험 종료 임박(7일 이내)·종료 직후(14일 이내) 실사업장. 연결된 관리자가 있는 곳만 — 연락할 사람이 있어야 한다.
// 고객에게 자동 알림은 보내지 않고, 운영자가 사용 신호를 보고 직접 연락한다.
export async function listTrialFollowUps(): Promise<TrialFollowUp[]> {
  const { sb } = await requirePlatform();
  const today = todayKST();
  const shift = (days: number) => todayKST(new Date(Date.now() + days * 86_400_000));
  const { data, error } = await sb.from('facility_subscriptions')
    .select('status,trial_ends_at,service_plans(name),facilities!inner(id,name,contact_phone,admin_user_id,is_demo,deleted_at)')
    .not('trial_ends_at', 'is', null)
    .is('trial_converted_at', null)
    .in('status', ['active', 'past_due', 'pending', 'expired'])
    .gte('trial_ends_at', shift(-14))
    .lte('trial_ends_at', shift(7))
    .eq('facilities.is_demo', false)
    .is('facilities.deleted_at', null)
    .not('facilities.admin_user_id', 'is', null)
    .order('trial_ends_at', { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as any[];
  // 같은 사업장에 만료 행과 새 체험 행이 함께 있으면 최근 것 하나만
  const byFacility = new Map<string, any>();
  for (const row of rows) {
    const f = Array.isArray(row.facilities) ? row.facilities[0] : row.facilities;
    if (!f) continue;
    const prev = byFacility.get(f.id);
    if (!prev || row.trial_ends_at > prev.trial_ends_at) byFacility.set(f.id, { ...row, facility: f });
  }
  // 이미 다른 활성 구독(새 체험·유료)으로 넘어간 만료 행은 제외
  const expiredIds = [...byFacility.values()].filter((r) => r.status === 'expired').map((r) => r.facility.id);
  if (expiredIds.length) {
    const { data: current } = await sb.from('facility_subscriptions').select('facility_id')
      .in('facility_id', expiredIds).in('status', ['active', 'past_due', 'pending']);
    for (const c of current ?? []) byFacility.delete(c.facility_id);
  }

  const todayMs = Date.parse(`${today}T00:00:00+09:00`);
  const result = await Promise.all([...byFacility.values()].map(async (r): Promise<TrialFollowUp> => {
    const fid = r.facility.id as string;
    const [staff, shifts, accepted, admin] = await Promise.all([
      sb.from('facility_staff').select('id', { count: 'exact', head: true }).eq('facility_id', fid).neq('status', 'ended'),
      sb.from('shifts').select('id', { count: 'exact', head: true }).eq('facility_id', fid),
      sb.from('shift_applications').select('id,shifts!inner(facility_id)', { count: 'exact', head: true })
        .eq('shifts.facility_id', fid).eq('status', 'accepted'),
      sb.auth.admin.getUserById(r.facility.admin_user_id),
    ]);
    const plan = Array.isArray(r.service_plans) ? r.service_plans[0] : r.service_plans;
    const daysLeft = Math.round((Date.parse(`${r.trial_ends_at}T00:00:00+09:00`) - todayMs) / 86_400_000);
    return {
      facilityId: fid, name: r.facility.name, planName: plan?.name ?? r.status,
      trialEndsAt: r.trial_ends_at, daysLeft, expired: r.status === 'expired' || daysLeft < 0,
      contactPhone: r.facility.contact_phone ?? null, adminEmail: admin.data?.user?.email ?? null,
      staffCount: staff.count ?? 0, shiftCount: shifts.count ?? 0, acceptedCount: accepted.count ?? 0,
    };
  }));
  // 임박한 것 먼저, 그다음 막 끝난 것
  return result.sort((a, b) => (a.expired === b.expired ? (a.expired ? b.daysLeft - a.daysLeft : a.daysLeft - b.daysLeft) : a.expired ? 1 : -1));
}

export async function listRegistrationRequests(): Promise<RegistrationRequest[]> {
  const { sb } = await requirePlatform();
  const { data, error } = await sb.from('facility_registration_requests')
    .select('id, facility_type, facility_name, address_text, contact_name, contact_phone, note, status, created_at, requested_by')
    .in('status', ['pending', 'reviewing']).order('created_at', { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as RegistrationRequest[];
}

export async function approveSelfRegisteredFacility(input: { facilityId: string; brn: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const { session, sb } = await requirePlatform();
    const result = await approveFacilityCore(sb, { id: session.user.id, email: session.user.email ?? null, name: (session.user.user_metadata?.name as string | undefined) ?? null }, input);
    if (result.ok) { revalidatePath('/ops/facilities'); revalidatePath('/'); await nudgeNotificationDispatch(); }
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '승인하지 못했어요.' };
  }
}

// 운영자가 카드에서 국세청 상태를 다시 조회한다
export async function recheckBusinessStatusAction(input: { facilityId: string }): Promise<{ ok: boolean; status?: string; detail?: string; error?: string }> {
  try {
    const { sb } = await requirePlatform();
    const { data: facility } = await sb.from('facilities').select('business_registration_number,brn_submitted').eq('id', input.facilityId).maybeSingle();
    const brn = String(facility?.brn_submitted ?? facility?.business_registration_number ?? '').replace(/\D/g, '');
    if (brn.length !== 10) return { ok: false, error: '사업자등록번호 10자리가 없어요.' };
    const result = await refreshFacilityBusinessStatus(sb, input.facilityId, brn);
    if (!result) return { ok: false, error: process.env.NTS_BUSINESS_API_KEY ? '국세청 조회 결과를 받지 못했어요. 잠시 후 다시 시도해 주세요.' : 'NTS_BUSINESS_API_KEY 가 설정되지 않아 조회할 수 없어요.' };
    revalidatePath('/ops/facilities');
    return { ok: true, status: result.status, detail: result.detail };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '조회하지 못했어요.' };
  }
}

// 직업안정법 §25(2026-12-10) — 구인자 공표 정보. 운영자가 고용노동부 체불사업주 명단(월 1회)·산재 발생건수 공표(연 1회)와 대조해 기록하면
// 근무자 사업장 시트·공개 공고 페이지에 그 사실이 게재된다. 컬럼이 아직 없으면(마이그레이션 전) 빈 목록.
export type FacilityPublicFlags = {
  id: string; name: string; business_registration_number: string | null;
  public_flag_wage_arrears: boolean; public_flag_industrial_accident: boolean; public_flags_checked_at: string | null; public_flags_note: string | null;
};
// 대조 대상 전부(200건에서 잘리지 않게 500건씩), 단기·행사(긱) 현장 제외. 조회 실패는 빈 목록이 아니라 오류로 — '대조할 곳 없음'으로 오해하지 않게
export async function listFacilityPublicFlags(): Promise<FacilityPublicFlags[]> {
  const { sb } = await requirePlatform();
  const rows: FacilityPublicFlags[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await sb.from('facilities')
      .select('id,name,business_registration_number,public_flag_wage_arrears,public_flag_industrial_accident,public_flags_checked_at,public_flags_note')
      .eq('is_demo', false).eq('is_active', true).is('deleted_at', null).neq('facility_type', 'gigworker')
      .order('name').order('id').range(from, from + 499);
    if (error) throw new Error('공표 대조 목록을 불러오지 못했어요.');
    rows.push(...((data ?? []) as FacilityPublicFlags[]));
    if ((data ?? []).length < 500) return rows;
  }
}

export async function setFacilityPublicFlagsAction(input: { facilityId: string; wageArrears: boolean; industrialAccident: boolean; note: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const { session, sb } = await requirePlatform();
    if (!/^[0-9a-f-]{36}$/i.test(input.facilityId) || typeof input.wageArrears !== 'boolean' || typeof input.industrialAccident !== 'boolean'
      || typeof input.note !== 'string' || input.note.length > 500) return { ok: false, error: '입력을 확인해 주세요.' };
    const { data: before } = await sb.from('facilities').select('public_flag_wage_arrears,public_flag_industrial_accident,public_flags_note').eq('id', input.facilityId).maybeSingle();
    const now = new Date().toISOString();
    const after = { public_flag_wage_arrears: input.wageArrears, public_flag_industrial_accident: input.industrialAccident, public_flags_note: input.note.trim() || null, public_flags_checked_at: now };
    const { error } = await sb.from('facilities').update(after).eq('id', input.facilityId);
    if (error) return { ok: false, error: '저장하지 못했어요. 마이그레이션 적용 여부를 확인해 주세요.' };
    // 대조 기록은 직업안정법 대응 증빙(대응 문서 4절) — 기록을 못 남기면 저장을 되돌린다
    const { error: auditError } = await sb.from('audit_logs').insert({
      actor_type: 'admin', actor_id: session.user.id, action: 'facility.public_flags.update',
      entity_type: 'facility', entity_id: input.facilityId, before_data: before ?? {}, after_data: after,
    });
    if (auditError) {
      if (before) await sb.from('facilities').update(before).eq('id', input.facilityId);
      return { ok: false, error: '처리 기록을 남기지 못해 되돌렸어요. 다시 저장해 주세요.' };
    }
    revalidatePath('/ops/facilities');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '저장하지 못했어요.' };
  }
}

export async function rejectSelfRegisteredFacility(input: { facilityId: string; reason: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const { session, sb } = await requirePlatform();
    const result = await rejectFacilityCore(sb, { id: session.user.id, email: session.user.email ?? null, name: (session.user.user_metadata?.name as string | undefined) ?? null }, input);
    if (result.ok) { revalidatePath('/ops/facilities'); await nudgeNotificationDispatch(); }
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '반려하지 못했어요.' };
  }
}

export async function setRegistrationRequestStatus(input: { requestId: string; status: 'reviewing' | 'approved' | 'rejected' | 'duplicate' }): Promise<{ ok: boolean; error?: string }> {
  try {
    const { session, sb } = await requirePlatform();
    const { error } = await sb.from('facility_registration_requests')
      .update({ status: input.status, reviewed_by: session.user.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', input.requestId);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/ops/facilities');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '처리하지 못했어요.' };
  }
}

// 운영자 화면 '지금 점검' — 매일 09:00 자동 점검과 같은 절차
export async function runHealthCheckNowAction(): Promise<void> {
  await requirePlatform();
  await runHealthCheck('manual');
  revalidatePath('/ops/facilities');
}
