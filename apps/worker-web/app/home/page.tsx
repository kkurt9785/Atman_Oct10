'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ApplySheet } from '@/components/shifts/ApplySheet';
import type { Shift } from '@/app/shifts/page';
import { dateKST } from '@/lib/date';

type ShiftWithFacility = Shift & {
  facilities: { name: string } | null;
};

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
  return shift.department === f;
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
  const facilityName = shift.facilities?.name ?? '병원/클리닉';
  const start = shift.start_time.slice(0, 5);
  const end   = shift.end_time.slice(0, 5);
  const pay   = shift.estimated_total_pay.toLocaleString('ko-KR');

  return (
    <div className="bg-white rounded-card shadow-card p-5 flex-shrink-0 w-[300px]">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl bg-primary-light flex items-center justify-center flex-shrink-0">
          <span className="text-[18px]">🏥</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-ink leading-tight truncate">{facilityName}</p>
        </div>
        {hot && (
          <span className="text-[11px] font-bold text-warn bg-warn/10 px-2 py-0.5 rounded-full flex-shrink-0">
            🔥 HOT
          </span>
        )}
      </div>

      <p className="text-[13px] text-sub mb-0.5">{shift.shift_date}</p>
      <p className="text-[19px] font-extrabold text-ink mb-1">
        {start} – {end}{shift.is_overnight ? ' (익일)' : ''}
      </p>
      {shift.department && (
        <p className="text-[12px] text-tertiary mb-2">{shift.department}</p>
      )}
      {shift.is_overnight && (
        <span className="inline-flex items-center px-2 py-0.5 bg-kakao rounded-full text-[11px] font-bold text-ink mb-2">
          야간수당 +50%
        </span>
      )}

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
  const facilityName = shift.facilities?.name ?? '병원/클리닉';
  const start = shift.start_time.slice(0, 5);
  const end   = shift.end_time.slice(0, 5);
  const pay   = shift.estimated_total_pay.toLocaleString('ko-KR');

  return (
    <div className="bg-white rounded-card shadow-card p-4 mb-3 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-[12px] text-tertiary truncate">{facilityName}</p>
        <p className="text-[15px] font-bold text-ink mt-0.5">
          {shift.shift_date}　{start}–{end}
        </p>
        <p className="text-[12px] text-sub truncate mt-0.5">{shift.department}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-[15px] font-extrabold text-primary">₩{pay}</p>
        <button
          onClick={onApply}
          className="mt-1.5 h-8 px-4 bg-primary text-white text-[12px] font-bold rounded-btn active:opacity-80"
        >
          지원
        </button>
      </div>
    </div>
  );
}

// ─── 메인 ──────────────────────────────────────────────────────
export default function HomePage() {
  const router = useRouter();
  const [name,    setName]    = useState('');
  const [role,    setRole]    = useState<'rn' | 'na'>('rn');
  const [areas,   setAreas]   = useState<string[]>([]);
  const [credits, setCredits] = useState(0);
  const [shifts,  setShifts]  = useState<ShiftWithFacility[]>([]);
  const [loading, setLoading] = useState(true);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<ShiftWithFacility | null>(null);
  const [showProfileBanner, setShowProfileBanner] = useState(false);

  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [wageFilter, setWageFilter] = useState<WageFilter>('all');
  const [deptFilter, setDeptFilter] = useState<DeptFilter>('all');

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
        { data: creditsData },
        { data: workerRow },
      ] = await Promise.all([
        supabase.from('worker_location_prefs').select('locations').single(),
        supabase.from('user_credits').select('balance').eq('user_id', user.id).maybeSingle(),
        supabase.from('workers')
          .select('id, role, license_number, license_photo_url, experience_years, last_workplace, department_tags')
          .eq('auth_user_id', user.id)
          .maybeSingle(),
      ]);

      const userRole = (workerRow?.role as 'rn' | 'na') ?? 'rn';
      setRole(userRole);
      setAreas(((locPref?.locations ?? []) as { label: string }[]).map((l) => l.label));
      setCredits(creditsData?.balance ?? 0);

      if (workerRow) {
        const w = workerRow as Record<string, unknown>;
        const incomplete = !((w.license_number || w.license_photo_url) && w.experience_years && w.last_workplace && (w.department_tags as string[] | null)?.length);
        setShowProfileBanner(incomplete);
      }

      // 이미 지원한 shift_id 목록
      if (workerRow?.id) {
        const { data: appData } = await supabase
          .from('shift_applications')
          .select('shift_id')
          .eq('worker_id', workerRow.id)
          .in('status', ['applied', 'accepted']);
        setApplied(new Set((appData ?? []).map((a: { shift_id: string }) => a.shift_id)));
      }

      // 위치 기반 근처 시프트 조회
      const roleFilter = userRole === 'rn' ? ['rn', 'any'] : ['na', 'any'];
      let shiftRows: ShiftWithFacility[] = [];

      if (user) {
        const { data: rpcData } = await supabase.rpc('get_nearby_open_shifts', {
          p_auth_user_id: user.id,
          p_roles: roleFilter,
        });
        shiftRows = (rpcData ?? []).map((r: Record<string, unknown>) => ({
          ...r,
          facilities: { name: r.facility_name as string },
        })) as ShiftWithFacility[];
      }

      setShifts(shiftRows);
      setLoading(false);
    }
    load();
  }, [router]);

  const deptChips = role === 'rn' ? DEPT_CHIPS_RN : DEPT_CHIPS_NA;
  const roleLabel = role === 'rn' ? '간호사' : '간호조무사';

  const roleShifts = shifts.filter((s) => !applied.has(s.id));
  const filtered   = roleShifts.filter(
    (s) =>
      matchesDate(s, dateFilter) &&
      matchesTime(s, timeFilter) &&
      matchesWage(s, wageFilter) &&
      matchesDept(s, deptFilter)
  );

  const recommended = filtered.slice(0, 3);
  const areaShifts  = filtered.slice(3);

  function resetFilters() {
    setDateFilter('all');
    setTimeFilter('all');
    setWageFilter('all');
    setDeptFilter('all');
  }

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
              {roleShifts.length > 0
                ? <><span className="text-primary">시프트 {roleShifts.length}건</span> 있어요</>
                : <span className="text-ink">새 시프트를 기다리는 중</span>
              }
            </h1>
          </div>
          {/* 적립금 버튼 */}
          <Link href="/store" className="flex-shrink-0 ml-3 mt-1">
            <div className="flex flex-col items-center bg-primary/8 border border-primary/20 px-3.5 py-2.5 rounded-2xl active:opacity-70 transition-opacity">
              <span className="text-[10px] font-semibold text-primary tracking-tight">적립금</span>
              <span className="text-[17px] font-extrabold text-primary leading-tight">
                ₩{credits.toLocaleString('ko-KR')}
              </span>
              <span className="text-[10px] text-primary/60 mt-0.5">스토어 →</span>
            </div>
          </Link>
        </div>
        {areas.length > 0 && (
          <div className="flex gap-1.5 mt-3 flex-wrap">
            {areas.map((a) => (
              <span key={a} className="text-[12px] font-semibold text-primary bg-primary-light px-2.5 py-1 rounded-full">
                📍 {a}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 프로필 미완성 배너 */}
      {showProfileBanner && (
        <div className="mx-5 mb-4 bg-primary/8 border border-primary/20 rounded-2xl p-4 flex items-center gap-3">
          <span className="text-2xl flex-shrink-0">📋</span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-ink">프로필 카드를 완성해보세요</p>
            <p className="text-[12px] text-sub mt-0.5">병원 HR에게 더 좋은 첫인상을 남길 수 있어요</p>
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
        <ChipRow options={TIME_CHIPS} value={timeFilter} onChange={setTimeFilter} />
        <ChipRow options={deptChips}  value={deptFilter} onChange={setDeptFilter} />
        <ChipRow options={WAGE_CHIPS} value={wageFilter} onChange={setWageFilter} />
      </div>

      {/* 추천 시프트 */}
      {recommended.length > 0 && (
        <section className="mb-6">
          <div className="px-5 flex items-center justify-between mb-3">
            <h2 className="text-[16px] font-extrabold text-ink">🔥 추천 시프트</h2>
            <span className="text-[12px] text-tertiary">조건 맞춤</span>
          </div>
          <div className="overflow-x-auto scrollbar-hide">
            <div className="flex gap-3 px-5 pb-2">
              {recommended.map((s) => (
                <ShiftCard key={s.id} shift={s} hot onApply={() => setSelected(s)} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 전체 공고 */}
      <section className="px-5">
        <h2 className="text-[16px] font-extrabold text-ink mb-3">
          {areas.length > 0 ? `📍 ${areas[0]} 전체 공고` : '📍 전체 공고'}
        </h2>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 gap-3">
            <span className="text-5xl">🔍</span>
            <p className="text-[15px] font-bold text-ink">조건에 맞는 시프트가 없어요</p>
            <button onClick={resetFilters} className="text-[14px] text-primary font-semibold">
              필터 초기화
            </button>
          </div>
        ) : areaShifts.length === 0 ? (
          <p className="text-[13px] text-tertiary py-4 text-center">추천 외 추가 공고가 없어요</p>
        ) : (
          areaShifts.map((s) => (
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
