'use client';

import { ROSTER_SLOTS, SLOT_LABEL, cellKey, type RosterCells, type RosterDay, type RosterSlot } from '@/lib/roster';

// 이번 주 근무표 (7일 × D·E·N). 진한 칸 = 확정 근무, 연한 칸 = 지원 중, +숫자 = 그 시간대에 갈 수 있는 근무 수.
// 칸을 누르면 onSelect — 그 시간대의 근무 목록이 아래에 열린다.
export function WeekRoster({ week, cells, selected, onSelect, compact = false }: {
  week: RosterDay[];
  cells: RosterCells;
  selected?: { date: string; slot: RosterSlot } | null;
  onSelect?: (date: string, slot: RosterSlot) => void;
  compact?: boolean;
}) {
  const cellHeight = compact ? 'h-8' : 'h-10';
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
          <RosterRow key={slot} slot={slot} week={week} cells={cells} selected={selected} onSelect={onSelect} compact={compact} cellHeight={cellHeight} />
        ))}
      </div>
    </div>
  );
}

function RosterRow({ slot, week, cells, selected, onSelect, compact, cellHeight }: {
  slot: RosterSlot; week: RosterDay[]; cells: RosterCells;
  selected?: { date: string; slot: RosterSlot } | null; onSelect?: (date: string, slot: RosterSlot) => void; compact: boolean; cellHeight: string;
}) {
  return (
    <>
      <span className="text-[11px] font-extrabold leading-tight text-sub">
        {slot}
        {!compact && <span className="block font-medium text-tertiary">{SLOT_LABEL[slot]}</span>}
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
        const label = confirmed ? '●' : applied ? '○' : count > 0 ? `+${count}` : '·';
        const aria = `${day.weekday} ${slot} ${confirmed ? '확정 근무' : applied ? '지원 중' : count > 0 ? `근무 ${count}건` : '근무 없음'}`;
        return (
          <button
            key={`${day.date}-${slot}`}
            type="button"
            aria-label={aria}
            aria-pressed={isSelected}
            onClick={() => onSelect?.(day.date, slot)}
            className={`${cellHeight} rounded-[10px] text-[12px] font-extrabold ${tone} ${confirmed && isSelected ? 'ring-2 ring-ink ring-offset-2 ring-offset-bg' : ''} ${day.isToday && !isSelected && !confirmed ? 'ring-1 ring-primary/30' : ''}`}
          >
            {label}
          </button>
        );
      })}
    </>
  );
}
