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
import { addCount, cellKey, currentWeek, defaultSelection, setState, slotOf, SLOT_NAME, type RosterCells, type RosterSlot } from '@/lib/roster';

// 의료 워커 홈 = "이번 주 내 근무표". 확정 근무는 진한 칸, 지원 중은 연한 칸, 빈 칸에는 갈 수 있는 근무 수.
// 칸을 누르면 그 시간대의 근무만 아래에 남는다. 날짜·시간 필터 칩은 근무표가 대신한다.

type ShiftWithFacility = Shift & {
  facilities: { name: string; address_text?: string | null; facility_type?: string | null } | null;
};
type NextAction={label:string;title:string;description:string;href:string;tone:'primary'|'success'};
type Activity = { shift_id: string; status: string; checked_in_at: string | null; checked_out_at: string | null; shifts: { shift_date: string; start_time: string } | Array<{ shift_date: string; start_time: string }> | null };
const shiftOfActivity = (row: Activity) => (Array.isArray(row.shifts) ? row.shifts[0] : row.shifts) ?? null;

// ─── 필터 타입 ─────────────────────────────────────────────────
type WageFilter = 'all' | '12k' | '15k';
type DeptFilter = string;

const WAGE_CHIPS: { value: WageFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: '12k', label: '₩12,000+' },
  { value: '15k', label: '₩15,000+' },
];
const DEPT_CHIPS_RN: { value: DeptFilter; label: string }[] = [
  { value: 'all',    label: '전체' },
  { value: '일반병동', label: '일반병동' },
  { value: '중환자실', label: '중환자실 ICU' },
  { value: '응급실',  label: '응급실 ER' },
  { value: '수술실',  label: '수술실 OR' },
  { value: '외래',   label: '외래' },
];
const DEPT_CHIPS_NA: { value: DeptFilter; label: string }[] = [
  { value: 'all',      label: '전체' },
  { value: '요양원',   label: '요양원' },
  { value: '요양병원', label: '요양병원' },
  { value: '의원·클리닉', label: '의원·클리닉' },
  { value: '재활병원', label: '재활병원' },
  { value: '한의원',   label: '한의원' },
];
const DEPT_CHIPS_PHARMACIST: { value: DeptFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: '조제실', label: '조제실' },
  { value: '대체약사', label: '대체약사' },
  { value: '주말근무', label: '주말근무' },
  { value: '야간약국', label: '야간약국' },
];
const DEPT_CHIPS_PHARMACY_STAFF: { value: DeptFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: '전산·접수', label: '전산·접수' },
  { value: '재고관리', label: '재고관리' },
  { value: '사무보조', label: '사무보조' },
  { value: '매대관리', label: '매대관리' },
];

// ─── 필터 함수 ─────────────────────────────────────────────────
function matchesWage(shift: Shift, f: WageFilter) {
  if (f === '12k') return shift.hourly_wage >= 12000;
  if (f === '15k') return shift.hourly_wage >= 15000;
  return true;
}
function matchesDept(shift: Shift, f: DeptFilter) {
  if (f === 'all') return true;
  // 부서는 자유 텍스트라 정확일치는 죽은 필터가 됨 — 부서·업무설명 부분일치로 매칭
  return (shift.department ?? '').includes(f) || (shift.description ?? '').includes(f);
}
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

// ─── 서브 컴포넌트 ─────────────────────────────────────────────
function ChipRow<T extends string>({
  options, value, onChange,
}: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`whitespace-nowrap px-3.5 py-2 rounded-full text-[13px] font-semibold flex-shrink-0 transition-colors ${
            value === o.value ? 'bg-primary text-white' : 'bg-bg text-sub'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
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

// ─── 메인 ──────────────────────────────────────────────────────
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
  const [showProfileBanner, setShowProfileBanner] = useState(false);
  // 플랫폼 심사를 거치는 직군(약사 등)이 미승인이면 공고가 0건인 이유를 안내해야 한다
  const [reviewPending, setReviewPending] = useState(false);
  const [nextAction,setNextAction]=useState<NextAction|null>(null);

  // 공고 탐색 기준 — 🛰 현재 위치 또는 📍 등록 지역 중 하나 (세그먼트)
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [basis, setBasis] = useState<'gps' | string>('gps');
  const [locNotice, setLocNotice] = useState('');

  const week = useMemo(() => currentWeek(), []);
  const [cell, setCell] = useState<{ date: string; slot: RosterSlot } | null>(null);
  const [cellTouched, setCellTouched] = useState(false);
  const [wageFilter, setWageFilter] = useState<WageFilter>('all');
  const [deptFilter, setDeptFilter] = useState<DeptFilter>('all');
  const [showMoreFilters, setShowMoreFilters] = useState(false);

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
    // 지역 칩은 같은 칩 재클릭 시 no-op, GPS 칩은 재클릭 = 위치 새로고침으로 동작
    if (b === basis && b !== 'gps') return;
    const prev = basis;
    setBasis(b);
    if (b === 'gps') {
      // 누를 때마다 위치를 다시 조회 — 이동 후에도 신선한 좌표를 쓰고,
      // 최초에 권한을 거부한 사용자에게는 이 시점에 다시 요청된다.
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

      const [
        { data: locPref },
        { data: workerRow },
      ] = await Promise.all([
        supabase.from('worker_location_prefs').select('locations').single(),
        supabase.from('workers')
          .select('id, role, verification_status, license_number, license_photo_url, experience_years, last_workplace, department_tags')
          .eq('auth_user_id', user.id)
          .maybeSingle(),
      ]);

      const userRole = (workerRow?.role as WorkerRole) ?? 'rn';
      const areaLabels = ((locPref?.locations ?? []) as { label: string }[]).map((l) => l.label);
      setRole(userRole);
      setAreas(areaLabels);

      if (workerRow) {
        const w = workerRow as Record<string, unknown>;
        const skipsPlatformReview = w.role === 'rn' || w.role === 'na' || w.role === 'pharmacist' || w.role === 'pharmacy_staff';
        setReviewPending(!skipsPlatformReview && w.verification_status !== 'approved');
        const credentialReady = w.role==='pharmacy_staff'||w.role==='rn'||w.role==='na'||w.license_number||w.license_photo_url;
        const incomplete = !(credentialReady && w.experience_years && w.last_workplace && (w.department_tags as string[] | null)?.length);
        setShowProfileBanner(incomplete);
      }

      // 이미 지원한 shift_id 목록 + 근무표에 올릴 확정·지원 중 근무
      if (workerRow?.id) {
        const [{ data: appData },{data:payments}] = await Promise.all([supabase
          .from('shift_applications')
          .select('shift_id,status,checked_in_at,checked_out_at,shifts(shift_date,start_time)')
          .eq('worker_id', workerRow.id)
          .in('status', ['invited','applied', 'accepted','completed']),supabase.from('wage_payment_instructions').select('status').eq('worker_id',workerRow.id).order('created_at',{ascending:false}).limit(1)]);
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
        const future=rows.find(a=>a.status==='accepted'&&(shiftOfActivity(a)?.shift_date??'')>today);
        const payment=(payments??[])[0];
        if(inProgress)setNextAction({label:'퇴근하기',title:'현재 근무 중이에요',description:'근무를 마치면 여기서 퇴근을 기록하세요.',href:'/workplace',tone:'success'});
        else if(todayReady){
          const shift=shiftOfActivity(todayReady);
          const minutes=minutesUntilKstTime(shift?.start_time??'00:00');
          if(minutes>30)setNextAction({label:'근무 준비 보기',title:`오늘 ${shift?.start_time?.slice(0,5)??''} 근무가 있어요`,description:'시작 30분 전부터 출근 준비와 출근 버튼을 앱에서 확인할 수 있어요.',href:'/applications',tone:'primary'});
          else if(minutes>=-5)setNextAction({label:'닿기로 출근',title:'출근을 준비해 주세요',description:minutes>0?`${minutes}분 뒤 근무가 시작돼요. 사업장에 도착하면 닿기 버튼을 길게 눌러 출근하세요.`:'근무 시작 시간이에요. 닿기 버튼을 길게 눌러 출근하세요.',href:'/workplace',tone:'primary'});
          else setNextAction({label:'출근 상태 확인',title:'출근 확인이 필요해요',description:'관리자도 이 근무의 출근 상태를 확인하고 있어요. 지금 출근 인증을 진행해 주세요.',href:'/workplace',tone:'primary'});
        }
        else if(waiting)setNextAction({label:'지원 현황 보기',title:waiting.status==='invited'?'새 근무 요청이 도착했어요':'사업장에서 지원을 확인하고 있어요',description:'현재 진행 상태와 사업장 답변을 확인하세요.',href:'/applications',tone:'primary'});
        else if(payment&&!['cancelled','worker_confirmed'].includes(payment.status))setNextAction({label:'지급 현황 확인',title:payment.status==='paid'?'사업장에서 지급을 완료했어요':'완료한 근무의 지급을 준비하고 있어요',description:payment.status==='paid'?'계좌 입금 여부를 확인해 주세요.':'예정 금액과 처리 상태를 확인하세요.',href:'/earnings',tone:'success'});
        else if(future)setNextAction({label:'예정 근무 보기',title:'확정된 다음 근무가 있어요',description:'가장 가까운 확정 근무의 날짜와 출근 시간을 확인하세요.',href:'/applications',tone:'primary'});
      }

      // 기본 기준: GPS 가능하면 현재 위치, 아니면 첫 번째 등록 지역
      const p = await getPosition();
      setPos(p);
      const initialBasis: 'gps' | string = p ? 'gps' : areaLabels[0] ?? 'gps';
      setBasis(initialBasis);
      await fetchShifts(p, initialBasis);
      setLoading(false);
    }
    load();
  }, [router, fetchShifts]);

  const deptChips = role === 'rn' ? DEPT_CHIPS_RN
    : role === 'na' ? DEPT_CHIPS_NA
    : role === 'pharmacist' ? DEPT_CHIPS_PHARMACIST
    : DEPT_CHIPS_PHARMACY_STAFF;
  const roleLabel = WORKER_ROLE_LABEL[role];

  const roleShifts = shifts.filter((s) => !applied.has(s.id));

  // 근무표: 지원 가능한 근무 수(+N) + 확정(●)·지원 중(○)
  const cells = useMemo(() => {
    const next: RosterCells = {};
    const first = week[0].date, last = week[6].date;
    for (const s of roleShifts) if (s.shift_date >= first && s.shift_date <= last) addCount(next, s.shift_date, s.start_time);
    for (const a of activity) {
      const shift = shiftOfActivity(a);
      if (!shift || shift.shift_date < first || shift.shift_date > last) continue;
      if (a.status === 'accepted' || a.status === 'completed') setState(next, shift.shift_date, shift.start_time, 'confirmed');
      else if (a.status === 'applied' || a.status === 'invited') setState(next, shift.shift_date, shift.start_time, 'applied');
    }
    return next;
    // roleShifts 는 shifts·applied 에서 매번 새로 만들어지므로 원본을 의존성으로 둔다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shifts, applied, activity, week]);

  // 처음 한 번은 공고가 있는 첫 칸을 골라 둔다. 사용자가 칸을 누른 뒤에는 건드리지 않는다.
  useEffect(() => {
    if (loading || cellTouched) return;
    setCell(defaultSelection(week, cells));
  }, [loading, cellTouched, week, cells]);

  const filtered   = roleShifts.filter(
    (s) =>
      matchesCell(s, cell) &&
      matchesWage(s, wageFilter) &&
      matchesDept(s, deptFilter)
  );
  const weekCount = roleShifts.filter((s) => s.shift_date >= week[0].date && s.shift_date <= week[6].date).length;
  const selectedDay = week.find((day) => day.date === cell?.date);
  const selectedCount = cell ? cells[cellKey(cell.date, cell.slot)]?.count ?? 0 : 0;

  function resetFilters() {
    setCell(null);
    setCellTouched(true);
    setWageFilter('all');
    setDeptFilter('all');
    setShowMoreFilters(false);
  }
  const extraFilterCount=[wageFilter!=='all',deptFilter!=='all'].filter(Boolean).length;

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
      {/* 헤더 */}
      <div className="px-5 pt-12 pb-3">
        <div className="flex items-center justify-between">
          <Wordmark size={20} />
          <span className="rounded-full bg-primary/10 px-3 py-1.5 text-[12px] font-extrabold text-primary">{name} {roleLabel}</span>
        </div>
        <h1 className="mt-5 text-[24px] font-extrabold leading-tight tracking-[-0.6px] text-ink">
          이번 주 내 근무표<br />
          {weekCount > 0
            ? <><span className="text-primary">빈 칸에 {weekCount}건</span> 갈 수 있어요</>
            : <span className="text-ink">새 근무를 기다리는 중</span>}
        </h1>
        {locNotice && (
          <p role="alert" className="mt-3 rounded-xl bg-amber-50 text-amber-700 text-[13px] font-bold px-3 py-2">{locNotice}</p>
        )}
        {(pos || areas.length > 0) && (
          <div className="flex gap-1.5 mt-3 flex-wrap">
            {pos && (
              <button
                onClick={() => selectBasis('gps')}
                className={`text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors ${
                  basis === 'gps' ? 'text-white bg-primary' : 'text-sub bg-bg'
                }`}
              >
                🛰 현재 위치
              </button>
            )}
            {areas.map((a) => (
              <button
                key={a}
                onClick={() => selectBasis(a)}
                className={`text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors ${
                  basis === a ? 'text-white bg-primary' : 'text-sub bg-bg'
                }`}
              >
                📍 {a}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 근무표 */}
      <div className="px-5">
        <WeekRoster week={week} cells={cells} selected={cell} onSelect={(date, slot) => { setCellTouched(true); setCell(cell?.date === date && cell?.slot === slot ? null : { date, slot }); }} />
        <p className="mt-2 px-1 text-[11px] text-tertiary">● 확정 근무 · ○ 지원 중 · +숫자 = 그 시간대에 갈 수 있는 근무. 같은 칸을 다시 누르면 전체 보기</p>
      </div>

      {nextAction && <section className={`mx-5 mt-4 rounded-2xl p-4 ${nextAction.tone==='success'?'bg-success text-white':'bg-primary text-white'} shadow-btn`}>
        <p className="text-[11px] font-bold text-white/75">지금 할 일</p><h2 className="mt-1 text-[17px] font-extrabold">{nextAction.title}</h2><p className="mt-1 text-[12px] text-white/80">{nextAction.description}</p><Link href={nextAction.href} className="mt-3 flex h-11 w-full items-center justify-center rounded-xl bg-white text-[14px] font-extrabold text-primary">{nextAction.label}</Link>
      </section>}

      {/* 프로필 미완성 배너 */}
      {showProfileBanner && (
        <div className="mx-5 mt-4 bg-primary/8 border border-primary/20 rounded-2xl p-4 flex items-center gap-3">
          <span className="text-2xl flex-shrink-0">📋</span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-ink">프로필 카드를 완성해보세요</p>
            <p className="text-[12px] text-sub mt-0.5">지원할 사업장에 더 좋은 첫인상을 남길 수 있어요</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link href="/settings/profile" className="text-[12px] font-bold text-primary whitespace-nowrap">
              완성하기 →
            </Link>
            <button
              onClick={() => setShowProfileBanner(false)}
              className="text-tertiary text-[16px] leading-none"
              aria-label="닫기"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* 선택한 칸의 근무 */}
      <section className="px-5 mt-5">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-[12px] font-bold text-primary">{cell && selectedDay ? `${selectedDay.isToday ? '오늘' : `${selectedDay.weekday}요일 ${selectedDay.dayNumber}일`} · ${cell.slot} ${SLOT_NAME[cell.slot]}` : '이번 주 전체'}</p>
            <h2 className="text-[18px] font-extrabold text-ink">지원 가능한 근무</h2>
          </div>
          <span className="text-[12px] font-bold text-sub">{cell ? selectedCount : filtered.length}건</span>
        </div>
        <button type="button" onClick={()=>setShowMoreFilters(value=>!value)} aria-expanded={showMoreFilters} className="mb-3 flex h-10 w-full items-center justify-between rounded-xl border border-line bg-white px-3 text-[12px] font-bold text-sub">
          <span>업무·시급 조건{extraFilterCount?` ${extraFilterCount}개 적용`:''}</span><span>{showMoreFilters?'접기 ↑':'더보기 ↓'}</span>
        </button>
        {showMoreFilters&&<div className="mb-3 flex flex-col gap-2 rounded-2xl bg-white p-3 shadow-sm">
          <ChipRow options={deptChips}  value={deptFilter} onChange={setDeptFilter} />
          <ChipRow options={WAGE_CHIPS} value={wageFilter} onChange={setWageFilter} />
          {extraFilterCount>0&&<button type="button" onClick={()=>{setDeptFilter('all');setWageFilter('all');}} className="self-end text-[12px] font-bold text-primary">상세 조건 초기화</button>}
        </div>}

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center py-12 gap-3">
            <span className="text-5xl">{reviewPending ? '⏳' : '🗓'}</span>
            <p className="text-[15px] font-bold text-ink">{reviewPending ? '자격 심사 중이에요' : cell ? '이 칸엔 아직 근무가 없어요' : '조건에 맞는 근무가 없어요'}</p>
            {reviewPending ? (
              <p className="text-center text-[13px] leading-5 text-sub">심사가 끝나면 알림으로 알려드리고,<br />이 화면에 지원 가능한 근무가 열려요.</p>
            ) : (
              <button onClick={resetFilters} className="text-[14px] text-primary font-semibold">
                이번 주 전체 보기
              </button>
            )}
          </div>
        ) : (
          filtered.map((s) => (
            <ListCard key={s.id} shift={s} onApply={() => setSelected(s)} />
          ))
        )}
      </section>

      <Link href="/rewards" className="mx-5 mt-2 block rounded-2xl border border-primary/20 bg-primary/8 p-4 active:opacity-80">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-bold text-primary">런칭 리워드</p>
            <p className="mt-0.5 text-[16px] font-extrabold text-ink">프로필 인증부터 첫 근무까지</p>
            <p className="mt-1 text-[12px] text-sub">커피 5천원 · 첫 근무 완료 2만원</p>
          </div>
          <span className="shrink-0 text-[13px] font-extrabold text-primary">내 진행 보기 →</span>
        </div>
      </Link>

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
