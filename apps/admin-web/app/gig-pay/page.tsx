import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getShop } from '@/lib/db/shop';
import { getAdminContext } from '@/lib/admin-auth';
import { getGigPayoutBoard } from '@/lib/db/gig-payouts';
import { WorkforceActionForm } from '@/components/WorkforceActionForm';
import { ManageBackLink } from '@/components/ManageBackLink';
import { CreatePayoutForm, PayoutRowActions, WithholdingCalculator } from './PayoutForm';
import { minimumHourlyWage, weeklyHolidayPay, WEEKLY_HOLIDAY_MIN_MINUTES } from '@/lib/pay';
import { PayoutDetail } from './PayoutDetail';
import type { PayoutStatement } from '@/lib/pay-statement';

const PAY: Record<string, string> = { hourly: '시급', daily: '일급', monthly: '월급' };
const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;
const hours = (minutes: number) => `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ''}`;

// 긱워커 지급. 근무자별로 마지막 지급 이후 완료된 근무를 한 건으로 묶어 '지금 지급' 또는 '나중에(날짜) 지급'으로 기록한다.
// 병원·약국의 월 급여(/payroll)와 달리 하루·일주일 단위로 자유롭게 끊는다. 실제 송금은 관리자가 하고 앱은 기록·알림만 맡는다.
export default async function GigPayPage({ searchParams }: { searchParams: Promise<{ staff?: string; q?: string; page?: string }> }) {
  const currentMinimum = minimumHourlyWage();
  const shop = await getShop();
  if (!shop) redirect('/setup/claim-facility');
  // 긱 사업장이든 병원이든, 긱 근무자가 있으면 쓴다 (getGigPayoutBoard 가 worker_kind='gig' 만 모은다)
  const context = await getAdminContext();
  const canManage = context?.accessRole === 'owner' || context?.accessRole === 'super' || context?.accessRole === 'operator';
  if (!context || !canManage || !context.canViewPayroll) redirect('/');
  const params = await searchParams;
  const allWorkers = await getGigPayoutBoard(context.accessToken);
  const query = (typeof params.q === 'string' ? params.q : '').trim().slice(0, 100);
  const board = allWorkers.filter(row => (!params.staff || row.staffId === params.staff) && (!query || row.name.includes(query)));
  const requestedPage = /^\d{1,6}$/.test(params.page ?? '') ? Number(params.page) : 1;
  const unpaidTotal = board.reduce((sum, row) => sum + row.unpaidAmount, 0);
  // 지급 한 건을 '왜 이 금액인지'까지 보여 주고 공유하는 명세 — 근무자 앱과 같은 문장
  const toStatement = (p: { name: string; periodStart: string; periodEnd: string; workedDays: number; workedMinutes: number; payBasis: string; payRate: number; amount: number; withholdingAmount: number; netAmount: number; status: 'scheduled' | 'paid' | 'cancelled'; payAt: string | null; paidAt: string | null }): PayoutStatement => ({
    facilityName: shop.name, workerName: p.name, periodStart: p.periodStart, periodEnd: p.periodEnd, workedDays: p.workedDays, workedMinutes: p.workedMinutes,
    payBasis: p.payBasis, payRate: p.payRate, amount: p.amount, withholdingAmount: p.withholdingAmount, netAmount: p.netAmount, status: p.status, payAt: p.payAt, paidAt: p.paidAt,
  });
  const scheduled = board.flatMap((row) => row.payouts.filter((p) => p.status === 'scheduled').map((p) => ({ ...p, name: row.name })));
  const allPaid = board.flatMap((row) => row.payouts.filter((p) => p.status === 'paid').map((p) => ({ ...p, name: row.name }))).sort((a, b) => (b.paidAt ?? '').localeCompare(a.paidAt ?? ''));
  const pageCount = Math.max(1, Math.ceil(allPaid.length / 10));
  const page = Math.max(1, Math.min(requestedPage, pageCount));
  const paid = allPaid.slice((page - 1) * 10, page * 10);
  const pageHref = (next: number) => '/gig-pay?' + new URLSearchParams({ ...(params.staff ? { staff: params.staff } : {}), ...(query ? { q: query } : {}), page: String(next) }).toString();

  return <main className="px-4 pb-28">
    <ManageBackLink href={shop.mode === 'gig' ? '/' : '/staff?view=contract'} label={shop.mode === 'gig' ? '홈' : '직원 관리'} />
    <div className="mt-3 mb-4 px-1"><p className="text-label font-bold text-primary">근무 끝나면 바로, 또는 날짜를 정해서</p><h1 className="text-display font-extrabold text-ink">지급 관리</h1><p className="mt-1 text-label leading-5 text-sub">완료된 출퇴근 기록으로 금액을 계산해요. 송금은 사장님이 직접 하고, 여기서 기록하면 근무자 앱에서 지급 내역을 확인할 수 있어요.</p></div>

    <form action="/gig-pay" className="mb-4 flex flex-wrap gap-2">
      <label className="w-full text-sm font-bold text-sub">{shop.name} · 근무자 검색
        <input name="q" defaultValue={query} placeholder="이름 검색" maxLength={100} className="mt-1 h-11 w-full rounded-xl border border-line px-3 text-base" />
      </label>
      <button className="h-11 rounded-xl bg-ink px-4 text-sm font-bold text-white">검색</button>
      {(query || params.staff) && <Link href="/gig-pay" className="inline-flex h-11 items-center px-4 text-sm font-bold text-primary">전체 근무자 보기</Link>}
      {params.staff && <p role="status" className="w-full text-sm text-sub">선택한 근무자: {board[0]?.name ?? '현재 현장에서 찾을 수 없어요'}</p>}
    </form>
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-2xl bg-ink p-4 text-white"><p className="text-[0.6875rem] text-white/60">지급할 금액</p><p className="mt-1 text-[1.375rem] font-extrabold">{won(unpaidTotal)}</p></div>
      <div className="rounded-2xl bg-white p-4 shadow-card"><p className="text-[0.6875rem] text-sub">지급 예정</p><p className="mt-1 text-[1.375rem] font-extrabold text-ink">{scheduled.length}건</p></div>
    </div>

    <p className="mt-3 rounded-xl bg-amber-50 p-3 text-[0.75rem] leading-5 text-amber-800">지급액은 출퇴근 기록에 저장된 휴게시간만 차감해요. 약정한 기본 휴게는 자동 차감하지 않아요. 지급 전 실제 휴게를 확인하고, 다르면 <Link href="/attendance-history" className="font-bold underline">근태 기록에서 수정</Link>해 주세요.</p>
    <h2 className="mt-6 px-1 text-[0.9375rem] font-extrabold text-ink">근무자별 지급</h2>
    {board.length === 0 && <div className="mt-3 rounded-2xl bg-white p-8 text-center text-label text-sub">{allWorkers.length ? '검색 조건에 맞는 근무자가 없어요. ' : '등록된 근무자가 없어요. '}<Link href="/staff?view=contract&entry=gigworker" className="font-bold text-primary">긱워커 등록 →</Link></div>}
    <div className="mt-3 space-y-3">
      {board.map((row) => (
        <section key={row.staffId} className="rounded-2xl bg-white p-4 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div><div className="flex items-center gap-2"><p className="text-[1rem] font-extrabold text-ink">{row.name}</p>{row.status==='ended'&&<span className="rounded-full bg-bg px-2 py-0.5 text-[0.6875rem] font-bold text-sub">근무 종료</span>}</div><p className="mt-0.5 text-[0.75rem] text-sub">{row.payBasis && row.payRate ? `${PAY[row.payBasis]} ${won(row.payRate)}` : '급여 기준 미설정'} · {!row.workerLinked ? '앱 미연결' : row.accountNumber ? '지급 계좌 전달 완료' : '근무자 계좌 전달 대기'}</p></div>
            <span className="shrink-0 text-[1.125rem] font-extrabold text-primary">{won(row.unpaidAmount)}</span>
          </div>
          <p className="mt-2 rounded-xl bg-bg px-3 py-2 text-[0.75rem] text-sub">{row.unpaidDays > 0 ? `${row.unpaidSince} ~ ${row.unpaidUntil} · ${row.unpaidDays}일 · ${hours(row.unpaidMinutes)}${row.unpaidBreakMinutes > 0 ? ` · 휴게 ${row.unpaidBreakMinutes}분 차감` : ''}` : '마지막 지급 이후 완료된 근무가 없어요'}</p>
          {row.openToday && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[0.75rem] font-bold text-amber-700">오늘 근무 중이에요 · 퇴근한 뒤에 지급하면 오늘 근무까지 한 번에 들어가요</p>}
          {row.payBasis === 'hourly' && row.payRate && row.weekMinutes >= WEEKLY_HOLIDAY_MIN_MINUTES && <p className="mt-2 rounded-xl bg-primary/5 px-3 py-2 text-[0.75rem] leading-5 text-sub">이번 주 기록 {hours(row.weekMinutes)} 기준 주휴 참고액 <b className="text-ink">약 {won(weeklyHolidayPay(row.weekMinutes, row.payRate))}</b>. 계약한 시간·개근 여부에 따라 실제 대상과 금액이 달라요. 확인 후 별도로 지급하고 기록해 주세요.</p>}
          {row.accountNumber && <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2"><p className="text-[0.6875rem] font-extrabold tracking-[0.08em] text-emerald-700">근무자가 전달한 지급 계좌</p><p className="mt-1 select-all text-[0.875rem] font-extrabold text-ink">{row.bankName} {row.accountNumber}</p><p className="mt-0.5 text-[0.6875rem] text-sub">예금주 {row.accountHolderName}</p></div>}
          {row.workerLinked && row.unpaidDays > 0 && !row.accountNumber && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[0.75rem] font-bold text-amber-700">근무자가 초대를 수락하면 계좌가 전달돼요. 아직이면 근무자에게 근태·지급 탭에서 전달을 부탁하세요.</p>}
          {!row.payBasis || !row.payRate ? (
            <WorkforceActionForm kind="set_staff_pay" values={{ staff_id: row.staffId }} className="mt-3 grid grid-cols-3 gap-2" successMessage="급여 기준을 저장했어요.">
              <select name="pay_basis" defaultValue="hourly" className="h-10 rounded-xl border border-line bg-white px-2 text-[0.75rem]"><option value="hourly">시급</option><option value="daily">일급</option></select>
              <input name="pay_rate" type="number" min={currentMinimum ?? 1} step="1" required placeholder={currentMinimum ? `시급 ${currentMinimum.toLocaleString('ko-KR')}원 이상` : '최저시급 기준 확인 필요'} className="h-10 rounded-xl border border-line bg-white px-2 text-[0.75rem]" />
              <button className="h-10 rounded-xl bg-ink text-[0.75rem] font-extrabold text-white">저장</button>
            </WorkforceActionForm>
          ) : canManage && row.unpaidDays > 0 ? (
            // 지급할 근무가 없으면 0원짜리 폼을 보여 주지 않는다 — 위 '완료된 근무가 없어요' 한 줄이면 충분하다
            <CreatePayoutForm staffId={row.staffId} amount={row.unpaidAmount} disabled={!row.accountNumber || row.payBasis === 'monthly' || row.unpaidAmount <= 0} disabledReason={row.payBasis === 'monthly' ? '월급은 근무 건별 자동 지급 대상이 아니에요. 월 급여를 별도로 검토해 주세요.' : !row.accountNumber ? '지급 계좌 전달 대기 중' : row.unpaidAmount <= 0 ? '지급액이 0원이에요. 출퇴근·휴게 기록을 확인해 주세요.' : undefined} />
          ) : null}
        </section>
      ))}
    </div>

    {scheduled.length > 0 && <>
      <h2 className="mt-6 px-1 text-[0.9375rem] font-extrabold text-ink">지급 예정</h2>
      <div className="mt-3 divide-y divide-line rounded-2xl bg-white shadow-card">
        {scheduled.map((p) => <div key={p.id} className="px-4"><p className="pt-3 text-[0.75rem] font-bold text-ink">{p.name}{p.note ? <span className="font-medium text-sub"> · {p.note}</span> : null}</p><PayoutDetail statement={toStatement(p)} right={canManage ? <PayoutRowActions payoutId={p.id} /> : undefined} /></div>)}
      </div>
    </>}

    {paid.length > 0 && <>
      <h2 className="mt-6 px-1 text-[0.9375rem] font-extrabold text-ink">지급 완료 · {allPaid.length}건</h2>
      <div className="mt-3 divide-y divide-line rounded-2xl bg-white shadow-card">
        {paid.map((p) => <div key={p.id} className="px-4"><p className="pt-3 text-[0.75rem] font-bold text-ink">{p.name}</p><PayoutDetail statement={toStatement(p)} right={p.workerConfirmStatus === 'received'
          ? <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[0.6875rem] font-extrabold text-emerald-700">입금 확인 ✓</span>
          : p.workerConfirmStatus === 'missing'
            ? <span className="shrink-0 rounded-full bg-red-50 px-2 py-1 text-[0.6875rem] font-extrabold text-red-600">⚠ 아직 못 받았대요</span>
            : <span className="shrink-0 text-[0.6875rem] font-bold text-emerald-600">{p.payAt} 지급 · 확인 대기</span>} /></div>)}
      </div>
    </>}
    {pageCount > 1 && <nav aria-label="지급 완료 내역 페이지" className="mt-3 flex items-center justify-between gap-3 text-sm">
      {page > 1 ? <Link className="inline-flex min-h-11 items-center px-3 font-bold text-primary" href={pageHref(page - 1)}>이전</Link> : <span />}
      <span>{page} / {pageCount}</span>
      {page < pageCount ? <Link className="inline-flex min-h-11 items-center px-3 font-bold text-primary" href={pageHref(page + 1)}>다음</Link> : <span />}
    </nav>}
    <WithholdingCalculator />
    <p className="mt-4 px-1 text-[0.6875rem] leading-5 text-sub">근무자별 금액은 완료된 출퇴근 기록과 급여 기준(휴게 차감)으로 계산한 세전 금액이에요. 출퇴근을 정해 주고 시급을 주는 단기 알바는 보통 근로자(일용근로소득)라 하루 15만 원까지는 떼는 세금이 없어요. 3.3%(사업소득)는 프리랜서 계약일 때만 켜 주세요. 신고·보험은 세무사와 확인해 주세요.</p>
  </main>;
}
