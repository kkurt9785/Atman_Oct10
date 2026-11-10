'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { isGigLink } from '@/lib/worker-mode';
import { estimateStaffPay, payBasisLine, payMonthKST, workedTimeLabel, type StaffPayAttendance, type StaffPayEstimate as Estimate } from '@/lib/staff-pay-estimate';

// 직원(월급·시급·일급)의 이번 달 예상 급여 카드 — 급여 화면(/earnings) 맨 위.
// 예전 급여 화면은 공고 근무 지급 건(wage_payment_instructions)만 읽어서, 한 달 내내 일한 직원에게 '지급 예정 0원'이 보였다(2026-11-10 치과 QA P1-11).
// 읽는 것은 내 facility_staff 행(급여 기준·금액)과 내 staff_attendances 뿐이다 — 둘 다 근무자 본인 읽기 RLS 가 이미 있어 새 DB 함수가 필요 없다.
// 사업장이 저장한 급여 확정본(staff_wage_payments)은 근무자가 읽을 수 없으므로, 여기 금액은 끝까지 '예상'이라고 적는다.
type FacilityRef = { name: string };
type StaffRow = {
  id: string; worker_kind?: string | null; pay_basis: string | null; pay_rate: number | string | null;
  contract_start: string | null; contract_end: string | null; facilities: FacilityRef | FacilityRef[] | null;
};
type Card = { staffId: string; facility: string; estimate: Estimate };
type State = { status: 'loading' } | { status: 'none' } | { status: 'error' } | { status: 'ready'; cards: Card[] };

const won = (value: number) => `₩${Math.round(value).toLocaleString('ko-KR')}`;

/** 직원 연결이 없으면 아무것도 그리지 않는다 — 공고 근무만 하는 사람의 급여 화면은 지금까지와 같다 */
export function StaffPayEstimate() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [retry, setRetry] = useState(0);
  const period = payMonthKST();
  useEffect(() => {
    let alive = true;
    void (async () => {
      setState({ status: 'loading' });
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { if (alive) setState({ status: 'none' }); return; }
        const { data: worker, error: workerError } = await supabase.from('workers').select('id').eq('auth_user_id', user.id).maybeSingle();
        if (workerError) throw workerError;
        if (!worker) { if (alive) setState({ status: 'none' }); return; }
        // RLS 가 본인 행만 주지만, 같은 계정이 사업장 관리자이기도 하면 다른 직원 행이 섞일 수 있어 worker_id 로 한 번 더 좁힌다
        const { data: staffRows, error: staffError } = await supabase.from('facility_staff')
          .select('id,worker_kind,pay_basis,pay_rate,contract_start,contract_end,facilities!facility_id(name)')
          .eq('worker_id', worker.id).neq('status', 'ended').order('created_at', { ascending: false });
        if (staffError) throw staffError;
        const linked = ((staffRows ?? []) as unknown as StaffRow[]).filter((row) => !isGigLink(row));
        if (!linked.length) { if (alive) setState({ status: 'none' }); return; }
        const { periodMonth, endDate } = payMonthKST();
        const { data: attendances, error: attendanceError } = await supabase.from('staff_attendances')
          .select('staff_id,work_date,status,check_in_at,check_out_at,break_minutes')
          .in('staff_id', linked.map((row) => row.id)).gte('work_date', periodMonth).lte('work_date', endDate);
        if (attendanceError) throw attendanceError;
        const byStaff = new Map<string, StaffPayAttendance[]>();
        for (const row of (attendances ?? []) as Array<StaffPayAttendance & { staff_id: string }>) byStaff.set(row.staff_id, [...(byStaff.get(row.staff_id) ?? []), row]);
        const cards = linked.map((row) => {
          const facility = Array.isArray(row.facilities) ? row.facilities[0] : row.facilities;
          return { staffId: row.id, facility: facility?.name ?? '내 사업장', estimate: estimateStaffPay(row, byStaff.get(row.id) ?? [], periodMonth, endDate) };
        });
        if (alive) setState({ status: 'ready', cards });
      } catch {
        if (alive) setState({ status: 'error' });
      }
    })();
    return () => { alive = false; };
  }, [retry]);

  if (state.status === 'none') return null;
  if (state.status === 'loading') return <section className="mx-5 mt-5 rounded-2xl bg-white p-5 text-[13px] text-sub shadow-card" role="status">이번 달 예상 급여를 계산하고 있어요…</section>;
  // 못 읽었을 때 0원을 보여 주지 않는다 — 금액을 모르는 것과 0원은 다르다
  if (state.status === 'error') return <section role="alert" className="mx-5 mt-5 rounded-2xl bg-white p-5 shadow-card">
    <p className="text-[15px] font-extrabold text-ink">이번 달 예상 급여를 불러오지 못했어요</p>
    <p className="mt-1 text-[12px] leading-5 text-sub">잠시 후 다시 확인해 주세요. 급여 금액은 사업장에 물어봐도 돼요.</p>
    <button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-2 min-h-11 text-[13px] font-bold text-primary">다시 불러오기</button>
  </section>;

  return <>{state.cards.map(({ staffId, facility, estimate }) => (
    <section key={staffId} aria-label={`${facility} 이번 달 예상 급여`} className="mx-5 mt-5 rounded-2xl bg-white p-5 shadow-card">
      <p className="text-[12px] font-bold text-primary">{facility} · 직원 급여</p>
      <h2 className="mt-1 text-[16px] font-extrabold text-ink">{period.label} 예상 급여 <span className="text-[13px] font-bold text-sub">(세전)</span></h2>
      {estimate.status === 'ready' ? <>
        <p className="mt-2 text-[28px] font-extrabold tracking-[-0.5px] text-ink">{won(estimate.amount)}</p>
        <p className="mt-1 text-[13px] leading-5 text-sub">{payBasisLine(estimate)}</p>
        {estimate.basis === 'monthly'
          ? <p className="mt-1 text-[12px] leading-5 text-sub">이번 달 확정 근무 {estimate.days}일 · {workedTimeLabel(estimate.minutes)}</p>
          : <p className="mt-1 text-[12px] leading-5 text-sub">오늘까지 확정된 근태로 계산했어요. 근무가 쌓이면 금액이 늘어요.</p>}
        {estimate.needsProration && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800">이번 달 중간에 계약이 시작되거나 끝나요. 사업장이 일한 기간에 맞춰 다시 계산할 수 있어요.</p>}
      </> : <>
        <p className="mt-2 text-[15px] font-extrabold text-ink">급여 기준이 아직 등록되지 않았어요</p>
        <p className="mt-1 text-[12px] leading-5 text-sub">사업장이 월급·시급을 등록하면 여기에 예상 금액이 보여요. 이번 달 확정 근무는 {estimate.days}일 · {workedTimeLabel(estimate.minutes)}이에요.</p>
      </>}
      {estimate.pendingCount > 0 && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800">퇴근까지 눌렀지만 아직 확정되지 않은 기록 {estimate.pendingCount}건은 빠져 있어요. 사업장이 확인하면 반영돼요.</p>}
      <p className="mt-3 border-t border-line pt-3 text-[12px] leading-5 text-sub">세금·4대 보험을 떼기 전 예상 금액이에요. 실제 받는 금액은 사업장이 월 마감 뒤에 확정해요.</p>
      <Link href={`/workplace?staffId=${staffId}`} className="mt-1 flex min-h-11 items-center text-[13px] font-bold text-primary">근태 내역 확인하기 →</Link>
    </section>
  ))}</>;
}
