'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ApplySheet } from '@/components/shifts/ApplySheet';
import { FacilitySheet } from '@/components/shifts/FacilitySheet';
import { dateKST } from '@/lib/date';
import { areaLabel, dateLabel, facilityName, mobilityLabel, timeLabel } from '@/lib/shift-display';

export type Shift = {
  id: string;
  facility_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  is_overnight: boolean;
  required_role: 'rn' | 'na' | 'any';
  hourly_wage: number;
  estimated_total_pay: number;
  description: string;
  department: string | null;
  notes: string | null;
  facilities?: { name: string; address_text?: string | null } | Array<{ name: string; address_text?: string | null }> | null;
  distance_km?: number | null;
  distance_m?: number | null;
  distance_meters?: number | null;
};

const ROLE_LABEL: Record<string, string> = {
  rn: '간호사 (RN)',
  na: '간호조무사 (NA)',
  any: '무관',
};

type DateFilter = 'today' | 'week' | 'all';
type TimeFilter = 'all' | 'day' | 'evening' | 'night';

const DATE_FILTERS: Array<{ value: DateFilter; label: string }> = [
  { value: 'today', label: '오늘' },
  { value: 'week', label: '이번주' },
  { value: 'all', label: '전체' },
];

const TIME_FILTERS: Array<{ value: TimeFilter; label: string }> = [
  { value: 'all', label: '전체 시간' },
  { value: 'day', label: '오전/주간' },
  { value: 'evening', label: '오후' },
  { value: 'night', label: '야간' },
];

function timeBucket(shift: Shift) {
  const hour = parseInt(shift.start_time.slice(0, 2), 10);
  if (hour >= 22 || hour < 6) return { key: 'night', label: '야간' };
  if (hour >= 14) return { key: 'evening', label: '오후' };
  return { key: 'day', label: '오전/주간' };
}

function matchesDate(shift: Shift, filter: DateFilter) {
  const today = dateKST();
  if (filter === 'today') return shift.shift_date === today;
  if (filter === 'week') return shift.shift_date >= today && shift.shift_date <= dateKST(7);
  return true;
}

function matchesTime(shift: Shift, filter: TimeFilter) {
  if (filter === 'all') return true;
  return timeBucket(shift).key === filter;
}

function ChipRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`whitespace-nowrap px-3.5 py-2 rounded-full text-[13px] font-bold ${
            value === option.value ? 'bg-primary text-white' : 'bg-white text-sub border border-line'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function groupShifts(shifts: Shift[]) {
  const groups = new Map<string, { title: string; shifts: Shift[] }>();
  for (const shift of shifts) {
    const bucket = timeBucket(shift);
    const key = `${shift.shift_date}-${bucket.key}`;
    const title = `${dateLabel(shift.shift_date)} · ${bucket.label}`;
    const current = groups.get(key) ?? { title, shifts: [] };
    current.shifts.push(shift);
    groups.set(key, current);
  }
  return Array.from(groups.values());
}

function ShiftCard({ shift, onApply, onFacility }: { shift: Shift; onApply: () => void; onFacility: () => void }) {
  const pay = shift.estimated_total_pay.toLocaleString('ko-KR');
  const area = areaLabel(shift);

  return (
    <div className="bg-white rounded-card shadow-card p-5 mb-3">
      {/* 날짜 + 자격 */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] font-semibold text-sub">{dateLabel(shift.shift_date)}</span>
        <span className="text-[12px] font-bold text-primary bg-primary-light px-2.5 py-1 rounded-full">
          {ROLE_LABEL[shift.required_role]}
        </span>
      </div>

      <div className="flex items-center justify-between mb-1">
        <p className="text-[15px] font-extrabold text-ink truncate">{facilityName(shift)}</p>
        <button
          onClick={(e) => { e.stopPropagation(); onFacility(); }}
          className="shrink-0 ml-2 text-[12px] font-semibold text-primary"
        >
          병원 보기 &gt;
        </button>
      </div>

      {/* 시간 */}
      <p className="text-[22px] font-extrabold text-ink leading-tight mb-1">
        {timeLabel(shift)}
      </p>

      {/* 지역 / 부서 */}
      {(area || shift.department) && (
        <p className="text-[13px] text-tertiary mb-0.5">
          {[area, shift.department].filter(Boolean).join(' · ')}
        </p>
      )}
      <p className="text-[13px] font-semibold text-sub mb-2">{mobilityLabel(shift)}</p>
      <p className="text-[14px] text-sub line-clamp-2 mb-4">{shift.description}</p>

      {/* 야간 배지 */}
      {shift.is_overnight && (
        <span className="inline-flex items-center px-2.5 py-1 bg-kakao rounded-full text-[12px] font-bold text-ink mr-2 mb-3">
          🌙 야간수당 +50%
        </span>
      )}

      {/* 시급 / 예상 지급액 + 지원 버튼 */}
      <div className="flex items-center justify-between pt-4 border-t border-line">
        <div>
          <p className="text-[12px] text-tertiary">예상 지급액</p>
          <p className="text-[20px] font-extrabold text-ink">₩{pay}</p>
          <p className="text-[12px] text-tertiary">시급 {shift.hourly_wage.toLocaleString('ko-KR')}원</p>
        </div>
        <button
          onClick={onApply}
          className="h-12 px-6 bg-primary text-white text-[15px] font-bold rounded-btn shadow-btn active:opacity-80"
        >
          지원하기
        </button>
      </div>

      {/* 기타 안내 */}
      {shift.notes && (
        <p className="mt-3 text-[12px] text-tertiary border-t border-line pt-3">
          💡 {shift.notes}
        </p>
      )}
    </div>
  );
}

export default function ShiftsPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Shift | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [facilityInfo, setFacilityInfo] = useState<{ id: string; name: string } | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>('today');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [visibleLimit, setVisibleLimit] = useState(10);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      let roleFilter: Array<'rn' | 'na' | 'any'> = ['rn', 'na', 'any'];
      let appliedShiftIds = new Set<string>();

      if (!user) {
        setIsGuest(true);
      } else {
        const { data: worker } = await supabase
          .from('workers')
          .select('id, role, verification_status')
          .eq('auth_user_id', user.id)
          .maybeSingle();

        if (worker?.verification_status === 'approved') {
          roleFilter = worker.role === 'rn' ? ['rn', 'any'] : ['na', 'any'];
          const { data: appData } = await supabase
            .from('shift_applications')
            .select('shift_id')
            .eq('worker_id', worker.id)
            .in('status', ['applied', 'accepted']);
          appliedShiftIds = new Set((appData ?? []).map((a: { shift_id: string }) => a.shift_id));
          setApplied(appliedShiftIds);
        }
      }

      const { data: shiftData } = await supabase
        .from('shifts')
        .select(
          'id, facility_id, shift_date, start_time, end_time, is_overnight, required_role, hourly_wage, estimated_total_pay, description, department, notes, facilities ( name, address_text )'
        )
        .eq('status', 'open')
        .gte('shift_date', dateKST())
        .in('required_role', roleFilter)
        .order('shift_date', { ascending: true })
        .order('start_time', { ascending: true });

      setShifts(((shiftData as unknown as Shift[]) ?? []).filter((s) => !appliedShiftIds.has(s.id)));
      setLoading(false);
    }
    load();
  }, []);

  function handleApplied(shiftId: string) {
    setShifts((prev) => prev.filter((s) => s.id !== shiftId));
    setApplied((prev) => new Set(prev).add(shiftId));
    setSelected(null);
  }

  function handleDateFilter(value: DateFilter) {
    setDateFilter(value);
    setVisibleLimit(10);
  }

  function handleTimeFilter(value: TimeFilter) {
    setTimeFilter(value);
    setVisibleLimit(10);
  }

  const filtered = shifts
    .filter((shift) => matchesDate(shift, dateFilter) && matchesTime(shift, timeFilter))
    .sort((a, b) => {
      const date = a.shift_date.localeCompare(b.shift_date);
      if (date !== 0) return date;
      return b.estimated_total_pay - a.estimated_total_pay;
    });
  const recommended = filtered.slice(0, 3);
  const grouped = groupShifts(filtered.slice(3, visibleLimit));
  const visibleCount = Math.min(filtered.length, visibleLimit);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-[15px] text-sub">시프트 불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-10">
      {/* 헤더 */}
      <div className="pt-14 pb-6">
        <p className="text-[14px] text-sub mb-1">내 조건에 맞는 시프트</p>
        <h1 className="text-[28px] font-extrabold text-ink leading-tight">
          시프트 {filtered.length}건
        </h1>
        {isGuest && (
          <p className="text-[13px] text-sub mt-2">
            둘러보기는 바로 가능해요. 지원할 때 1분 가입과 인증을 진행합니다.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 mb-5">
        <ChipRow options={DATE_FILTERS} value={dateFilter} onChange={handleDateFilter} />
        <ChipRow options={TIME_FILTERS} value={timeFilter} onChange={handleTimeFilter} />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <span className="text-5xl">🔍</span>
          <p className="text-[17px] font-bold text-ink">조건에 맞는 시프트가 없어요</p>
          <p className="text-[14px] text-sub text-center">
            필터를 넓히면 더 많은 공고를 볼 수 있어요
          </p>
          <button
            onClick={() => {
              setDateFilter('all');
              setTimeFilter('all');
              setVisibleLimit(10);
            }}
            className="text-[14px] font-bold text-primary"
          >
            전체 시프트 보기
          </button>
        </div>
      ) : (
        <>
          {recommended.length > 0 && (
            <section className="mb-6">
              <div className="flex items-center justify-between mb-3 px-1">
                <h2 className="text-[17px] font-extrabold text-ink">추천 시프트</h2>
                <span className="text-[12px] text-tertiary">상위 {recommended.length}건</span>
              </div>
              {recommended.map((s) => (
                <ShiftCard key={s.id} shift={s} onApply={() => setSelected(s)} onFacility={() => setFacilityInfo({ id: s.facility_id, name: facilityName(s) })} />
              ))}
            </section>
          )}

          {grouped.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3 px-1">
                <h2 className="text-[17px] font-extrabold text-ink">시간대별 공고</h2>
                <span className="text-[12px] text-tertiary">
                  {visibleCount}/{filtered.length}건 표시
                </span>
              </div>

              {grouped.map((group) => (
                <div key={group.title} className="mb-5">
                  <p className="text-[13px] font-bold text-sub mb-2 px-1">{group.title}</p>
                  {group.shifts.map((s) => (
                    <ShiftCard key={s.id} shift={s} onApply={() => setSelected(s)} onFacility={() => setFacilityInfo({ id: s.facility_id, name: facilityName(s) })} />
                  ))}
                </div>
              ))}

              {visibleLimit < filtered.length && (
                <button
                  onClick={() => setVisibleLimit((value) => value + 10)}
                  className="w-full h-12 rounded-xl border border-line bg-white text-[15px] font-bold text-ink"
                >
                  10건 더 보기
                </button>
              )}
            </section>
          )}
        </>
      )}

      {selected && (
        <ApplySheet
          shift={selected}
          onClose={() => setSelected(null)}
          onApplied={() => handleApplied(selected.id)}
        />
      )}

      {facilityInfo && (
        <FacilitySheet
          facilityId={facilityInfo.id}
          facilityName={facilityInfo.name}
          onClose={() => setFacilityInfo(null)}
        />
      )}
    </div>
  );
}
