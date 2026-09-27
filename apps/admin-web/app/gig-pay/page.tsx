import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getShop } from '@/lib/db/shop';
import { getAdminContext } from '@/lib/admin-auth';
import { getGigPayoutBoard } from '@/lib/db/gig-payouts';
import { WorkforceActionForm } from '@/components/WorkforceActionForm';
import { ManageBackLink } from '@/components/ManageBackLink';
import { CreatePayoutForm, PayoutRowActions, WithholdingCalculator } from './PayoutForm';

const PAY: Record<string, string> = { hourly: '시급', daily: '일급', monthly: '월급' };
const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;
const hours = (minutes: number) => `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ''}`;

// 긱워커 지급. 근무자별로 마지막 지급 이후 완료된 근무를 한 건으로 묶어 '지금 지급' 또는 '나중에(날짜) 지급'으로 기록한다.
// 병원·약국의 월 급여(/payroll)와 달리 하루·일주일 단위로 자유롭게 끊는다. 실제 송금은 관리자가 하고 앱은 기록·알림만 맡는다.
export default async function GigPayPage() {
  const [shop, context, board] = await Promise.all([getShop(), getAdminContext(), getGigPayoutBoard()]);
  if (!shop) redirect('/setup/claim-facility');
  const canManage = context?.accessRole === 'owner' || context?.accessRole === 'super' || context?.accessRole === 'operator';
  const unpaidTotal = board.reduce((sum, row) => sum + row.unpaidAmount, 0);
  const scheduled = board.flatMap((row) => row.payouts.filter((p) => p.status === 'scheduled').map((p) => ({ ...p, name: row.name })));
  const paid = board.flatMap((row) => row.payouts.filter((p) => p.status === 'paid').map((p) => ({ ...p, name: row.name }))).sort((a, b) => (b.paidAt ?? '').localeCompare(a.paidAt ?? '')).slice(0, 10);

  return <main className="px-4 pb-28">
    <ManageBackLink href="/" label="홈" />
    <div className="mt-3 mb-4 px-1"><p className="text-label font-bold text-primary">근무 끝나면 바로, 또는 날짜를 정해서</p><h1 className="text-display font-extrabold text-ink">지급 관리</h1><p className="mt-1 text-label leading-5 text-sub">완료된 출퇴근 기록으로 금액을 계산해요. 송금은 사장님이 하고, 여기서 기록하면 근무자 앱에 바로 알림이 가요.</p></div>

    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-2xl bg-ink p-4 text-white"><p className="text-[11px] text-white/60">지급할 금액</p><p className="mt-1 text-[22px] font-extrabold">{won(unpaidTotal)}</p></div>
      <div className="rounded-2xl bg-white p-4 shadow-card"><p className="text-[11px] text-sub">지급 예정</p><p className="mt-1 text-[22px] font-extrabold text-ink">{scheduled.length}건</p></div>
    </div>

    <h2 className="mt-6 px-1 text-[15px] font-extrabold text-ink">근무자별 지급</h2>
    {board.length === 0 && <div className="mt-3 rounded-2xl bg-white p-8 text-center text-label text-sub">등록된 근무자가 없어요. <Link href="/staff?view=contract&entry=gigworker" className="font-bold text-primary">긱워커 등록 →</Link></div>}
    <div className="mt-3 space-y-3">
      {board.map((row) => (
        <section key={row.staffId} className="rounded-2xl bg-white p-4 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-[16px] font-extrabold text-ink">{row.name}</p><p className="mt-0.5 text-[12px] text-sub">{row.payBasis && row.payRate ? `${PAY[row.payBasis]} ${won(row.payRate)}` : '급여 기준 미설정'} · {row.bankName && row.accountLast4 ? `${row.bankName} ****${row.accountLast4}` : row.workerLinked ? '계좌 미등록 (근무자 앱에서 등록)' : '앱 미연결'}</p></div>
            <span className="shrink-0 text-[18px] font-extrabold text-primary">{won(row.unpaidAmount)}</span>
          </div>
          <p className="mt-2 rounded-xl bg-bg px-3 py-2 text-[12px] text-sub">{row.unpaidDays > 0 ? `${row.unpaidSince} ~ ${row.unpaidUntil} · ${row.unpaidDays}일 · ${hours(row.unpaidMinutes)}` : '마지막 지급 이후 완료된 근무가 없어요'}</p>
          {!row.payBasis || !row.payRate ? (
            <WorkforceActionForm kind="set_staff_pay" values={{ staff_id: row.staffId }} className="mt-3 grid grid-cols-3 gap-2" successMessage="급여 기준을 저장했어요.">
              <select name="pay_basis" defaultValue="hourly" className="h-10 rounded-xl border border-line bg-white px-2 text-[12px]"><option value="hourly">시급</option><option value="daily">일급</option></select>
              <input name="pay_rate" type="number" min="1" step="100" required placeholder="금액" className="h-10 rounded-xl border border-line bg-white px-2 text-[12px]" />
              <button className="h-10 rounded-xl bg-ink text-[12px] font-extrabold text-white">저장</button>
            </WorkforceActionForm>
          ) : canManage ? (
            <CreatePayoutForm staffId={row.staffId} amount={row.unpaidAmount} disabled={row.unpaidDays === 0} />
          ) : null}
        </section>
      ))}
    </div>

    {scheduled.length > 0 && <>
      <h2 className="mt-6 px-1 text-[15px] font-extrabold text-ink">지급 예정</h2>
      <div className="mt-3 divide-y divide-line rounded-2xl bg-white shadow-card">
        {scheduled.map((p) => <div key={p.id} className="flex items-center justify-between gap-2 px-4 py-3"><div><p className="text-[13px] font-bold text-ink">{p.name} · 실지급 {won(p.netAmount)}</p><p className="text-[11px] text-sub">세전 {won(p.amount)}{p.withholdingAmount ? ` · 3.3% −${won(p.withholdingAmount)}` : ''} · {p.periodStart} ~ {p.periodEnd} · {p.workedDays}일 · 예정일 {p.payAt}{p.note ? ` · ${p.note}` : ''}</p></div>{canManage && <PayoutRowActions payoutId={p.id} />}</div>)}
      </div>
    </>}

    {paid.length > 0 && <>
      <h2 className="mt-6 px-1 text-[15px] font-extrabold text-ink">지급 완료</h2>
      <div className="mt-3 divide-y divide-line rounded-2xl bg-white shadow-card">
        {paid.map((p) => <div key={p.id} className="flex items-center justify-between gap-2 px-4 py-3"><div><p className="text-[13px] font-bold text-ink">{p.name} · 실지급 {won(p.netAmount)}</p><p className="text-[11px] text-sub">세전 {won(p.amount)}{p.withholdingAmount ? ` · 3.3% −${won(p.withholdingAmount)}` : ''} · {p.periodStart} ~ {p.periodEnd} · {p.workedDays}일 · {hours(p.workedMinutes)}</p></div><span className="text-[11px] font-bold text-emerald-600">{p.payAt} 지급</span></div>)}
      </div>
    </>}
    <WithholdingCalculator />
    <p className="mt-4 px-1 text-[11px] leading-5 text-sub">근무자별 금액은 완료된 출퇴근 기록과 급여 기준으로 계산한 세전 금액이고, 3.3%를 켜면 공제 후 실지급액으로 기록돼요. 세금·보험 처리는 사업장 기준에 따릅니다.</p>
  </main>;
}
