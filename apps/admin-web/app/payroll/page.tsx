import { redirect } from 'next/navigation';
import { Card } from '@/components/ui';
import { getShop } from '@/lib/db/shop';
import { getWagePayments } from '@/lib/db/payroll';
import { won, formatDate } from '@/lib/format';
import { updatePaymentStatus } from './actions';
import { getAdminContext } from '@/lib/admin-auth';

const STATUS: Record<string,string> = { draft:'검토 전',approved:'지급 승인',exported:'이체 준비',paid:'지급 완료',worker_confirmed:'입금 확인',disputed:'확인 요청',cancelled:'취소' };

export default async function PayrollPage() {
  const [shop, paymentResult, context] = await Promise.all([getShop(), getWagePayments(), getAdminContext()]);
  if (!shop) redirect('/setup/claim-facility');
  const { rows, error } = paymentResult;
  const canManage = context?.accessRole === 'owner' || context?.accessRole === 'super';
  const pending = rows.filter(r => ['draft','approved','exported','disputed'].includes(r.status)).reduce((s,r)=>s+r.netAmount,0);
  const completed = rows.filter(r => ['paid','worker_confirmed'].includes(r.status)).reduce((s,r)=>s+r.netAmount,0);
  return <main className="px-4">
    <div className="mt-3 mb-5 px-1"><p className="text-label font-bold text-primary">병원 직접 지급</p><h1 className="text-display font-extrabold text-ink">급여 지급관리</h1><p className="text-label text-sub mt-2">근무 기록을 승인하고 병원 계좌에서 워커에게 직접 지급하세요. 잇닿은 임금을 보관하지 않습니다.</p><a href="/api/payroll/export" className="inline-flex mt-3 h-10 px-4 items-center rounded-xl border border-primary/30 bg-white text-primary text-label font-bold">지급 검토 CSV 내려받기</a></div>
    <div className="grid grid-cols-2 gap-3 mb-5"><Card><p className="text-label text-sub">지급 예정</p><p className="text-title font-extrabold mt-1">{won(pending)}</p></Card><Card><p className="text-label text-sub">지급 완료</p><p className="text-title font-extrabold text-primary mt-1">{won(completed)}</p></Card></div>
    <Card className="bg-blue-50 border border-blue-100 mb-5"><p className="text-body font-bold text-ink">지급 흐름</p><p className="text-label text-sub mt-2 leading-5">근무 완료 → 금액 검토 → 지급 승인 → 이체 준비 → 병원 지급 완료 → 워커 입금 확인</p><p className="text-[13px] text-sub mt-2">3.3% 공제는 자동 적용하지 않습니다. 고용·세무 분류를 확인한 뒤 병원이 결정하세요.</p></Card>
    {!canManage&&<Card className="bg-amber-50 border border-amber-200 mb-4"><p className="text-body font-bold text-ink">조회 전용 권한</p><p className="text-label text-sub mt-1">지급 승인과 완료 처리는 병원 소유자 또는 급여 승인 담당자에게 요청해 주세요.</p></Card>}
    {error ? <Card className="py-8 text-center border border-red-200"><p role="alert" className="font-bold text-red-600">급여 정보를 불러오지 못했어요</p><p className="text-label text-sub mt-2">{error}</p><a href="/payroll" className="inline-flex mt-4 px-4 h-10 items-center rounded-xl bg-ink text-white text-label font-bold">다시 불러오기</a></Card>
    : rows.length===0 ? <Card className="py-10 text-center"><p className="font-bold">지급 요청이 없어요</p><p className="text-label text-sub mt-1">체크아웃 완료 후 자동으로 생성됩니다.</p></Card>
    : <div className="space-y-3">{rows.map(row => <Card key={row.id} className={row.status==='disputed'?'border border-red-200':''}>
      <div className="flex justify-between gap-3"><div><p className="text-body font-extrabold">{row.workerName}</p><p className="text-label text-sub mt-1">{formatDate(row.shiftDate)} 근무</p></div><span className="h-fit rounded-full bg-bg px-2.5 py-1 text-[13px] font-bold">{STATUS[row.status] ?? '처리 중'}</span></div>
      <div className="mt-4 rounded-xl bg-bg p-3 space-y-2 text-label"><div className="flex justify-between"><span className="text-sub">세전 예상액</span><b>{won(row.grossAmount)}</b></div><div className="flex justify-between"><span className="text-sub">공제 상태</span><b>{row.deductionStatus==='unconfirmed'?'미확정 · 병원 확인 필요':'병원 확인'}</b></div><div className="flex justify-between border-t border-line pt-2"><span>지급 예정액</span><b className="text-primary">{won(row.netAmount)}</b></div>{row.dueDate&&<div className="flex justify-between"><span className="text-sub">지급 예정일</span><b>{row.dueDate}</b></div>}</div>
      {row.disputeReason&&<p className="mt-3 rounded-lg bg-red-50 p-3 text-label text-red-600">워커 확인 요청: {row.disputeReason}</p>}
      {canManage&&row.status==='draft'&&<form action={updatePaymentStatus} className="mt-3"><input type="hidden" name="id" value={row.id}/><button name="action" value="approve" className="w-full h-11 rounded-xl bg-primary text-white text-label font-extrabold">금액 검토 후 지급 승인</button></form>}
      {canManage&&row.status==='approved'&&<form action={updatePaymentStatus} className="mt-3"><input type="hidden" name="id" value={row.id}/><button name="action" value="mark_exported" className="w-full h-11 rounded-xl bg-ink text-white text-label font-extrabold">이체 준비 완료 표시</button></form>}
      {canManage&&row.status==='exported'&&<form action={updatePaymentStatus} className="mt-3"><input type="hidden" name="id" value={row.id}/><button name="action" value="mark_paid" className="w-full h-11 rounded-xl bg-success text-white text-label font-extrabold">병원 지급 완료 표시</button></form>}
    </Card>)}</div>}
    <p className="text-[13px] text-sub px-1 mt-4 leading-5">CSV는 검토·회계 전달용이며 계좌번호는 끝 4자리만 포함합니다. 실제 계좌 이체는 병원이 직접 실행하고, 지급완료 표시는 실제 이체 확인 후 처리하세요. 모든 상태 변경은 감사로그에 기록됩니다.</p>
  </main>;
}
