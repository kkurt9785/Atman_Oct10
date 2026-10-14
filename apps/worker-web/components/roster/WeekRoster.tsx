'use client';

import { ROSTER_SLOTS, SLOT_LABEL, cellKey, type RosterCells, type RosterDay, type RosterSlot } from '@/lib/roster';

// 이번 주 근무표 (7일 × D·E·N). 진한 칸 = 확정 근무, 연한 칸 = 지원 중, +숫자 = 그 시간대에 갈 수 있는 근무 수.
// 칸을 누르면 onSelect — 그 시간대의 근무 목록이 아래에 열린다.
// slotNames: 간호 근무표(D·E·N)가 낯선 직군(약국)은 칸 이름을 오전·오후·야간으로 바꿔 보여 준다.
export function WeekRoster({ week, cells, selected, onSelect, compact = false, slotNames }: {
  week: RosterDay[];
  cells: RosterCells;
  selected?: { date: string; slot: RosterSlot } | null;
  onSelect?: (date: string, slot: RosterSlot) => void;
  compact?: boolean;
  slotNames?: Record<RosterSlot, string>;
}) {
  // 작은 폰(높이 700px 이하)에서는 칸을 낮춰 아래 근무 목록이 첫 화면에 들어오게 한다
  const cellHeight = compact ? 'h-8' : 'h-10 [@media(max-height:700px)]:h-8';
  return (
    <div className="rounded-2xl bg-bg p-3">
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `${compact ? 30 : 44}px repeat(7, minmax(0, 1fr))` }}>
        <span />
        {week.map((day) => (
          <span key={day.date} className={`text-center text-[11px] font-bold leading-tight ${day.isToday ? 'text-primary' : day.isWeekend === 'sun' ? 'text-red-500' : day.isWeekend === 'sat' ? 'text-primary/70' : 'text-tertiary'}`}>
            {day.weekday}
            {!compact && <b className={`mt-0.5 block text-[13px] ${day.isToday ? 'mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white' : 'text-ink'}`}>{day.dayNumber}</b>}
          </span>
        ))}
        {ROSTER_SLOTS.map((slot) => (
          <RosterRow key={slot} slot={slot} week={week} cells={cells} selected={selected} onSelect={onSelect} compact={compact} cellHeight={cellHeight} slotName={slotNames?.[slot]} />
        ))}
      </div>
    </div>
  );
}

function RosterRow({ slot, week, cells, selected, onSelect, compact, cellHeight, slotName }: {
  slot: RosterSlot; week: RosterDay[]; cells: RosterCells;
  selected?: { date: string; slot: RosterSlot } | null; onSelect?: (date: string, slot: RosterSlot) => void; compact: boolean; cellHeight: string; slotName?: string;
}) {
  return (
    <>
      <span className="text-[11px] font-extrabold leading-tight text-sub">
        {slotName ?? slot}
        {!compact && !slotName && <span className="block font-medium text-tertiary">{SLOT_LABEL[slot]}</span>}
      </span>
      {week.map((day) => {
        const cell = cells[cellKey(day.date, slot)];
        const isSelected = selected?.date === day.date && selected?.slot === slot;
        const confirmed = cell?.state === 'confirmed';
        const applied = cell?.state === 'applied';
        const count = cell?.count ?? 0;
        const tone = confirmed
          ? 'bg-primary text-white'
          : applied
            ? 'bg-primary/35 text-white'
            : isSelected
              ? 'bg-ink text-white shadow-btn'
              : count > 0
                ? 'bg-white text-primary'
                : 'bg-white text-line';
        // 확정 칸은 ●만(그 시간엔 더 갈 수 없다). 지원 중이어도 같은 시간대에 갈 수 있는 근무 수는 숨기지 않는다.
        const label = confirmed ? '●' : applied ? (count > 0 ? `○+${count}` : '○') : count > 0 ? `+${count}` : '·';
        const aria = `${day.weekday} ${slotName ?? slot} ${confirmed ? '확정 근무' : applied ? `지원 중${count > 0 ? ` · 갈 수 있는 근무 ${count}건` : ''}` : count > 0 ? `근무 ${count}건` : '근무 없음'}`;
        return (
          <button
            key={`${day.date}-${slot}`}
            type="button"
            aria-label={aria}
            aria-pressed={isSelected}
            onClick={() => onSelect?.(day.date, slot)}
            className={`${cellHeight} rounded-[10px] ${applied && count > 0 ? 'text-[11px] tracking-tight' : 'text-[12px]'} font-extrabold ${tone} ${(confirmed || applied) && isSelected ? 'ring-2 ring-ink ring-offset-2 ring-offset-bg' : ''} ${day.isToday && !isSelected && !confirmed ? 'ring-1 ring-primary/30' : ''}`}
          >
            {label}
          </button>
        );
      })}
    </>
  );
}
