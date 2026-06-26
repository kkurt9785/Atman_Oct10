'use client';

import { useState } from 'react';
import { ApplySheet } from '@/components/shifts/ApplySheet';
import type { Shift } from '@/app/shifts/page';

// ─── Mock 데이터 ──────────────────────────────────────────────
// role 을 'rn' | 'na' 로 바꾸면 필터 칩 전환됨
const MOCK_USER = {
  name: '김수진',
  role: 'rn' as 'rn' | 'na',
  areas: ['강남', '강동'],
};

const MOCK_SHIFTS: Shift[] = [
  // RN 시프트
  {
    id: 'mock-1',
    shift_date: '2026-06-28',
    start_time: '22:00', end_time: '06:00', is_overnight: true,
    required_role: 'rn', hourly_wage: 15000, estimated_total_pay: 120000,
    description: '3층 일반병동 야간 간호 지원, 투약 및 활력징후 측정',
    department: '일반병동', notes: '식사 제공 · 주차 가능',
  },
  {
    id: 'mock-2',
    shift_date: '2026-06-29',
    start_time: '22:00', end_time: '06:00', is_overnight: true,
    required_role: 'rn', hourly_wage: 16000, estimated_total_pay: 128000,
    description: 'ICU 야간 집중간호, 중증환자 모니터링 및 처치 보조',
    department: '중환자실', notes: '실력자 우대 · 복장 규정 있음',
  },
  {
    id: 'mock-4',
    shift_date: '2026-07-01',
    start_time: '22:00', end_time: '06:00', is_overnight: true,
    required_role: 'rn', hourly_wage: 15000, estimated_total_pay: 120000,
    description: '응급실 야간 트리아지 지원',
    department: '응급실', notes: null,
  },
  {
    id: 'mock-5',
    shift_date: '2026-07-02',
    start_time: '14:00', end_time: '22:00', is_overnight: false,
    required_role: 'rn', hourly_wage: 13000, estimated_total_pay: 98000,
    description: '5층 내과 외래 오후 근무, 투약 및 드레싱',
    department: '외래', notes: '저녁 제공',
  },
  // NA 시프트
  {
    id: 'mock-n1',
    shift_date: '2026-06-28',
    start_time: '09:00', end_time: '18:00', is_overnight: false,
    required_role: 'na', hourly_wage: 12000, estimated_total_pay: 91200,
    description: '어르신 일상생활 보조, 투약 지원, 기저귀 교환 등',
    department: '요양원', notes: '점심 제공 · 요양보호사 자격 우대',
  },
  {
    id: 'mock-n2',
    shift_date: '2026-06-29',
    start_time: '22:00', end_time: '06:00', is_overnight: true,
    required_role: 'na', hourly_wage: 13000, estimated_total_pay: 104000,
    description: '야간 어르신 케어, 활력징후 측정 및 낙상 예방',
    department: '요양병원', notes: '야간수당 포함',
  },
  {
    id: 'mock-n3',
    shift_date: '2026-06-30',
    start_time: '09:00', end_time: '14:00', is_overnight: false,
    required_role: 'na', hourly_wage: 11000, estimated_total_pay: 49500,
    description: '외래 접수·수납 보조, 처치실 준비 및 정리',
    department: '의원·클리닉', notes: '주 3회 반복 근무 가능',
  },
  {
    id: 'mock-n4',
    shift_date: '2026-07-01',
    start_time: '09:00', end_time: '17:00', is_overnight: false,
    required_role: 'na', hourly_wage: 12000, estimated_total_pay: 86400,
    description: '재활 훈련 보조, 이동 지원 및 일상생활 재활',
    department: '재활병원', notes: '체력 필요 · 경험자 우대',
  },
  {
    id: 'mock-n5',
    shift_date: '2026-07-02',
    start_time: '10:00', end_time: '19:00', is_overnight: false,
    required_role: 'na', hourly_wage: 11500, estimated_total_pay: 92000,
    description: '침술·뜸 보조, 접수 및 물리치료 준비',
    department: '한의원', notes: '한방 관심자 환영',
  },
];

const MOCK_FACILITIES: Record<string, { name: string; distance: string }> = {
  'mock-1':  { name: '강남세브란스병원', distance: '1.2km' },
  'mock-2':  { name: '삼성서울병원',    distance: '2.8km' },
  'mock-4':  { name: '서울아산병원',    distance: '3.4km' },
  'mock-5':  { name: '강남성모병원',    distance: '1.7km' },
  'mock-n1': { name: '강남노인요양원',  distance: '0.8km' },
  'mock-n2': { name: '강동요양병원',    distance: '1.5km' },
  'mock-n3': { name: '강남내과의원',    distance: '0.4km' },
  'mock-n4': { name: '강동재활병원',    distance: '2.1km' },
  'mock-n5': { name: '강남한의원',      distance: '0.6km' },
};

// ─── 필터 타입 ────────────────────────────────────────────────
type DateFilter = 'all' | 'today' | 'tomorrow' | 'week';
type TimeFilter = 'all' | 'night' | 'day' | 'early';
type WageFilter = 'all' | '12k' | '15k';
type DeptFilter = string; // role별로 동적

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
  { value: 'all',     label: '전체' },
  { value: '요양원',  label: '요양원' },
  { value: '요양병원', label: '요양병원' },
  { value: '의원·클리닉', label: '의원·클리닉' },
  { value: '재활병원', label: '재활병원' },
  { value: '한의원',  label: '한의원' },
];

// ─── 필터 함수 ────────────────────────────────────────────────
function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

function matchesDate(shift: Shift, f: DateFilter) {
  if (f === 'all') return true;
  const today    = toDateStr(new Date());
  const tomorrow = toDateStr(new Date(Date.now() + 86400000));
  const weekEnd  = toDateStr(new Date(Date.now() + 7 * 86400000));
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

// ─── 서브 컴포넌트 ────────────────────────────────────────────
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

function ShiftCard({ shift, hot = false, onApply }: { shift: Shift; hot?: boolean; onApply: () => void }) {
  const fac   = MOCK_FACILITIES[shift.id];
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
          <p className="text-[15px] font-bold text-ink leading-tight truncate">{fac?.name}</p>
          <p className="text-[12px] text-tertiary">{fac?.distance}</p>
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

function ListCard({ shift, onApply }: { shift: Shift; onApply: () => void }) {
  const fac   = MOCK_FACILITIES[shift.id];
  const start = shift.start_time.slice(0, 5);
  const end   = shift.end_time.slice(0, 5);
  const pay   = shift.estimated_total_pay.toLocaleString('ko-KR');

  return (
    <div className="bg-white rounded-card shadow-card p-4 mb-3 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-[12px] text-tertiary truncate">{fac?.name} · {fac?.distance}</p>
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

// ─── 메인 ─────────────────────────────────────────────────────
export default function HomePage() {
  const role = MOCK_USER.role;
  const deptChips = role === 'rn' ? DEPT_CHIPS_RN : DEPT_CHIPS_NA;

  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [wageFilter, setWageFilter] = useState<WageFilter>('all');
  const [deptFilter, setDeptFilter] = useState<DeptFilter>('all');
  const [selected, setSelected]     = useState<Shift | null>(null);
  const [applied, setApplied]       = useState<Set<string>>(new Set());

  // role에 맞는 시프트만 우선 추림
  const roleShifts = MOCK_SHIFTS.filter(
    (s) => s.required_role === role || s.required_role === 'any'
  );

  const filtered = roleShifts.filter(
    (s) =>
      !applied.has(s.id) &&
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

  const totalCount = roleShifts.length - applied.size;
  const roleLabel  = role === 'rn' ? '간호사' : '간호조무사';

  return (
    <div className="pb-24">
      {/* 헤더 */}
      <div className="px-5 pt-14 pb-4">
        <p className="text-[14px] text-sub">안녕하세요 👋</p>
        <h1 className="text-[26px] font-extrabold text-ink leading-tight mt-0.5">
          {MOCK_USER.name} {roleLabel}님,<br />
          <span className="text-primary">내 근처 시프트 {totalCount}건</span> 있어요
        </h1>
        <div className="flex gap-1.5 mt-3">
          {MOCK_USER.areas.map((a) => (
            <span key={a} className="text-[12px] font-semibold text-primary bg-primary-light px-2.5 py-1 rounded-full">
              📍 {a}
            </span>
          ))}
        </div>
      </div>

      {/* 필터 4줄 */}
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
            <span className="text-[12px] text-tertiary">내 지역 · 조건 맞춤</span>
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

      {/* 지역 전체 공고 */}
      <section className="px-5">
        <h2 className="text-[16px] font-extrabold text-ink mb-3">
          📍 {MOCK_USER.areas.join(' · ')} 전체 공고
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
