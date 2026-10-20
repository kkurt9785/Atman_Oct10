'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { dateKST } from '@/lib/date';
import { AGENDA_STATUS, agendaEndsAt, agendaTime, isPendingKind, slotLabel, sortAgenda, staffAgenda, type AgendaItem, type AgendaKind, type StaffPlan } from '@/lib/work-agenda';

export function WorkAgenda({ compact = false, revision = '' }: { compact?: boolean; revision?: string }) {
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [view, setView] = useState('list'), [selected, setSelected] = useState('');
  const [month, setMonth] = useState(dateKST().slice(0, 7));
  const [staffCount, setStaffCount] = useState(0);
  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true); setError('');
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) throw new Error();
        const { data: worker, error: workerError } = await supabase.from('workers').select('id,role').eq('auth_user_id', user.id).maybeSingle();
        if (workerError) throw workerError;
        const from = compact ? dateKST() : `${month}-01`;
        const [staff, applications] = await Promise.all([
          supabase.from('facility_staff').select('id,contract_start,contract_end,work_weekdays,default_start_time,default_end_time,facilities!facility_id(name)').eq('worker_id', worker?.id ?? '00000000-0000-0000-0000-000000000000').eq('worker_kind', 'staff').neq('status', 'ended'),
          worker ? supabase.from('shift_applications').select('id,status,checked_in_at,checked_out_at,shifts(shift_date,start_time,end_time,status,required_role,facilities!facility_id(name))').eq('worker_id', worker.id).in('status', ['invited', 'applied', 'accepted', 'completed']) : Promise.resolve({ data: [], error: null }),
        ]);
        if (staff.error || applications.error) throw new Error();
        const rows = staffAgenda((staff.data ?? []) as unknown as StaffPlan[], from, compact ? 42 : new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate(), worker?.role as string | undefined);
        for (const app of applications.data ?? []) {
          const shift = Array.isArray(app.shifts) ? app.shifts[0] : app.shifts;
          if (!shift || shift.status === 'cancelled') continue;
          const active = app.status === 'accepted' && Boolean(app.checked_in_at) && !app.checked_out_at;
          if (compact && !active && shift.shift_date < from) continue;
          const facility = Array.isArray(shift.facilities) ? shift.facilities[0] : shift.facilities;
          const finished = app.status === 'completed' || Boolean(app.checked_out_at);
          if (compact && finished) continue;
          if (['applied', 'invited'].includes(app.status) && Date.parse(`${shift.shift_date}T${shift.start_time}+09:00`) <= Date.now()) continue;
          // 확정됐는데 출근 기록 없이 끝난 근무는 '확정'으로 남기지 않는다(상세 카드의 '근무 기록 없음'과 같은 기준)
          const base = { id: app.id, date: shift.shift_date, start: shift.start_time, end: shift.end_time };
          const ended = agendaEndsAt({ ...base, facility: '', kind: 'confirmed', status: '', href: '' }) <= Date.now();
          const kind: AgendaKind = active ? 'active' : finished ? 'done' : app.status === 'accepted' ? (ended && !app.checked_in_at ? 'missed' : 'confirmed') : app.status === 'invited' ? 'invited' : 'pending';
          rows.push({ ...base, facility: facility?.name || '사업장', active, kind, status: AGENDA_STATUS[kind], slot: slotLabel(shift.start_time, (shift as { required_role?: string | null }).required_role), href: `/applications#application-${app.id}` });
        }
        if (alive) { setItems(sortAgenda(compact ? rows.filter(row => row.active || agendaEndsAt(row) > Date.now()) : rows)); setStaffCount(staff.data?.length ?? 0); }
      } catch { if (alive) setError('근무 일정을 불러오지 못했어요.'); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [compact, month, retry, revision]);
  if (loading) return <p role="status" className="py-8 text-sm text-sub">내 근무를 확인하고 있어요…</p>;
  if (error) return <div role="alert" className="rounded-2xl bg-amber-50 p-4"><p>{error}</p><button onClick={() => setRetry(x => x + 1)} className="min-h-11 font-bold text-primary">다시 불러오기</button></div>;
  const pending = items.filter(item => isPendingKind(item.kind));
  const confirmed = items.filter(item => !isPendingKind(item.kind));
  const today = dateKST();
  const activeItem = items.find(item => item.kind === 'active');
  const todayConfirmed = items.find(item => item.kind === 'confirmed' && item.date === today);
  // 출퇴근 버튼 문구는 상황대로 — 단기 근무만 있는 사람에게 '내 사업장'은 어색하다
  const ctaLabel = activeItem ? `퇴근하기 · ${activeItem.facility}` : todayConfirmed ? `출근하기 · ${todayConfirmed.facility}` : '출퇴근 · 내 사업장';
  const attendanceTarget=activeItem??todayConfirmed;
  const attendanceHref=attendanceTarget?`/workplace?applicationId=${encodeURIComponent(attendanceTarget.id)}`:'/workplace';
  const chipClass: Record<AgendaKind, string> = { staff: 'bg-bg text-sub', pending: 'bg-amber-50 text-amber-700', invited: 'bg-amber-50 text-amber-700', confirmed: 'bg-primary/10 text-primary', active: 'bg-emerald-50 text-emerald-700', done: 'bg-bg text-sub', missed: 'bg-amber-50 text-amber-800' };
  const isPast = (item: AgendaItem) => !item.active && agendaEndsAt(item) <= Date.now();
  const renderCard = (item: AgendaItem) => <Link key={item.id} href={item.href} className={`block rounded-2xl border border-line bg-white p-4 active:bg-primary/5 ${isPast(item) ? 'opacity-60' : ''}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-sm font-bold">{item.date === today ? '오늘 · ' : ''}{item.date}{item.slot && <span className="rounded-full bg-bg px-2 py-0.5 text-[11px] font-bold text-sub">{item.slot}</span>}</span>
      <span className={`rounded-full px-2 py-1 text-xs font-bold ${chipClass[item.kind]}`}>{item.status}</span>
    </div>
    <p className="mt-2 text-xl font-extrabold">{agendaTime(item)}</p>
    <p className="mt-1 break-words text-sm text-sub">{item.facility}</p>
    <p className="mt-3 text-xs font-bold text-primary">{item.kind === 'staff' ? '내 사업장 · 근태 확인' : item.kind === 'missed' ? '출근 기록 없이 끝났어요 · 사업장에 알리기' : '근무 상세 · 지원 상태 확인'} →</p>
  </Link>;
  const visible = compact ? confirmed.slice(0, 1) : items.filter(item => item.date.startsWith(month) && (!selected || item.date === selected));
  const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
  const offset = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  return <section aria-label="내 근무 일정" className="space-y-3">
    {(staffCount > 0 || activeItem || todayConfirmed) && <Link href={attendanceHref} className="flex min-h-12 items-center justify-center rounded-xl bg-primary p-3 font-bold text-white">{ctaLabel}</Link>}
    <div className="flex items-center justify-between"><h2 className="text-lg font-extrabold">{compact ? '다음 내 근무' : '날짜별 일정'}</h2>{compact ? <Link className="min-h-11 flex items-center text-sm font-bold text-primary" href="/applications">전체 보기 →</Link> : <div className="flex gap-1">{[['list', '목록'], ['calendar', '달력']].map(([key, label]) => <button key={key} onClick={() => { setView(key); setSelected(''); }} aria-pressed={view === key} className={`min-h-11 rounded-xl px-3 text-sm ${view === key ? 'bg-ink text-white' : 'bg-white'}`}>{label}</button>)}</div>}</div>
    {!compact && <label className="flex items-center justify-between gap-2 text-sm">조회 월<input aria-label="일정 조회 월" type="month" value={month} onChange={e => { if (e.target.value) { setMonth(e.target.value); setSelected(''); } }} className="min-h-11 min-w-0 rounded-xl border border-line p-2 text-base" /></label>}
    {!compact && view === 'calendar' && <div className="rounded-2xl bg-white p-3"><div className="grid grid-cols-7 text-center text-xs">{'일월화수목금토'.split('').map(day => <span key={day} className="py-2">{day}</span>)}{Array.from({ length: offset }, (_, i) => <span key={`blank-${i}`} />)}{Array.from({ length: days }, (_, i) => { const date = `${month}-${String(i + 1).padStart(2, '0')}`, count = items.filter(item => item.date === date).length; return <button key={date} aria-label={`${date} 근무 ${count}건`} aria-pressed={selected === date} onClick={() => setSelected(selected === date ? '' : date)} className={`min-h-14 rounded-xl py-2 ${selected === date ? 'bg-primary text-white' : date === dateKST() ? 'bg-primary/10' : ''}`}><span className="block text-sm">{i + 1}</span><span className="block text-[10px]">{count ? `${count}건` : '·'}</span></button>; })}</div>{selected && <button className="min-h-11 text-sm font-bold text-primary" onClick={() => setSelected('')}>이 달 전체 보기</button>}</div>}
    {(compact || selected ? visible : visible.filter(item => !isPast(item))).map(renderCard)}
    {!compact && !selected && visible.some(isPast) && <details className="rounded-2xl bg-white"><summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-bold text-sub">지난 일정 {visible.filter(isPast).length}건</summary><div className="space-y-3 px-3 pb-3">{visible.filter(isPast).map(renderCard)}</div></details>}
    {!visible.length && <div className="rounded-2xl bg-white p-5"><p className="font-bold">{compact ? '예정된 근무가 없어요' : '선택한 기간에 일정이 없어요'}</p><Link href="/shifts" className="mt-2 flex min-h-11 items-center font-bold text-primary">가능한 날짜로 근무 찾기 →</Link></div>}
    {staffCount > 0 && <p className="text-xs leading-5 text-sub">직원 일정은 계약 기간·요일 기준의 예정입니다. 휴가·변경 사항과 실제 출퇴근은 내 사업장에서 확인해 주세요.</p>}
    {compact && pending.length > 0 && <Link href="/applications" className="flex min-h-14 items-center justify-between rounded-2xl bg-amber-50 p-4 text-sm font-bold">지원 대기·수락 요청 {pending.length}건 <span>확인 →</span></Link>}
  </section>;
}
