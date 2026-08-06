'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// admin 직원별 근태와 같은 캘린더 문법 — 워커 본인 기록(RLS로 자기 것만 조회).
type Row = {
  work_date: string; check_in_at: string | null; check_out_at: string | null; status: string;
  break_minutes: number | null; late_minutes: number | null; early_leave_minutes: number | null;
  check_in_method: string | null; check_out_method: string | null;
};

const STATUS_LABEL: Record<string, string> = { scheduled: '예정', working: '근무 중', checkout_pending: '승인 대기', completed: '완료', late: '지각', absent: '결근', leave: '휴가' };
const AUTH: Record<string, string> = { GPS: '위치', GPS_QR: '위치+QR', QR: 'QR', QR_FALLBACK: 'QR 보완', WORKPLACE_NET: '사업장 네트워크', ADMIN: '관리자', qr: '기존 QR', button: '원터치' };
const DAY_STYLE: Record<string, string> = {
  completed: 'bg-primary text-white', working: 'bg-primary/15 text-primary',
  checkout_pending: 'bg-amber-100 text-amber-700', late: 'bg-amber-400 text-white',
  absent: 'bg-red-500 text-white', leave: 'bg-emerald-400 text-white', scheduled: 'bg-bg text-sub',
};
const LEGEND: [string, string][] = [['bg-primary', '완료'], ['bg-primary/15', '근무 중'], ['bg-amber-400', '지각'], ['bg-amber-100', '승인 대기'], ['bg-red-500', '결근'], ['bg-emerald-400', '휴가'], ['bg-bg', '예정']];

const kstToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const moveMonth = (month: string, delta: number) => { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + delta); return d.toISOString().slice(0, 7); };
const timeOf = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
const worked = (r: Row) => r.check_in_at && r.check_out_at ? Math.max(0, Math.round((Date.parse(r.check_out_at) - Date.parse(r.check_in_at)) / 60000) - Number(r.break_minutes ?? 0)) : 0;

export function MyAttendanceCalendar({ staffId }: { staffId: string }) {
  const today = kstToday();
  const current = today.slice(0, 7);
  const [month, setMonth] = useState(current);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => { void (async () => {
    setLoading(true);
    const [y, m] = month.split('-').map(Number);
    const end = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    const { data } = await supabase.from('staff_attendances')
      .select('work_date,check_in_at,check_out_at,status,break_minutes,late_minutes,early_leave_minutes,check_in_method,check_out_method')
      .eq('staff_id', staffId).gte('work_date', `${month}-01`).lte('work_date', end)
      .order('work_date', { ascending: false });
    const list = (data ?? []) as Row[];
    setRows(list);
    setSelected(month === current && list.some(r => r.work_date === today) ? today : list[0]?.work_date ?? null);
    setLoading(false);
  })(); }, [staffId, month, current, today]);

  const byDate = new Map(rows.map(r => [r.work_date, r]));
  const [y, m] = month.split('-').map(Number);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const cells: (string | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: new Date(Date.UTC(y, m, 0)).getUTCDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ];
  const doneDays = rows.filter(r => r.check_in_at && r.check_out_at).length;
  const totalMin = rows.reduce((s, r) => s + worked(r), 0);
  const row = selected ? byDate.get(selected) : undefined;

  return (
    <div>
      <div className="flex items-center justify-between rounded-xl bg-bg p-1.5">
        <button type="button" onClick={() => setMonth(moveMonth(month, -1))} aria-label="이전 달" className="flex h-9 w-9 items-center justify-center text-lg">‹</button>
        <b className="text-[13px]">{month.slice(0,4)}년 {Number(month.slice(5,7))}월 · 완료 {doneDays}일 · {Math.floor(totalMin / 60)}시간 {totalMin % 60}분</b>
        {month < current
          ? <button type="button" onClick={() => setMonth(moveMonth(month, 1))} aria-label="다음 달" className="flex h-9 w-9 items-center justify-center text-lg">›</button>
          : <span className="flex h-9 w-9 items-center justify-center text-lg text-line" aria-hidden="true">›</span>}
      </div>
      {loading ? <p className="mt-4 rounded-xl bg-bg p-4 text-center text-[12px] text-sub">근태를 불러오는 중...</p> : <>
        <div className="mt-3 grid grid-cols-7 text-center text-[11px] font-bold text-sub">
          {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => <span key={d} className={`py-1 ${i === 0 ? 'text-red-400' : ''}`}>{d}</span>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-y-1">
          {cells.map((date, i) => {
            if (!date) return <span key={`e-${i}`} />;
            const record = byDate.get(date);
            const style = record ? DAY_STYLE[record.status] ?? 'bg-bg text-sub' : 'text-ink';
            return (
              <button key={date} type="button" disabled={!record} onClick={() => setSelected(date)}
                aria-label={`${date}${record ? ` ${STATUS_LABEL[record.status] ?? record.status}` : ''}`} aria-pressed={date === selected}
                className="flex items-center justify-center py-0.5">
                <span className={`flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold ${style} ${date === selected ? 'ring-2 ring-ink' : date === today ? 'ring-1 ring-line' : ''}`}>{Number(date.slice(8))}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-3">
          {LEGEND.map(([color, label]) => <span key={label} className="flex items-center gap-1 text-[11px] text-sub"><span className={`h-2.5 w-2.5 rounded-full ${color}`} aria-hidden="true" />{label}</span>)}
        </div>
        {rows.length === 0
          ? <p className="mt-3 rounded-xl bg-bg p-4 text-center text-[12px] text-sub">{month.slice(0,4)}년 {Number(month.slice(5,7))}월 근태 기록이 없어요.</p>
          : row && <div className="mt-3 rounded-xl bg-bg p-3 text-[12px]" role="region" aria-live="polite" aria-label="선택한 날짜 상세">
              <div className="flex items-center justify-between"><b className="text-[13px]">{row.work_date}</b><span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold">{STATUS_LABEL[row.status] ?? row.status}</span></div>
              <div className="mt-2 flex justify-between"><span className="text-sub">출퇴근</span><b>{timeOf(row.check_in_at)} → {timeOf(row.check_out_at)}</b></div>
              <div className="mt-1.5 flex justify-between"><span className="text-sub">인정 근무</span><b>{Math.floor(worked(row) / 60)}시간 {worked(row) % 60}분</b></div>
              <div className="mt-1.5 flex justify-between"><span className="text-sub">인증</span><b>{AUTH[row.check_out_method ?? row.check_in_method ?? ''] ?? row.check_out_method ?? row.check_in_method ?? '—'}</b></div>
              {(Number(row.late_minutes) > 0 || Number(row.early_leave_minutes) > 0) && <p className="mt-1.5 text-right font-bold text-amber-600">{Number(row.late_minutes) > 0 ? `지각 ${row.late_minutes}분` : ''}{Number(row.early_leave_minutes) > 0 ? ` · 조퇴 ${row.early_leave_minutes}분` : ''}</p>}
            </div>}
      </>}
    </div>
  );
}
