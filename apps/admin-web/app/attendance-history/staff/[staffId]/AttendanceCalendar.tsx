'use client';
import { useState } from 'react';
import type { AttendanceHistoryRow } from '@/lib/db/attendance-history';

// 알밤·시프티류 근태 앱 표준 문법: 월 캘린더에 상태를 색으로, 탭하면 그 날 상세.
// 하루=카드 1장 리스트(월 30장 스크롤)를 대체한다.

const STATUS_LABEL: Record<string, string> = { scheduled: '예정', working: '근무 중', checkout_pending: '승인 대기', completed: '완료', late: '지각', absent: '결근', leave: '휴가' };
const AUTH: Record<string, string> = { GPS: '위치', GPS_QR: '위치+QR', QR: 'QR', QR_FALLBACK: 'QR 보완', ADMIN: '관리자', qr: '기존 QR', button: '원터치' };
const DAY_STYLE: Record<string, string> = {
  completed: 'bg-primary text-white',
  working: 'bg-primary/15 text-primary',
  checkout_pending: 'bg-amber-100 text-amber-700',
  late: 'bg-amber-400 text-white',
  absent: 'bg-red-500 text-white',
  leave: 'bg-emerald-400 text-white',
  scheduled: 'bg-bg text-sub',
};
const LEGEND: [string, string][] = [
  ['bg-primary', '완료'], ['bg-primary/15', '근무 중'], ['bg-amber-400', '지각'],
  ['bg-red-500', '결근'], ['bg-emerald-400', '휴가'],
];

function dt(iso: string | null) { if (!iso) return '—'; return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }); }
function hm(min: number) { return `${Math.floor(min / 60)}시간 ${min % 60}분`; }

export function AttendanceCalendar({ month, rows, today }: { month: string; rows: AttendanceHistoryRow[]; today: string }) {
  const byDate = new Map(rows.map(r => [r.workDate, r]));
  const [selected, setSelected] = useState<string | null>(
    today.startsWith(month) && byDate.has(today) ? today : rows[0]?.workDate ?? null,
  );
  const [y, m] = month.split('-').map(Number);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ];
  const row = selected ? byDate.get(selected) : undefined;

  return (
    <div className="mt-4">
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="grid grid-cols-7 text-center text-[11px] font-bold text-sub">
          {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
            <span key={d} className={`py-1 ${i === 0 ? 'text-red-400' : ''}`}>{d}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-y-1.5">
          {cells.map((date, i) => {
            if (!date) return <span key={`empty-${i}`} />;
            const record = byDate.get(date);
            const style = record ? DAY_STYLE[record.status] ?? 'bg-bg text-sub' : 'text-ink';
            const isToday = date === today;
            const isSelected = date === selected;
            return (
              <button
                key={date}
                type="button"
                onClick={() => record && setSelected(date)}
                disabled={!record}
                aria-label={`${date}${record ? ` ${STATUS_LABEL[record.status] ?? record.status}` : ''}`}
                aria-pressed={isSelected}
                className="flex items-center justify-center py-0.5"
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold ${style} ${isSelected ? 'ring-2 ring-ink' : isToday ? 'ring-1 ring-line' : ''}`}>
                  {Number(date.slice(8))}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-3">
          {LEGEND.map(([color, label]) => (
            <span key={label} className="flex items-center gap-1 text-[11px] text-sub">
              <span className={`h-2.5 w-2.5 rounded-full ${color}`} aria-hidden="true" />{label}
            </span>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="mt-3 rounded-2xl bg-white py-8 text-center text-[13px] font-bold shadow-sm">이 달 근태 기록이 없어요.</div>
      ) : row ? (
        <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm" role="region" aria-live="polite" aria-label="선택한 날짜 상세">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-extrabold">{row.workDate} <span className="ml-1 font-medium text-sub">예정 {row.scheduledStart?.slice(0, 5) ?? '—'}~{row.scheduledEnd?.slice(0, 5) ?? '—'}</span></p>
            <span className="rounded-full bg-bg px-2.5 py-1 text-[11px] font-bold">{STATUS_LABEL[row.status] ?? row.status}</span>
          </div>
          <div className="mt-3 rounded-xl bg-bg p-3 text-[12px]">
            <div className="flex justify-between"><span className="text-sub">실제 출퇴근</span><b>{dt(row.checkInAt)} → {dt(row.checkOutAt)}</b></div>
            <div className="mt-2 flex justify-between"><span className="text-sub">인정 근무</span><b>{hm(row.workedMinutes)}</b></div>
            <div className="mt-2 flex justify-between"><span className="text-sub">인증</span><b>{AUTH[row.method ?? ''] ?? row.method ?? '—'}</b></div>
            {(row.lateMinutes > 0 || row.earlyLeaveMinutes > 0) && <p className="mt-2 text-right font-bold text-warn">{row.lateMinutes > 0 ? `지각 ${row.lateMinutes}분` : ''}{row.earlyLeaveMinutes > 0 ? ` · 조퇴 ${row.earlyLeaveMinutes}분` : ''}</p>}
            {row.correctionReason && <p className="mt-2 text-[11px] text-sub">수정 사유: {row.correctionReason}</p>}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-center text-[12px] text-sub">날짜를 누르면 그 날 기록이 여기 표시돼요.</p>
      )}
    </div>
  );
}
