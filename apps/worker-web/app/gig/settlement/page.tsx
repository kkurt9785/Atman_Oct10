'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { isGigworkerSource } from '@/lib/worker-mode';
import { BankAccount, type BankAccountValue } from '@/components/onboarding/BankAccount';
import { MyAttendanceCalendar } from '@/components/attendance/MyAttendanceCalendar';

type FacilityRef = { id: string; name: string; registration_source?: string | null };
type Staff = { id: string; name: string; status: string; facilities: FacilityRef | FacilityRef[] };
type Bank = { id: string; bank_name: string | null; account_number_last4: string | null };
type Share = { staff_id: string; bank_account_id: string; shared_at: string };
type Payout = {
  id: string; staff_id: string; period_start: string; period_end: string; worked_days: number;
  amount: number; withholding_amount: number | null; net_amount: number | null;
  status: 'scheduled' | 'paid' | 'cancelled'; pay_at: string | null;
};

const facilityOf = (staff: Staff) => (Array.isArray(staff.facilities) ? staff.facilities[0] : staff.facilities) ?? null;
const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

export default function GigSettlementPage() {
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [workerName, setWorkerName] = useState('');
  const [bank, setBank] = useState<Bank | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [completedStaffIds, setCompletedStaffIds] = useState<Set<string>>(new Set());
  const [payouts, setPayouts] = useState<Payout[]>([]);
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
      supabase.from('facility_staff').select('id,name,status,facilities(id,name,registration_source)').order('created_at', { ascending: false }),
    ]);
    const linked = ((staffRows ?? []) as Staff[]).filter((item) => isGigworkerSource(facilityOf(item)?.registration_source));
    setStaffList(linked);
    setSelectedStaffId(linked[0]?.id ?? '');
    setWorkerName(worker?.name ?? user.user_metadata?.profile_nickname ?? '');
    if (!worker?.id || linked.length === 0) { setLoading(false); return; }
    const staffIds = linked.map((item) => item.id);
    const [{ data: bankRow }, { data: shareRows }, { data: completedRows }, { data: payoutRows }] = await Promise.all([
      supabase.from('worker_bank_accounts').select('id,bank_name,account_number_last4')
        .eq('worker_id', worker.id).eq('is_primary', true).is('deleted_at', null).maybeSingle(),
      supabase.from('gig_bank_account_shares').select('staff_id,bank_account_id,shared_at').in('staff_id', staffIds),
      supabase.from('staff_attendances').select('staff_id').in('staff_id', staffIds).eq('status', 'completed'),
      supabase.from('gig_payouts').select('id,staff_id,period_start,period_end,worked_days,amount,withholding_amount,net_amount,status,pay_at')
        .in('staff_id', staffIds).neq('status', 'cancelled').order('created_at', { ascending: false }),
    ]);
    setBank((bankRow as Bank | null) ?? null);
    setShares((shareRows ?? []) as Share[]);
    setCompletedStaffIds(new Set((completedRows ?? []).map((row) => row.staff_id as string)));
    setPayouts((payoutRows ?? []) as Payout[]);
    setBankOpen(!bankRow);
    setLoading(false);
  })(); }, []);

  const staff = staffList.find((item) => item.id === selectedStaffId) ?? staffList[0] ?? null;
  const facility = staff ? facilityOf(staff) : null;
  const hasCompletedWork = Boolean(staff && completedStaffIds.has(staff.id));
  const currentShare = staff && bank ? shares.find((item) => item.staff_id === staff.id && item.bank_account_id === bank.id) ?? null : null;
  const selectedPayouts = useMemo(() => payouts.filter((item) => item.staff_id === staff?.id), [payouts, staff?.id]);

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
      <p className="text-[11px] font-extrabold tracking-[0.14em] text-primary-light">ATTENDANCE & PAY</p>
      <h1 className="mt-2 text-[25px] font-extrabold">근태·정산</h1>
      <p className="mt-1 text-[12px] leading-5 text-white/65">근무 기록을 확인하고, 일이 끝난 뒤 지급 계좌를 관리자에게 직접 전달해요.</p>
    </header>

    {loading ? <div className="mt-3 rounded-2xl bg-white p-8 text-center text-[13px] text-sub">근태와 정산을 불러오고 있어요...</div>
      : !staff ? <section className="mt-3 rounded-2xl bg-white p-8 text-center"><b className="text-ink">연결된 긱 근무가 없어요</b><p className="mt-2 text-[13px] text-sub">관리자의 초대를 먼저 수락해 주세요.</p></section>
      : <>
        {staffList.length > 1 && <label className="mt-3 block rounded-2xl bg-white p-4 text-[12px] font-bold text-sub shadow-sm">근무지 선택<select value={selectedStaffId} onChange={(event) => setSelectedStaffId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-line bg-white px-3 text-ink">{staffList.map((item) => <option key={item.id} value={item.id}>{facilityOf(item)?.name ?? '근무지'} · {item.name}</option>)}</select></label>}

        <section className="mt-3 rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-[11px] font-extrabold text-primary">지급 계좌</p><h2 className="mt-1 text-[18px] font-extrabold text-ink">{bank?.bank_name && bank.account_number_last4 ? `${bank.bank_name} · ****${bank.account_number_last4}` : '계좌를 먼저 등록해 주세요'}</h2></div>
            {bank && <button type="button" onClick={() => setBankOpen((open) => !open)} className="shrink-0 rounded-lg bg-bg px-3 py-2 text-[11px] font-extrabold text-sub">{bankOpen ? '닫기' : '변경'}</button>}
          </div>
          <p className="mt-2 rounded-xl bg-primary/5 px-3 py-2 text-[11px] leading-5 text-sub"><b className="text-primary">등록과 전달은 달라요.</b> 지금 입력해도 관리자에게 보이지 않아요. 근무 완료 후 아래 전달 버튼을 눌러야 이 근무지에만 전체 계좌가 활성화돼요.</p>

          {bankOpen && <div className="mt-3 rounded-xl bg-bg p-3"><BankAccount compact onNext={(value) => void saveBank(value)} submitting={bankSaving} submitError={bankError} /></div>}

          {bank && !bankOpen && (currentShare
            ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p className="text-[13px] font-extrabold text-emerald-700">{facility?.name} 관리자에게 전달됨 ✓</p><p className="mt-1 text-[11px] leading-4 text-emerald-700/80">이 근무지의 지급 권한이 있는 관리자만 계좌를 확인할 수 있어요.</p></div>
            : hasCompletedWork
              ? <button type="button" onClick={() => void shareBank()} disabled={sharing} className="mt-4 h-12 w-full rounded-xl bg-primary text-[14px] font-extrabold text-white disabled:opacity-60">{sharing ? '안전하게 전달 중...' : `${facility?.name} 관리자에게 계좌 전달`}</button>
              : <div className="mt-4 rounded-xl bg-bg p-3 text-center"><p className="text-[13px] font-bold text-sub">근무 완료 후 전달할 수 있어요</p><p className="mt-1 text-[11px] text-tertiary">그전에는 관리자 화면에 계좌가 표시되지 않아요.</p></div>)}
          {shareError && <p role="alert" className="mt-2 text-[12px] font-bold text-red-600">{shareError}</p>}
        </section>

        <section className="mt-3 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-[18px] font-extrabold text-ink">내 근태</h2>
          <p className="mt-1 text-[12px] text-sub">{facility?.name}에서 기록된 출퇴근만 보여요.</p>
          <div className="mt-3"><MyAttendanceCalendar staffId={staff.id} includeShiftAttendance={false} staffSourceLabel="긱 근무" /></div>
          <p className="mt-3 text-[11px] leading-5 text-sub">수정이 필요한 기록은 대화 탭에서 관리자에게 요청하세요.</p>
        </section>

        <section className="mt-3 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-[18px] font-extrabold text-ink">지급 현황</h2>
          {selectedPayouts.length === 0
            ? <p className="mt-3 text-[13px] leading-5 text-sub">아직 지급 기록이 없어요. 관리자가 지급을 기록하면 여기에 바로 남아요.</p>
            : <div className="mt-3 divide-y divide-line">{selectedPayouts.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3"><div><p className="text-[15px] font-extrabold text-ink">{won(item.net_amount ?? item.amount)}</p><p className="mt-0.5 text-[11px] text-sub">{item.period_start}{item.period_end !== item.period_start ? ` ~ ${item.period_end}` : ''} · {item.worked_days}일{item.withholding_amount ? ` · 공제 ${won(item.withholding_amount)}` : ''}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${item.status === 'paid' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-700'}`}>{item.status === 'paid' ? '지급 완료' : `${item.pay_at ?? ''} 지급 예정`}</span></div>)}</div>}
        </section>
      </>}
  </main>;
}
