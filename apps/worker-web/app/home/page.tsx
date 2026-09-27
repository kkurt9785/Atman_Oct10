'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ApplySheet } from '@/components/shifts/ApplySheet';
import type { Shift } from '@/app/shifts/page';
import { dateKST } from '@/lib/date';
import { facilityName, mobilityLabel, timeLabel } from '@/lib/shift-display';
import { WORKER_ROLE_LABEL, type WorkerRole } from '@/lib/roles';
import { WeekRoster } from '@/components/roster/WeekRoster';
import { Wordmark } from '@/components/brand/BrandMark';
import { WorkerModeBadge } from '@/components/worker/WorkerModeBadge';
import { addCount, cellKey, currentWeek, defaultSelection, setState, slotOf, SLOT_NAME, type RosterCells, type RosterSlot } from '@/lib/roster';
import { loadWorkerShellContext, rememberWorkerShell } from '@/lib/worker-mode';

// 의료 워커 홈 = 근무표 한 장 + 그 칸의 근무. 그 외는 없다.
//   ● 확정 근무, ○ 지원 중, +N 그 시간대에 갈 수 있는 근무. 칸을 누르면 아래 목록이 그 칸으로 좁혀진다.
// 상세 조건(업무·시급)은 근무 찾기 탭(/shifts)에서, 프로필·리워드는 내 정보에서 다룬다.

type ShiftWithFacility = Shift & {
  facilities: { name: string; address_text?: string | null; facility_type?: string | null } | null;
};
type NextAction={label:string;title:string;href:string;tone:'primary'|'success'};
type Activity = { shift_id: string; status: string; checked_in_at: string | null; checked_out_at: string | null; shifts: { shift_date: string; start_time: string } | Array<{ shift_date: string; start_time: string }> | null };
const shiftOfActivity = (row: Activity) => (Array.isArray(row.shifts) ? row.shifts[0] : row.shifts) ?? null;

function matchesCell(shift: Shift, cell: { date: string; slot: RosterSlot } | null) {
  if (!cell) return true;
  return shift.shift_date === cell.date && slotOf(shift.start_time) === cell.slot;
}

function minutesUntilKstTime(time: string) {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const [hour, minute] = time.slice(0, 5).split(':').map(Number);
  return hour * 60 + minute - nowMinutes;
}

function ListCard({ shift, onApply }: { shift: ShiftWithFacility; onApply: () => void }) {
  const pay   = shift.estimated_total_pay.toLocaleString('ko-KR');
  return (
    <div className="bg-white rounded-card shadow-card p-4 mb-3">
      <div className="flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-[12px] text-tertiary truncate">{facilityName(shift)}</p>
        <p className="text-[15px] font-bold text-ink mt-0.5">
          {shift.shift_date}　{timeLabel(shift)}
        </p>
        <p className="text-[12px] text-sub truncate mt-0.5">
          {[mobilityLabel(shift), shift.department].filter(Boolean).join(' · ')}{shift.is_overnight ? ' · 야간 +50%' : ''}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-[15px] font-extrabold text-primary">₩{pay}</p>
      </div>
      </div>
      <button onClick={onApply} className="mt-3 h-10 w-full bg-primary text-white text-[13px] font-bold rounded-btn active:opacity-80">지원하기</button>
    </div>
  );
}

// 현재 위치 조회 — 거부/타임아웃 시 null (지역 설정 기준으로 폴백)
function getPosition(timeoutMs = 3500): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => resolve(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 5 * 60 * 1000 }
    );
  });
}

export default function HomePage() {
  const router = useRouter();
  const [name,    setName]    = useState('');
  const [role,    setRole]    = useState<WorkerRole>('rn');
  const [areas,   setAreas]   = useState<string[]>([]);
  const [shifts,  setShifts]  = useState<ShiftWithFacility[]>([]);
  const [loading, setLoading] = useState(true);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [activity, setActivity] = useState<Activity[]>([]);
  const [selected, setSelected] = useState<ShiftWithFacility | null>(null);
  // 플랫폼 심사를 거치는 직군(약사 등)이 미승인이면 공고가 0건인 이유를 안내해야 한다
  const [reviewPending, setReviewPending] = useState(false);
  const [nextAction,setNextAction]=useState<NextAction|null>(null);
  const [hasGigLink, setHasGigLink] = useState(false);

  // 공고 탐색 기준 — 현재 위치 또는 등록 지역 중 하나
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [basis, setBasis] = useState<'gps' | string>('gps');
  const [locNotice, setLocNotice] = useState('');

  const week = useMemo(() => currentWeek(), []);
  const [cell, setCell] = useState<{ date: string; slot: RosterSlot } | null>(null);
  const [cellTouched, setCellTouched] = useState(false);

  // RPC 결과 → 화면 모델
  const mapRows = (rows: Record<string, unknown>[] | null) =>
    (rows ?? []).map((r) => ({
      ...r,
      distance_km:
        typeof r.distance_km === 'number'
          ? r.distance_km
          : typeof r.distance_meters === 'number'
            ? r.distance_meters / 1000
            : typeof r.distance_m === 'number'
              ? r.distance_m / 1000
              : null,
      facilities: {
        name: r.facility_name as string,
        address_text: (r.address_text ?? r.facility_address) as string | null,
      },
    })) as ShiftWithFacility[];

  // 사용자 ID·직군을 클라이언트에서 넘기지 않고 DB가 auth.uid()로 결정한다.
  const fetchShifts = useCallback(async (position: { lat: number; lng: number } | null, selectedBasis: 'gps' | string) => {
    const useGps = selectedBasis === 'gps' && Boolean(position);
    const { data, error } = await supabase.rpc('get_nearby_open_shifts_secure', {
      p_lat: useGps ? position!.lat : null,
      p_lng: useGps ? position!.lng : null,
      p_pref_labels: useGps ? [] : selectedBasis === 'gps' ? null : [selectedBasis],
    });
    if (error) {
      console.error('[home] secure shift discovery failed', error);
      setShifts([]);
      return;
    }
    setShifts(mapRows((data ?? []) as Record<string, unknown>[]));
  }, []);

  async function selectBasis(b: 'gps' | string) {
    if (b === basis && b !== 'gps') return;
    const prev = basis;
    setBasis(b);
    if (b === 'gps') {
      const fresh = await getPosition();
      if (fresh) setPos(fresh);
      const next = fresh ?? pos;
      if (!next) {
        setLocNotice('위치를 가져올 수 없어요. 브라우저 설정에서 위치 권한을 허용한 뒤 다시 눌러주세요.');
        setBasis(prev === 'gps' ? areas[0] ?? 'gps' : prev);
        return;
      }
      setLocNotice('');
      fetchShifts(next, b);
    } else {
      setLocNotice('');
      fetchShifts(pos, b);
    }
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/shifts');
        return;
      }
      setName(user.user_metadata?.profile_nickname ?? '사용자');

      const [{ data: locPref }, { data: workerRow }, shellContext] = await Promise.all([
        supabase.from('worker_location_prefs').select('locations').single(),
        supabase.from('workers').select('id, role, verification_status').eq('auth_user_id', user.id).maybeSingle(),
        loadWorkerShellContext(user).catch(() => null),
      ]);
      setHasGigLink(Boolean(shellContext?.hasGig));

      // 카카오 로그인만 하고 가입(온보딩)을 끝내지 않은 사람에게는 근무표를 보여주지 않는다 — 가입부터
      if (!workerRow) {
        router.replace('/onboarding?step=terms');
        return;
      }
      const userRole = (workerRow.role as WorkerRole) ?? 'rn';
      const areaLabels = ((locPref?.locations ?? []) as { label: string }[]).map((l) => l.label);
      setRole(userRole);
      setAreas(areaLabels);
      if (workerRow) {
        const skipsPlatformReview = ['rn', 'na', 'pharmacist', 'pharmacy_staff'].includes(workerRow.role);
        setReviewPending(!skipsPlatformReview && workerRow.verification_status !== 'approved');
      }

      // 이미 지원한 shift_id + 근무표에 올릴 확정·지원 중 근무 + 지금 할 일
      if (workerRow?.id) {
        const { data: appData } = await supabase
          .from('shift_applications')
          .select('shift_id,status,checked_in_at,checked_out_at,shifts(shift_date,start_time)')
          .eq('worker_id', workerRow.id)
          .in('status', ['invited','applied', 'accepted','completed']);
        const rows=[...((appData??[]) as unknown as Activity[])].sort((left,right)=>{
          const leftShift=shiftOfActivity(left);
          const rightShift=shiftOfActivity(right);
          return `${leftShift?.shift_date??'9999-12-31'}T${leftShift?.start_time??'23:59'}`
            .localeCompare(`${rightShift?.shift_date??'9999-12-31'}T${rightShift?.start_time??'23:59'}`);
        });
        setActivity(rows);
        setApplied(new Set(rows.filter(a=>['applied','accepted'].includes(a.status)).map(a=>a.shift_id)));
        const today=dateKST();
        const inProgress=rows.find(a=>a.status==='accepted'&&a.checked_in_at&&!a.checked_out_at);
        const todayReady=rows.find(a=>a.status==='accepted'&&!a.checked_in_at&&shiftOfActivity(a)?.shift_date===today);
        const waiting=rows.find(a=>a.status==='invited')??rows.find(a=>a.status==='applied');
        if(inProgress)setNextAction({label:'퇴근하기',title:'현재 근무 중이에요',href:'/workplace',tone:'success'});
        else if(todayReady){
          const shift=shiftOfActivity(todayReady);
          const minutes=minutesUntilKstTime(shift?.start_time??'00:00');
          setNextAction(minutes>30
            ?{label:'근무 준비',title:`오늘 ${shift?.start_time?.slice(0,5)??''} 근무가 있어요`,href:'/applications',tone:'primary'}
            :{label:'닿기로 출근',title:minutes>0?`${minutes}분 뒤 근무 시작`:'근무 시작 시간이에요',href:'/workplace',tone:'primary'});
        }
        else if(waiting)setNextAction({label:'확인',title:waiting.status==='invited'?'새 근무 요청이 도착했어요':'사업장에서 지원을 확인하고 있어요',href:'/applications',tone:'primary'});
      }

      const p = await getPosition();
      setPos(p);
      const initialBasis: 'gps' | string = p ? 'gps' : areaLabels[0] ?? 'gps';
      setBasis(initialBasis);
      await fetchShifts(p, initialBasis);
      setLoading(false);
    }
    load();
  }, [router, fetchShifts]);

  const roleLabel = WORKER_ROLE_LABEL[role];
  const openShifts = useMemo(() => shifts.filter((s) => !applied.has(s.id)), [shifts, applied]);

  // 근무표: 지원 가능한 근무 수(+N) + 확정(●)·지원 중(○)
  const cells = useMemo(() => {
    const next: RosterCells = {};
    const first = week[0].date, last = week[6].date;
    for (const s of openShifts) if (s.shift_date >= first && s.shift_date <= last) addCount(next, s.shift_date, s.start_time);
    for (const a of activity) {
      const shift = shiftOfActivity(a);
      if (!shift || shift.shift_date < first || shift.shift_date > last) continue;
      if (a.status === 'accepted' || a.status === 'completed') setState(next, shift.shift_date, shift.start_time, 'confirmed');
      else if (a.status === 'applied' || a.status === 'invited') setState(next, shift.shift_date, shift.start_time, 'applied');
    }
    return next;
  }, [openShifts, activity, week]);

  // 처음 한 번은 공고가 있는 첫 칸을 골라 둔다. 사용자가 칸을 누른 뒤에는 건드리지 않는다.
  useEffect(() => {
    if (loading || cellTouched) return;
    setCell(defaultSelection(week, cells));
  }, [loading, cellTouched, week, cells]);

  const filtered = openShifts.filter((s) => matchesCell(s, cell));
  const weekCount = openShifts.filter((s) => s.shift_date >= week[0].date && s.shift_date <= week[6].date).length;
  const selectedDay = week.find((day) => day.date === cell?.date);
  const selectedCount = cell ? cells[cellKey(cell.date, cell.slot)]?.count ?? 0 : 0;

  function handleApplied() {
    if (selected) setApplied((prev) => new Set(prev).add(selected.id));
    setSelected(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="pb-24">
      <div className="px-5 pt-12">
        <div className="flex items-center justify-between">
          <div>
            <Wordmark size={20} />
            <div className="mt-2"><WorkerModeBadge shell="medical" /></div>
          </div>
          <span className="rounded-full bg-primary/10 px-3 py-1.5 text-[12px] font-extrabold text-primary">{name} {roleLabel}</span>
        </div>

        {hasGigLink && <Link href="/gig" onClick={() => rememberWorkerShell('gig')} className="mt-4 flex items-center justify-between rounded-2xl bg-ink px-4 py-3 text-white shadow-sm active:opacity-80">
          <span><b className="block text-[13px]">긱워커 간편모드</b><span className="mt-0.5 block text-[11px] text-white/60">초대받은 일정·출퇴근·워크룸</span></span>
          <span className="text-[12px] font-extrabold text-primary">내 긱 근무 →</span>
        </Link>}

        {nextAction && (
          <Link href={nextAction.href} className={`mt-4 flex items-center justify-between rounded-2xl px-4 py-3.5 text-white shadow-btn ${nextAction.tone==='success'?'bg-success':'bg-primary'}`}>
            <span className="text-[15px] font-extrabold">{nextAction.title}</span>
            <span className="shrink-0 rounded-lg bg-white/20 px-3 py-1.5 text-[12px] font-extrabold">{nextAction.label} →</span>
          </Link>
        )}

        <h1 className="mt-5 text-[22px] font-extrabold leading-tight tracking-[-0.5px] text-ink">
          이번 주 내 근무표
          {weekCount > 0 && <span className="ml-2 text-[14px] font-bold text-primary">갈 수 있는 근무 {weekCount}건</span>}
        </h1>

        {(pos || areas.length > 0) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {pos && (
              <button onClick={() => selectBasis('gps')} className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${basis === 'gps' ? 'bg-primary text-white' : 'bg-bg text-sub'}`}>현재 위치</button>
            )}
            {areas.map((a) => (
              <button key={a} onClick={() => selectBasis(a)} className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${basis === a ? 'bg-primary text-white' : 'bg-bg text-sub'}`}>{a}</button>
            ))}
          </div>
        )}
        {locNotice && <p role="alert" className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[13px] font-bold text-amber-700">{locNotice}</p>}

        <div className="mt-3">
          <WeekRoster week={week} cells={cells} selected={cell} onSelect={(date, slot) => { setCellTouched(true); setCell(cell?.date === date && cell?.slot === slot ? null : { date, slot }); }} />
          <p className="mt-2 px-1 text-[11px] text-tertiary">● 확정 · ○ 지원 중 · +숫자 = 갈 수 있는 근무. 같은 칸을 다시 누르면 전체 보기</p>
        </div>
      </div>

      <section className="px-5 mt-5">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="text-[16px] font-extrabold text-ink">{cell && selectedDay ? `${selectedDay.isToday ? '오늘' : `${selectedDay.weekday}요일 ${selectedDay.dayNumber}일`} · ${cell.slot} ${SLOT_NAME[cell.slot]}` : '이번 주 전체'}</h2>
          <span className="text-[12px] font-bold text-sub">{cell ? selectedCount : filtered.length}건</span>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl bg-bg px-4 py-8 text-center">
            <p className="text-[15px] font-bold text-ink">{reviewPending ? '자격 심사 중이에요' : cell ? '이 칸엔 아직 근무가 없어요' : '이번 주 갈 수 있는 근무가 없어요'}</p>
            <p className="mt-1 text-[12px] text-sub">{reviewPending ? '심사가 끝나면 알림으로 알려드려요.' : '새 근무가 올라오면 알림으로 알려드려요.'}</p>
            {!reviewPending && cell && <button onClick={() => { setCellTouched(true); setCell(null); }} className="mt-3 text-[13px] font-bold text-primary">이번 주 전체 보기</button>}
          </div>
        ) : (
          filtered.map((s) => (
            <ListCard key={s.id} shift={s} onApply={() => setSelected(s)} />
          ))
        )}
      </section>

      {selected && (
        <ApplySheet
          shift={selected}
          onClose={() => setSelected(null)}
          onApplied={handleApplied}
        />
      )}
    </div>
  );
}
