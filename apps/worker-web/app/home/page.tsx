'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ApplySheet } from '@/components/shifts/ApplySheet';
import type { Shift } from '@/app/shifts/page';
import { dateKST } from '@/lib/date';
import { facilityName, mobilityLabel, timeLabel } from '@/lib/shift-display';
import { WORKER_ROLE_LABEL, type WorkerRole } from '@/lib/roles';

type ShiftWithFacility = Shift & {
  facilities: { name: string; address_text?: string | null; facility_type?: string | null } | null;
};
type NextAction={label:string;title:string;description:string;href:string;tone:'primary'|'success'};

// ─── 필터 타입 ─────────────────────────────────────────────────
type DateFilter = 'all' | 'today' | 'tomorrow' | 'week';
type TimeFilter = 'all' | 'night' | 'day' | 'early';
type WageFilter = 'all' | '12k' | '15k';
type DeptFilter = string;

const DATE_CHIPS: { value: DateFilter; label: string }[] = [
  { value: 'all',      label: '전체' },
  { value: 'today',    label: '오늘' },
  { value: 'tomorrow', label: '내일' },
  { value: 'week',     label: '이번주' },
];
const TIME_CHIPS: { value: TimeFilter; label: string }[] = [
  { value: 'all',   label: '전체' },
  { value: 'night', label: '🌙 야간 22–06' },
  { value: 'day',   label: '☀️ 주간 08–16' },
  { value: 'early', label: '🌅 이른 06–14' },
];
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
function toDateStr(d: Date) {
  return dateKST(0, d);
}
function matchesDate(shift: Shift, f: DateFilter) {
  if (f === 'all') return true;
  const today    = dateKST();
  const tomorrow = dateKST(1);
  const weekEnd  = dateKST(7);
  if (f === 'today')    return shift.shift_date === today;
  if (f === 'tomorrow') return shift.shift_date === tomorrow;
  if (f === 'week')     return shift.shift_date >= today && shift.shift_date <= weekEnd;
  return true;
}
function matchesTime(shift: Shift, f: TimeFilter) {
  const h = parseInt(shift.start_time.slice(0, 2), 10);
  if (f === 'night') return h >= 22 || h < 6;
  if (f === 'day')   return h >= 8 && h < 16;
  if (f === 'early') return h >= 6 && h < 14;
  return true;
}
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

function ShiftCard({
  shift, hot = false, onApply,
}: { shift: ShiftWithFacility; hot?: boolean; onApply: () => void }) {
  const pay   = shift.estimated_total_pay.toLocaleString('ko-KR');
  const isPharmacy = shift.facilities?.facility_type === 'pharmacy'
    || shift.required_role === 'pharmacist'
    || shift.required_role === 'pharmacy_staff';

  return (
    <div className="bg-white rounded-card shadow-card p-4 flex-shrink-0 w-[292px]">
      <div className="flex items-start gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-ink leading-tight truncate">{facilityName(shift)}</p>
        </div>
        {hot && (
          <span className="text-[11px] font-bold text-warn bg-warn/10 px-2 py-0.5 rounded-full flex-shrink-0">
            🔥 HOT
          </span>
        )}
      </div>

      <p className="text-[13px] font-bold text-primary mb-0.5">{shift.shift_date}</p>
      <p className="text-[19px] font-extrabold text-ink mb-1">
        {timeLabel(shift)}
      </p>
      <div className="mb-2 flex flex-wrap gap-1.5"><span className="rounded-full bg-bg px-2 py-1 text-[11px] font-bold text-sub">{mobilityLabel(shift)}</span>{shift.department&&<span className="rounded-full bg-bg px-2 py-1 text-[11px] font-bold text-sub">{shift.department}</span>}{shift.is_overnight&&<span className="rounded-full bg-kakao px-2 py-1 text-[11px] font-bold text-ink">야간 +50%</span>}</div>

      <div className="flex items-center justify-between pt-3 border-t border-line">
        <div>
          <p className="text-[11px] text-tertiary">예상 지급액</p>
          <p className="text-[18px] font-extrabold text-primary">₩{pay}</p>
        </div>
        <button
          onClick={onApply}
          className="h-10 px-5 bg-primary text-white text-[13px] font-bold rounded-btn shadow-btn active:opacity-80"
        >
          지원하기
        </button>
      </div>
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
          {[mobilityLabel(shift), shift.department].filter(Boolean).join(' · ')}
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
  const [selected, setSelected] = useState<ShiftWithFacility | null>(null);
  const [showProfileBanner, setShowProfileBanner] = useState(false);
  // 플랫폼 심사를 거치는 직군(약사 등)이 미승인이면 공고가 0건인 이유를 안내해야 한다
  const [reviewPending, setReviewPending] = useState(false);
  const [nextAction,setNextAction]=useState<NextAction>({label:'근무 찾기',title:'내 조건에 맞는 근무를 찾아보세요',description:'지역과 직종에 맞는 시프트를 모아 보여드려요.',href:'/shifts',tone:'primary'});

  // 공고 탐색 기준 — 🛰 현재 위치 또는 📍 등록 지역 중 하나 (세그먼트)
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [basis, setBasis] = useState<'gps' | string>('gps');
  const [locNotice, setLocNotice] = useState('');

  const [dateFilter, setDateFilter] = useState<DateFilter>('all'); // 기본 '전체' — 오늘 공고 0건이어도 첫 화면이 비지 않게
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
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

      // 이미 지원한 shift_id 목록
      if (workerRow?.id) {
        const [{ data: appData },{data:payments}] = await Promise.all([supabase
          .from('shift_applications')
          .select('shift_id,status,checked_in_at,checked_out_at,shifts(shift_date,start_time)')
          .eq('worker_id', workerRow.id)
          .in('status', ['invited','applied', 'accepted','completed']),supabase.from('wage_payment_instructions').select('status').eq('worker_id',workerRow.id).order('created_at',{ascending:false}).limit(1)]);
        const activity=(appData??[]) as any[];
        setApplied(new Set(activity.filter(a=>['applied','accepted'].includes(a.status)).map(a=>a.shift_id)));
        const today=dateKST();
        const inProgress=activity.find(a=>a.status==='accepted'&&a.checked_in_at&&!a.checked_out_at);
        const todayReady=activity.find(a=>a.status==='accepted'&&!a.checked_in_at&&(Array.isArray(a.shifts)?a.shifts[0]?.shift_date:a.shifts?.shift_date)===today);
        const waiting=activity.find(a=>['invited','applied'].includes(a.status));
        const future=activity.find(a=>a.status==='accepted'&&(Array.isArray(a.shifts)?a.shifts[0]?.shift_date:a.shifts?.shift_date)>today);
        const payment=(payments??[])[0];
        if(inProgress)setNextAction({label:'퇴근하기',title:'현재 근무 중이에요',description:'근무를 마치면 여기서 퇴근을 기록하세요.',href:'/workplace',tone:'success'});
        else if(todayReady)setNextAction({label:'출근하기',title:'오늘 확정된 근무가 있어요',description:'사업장에 도착하면 위치 또는 QR로 출근하세요.',href:'/workplace',tone:'primary'});
        else if(waiting)setNextAction({label:'지원 현황 보기',title:waiting.status==='invited'?'새 근무 요청이 도착했어요':'사업장에서 지원을 확인하고 있어요',description:'현재 진행 상태와 사업장 답변을 확인하세요.',href:'/applications',tone:'primary'});
        else if(future)setNextAction({label:'예정 근무 보기',title:'확정된 다음 근무가 있어요',description:'날짜와 출근 시간을 미리 확인하세요.',href:'/applications',tone:'primary'});
        else if(payment&&!['cancelled','worker_confirmed'].includes(payment.status))setNextAction({label:'지급 현황 확인',title:payment.status==='paid'?'사업장에서 지급을 완료했어요':'완료한 근무의 지급을 준비하고 있어요',description:payment.status==='paid'?'계좌 입금 여부를 확인해 주세요.':'예정 금액과 처리 상태를 확인하세요.',href:'/earnings',tone:'success'});
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
  const filtered   = roleShifts.filter(
    (s) =>
      matchesDate(s, dateFilter) &&
      matchesTime(s, timeFilter) &&
      matchesWage(s, wageFilter) &&
      matchesDept(s, deptFilter)
  );

  const todayCount = roleShifts.filter((s) => matchesDate(s, 'today')).length;

  function resetFilters() {
    setDateFilter('all');
    setTimeFilter('all');
    setWageFilter('all');
    setDeptFilter('all');
    setShowMoreFilters(false);
  }
  const extraFilterCount=[timeFilter!=='all',wageFilter!=='all',deptFilter!=='all'].filter(Boolean).length;

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
      <div className="px-5 pt-14 pb-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-[14px] text-sub">안녕하세요 👋</p>
            <h1 className="text-[24px] font-extrabold text-ink leading-tight mt-0.5">
              {name} {roleLabel}님,<br />
              {todayCount > 0
                ? <><span className="text-primary">오늘 지원 가능 {todayCount}건</span> 있어요</>
                : <span className="text-ink">새 시프트를 기다리는 중</span>
              }
            </h1>
          </div>
        </div>
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

      <section className={`mx-5 mb-4 rounded-2xl p-4 ${nextAction.tone==='success'?'bg-success text-white':'bg-primary text-white'} shadow-btn`}>
        <p className="text-[11px] font-bold text-white/75">지금 할 일</p><h2 className="mt-1 text-[17px] font-extrabold">{nextAction.title}</h2><p className="mt-1 text-[12px] text-white/80">{nextAction.description}</p><Link href={nextAction.href} className="mt-3 flex h-11 w-full items-center justify-center rounded-xl bg-white text-[14px] font-extrabold text-primary">{nextAction.label}</Link>
      </section>

      <div className="mx-5 mb-4 rounded-2xl border border-line bg-white px-4 py-3 shadow-sm">
        <p className="text-[11px] font-bold text-sub">잇닿 이용 순서</p>
        <div className="mt-2 flex items-center justify-between gap-1 text-[11px] font-extrabold text-primary">
          <span>① 근무 찾기</span><span className="text-line">→</span>
          <Link href="/applications">② 지원</Link><span className="text-line">→</span>
          <Link href="/workplace">③ 출퇴근</Link><span className="text-line">→</span>
          <Link href="/earnings">④ 입금 확인</Link>
        </div>
      </div>

      <Link href="/rewards" className="mx-5 mb-4 block rounded-2xl border border-primary/20 bg-primary/8 p-4 active:opacity-80">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-bold text-primary">런칭 리워드</p>
            <p className="mt-0.5 text-[16px] font-extrabold text-ink">프로필 인증부터 첫 근무까지</p>
            <p className="mt-1 text-[12px] text-sub">커피 5천원 · 첫 근무 완료 2만원</p>
          </div>
          <span className="shrink-0 text-[13px] font-extrabold text-primary">내 진행 보기 →</span>
        </div>
      </Link>

      {/* 프로필 미완성 배너 */}
      {showProfileBanner && (
        <div className="mx-5 mb-4 bg-primary/8 border border-primary/20 rounded-2xl p-4 flex items-center gap-3">
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

      {/* 필터 */}
      <div className="px-5 pb-4 flex flex-col gap-2">
        <ChipRow options={DATE_CHIPS} value={dateFilter} onChange={setDateFilter} />
        <button type="button" onClick={()=>setShowMoreFilters(value=>!value)} aria-expanded={showMoreFilters} className="flex h-10 items-center justify-between rounded-xl border border-line bg-white px-3 text-[12px] font-bold text-sub">
          <span>시간·업무·시급 조건{extraFilterCount?` ${extraFilterCount}개 적용`:''}</span><span>{showMoreFilters?'접기 ↑':'더보기 ↓'}</span>
        </button>
        {showMoreFilters&&<div className="flex flex-col gap-2 rounded-2xl bg-white p-3 shadow-sm">
          <ChipRow options={TIME_CHIPS} value={timeFilter} onChange={setTimeFilter} />
          <ChipRow options={deptChips}  value={deptFilter} onChange={setDeptFilter} />
          <ChipRow options={WAGE_CHIPS} value={wageFilter} onChange={setWageFilter} />
          {extraFilterCount>0&&<button type="button" onClick={()=>{setTimeFilter('all');setDeptFilter('all');setWageFilter('all');}} className="self-end text-[12px] font-bold text-primary">상세 조건 초기화</button>}
        </div>}
      </div>

      {/* 조건에 맞는 공고 — 추천/전체 중복 없이 한 목록에서 바로 지원 */}
      <section className="px-5">
        <div className="mb-3 flex items-end justify-between gap-3"><div><p className="text-[12px] font-bold text-primary">선택한 조건</p><h2 className="text-[18px] font-extrabold text-ink">지원 가능한 근무</h2></div><span className="text-[12px] font-bold text-sub">{filtered.length}건</span></div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 gap-3">
            <span className="text-5xl">{reviewPending ? '⏳' : '🔍'}</span>
            <p className="text-[15px] font-bold text-ink">{reviewPending ? '자격 심사 중이에요' : '조건에 맞는 시프트가 없어요'}</p>
            {reviewPending ? (
              <p className="text-center text-[13px] leading-5 text-sub">심사가 끝나면 알림으로 알려드리고,<br />이 화면에 지원 가능한 근무가 열려요.</p>
            ) : (
              <button onClick={resetFilters} className="text-[14px] text-primary font-semibold">
                필터 초기화
              </button>
            )}
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
