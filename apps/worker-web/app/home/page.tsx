'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ApplySheet } from '@/components/shifts/ApplySheet';
import type { Shift } from '@/app/shifts/page';
import { dateKST } from '@/lib/date';
import { facilityName, mobilityLabel, timeLabel } from '@/lib/shift-display';

type ShiftWithFacility = Shift & {
  facilities: { name: string; address_text?: string | null } | null;
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
  const pay   = shift.estimated_total_pay.toLocaleString('ko-KR');

  return (
    <div className="bg-white rounded-card shadow-card p-5 flex-shrink-0 w-[300px]">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl bg-primary-light flex items-center justify-center flex-shrink-0">
          <span className="text-[18px]">🏥</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-ink leading-tight truncate">{facilityName(shift)}</p>
        </div>
        {hot && (
          <span className="text-[11px] font-bold text-warn bg-warn/10 px-2 py-0.5 rounded-full flex-shrink-0">
            🔥 HOT
          </span>
        )}
      </div>

      <p className="text-[13px] text-sub mb-0.5">{shift.shift_date}</p>
      <p className="text-[19px] font-extrabold text-ink mb-1">
        {timeLabel(shift)}
      </p>
      <p className="text-[12px] font-semibold text-primary mb-1">{mobilityLabel(shift)}</p>
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
  const pay   = shift.estimated_total_pay.toLocaleString('ko-KR');

  return (
    <div className="bg-white rounded-card shadow-card p-4 mb-3 flex items-center gap-4">
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
  const [role,    setRole]    = useState<'rn' | 'na'>('rn');
  const [areas,   setAreas]   = useState<string[]>([]);
  const [shifts,  setShifts]  = useState<ShiftWithFacility[]>([]);
  const [loading, setLoading] = useState(true);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<ShiftWithFacility | null>(null);
  const [showProfileBanner, setShowProfileBanner] = useState(false);

  // 공고 탐색 기준 — 🛰 현재 위치 또는 📍 등록 지역 중 하나 (세그먼트)
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [basis, setBasis] = useState<'gps' | string>('gps');
  const [locNotice, setLocNotice] = useState('');
  const [reviewPending, setReviewPending] = useState(false);
  const approvedRef = useRef(false);

  const [dateFilter, setDateFilter] = useState<DateFilter>('today');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [wageFilter, setWageFilter] = useState<WageFilter>('all');
  const [deptFilter, setDeptFilter] = useState<DeptFilter>('all');

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
    if (!approvedRef.current) {
      setShifts([]);
      return;
    }
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

      const userRole = (workerRow?.role as 'rn' | 'na') ?? 'rn';
      const areaLabels = ((locPref?.locations ?? []) as { label: string }[]).map((l) => l.label);
      setRole(userRole);
      setAreas(areaLabels);

      approvedRef.current = workerRow?.verification_status === 'approved';
      setReviewPending(Boolean(workerRow) && workerRow?.verification_status !== 'approved');

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
  const todayCount = roleShifts.filter((s) => matchesDate(s, 'today')).length;

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
              {todayCount > 0
                ? <><span className="text-primary">오늘 지원 가능 {todayCount}건</span> 있어요</>
                : <span className="text-ink">새 시프트를 기다리는 중</span>
              }
            </h1>
          </div>
          <div className="flex-shrink-0 ml-3 mt-1 flex gap-2">
          <Link href="/workplace">
            <div className="flex flex-col items-center bg-success/10 border border-success/20 px-3 py-2.5 rounded-2xl active:opacity-70 transition-opacity">
              <span className="text-[19px] leading-tight">🕘</span>
              <span className="text-[11px] font-bold text-success mt-0.5">내 직장</span>
            </div>
          </Link>
          <Link href="/earnings">
            <div className="flex flex-col items-center bg-primary/8 border border-primary/20 px-3.5 py-2.5 rounded-2xl active:opacity-70 transition-opacity">
              <span className="text-[19px] leading-tight">💰</span>
              <span className="text-[11px] font-bold text-primary mt-0.5">급여 확인</span>
            </div>
          </Link>
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

      <div className="mx-5 mb-4 bg-ink rounded-2xl p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-white/70">오늘 바로 지원</p>
          <p className="text-[19px] font-extrabold text-white mt-0.5">
            {todayCount > 0 ? `${todayCount}개 시프트 확인` : '조건을 넓혀서 보기'}
          </p>
        </div>
        <Link
          href="/shifts"
          className="h-11 px-4 rounded-xl bg-white text-ink text-[14px] font-extrabold flex items-center justify-center flex-shrink-0"
        >
          보기
        </Link>
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

      {/* 조건 일치 공고 */}
      {recommended.length > 0 && (
        <section className="mb-6">
          <div className="px-5 flex items-center justify-between mb-3">
            <h2 className="text-[16px] font-extrabold text-ink">내 조건과 가까운 공고</h2>
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
            <p className="text-[15px] font-bold text-ink">{reviewPending ? '면허 심사 중이에요' : '조건에 맞는 시프트가 없어요'}</p>
            {reviewPending && (
              <p className="text-[13px] text-sub text-center leading-5">심사가 끝나면 알림으로 알려드려요.</p>
            )}
            <button onClick={resetFilters} className="text-[14px] text-primary font-semibold">
              필터 초기화
            </button>
          </div>
        ) : areaShifts.length === 0 ? (
          <p className="text-[13px] text-tertiary py-4 text-center">조건에 맞는 추가 공고가 없어요</p>
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
