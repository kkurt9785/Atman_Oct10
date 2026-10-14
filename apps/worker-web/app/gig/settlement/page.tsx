'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { GigInviteAction } from '@/components/invite/GigInviteAction';
import { isGigLink } from '@/lib/worker-mode';
import { BankAccount, type BankAccountValue } from '@/components/onboarding/BankAccount';
import { MyAttendanceCalendar } from '@/components/attendance/MyAttendanceCalendar';
import { PayoutDetail } from '@/components/gig/PayoutDetail';
import { effectiveBreakMinutes, hoursText, weeklyHolidayPay, currentWeekRangeKST, WEEKLY_HOLIDAY_MIN_MINUTES, type PayoutStatement } from '@/lib/gig-pay';

type FacilityRef = { id: string; name: string };
type Staff = {
  id: string; name: string; status: string; worker_kind?: string | null; facilities: FacilityRef | FacilityRef[];
  // 내 근무 조건 — 초대 수락 뒤에도 다시 볼 수 있게(시급·시간·휴게·기간)
  pay_basis?: string | null; pay_rate?: number | null; default_break_minutes?: number | null;
  default_start_time?: string | null; default_end_time?: string | null; work_weekdays?: number[] | null;
  contract_start?: string | null; contract_end?: string | null;
};
type AttendanceRow = { work_date: string; check_in_at: string | null; check_out_at: string | null; break_minutes: number | null; status: string };
type Bank = { id: string; bank_name: string | null; account_number_last4: string | null };
type Share = { staff_id: string; bank_account_id: string; shared_at: string };
type Payout = {
  id: string; staff_id: string; period_start: string; period_end: string; worked_days: number; worked_minutes: number;
  pay_basis: string; pay_rate: number; amount: number; withholding_amount: number | null; net_amount: number | null;
  status: 'scheduled' | 'paid' | 'cancelled'; pay_at: string | null; paid_at: string | null;
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
  const [loading, setLoading] = useState(true);
  const [bankOpen, setBankOpen] = useState(false);
  const [bankSaving, setBankSaving] = useState(false);
  const [bankError, setBankError] = useState('');
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState('');

  useEffect(() => { void (async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.replace('/'); return; }
    const [{ data: worker }, { data: staffRows }] = await Promise.all([
      supabase.from('workers').select('id,name').eq('auth_user_id', user.id).is('deleted_at', null).maybeSingle(),
      supabase.from('facility_staff').select('id,name,status,worker_kind,pay_basis,pay_rate,default_break_minutes,default_start_time,default_end_time,work_weekdays,contract_start,contract_end,facilities!facility_id(id,name)').order('created_at', { ascending: false }),
    ]);
    const linked = ((staffRows ?? []) as Staff[]).filter(isGigLink);
    setStaffList(linked);
    setSelectedStaffId(linked[0]?.id ?? '');
    setWorkerName(worker?.name ?? user.user_metadata?.profile_nickname ?? '');
    if (!worker?.id || linked.length === 0) { setLoading(false); return; }
    const staffIds = linked.map((item) => item.id);
    const [{ data: bankRow }, { data: shareRows }, { data: payoutRows }] = await Promise.all([
      supabase.from('worker_bank_accounts').select('id,bank_name,account_number_last4')
        .eq('worker_id', worker.id).eq('is_primary', true).is('deleted_at', null).maybeSingle(),
      supabase.from('gig_bank_account_shares').select('staff_id,bank_account_id,shared_at').in('staff_id', staffIds),
      supabase.from('gig_payouts').select('id,staff_id,period_start,period_end,worked_days,worked_minutes,pay_basis,pay_rate,amount,withholding_amount,net_amount,status,pay_at,paid_at')
        .in('staff_id', staffIds).neq('status', 'cancelled').order('created_at', { ascending: false }),
    ]);
    setBank((bankRow as Bank | null) ?? null);
    setShares((shareRows ?? []) as Share[]);
    setPayouts((payoutRows ?? []) as Payout[]);
    setBankOpen(!bankRow);
    setLoading(false);
  })(); }, []);

  const staff = staffList.find((item) => item.id === selectedStaffId) ?? staffList[0] ?? null;
  const facility = staff ? facilityOf(staff) : null;
  const currentShare = staff && bank ? shares.find((item) => item.staff_id === staff.id && item.bank_account_id === bank.id) ?? null : null;
  const selectedPayouts = useMemo(() => payouts.filter((item) => item.staff_id === staff?.id), [payouts, staff?.id]);

  // 이번 달 인정 시간 → 예상 세전. 사장님 앱 정산과 같은 규칙(완료 기록, 휴게 차감)
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const monthStart = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const monthEnd = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  useEffect(() => {
    if (!staff?.id) { setMonthRows([]); return; }
    let active = true;
    void supabase.from('staff_attendances').select('work_date,check_in_at,check_out_at,break_minutes,status')
      .eq('staff_id', staff.id).gte('work_date', monthStart).lte('work_date', monthEnd)
      .then(({ data }) => { if (active) setMonthRows((data ?? []) as AttendanceRow[]); });
    return () => { active = false; };
  }, [staff?.id, monthStart, monthEnd]);
  const month = useMemo(() => {
    let minutes = 0; const days = new Set<string>();
    for (const row of monthRows) {
      if (row.status !== 'completed' || !row.check_in_at || !row.check_out_at) continue;
      const raw = Math.max(0, Math.round((Date.parse(row.check_out_at) - Date.parse(row.check_in_at)) / 60000));
      minutes += Math.max(0, raw - effectiveBreakMinutes(raw, row.break_minutes, staff?.default_break_minutes)); days.add(row.work_date);
    }
    const rate = Number(staff?.pay_rate ?? 0);
    const expected = staff?.pay_basis === 'hourly' ? Math.round((minutes / 60) * rate) : staff?.pay_basis === 'daily' ? days.size * rate : 0;
    const received = selectedPayouts.filter((p) => p.status === 'paid' && ((p.paid_at ?? p.pay_at ?? '').slice(0, 10) >= monthStart)).reduce((sum, p) => sum + (p.net_amount ?? p.amount), 0);
    // 이번 주(월~일) 인정 시간 → 주휴수당 안내 (달이 바뀌는 주는 이번 달 기록만 본다)
    const week = currentWeekRangeKST();
    let weekMinutes = 0;
    for (const row of monthRows) {
      if (row.status !== 'completed' || !row.check_in_at || !row.check_out_at || row.work_date < week.start || row.work_date > week.end) continue;
      const raw = Math.max(0, Math.round((Date.parse(row.check_out_at) - Date.parse(row.check_in_at)) / 60000));
      weekMinutes += Math.max(0, raw - effectiveBreakMinutes(raw, row.break_minutes, staff?.default_break_minutes));
    }
    const holiday = staff?.pay_basis === 'hourly' ? weeklyHolidayPay(weekMinutes, rate) : 0;
    return { minutes, days: days.size, expected, received, weekMinutes, holiday };
  }, [monthRows, staff, selectedPayouts, monthStart]);
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
      : !staff ? <section className="mt-3 rounded-2xl bg-white p-8 text-center"><b className="text-ink">연결된 초대 근무가 없어요</b><p className="mt-2 text-[13px] text-sub">사장님이 보낸 초대를 먼저 수락해 주세요.</p><GigInviteAction /></section>
      : <>
        {staffList.length > 1 && <label className="mt-3 block rounded-2xl bg-white p-4 text-[12px] font-bold text-sub shadow-sm">근무지 선택<select value={selectedStaffId} onChange={(event) => setSelectedStaffId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-line bg-white px-3 text-ink">{staffList.map((item) => <option key={item.id} value={item.id}>{facilityOf(item)?.name ?? '근무지'} · {item.name}</option>)}</select></label>}

        <section className="mt-3 rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-[11px] font-extrabold text-primary">내 근무 조건</p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <h2 className="text-[20px] font-extrabold text-ink">{staff.pay_basis === 'hourly' ? `시급 ${won(Number(staff.pay_rate ?? 0))}` : staff.pay_basis === 'daily' ? `일급 ${won(Number(staff.pay_rate ?? 0))}` : staff.pay_rate ? `월 ${won(Number(staff.pay_rate))}` : '급여 기준 미정'}</h2>
            {staff.default_break_minutes ? <span className="text-[12px] font-bold text-sub">휴게 {staff.default_break_minutes}분 차감</span> : null}
          </div>
          <p className="mt-1 text-[12px] text-sub">{[weekdayText(staff.work_weekdays), staff.default_start_time ? `${hhmm(staff.default_start_time)}–${hhmm(staff.default_end_time)}` : '', staff.contract_start ? `${staff.contract_start}${staff.contract_end ? ` ~ ${staff.contract_end}` : '~'}` : ''].filter(Boolean).join(' · ') || '사장님이 정한 일정이 여기에 보여요'}</p>
          <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-bg p-3 text-center">
            <div><p className="text-[11px] text-sub">이번 달 인정</p><p className="mt-0.5 text-[13px] font-extrabold text-ink">{hoursText(month.minutes)}</p><p className="text-[10px] text-sub">{month.days}일</p></div>
            <div><p className="text-[11px] text-sub">예상 세전</p><p className="mt-0.5 text-[13px] font-extrabold text-primary">{won(month.expected)}</p><p className="text-[10px] text-sub">{staff.pay_basis === 'hourly' ? '시간 × 시급' : staff.pay_basis === 'daily' ? '일수 × 일급' : '-'}</p></div>
            <div><p className="text-[11px] text-sub">받은 금액</p><p className="mt-0.5 text-[13px] font-extrabold text-ink">{won(month.received)}</p><p className="text-[10px] text-sub">지급 완료 기준</p></div>
          </div>
          {month.holiday > 0
            ? <p className="mt-2 text-[11px] leading-4 text-sub">이번 주 {hoursText(month.weekMinutes)} 근무 · 개근이면 <b className="text-ink">주휴수당 약 {won(month.holiday)}</b> 대상이에요. 지급액과 별도라 사장님과 확인해 주세요.</p>
            : <p className="mt-2 text-[11px] leading-4 text-sub">이번 주 {hoursText(month.weekMinutes)} 근무{month.weekMinutes < WEEKLY_HOLIDAY_MIN_MINUTES ? ' · 주 15시간 이상·개근이면 주휴수당 대상이 돼요' : ''}.</p>}
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
            : <div className="mt-3 divide-y divide-line">{selectedPayouts.map((item) => <PayoutDetail key={item.id} statement={toStatement(item)} right={<span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${item.status === 'paid' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-700'}`}>{item.status === 'paid' ? '지급 완료' : `${item.pay_at ?? ''} 지급 예정`}</span>} />)}</div>}
        </section>
      </>}
  </main>;
}
