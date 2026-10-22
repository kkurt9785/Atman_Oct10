'use client';

import { roundPay } from '@/lib/shared/gig-pay/shift-pay';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { GigInviteAction } from '@/components/invite/GigInviteAction';
import { isGigLink } from '@/lib/worker-mode';
import { BankAccount, type BankAccountValue } from '@/components/onboarding/BankAccount';
import { MyAttendanceCalendar } from '@/components/attendance/MyAttendanceCalendar';
import { PayoutDetail } from '@/components/gig/PayoutDetail';
import { summarizeAttendancePeriod, payoutDateKST, hoursText, weeklyHolidayPay, currentWeekRangeKST, type PayoutStatement } from '@/lib/gig-pay';

type FacilityRef = { id: string; name: string };
type Staff = {
  id: string; name: string; status: string; worker_kind?: string | null; facilities: FacilityRef | FacilityRef[];
  // 내 근무 조건 — 초대 수락 뒤에도 다시 볼 수 있게(시급·시간·휴게·기간)
  pay_basis?: string | null; pay_rate?: number | null; default_break_minutes?: number | null;
  default_start_time?: string | null; default_end_time?: string | null; work_weekdays?: number[] | null;
  contract_start?: string | null; contract_end?: string | null;
  // 초대 수락 시점의 조건(snapshot_my_gig_terms) — 지금 조건과 다르면 알려 준다
  terms_snapshot?: { payBasis?: string | null; payRate?: number | null; startTime?: string | null; endTime?: string | null; breakMinutes?: number | null; acceptedAt?: string | null } | null;
  terms_snapshot_at?: string | null;
};
type AttendanceRow = { work_date: string; check_in_at: string | null; check_out_at: string | null; break_minutes: number | null; status: string };
type Bank = { id: string; bank_name: string | null; account_number_last4: string | null };
type Share = { staff_id: string; bank_account_id: string; shared_at: string };
type Payout = {
  id: string; staff_id: string; period_start: string; period_end: string; worked_days: number; worked_minutes: number;
  pay_basis: string; pay_rate: number; amount: number; withholding_amount: number | null; net_amount: number | null;
  status: 'scheduled' | 'paid' | 'cancelled'; pay_at: string | null; paid_at: string | null;
  worker_confirm_status: 'received' | 'missing' | null; worker_confirmed_at: string | null;
};
const WEEKDAY = ['', '월', '화', '수', '목', '금', '토', '일'];
const weekdayText = (days?: number[] | null) => !days?.length ? '' : days.length === 7 ? '매일' : days.map((d) => WEEKDAY[d] ?? '').join('·');
const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : '');

const facilityOf = (staff: Staff) => (Array.isArray(staff.facilities) ? staff.facilities[0] : staff.facilities) ?? null;
const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

export default function GigSettlementPage() {
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [workerName, setWorkerName] = useState('');
  const [bank, setBank] = useState<Bank | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [monthRows, setMonthRows] = useState<AttendanceRow[]>([]);
  const [attendanceError, setAttendanceError] = useState('');
  const [attendanceStaffId, setAttendanceStaffId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [bankOpen, setBankOpen] = useState(false);
  const [bankSaving, setBankSaving] = useState(false);
  const [bankError, setBankError] = useState('');
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    void (async () => {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!active) return;
    if (authError) throw new Error('로그인 상태를 확인하지 못했어요. 다시 시도해 주세요.');
    if (!user) { window.location.replace('/'); return; }
    const [{ data: worker, error: workerError }, { data: staffRows, error: staffError }] = await Promise.all([
      supabase.from('workers').select('id,name').eq('auth_user_id', user.id).is('deleted_at', null).maybeSingle(),
      supabase.from('facility_staff').select('id,name,status,worker_kind,pay_basis,pay_rate,default_break_minutes,default_start_time,default_end_time,work_weekdays,contract_start,contract_end,terms_snapshot,terms_snapshot_at,facilities!facility_id(id,name)').order('created_at', { ascending: false }),
    ]);
    if (!active) return;
    if (workerError || staffError) throw new Error('근무지 정보를 불러오지 못했어요. 다시 시도해 주세요.');
    const linked = ((staffRows ?? []) as Staff[]).filter(isGigLink);
    setStaffList(linked);
    setSelectedStaffId(linked[0]?.id ?? '');
    setWorkerName(worker?.name ?? user.user_metadata?.profile_nickname ?? '');
    if (!worker?.id || linked.length === 0) { setLoading(false); return; }
    const staffIds = linked.map((item) => item.id);
    const [{ data: bankRow, error: bankLoadError }, { data: shareRows, error: sharesError }, { data: payoutRows, error: payoutsError }] = await Promise.all([
      supabase.from('worker_bank_accounts').select('id,bank_name,account_number_last4')
        .eq('worker_id', worker.id).eq('is_primary', true).is('deleted_at', null).maybeSingle(),
      supabase.from('gig_bank_account_shares').select('staff_id,bank_account_id,shared_at').in('staff_id', staffIds),
      supabase.from('gig_payouts').select('id,staff_id,period_start,period_end,worked_days,worked_minutes,pay_basis,pay_rate,amount,withholding_amount,net_amount,status,pay_at,paid_at,worker_confirm_status,worker_confirmed_at')
        .in('staff_id', staffIds).neq('status', 'cancelled').order('created_at', { ascending: false }),
    ]);
    if (!active) return;
    if (bankLoadError || sharesError || payoutsError) throw new Error('계좌·지급 내역을 불러오지 못했어요. 다시 시도해 주세요.');
    if ((payoutRows?.length ?? 0) >= 1000) throw new Error('지급 내역이 많아 전체 합계를 확인할 수 없어요. 고객센터에 문의해 주세요.');
    setBank((bankRow as Bank | null) ?? null);
    setShares((shareRows ?? []) as Share[]);
    setPayouts((payoutRows ?? []) as Payout[]);
    setBankOpen(!bankRow);
    setLoading(false);
  })().catch((error: unknown) => {
    if (active) { setLoadError(error instanceof Error ? error.message : '정보를 불러오지 못했어요. 다시 시도해 주세요.'); setLoading(false); }
  });
    return () => { active = false; };
  }, [reloadKey]);

  const staff = staffList.find((item) => item.id === selectedStaffId) ?? staffList[0] ?? null;
  const facility = staff ? facilityOf(staff) : null;
  const currentShare = staff && bank ? shares.find((item) => item.staff_id === staff.id && item.bank_account_id === bank.id) ?? null : null;
  const selectedPayouts = useMemo(() => payouts.filter((item) => item.staff_id === staff?.id), [payouts, staff?.id]);

  // 이번 달 인정 시간 → 예상 세전. 사장님 앱 정산과 같은 규칙(완료 기록, 휴게 차감)
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const monthStart = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const monthEnd = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const week = currentWeekRangeKST();
  const attendanceStart = week.start < monthStart ? week.start : monthStart;
  const attendanceEnd = week.end > monthEnd ? week.end : monthEnd;
  useEffect(() => {
    if (!staff?.id) { setMonthRows([]); return; }
    let active = true;
    setAttendanceError('');
    setAttendanceStaffId('');
    void supabase.from('staff_attendances').select('work_date,check_in_at,check_out_at,break_minutes,status')
      .eq('staff_id', staff.id).gte('work_date', attendanceStart).lte('work_date', attendanceEnd)
      .then(({ data, error }) => {
        if (!active) return;
        setAttendanceStaffId(staff.id);
        const failed = error || (data?.length ?? 0) >= 1000;
        setAttendanceError(failed ? '전체 근무 기록을 확인하지 못했어요. 다시 불러오거나 고객센터에 문의해 주세요.' : '');
        setMonthRows(failed ? [] : (data ?? []) as AttendanceRow[]);
      });
    return () => { active = false; };
  }, [staff?.id, attendanceStart, attendanceEnd, reloadKey]);
  const month = useMemo(() => {
    const { minutes, days } = summarizeAttendancePeriod(monthRows, monthStart, monthEnd);
    const rate = Number(staff?.pay_rate ?? 0);
    const expected = staff?.pay_basis === 'hourly' ? roundPay(minutes, rate) : staff?.pay_basis === 'daily' ? days * rate : 0;
    const received = selectedPayouts.filter((p) => {
      const date = payoutDateKST(p.paid_at, p.pay_at);
      return p.status === 'paid' && date >= monthStart && date <= monthEnd;
    }).reduce((sum, p) => sum + (p.net_amount ?? p.amount), 0);
    // Include the entire week even at a month boundary; this is a reference,
    // not a determination of contractual hours or holiday-pay eligibility.
    const { minutes: weekMinutes } = summarizeAttendancePeriod(monthRows, week.start, week.end);
    const holiday = staff?.pay_basis === 'hourly' ? weeklyHolidayPay(weekMinutes, rate) : 0;
    return { minutes, days, expected, received, weekMinutes, holiday };
  }, [monthRows, staff, selectedPayouts, monthStart, monthEnd, week.start, week.end]);
  // 입금 확인 — 사장님 지급 화면에 ✓/⚠ 로 표시된다
  async function confirmPayout(payoutId: string, received: boolean): Promise<string> {
    const { error } = await supabase.rpc('confirm_my_gig_payout', { p_payout_id: payoutId, p_received: received });
    if (error) return error.message.replace(/^.*?: /, '') || '지금은 확인을 남기지 못했어요.';
    setPayouts((current) => current.map((p) => (p.id === payoutId ? { ...p, worker_confirm_status: received ? 'received' : 'missing', worker_confirmed_at: new Date().toISOString() } : p)));
    return '';
  }
  // 수락한 조건과 지금 조건이 다른가(시급·시간·휴게)
  const snap = staff?.terms_snapshot ?? null;
  const termsChanged = Boolean(snap && (
    Number(snap.payRate ?? 0) !== Number(staff?.pay_rate ?? 0) || (snap.startTime ?? '').slice(0, 5) !== (staff?.default_start_time ?? '').slice(0, 5)
    || (snap.endTime ?? '').slice(0, 5) !== (staff?.default_end_time ?? '').slice(0, 5) || Number(snap.breakMinutes ?? 0) !== Number(staff?.default_break_minutes ?? 0)));
  const toStatement = (item: Payout): PayoutStatement => ({
    facilityName: facility?.name ?? '', workerName: staff?.name ?? workerName, periodStart: item.period_start, periodEnd: item.period_end,
    workedDays: item.worked_days, workedMinutes: item.worked_minutes, payBasis: item.pay_basis, payRate: item.pay_rate,
    amount: item.amount, withholdingAmount: item.withholding_amount ?? 0, netAmount: item.net_amount ?? item.amount, status: item.status, payAt: item.pay_at, paidAt: item.paid_at,
  });

  async function saveBank(value: BankAccountValue) {
    setBankSaving(true); setBankError(''); setShareError('');
    const { error } = await supabase.rpc('upsert_my_bank_account', {
      p_bank_code: value.bankCode, p_bank_name: value.bankName,
      p_account_number: value.accountNumber, p_account_holder_name: workerName,
    });
    if (error) { setBankError(error.message.replace(/^.*?: /, '') || '계좌를 저장하지 못했어요.'); setBankSaving(false); return; }
    const { data } = await supabase.from('worker_bank_accounts').select('id,bank_name,account_number_last4')
      .eq('is_primary', true).is('deleted_at', null).maybeSingle();
    setBank((data as Bank | null) ?? null);
    setBankOpen(false);
    setBankSaving(false);
  }

  async function shareBank() {
    if (!staff || !bank || sharing) return;
    setSharing(true); setShareError('');
    const { data, error } = await supabase.rpc('share_my_gig_bank_account', { p_staff_id: staff.id });
    setSharing(false);
    if (error) { setShareError(error.message.replace(/^.*?: /, '') || '계좌를 전달하지 못했어요.'); return; }
    const row = Array.isArray(data) ? data[0] : data;
    setShares((current) => [
      ...current.filter((item) => item.staff_id !== staff.id),
      { staff_id: staff.id, bank_account_id: bank.id, shared_at: row?.shared_at ?? new Date().toISOString() },
    ]);
  }

  return <main className="min-h-screen bg-bg px-4 pb-8 pt-5">
    <header className="rounded-3xl bg-ink px-5 py-5 text-white shadow-btn">
      <p className="text-[11px] font-extrabold text-primary-light">내 근무 기록</p>
      <h1 className="mt-2 text-[25px] font-extrabold">근태·지급</h1>
      <p className="mt-1 text-[12px] leading-5 text-white/65">근무 시작 전에 지급 계좌를 전달해 두고, 근무 기록과 지급 현황을 여기서 확인해요.</p>
    </header>

    {loading ? <div className="mt-3 rounded-2xl bg-white p-8 text-center text-[13px] text-sub">근태와 정산을 불러오고 있어요...</div>
      : loadError ? <section className="mt-3 rounded-2xl bg-white p-5"><p role="alert" className="text-[13px] text-red-600">{loadError}</p><button type="button" onClick={() => setReloadKey(key => key + 1)} className="mt-3 min-h-11 rounded-xl bg-primary px-4 text-[13px] font-bold text-white">다시 불러오기</button></section>
      : !staff ? <section className="mt-3 rounded-2xl bg-white p-8 text-center"><b className="text-ink">연결된 초대 근무가 없어요</b><p className="mt-2 text-[13px] text-sub">사장님이 보낸 초대를 먼저 수락해 주세요.</p><GigInviteAction /></section>
      : <>
        {staffList.length > 1 && <label className="mt-3 block rounded-2xl bg-white p-4 text-[12px] font-bold text-sub shadow-sm">근무지 선택<select value={selectedStaffId} onChange={(event) => setSelectedStaffId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-line bg-white px-3 text-ink">{staffList.map((item) => <option key={item.id} value={item.id}>{facilityOf(item)?.name ?? '근무지'} · {item.name}</option>)}</select></label>}

        <section className="mt-3 rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-[11px] font-extrabold text-primary">내 근무 조건</p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <h2 className="text-[20px] font-extrabold text-ink">{staff.pay_basis === 'hourly' ? `시급 ${won(Number(staff.pay_rate ?? 0))}` : staff.pay_basis === 'daily' ? `일급 ${won(Number(staff.pay_rate ?? 0))}` : staff.pay_rate ? `월 ${won(Number(staff.pay_rate))}` : '급여 기준 미정'}</h2>
            {staff.default_break_minutes ? <span className="text-[12px] font-bold text-sub">예정 휴게 {staff.default_break_minutes}분</span> : null}
          </div>
          <p className="mt-1 text-[12px] text-sub">{[weekdayText(staff.work_weekdays), staff.default_start_time ? `${hhmm(staff.default_start_time)}–${hhmm(staff.default_end_time)}` : '', staff.contract_start ? `${staff.contract_start}${staff.contract_end ? ` ~ ${staff.contract_end}` : '~'}` : ''].filter(Boolean).join(' · ') || '사장님이 정한 일정이 여기에 보여요'}</p>
          {snap && (termsChanged
            ? <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-700"><b>수락할 때와 조건이 달라요.</b> 수락한 조건: {snap.payBasis === 'hourly' ? `시급 ${won(Number(snap.payRate ?? 0))}` : snap.payBasis === 'daily' ? `일급 ${won(Number(snap.payRate ?? 0))}` : ''}{snap.startTime ? ` · ${hhmm(snap.startTime)}–${hhmm(snap.endTime)}` : ''}{snap.breakMinutes ? ` · 휴게 ${snap.breakMinutes}분` : ''} ({(staff?.terms_snapshot_at ?? '').slice(0, 10)} 수락). 바뀐 이유는 사장님께 확인해 주세요.</p>
            : <p className="mt-2 text-[11px] text-sub">{(staff?.terms_snapshot_at ?? '').slice(0, 10)}에 수락한 조건 그대로예요.</p>)}
          {attendanceStaffId !== staff.id ? <p role="status" className="mt-4 text-[12px] text-sub">근무 시간을 확인하고 있어요.</p>
            : attendanceError ? <div className="mt-4"><p role="alert" className="text-[12px] text-red-600">{attendanceError}</p><button type="button" onClick={() => setReloadKey(key => key + 1)} className="mt-2 min-h-11 rounded-xl bg-bg px-3 text-[12px] font-bold">다시 불러오기</button></div> : <>
          <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-bg p-3 text-center">
            <div><p className="text-[11px] text-sub">이번 달 인정</p><p className="mt-0.5 text-[13px] font-extrabold text-ink">{hoursText(month.minutes)}</p><p className="text-[10px] text-sub">{month.days}일</p></div>
            <div><p className="text-[11px] text-sub">예상 세전</p><p className="mt-0.5 text-[13px] font-extrabold text-primary">{won(month.expected)}</p><p className="text-[10px] text-sub">{staff.pay_basis === 'hourly' ? '시간 × 시급' : staff.pay_basis === 'daily' ? '일수 × 일급' : '-'}</p></div>
            <div><p className="text-[11px] text-sub">지급 완료 기록</p><p className="mt-0.5 text-[13px] font-extrabold text-ink">{won(month.received)}</p><p className="text-[10px] text-sub">실제 입금은 별도 확인</p></div>
          </div>
          {month.holiday > 0
            ? <p className="mt-2 text-[11px] leading-4 text-sub">이번 주 기록 {hoursText(month.weekMinutes)} 기준 주휴 참고액 <b className="text-ink">약 {won(month.holiday)}</b>. 실제 대상과 금액은 계약한 시간·개근 여부를 사장님과 확인해 주세요. 지급액에 자동 합산하지 않아요.</p>
            : <p className="mt-2 text-[11px] leading-4 text-sub">이번 주 기록 {hoursText(month.weekMinutes)}. 주휴수당은 실제 기록만으로 판단하지 않으며, 계약한 시간과 개근 여부 확인이 필요해요.</p>}
          </>}
        </section>

        <section className="mt-3 rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-[11px] font-extrabold text-primary">지급 계좌</p><h2 className="mt-1 text-[18px] font-extrabold text-ink">{bank?.bank_name && bank.account_number_last4 ? `${bank.bank_name} · ****${bank.account_number_last4}` : '계좌를 먼저 등록해 주세요'}</h2></div>
            {bank && <button type="button" onClick={() => setBankOpen((open) => !open)} className="shrink-0 rounded-lg bg-bg px-3 py-2 text-[11px] font-extrabold text-sub">{bankOpen ? '닫기' : '변경'}</button>}
          </div>
          <p className="mt-2 rounded-xl bg-primary/5 px-3 py-2 text-[11px] leading-5 text-sub"><b className="text-primary">등록과 전달은 달라요.</b> 저장한 계좌는 내가 전달한 근무지의 지급 담당자만 볼 수 있어요. 근무 시작 전에 전달해 두면 지급이 늦어지지 않아요.</p>

          {bankOpen && <div className="mt-3 rounded-xl bg-bg p-3"><BankAccount compact onNext={(value) => void saveBank(value)} submitting={bankSaving} submitError={bankError} /></div>}

          {bank && !bankOpen && (currentShare
            ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p className="text-[13px] font-extrabold text-emerald-700">{facility?.name}에 전달됨 ✓</p><p className="mt-1 text-[11px] leading-4 text-emerald-700/80">이 근무지의 지급 권한이 있는 담당자만 계좌를 확인할 수 있어요.</p></div>
            : <button type="button" onClick={() => void shareBank()} disabled={sharing} className="mt-4 h-12 w-full rounded-xl bg-primary text-[14px] font-extrabold text-white disabled:opacity-60">{sharing ? '안전하게 전달 중...' : `${facility?.name}에 계좌 전달`}</button>)}
          {shareError && <p role="alert" className="mt-2 text-[12px] font-bold text-red-600">{shareError}</p>}
        </section>

        <section className="mt-3 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-[18px] font-extrabold text-ink">내 근태</h2>
          <p className="mt-1 text-[12px] text-sub">{facility?.name}에서 기록된 출퇴근만 보여요.</p>
          <div className="mt-3"><MyAttendanceCalendar staffId={staff.id} includeShiftAttendance={false} staffSourceLabel="초대 근무" /></div>
          <p className="mt-3 text-[11px] leading-5 text-sub">수정이 필요한 기록은 대화 탭에서 사장님께 요청해 주세요.</p>
        </section>

        <section className="mt-3 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-[18px] font-extrabold text-ink">지급 현황</h2>
          {selectedPayouts.length === 0
            ? <p className="mt-3 text-[13px] leading-5 text-sub">아직 지급 기록이 없어요. 사장님이 지급을 기록하면 여기에 바로 남아요.</p>
            : <div className="mt-3 divide-y divide-line">{selectedPayouts.map((item) => <PayoutDetail key={item.id} statement={toStatement(item)} confirm={{ status: item.worker_confirm_status, onConfirm: (received) => confirmPayout(item.id, received) }} right={<span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${item.status === 'paid' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-700'}`}>{item.status === 'paid' ? '지급 완료' : `${item.pay_at ?? ''} 지급 예정`}</span>} />)}</div>}
        </section>
      </>}
  </main>;
}
