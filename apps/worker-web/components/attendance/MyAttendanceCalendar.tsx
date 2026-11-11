'use client';
import { useEffect, useState } from 'react';
import { attendanceTime as timeOf, recordedShiftMinutes } from '@/lib/attendance-display';
import { leaveTypeLabel } from '@/lib/leave-display';
import { supabase } from '@/lib/supabase';

type Row = {
  recognizedMinutes?: number | null; key: string; work_date: string; check_in_at: string | null; check_out_at: string | null; status: string;
  break_minutes: number | null; late_minutes: number | null; early_leave_minutes: number | null;
  check_in_method: string | null; check_out_method: string | null; source: string;
};
const STATUS_LABEL: Record<string, string> = { scheduled: '예정', working: '근무 중', checkout_pending: '승인 대기', completed: '완료', late: '지각', absent: '결근', leave: '휴가' };
const AUTH: Record<string, string> = { GPS: '위치', GPS_QR: '위치+QR', QR: 'QR', QR_FALLBACK: 'QR', WORKPLACE_NET: '사업장 네트워크', ADMIN: '관리자', qr: 'QR', button: '출근하기 버튼' };
const DAY_STYLE: Record<string, string> = { completed: 'bg-primary text-white', working: 'bg-primary/15 text-primary', checkout_pending: 'bg-amber-100 text-amber-700', late: 'bg-amber-400 text-white', absent: 'bg-red-500 text-white', leave: 'bg-emerald-400 text-white', scheduled: 'bg-bg text-sub' };
const LEGEND: [string, string][] = [['bg-primary', '완료'], ['bg-primary/15', '근무 중'], ['bg-amber-400', '지각'], ['bg-amber-100', '승인 대기'], ['bg-red-500', '결근'], ['bg-emerald-400', '휴가'], ['bg-bg', '예정']];
// 승인·대기 중인 휴가 신청. 근태 표(staff_attendances)에는 줄이 안 생겨서 달력에 따로 얹는다.
type LeaveDay = { type: string; status: 'approved' | 'pending' };
const LEAVE_STYLE: Record<LeaveDay['status'], string> = { approved: 'bg-emerald-400 text-white', pending: 'border border-dashed border-emerald-500 text-emerald-700' };
const LEAVE_STATE: Record<LeaveDay['status'], string> = { approved: '휴가', pending: '휴가 신청 중' };
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const kstToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const moveMonth = (month: string, delta: number) => { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + delta); return d.toISOString().slice(0, 7); };
const worked = (r: Row) => r.recognizedMinutes !== undefined ? r.recognizedMinutes ?? 0 : r.check_in_at && r.check_out_at ? Math.max(0, Math.round((Date.parse(r.check_out_at) - Date.parse(r.check_in_at)) / 60000) - Number(r.break_minutes ?? 0)) : 0;
const statusRank: Record<string, number> = { absent: 7, late: 6, checkout_pending: 5, working: 4, leave: 3, completed: 2, scheduled: 1 };
type Settled = { attendance_id: string; worked_minutes: number; break_minutes: number };
// 본인 공고 근무의 정산 분. RPC 우선, 없으면(마이그레이션 전) 직접 읽기, 둘 다 안 되면 null → 화면은 '정산 대기'
async function loadSettledMinutes(ids: string[]): Promise<Map<string, Settled> | null> {
  const map = new Map<string, Settled>();
  if (ids.length === 0) return map;
  let res: { data: unknown; error: unknown } = await supabase.rpc('get_my_shift_settlement_minutes', { p_attendance_ids: ids });
  if (res.error) res = await supabase.from('wage_calculations').select('attendance_id,worked_minutes,break_minutes').in('attendance_id', ids);
  if (res.error) return null;
  for (const row of (res.data ?? []) as Settled[]) map.set(row.attendance_id, row);
  return map;
}

export function MyAttendanceCalendar({ staffId, refreshKey = 0, includeShiftAttendance = true, staffSourceLabel = '직원 근무' }: { staffId: string | null; refreshKey?: number; includeShiftAttendance?: boolean; staffSourceLabel?: string }) {
  const today = kstToday(); const current = today.slice(0, 7);
  const [month, setMonth] = useState(current); const [rows, setRows] = useState<Row[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [retry, setRetry] = useState(0); const [selected, setSelected] = useState<string | null>(null); const [notice, setNotice] = useState(''); const [leaveDays, setLeaveDays] = useState<Record<string, LeaveDay>>({});
  useEffect(() => { let active = true; void (async () => { try {
    setLoading(true); setError(''); setNotice(''); setRows([]); setLeaveDays({}); setSelected(null); let partial = ''; const [y, m] = month.split('-').map(Number); const end = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    const { data: staffRows, error: staffError } = staffId ? await supabase.from('staff_attendances').select('work_date,check_in_at,check_out_at,status,break_minutes,late_minutes,early_leave_minutes,check_in_method,check_out_method').eq('staff_id', staffId).gte('work_date', `${month}-01`).lte('work_date', end) : { data: [], error: null };
    if (staffError) throw new Error('직원 근태를 불러오지 못했어요.');
    // 휴가를 신청·승인받아도 달력이 비어 보였다(2026-11-10 근태 화면 정리). 못 읽어도 근태는 그대로 보여 준다.
    const leaveMap: Record<string, LeaveDay> = {};
    if (staffId) {
      const { data: leaveRows } = await supabase.from('staff_leave_requests').select('*').eq('staff_id', staffId).in('status', ['approved', 'pending']).lte('start_date', end);
      for (const leave of (leaveRows ?? []) as { leave_type: string; start_date: string; end_date: string | null; status: LeaveDay['status']; half_day_period?: string | null }[]) {
        const last = leave.end_date && leave.end_date > leave.start_date ? leave.end_date : leave.start_date;
        for (let date = leave.start_date < `${month}-01` ? `${month}-01` : leave.start_date; date <= last && date <= end; date = nextDay(date)) if (leaveMap[date]?.status !== 'approved') leaveMap[date] = { type: leave.half_day_period ? `${leave.leave_type}:${leave.half_day_period}` : leave.leave_type, status: leave.status };
      }
    }
    let workerRows: Row[] = [];
    const { data: userData, error: authError } = includeShiftAttendance ? await supabase.auth.getUser() : { data: { user: null }, error: null };
    if (authError || (includeShiftAttendance && !userData.user)) throw new Error('로그인을 확인한 뒤 다시 시도해 주세요.');
    if (includeShiftAttendance && userData.user) {
      const { data: worker, error: workerError } = await supabase.from('workers').select('id').eq('auth_user_id', userData.user.id).maybeSingle();
      if (workerError) throw new Error('근무자 정보를 불러오지 못했어요.');
      if (worker) {
        // 정산 분은 따로 읽는다 — 한 조회로 묶었더니 정산 표 권한 오류 하나로 직원 근태까지 달력 전체가 사라졌다(2026-11-05 QA)
        const { data: shifts, error: shiftError } = await supabase.from('shift_attendances').select('id,check_in_at,check_out_at,checkout_requested_at,check_in_method,check_out_method,late_minutes,early_leave_minutes,shifts!inner(shift_date)').eq('worker_id', worker.id).gte('shifts.shift_date', `${month}-01`).lte('shifts.shift_date', end);
        if (shiftError) partial = '공고 근무 기록을 불러오지 못했어요. 지금은 직원 근무만 보여요.';
        else {
          const settled = await loadSettledMinutes(((shifts ?? []) as any[]).map((r) => r.id as string));
          if (!settled) partial = '정산 시간을 불러오지 못해 공고 근무는 정산 대기로 보여요.';
          workerRows = ((shifts ?? []) as any[]).map((r) => { const s = Array.isArray(r.shifts) ? r.shifts[0] : r.shifts; return { recognizedMinutes: settled ? recordedShiftMinutes(settled.get(r.id)) : null, key: `shift-${r.id}`, work_date: s.shift_date, check_in_at: r.check_in_at, check_out_at: r.check_out_at, status: r.check_out_at ? 'completed' : r.checkout_requested_at ? 'checkout_pending' : r.check_in_at ? 'working' : 'scheduled', break_minutes: 0, late_minutes: Number(r.late_minutes??0), early_leave_minutes: Number(r.early_leave_minutes??0), check_in_method: r.check_in_method, check_out_method: r.check_out_method, source: '공고 근무' }; });
        }
      }
    }
    const list: Row[] = [ ...((staffRows ?? []) as any[]).map((r) => ({ ...r, key: `staff-${r.work_date}`, source: staffSourceLabel })), ...workerRows ];
    if (!active) return;
    list.sort((a, b) => a.work_date.localeCompare(b.work_date));
    setRows(list); setLeaveDays(leaveMap); setNotice(partial); const dates = list.map((r) => r.work_date); setSelected(month === current && (dates.includes(today) || leaveMap[today]) ? today : dates[0] ?? Object.keys(leaveMap).sort()[0] ?? null); setLoading(false);
  } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : '근태를 불러오지 못했어요. 다시 시도해 주세요.'); }
    finally { if (active) setLoading(false); }
  })(); return () => { active = false; }; }, [staffId, month, current, today, retry, refreshKey, includeShiftAttendance, staffSourceLabel]);
  const byDate = new Map<string, Row[]>(); rows.forEach((r) => byDate.set(r.work_date, [...(byDate.get(r.work_date) ?? []), r]));
  const [y, m] = month.split('-').map(Number); const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const cells: (string | null)[] = [...Array.from({ length: firstDow }, () => null), ...Array.from({ length: new Date(Date.UTC(y, m, 0)).getUTCDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const selectedRows = selected ? byDate.get(selected) ?? [] : []; const selectedLeave = selected ? leaveDays[selected] : undefined; const legend: [string, string][] = Object.values(leaveDays).some((leave) => leave.status === 'pending') ? [...LEGEND, [LEAVE_STYLE.pending, LEAVE_STATE.pending]] : LEGEND; const doneDays = new Set(rows.filter((r) => r.check_in_at && r.check_out_at).map(r => r.work_date)).size; const totalMin = rows.reduce((s, r) => s + worked(r), 0); const lateCount = rows.filter((r) => r.status === 'late' || Number(r.late_minutes) > 0).length; const earlyCount = rows.filter((r) => Number(r.early_leave_minutes) > 0).length; const pendingCount = rows.filter((r) => r.status === 'checkout_pending').length;
  return <div>
    <div className="flex items-center justify-between rounded-xl bg-bg p-1.5"><button type="button" onClick={() => setMonth(moveMonth(month, -1))} aria-label="이전 달" className="flex h-11 w-11 items-center justify-center text-lg">‹</button><b className="text-center text-[12px]">{month.slice(0, 4)}년 {Number(month.slice(5, 7))}월</b>{month < current ? <button type="button" onClick={() => setMonth(moveMonth(month, 1))} aria-label="다음 달" className="flex h-11 w-11 items-center justify-center text-lg">›</button> : <span className="flex h-11 w-11 items-center justify-center text-lg text-line" aria-hidden>›</span>}</div>
    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]"><div className="rounded-xl bg-primary/5 p-2.5"><b className="block text-[15px] text-primary">{doneDays}일 · {Math.floor(totalMin / 60)}시간 {totalMin % 60}분</b><span className="text-sub">완료 근무 · 정산 대기 시간 제외</span></div><div className="rounded-xl bg-amber-50 p-2.5"><b className="block text-[15px] text-amber-700">지각 {lateCount} · 조퇴 {earlyCount}</b><span className="text-sub">승인 대기 {pendingCount}건</span></div></div>
    {notice && !loading && !error && <p role="status" className="mt-2 rounded-xl bg-amber-50 p-2.5 text-[11px] font-bold text-amber-700">{notice}</p>}
    {loading ? <p className="mt-4 rounded-xl bg-bg p-4 text-center text-[12px] text-sub">근태를 불러오는 중...</p> : error ? <div role="alert" className="mt-4 rounded-xl border border-red-100 bg-red-50 p-4 text-center text-[12px] font-bold text-red-600"><p>{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-3 min-h-11 rounded-lg bg-white px-3 text-[12px] font-extrabold text-red-600">다시 불러오기</button></div> : <><div className="mt-3 grid grid-cols-7 text-center text-[11px] font-bold text-sub">{['일', '월', '화', '수', '목', '금', '토'].map((d, i) => <span key={d} className={`py-1 ${i === 0 ? 'text-red-400' : ''}`}>{d}</span>)}</div><div className="mt-1 grid grid-cols-7 gap-y-1">{cells.map((date, i) => { if (!date) return <span key={`e-${i}`} />; const records = byDate.get(date) ?? []; const record = records.sort((a, b) => (statusRank[b.status] ?? 0) - (statusRank[a.status] ?? 0))[0]; const leave = record?.status === 'leave' ? undefined : leaveDays[date]; const style = record ? DAY_STYLE[record.status] ?? 'bg-bg text-sub' : leave ? LEAVE_STYLE[leave.status] : 'text-ink'; return <button key={date} type="button" disabled={!record && !leave} onClick={() => setSelected(date)} aria-label={`${date}${record ? ` ${STATUS_LABEL[record.status] ?? record.status}` : ''}${leave ? ` ${LEAVE_STATE[leave.status]}` : ''}`} aria-pressed={date === selected} className="flex min-h-11 items-center justify-center"><span className={`relative flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold ${style} ${date === selected ? 'ring-2 ring-ink' : date === today ? 'ring-1 ring-line' : ''}`}>{Number(date.slice(8))}{record && leave && <span className="absolute -bottom-1 h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />}</span></button>; })}</div><div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-3">{legend.map(([color, label]) => <span key={label} className="flex items-center gap-1 text-[11px] text-sub"><span className={`h-2.5 w-2.5 rounded-full ${color}`} aria-hidden />{label}</span>)}</div>
      {(selectedRows.length > 0 || selectedLeave) && <div className="mt-3 space-y-2" role="region" aria-live="polite" aria-label="선택한 날짜 상세">{selectedLeave && selected && !selectedRows.some((row) => row.status === 'leave') && <div className="flex items-center justify-between rounded-xl bg-emerald-50 p-3 text-[12px]"><b className="text-[13px] text-emerald-800">{selected} · {leaveTypeLabel(selectedLeave.type)}</b><span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-emerald-700">{selectedLeave.status === 'approved' ? '승인됨' : '승인 대기'}</span></div>}{selectedRows.map((row) => <div key={row.key} className="rounded-xl bg-bg p-3 text-[12px]"><div className="flex items-center justify-between"><b className="text-[13px]">{row.work_date} · {row.source}</b><span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold">{STATUS_LABEL[row.status] ?? row.status}</span></div><div className="mt-2 flex justify-between"><span className="text-sub">출퇴근</span><b>{timeOf(row.check_in_at)} → {timeOf(row.check_out_at)}</b></div><div className="mt-1.5 flex justify-between"><span className="text-sub">인정 근무</span><b>{row.recognizedMinutes === null ? '정산 대기' : `${Math.floor(worked(row) / 60)}시간 ${worked(row) % 60}분`}</b></div><div className="mt-1.5 flex justify-between"><span className="text-sub">인증</span><b>{AUTH[row.check_out_method ?? row.check_in_method ?? ''] ?? row.check_out_method ?? row.check_in_method ?? '—'}</b></div>{(Number(row.late_minutes) > 0 || Number(row.early_leave_minutes) > 0) && <p className="mt-1.5 text-right font-bold text-amber-600">{Number(row.late_minutes) > 0 ? `지각 ${row.late_minutes}분` : ''}{Number(row.early_leave_minutes) > 0 ? ` · 조퇴 ${row.early_leave_minutes}분` : ''}</p>}</div>)}</div>}
      {rows.length === 0 && Object.keys(leaveDays).length === 0 && <p className="mt-3 rounded-xl bg-bg p-4 text-center text-[12px] text-sub">{month.slice(0, 4)}년 {Number(month.slice(5, 7))}월 근태 기록이 없어요.</p>}</>}
  </div>;
}
