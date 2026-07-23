import { redirect } from 'next/navigation';
import { Card } from '@/components/ui';
import { getShop } from '@/lib/db/shop';
import { getStaffWagePayments, getWagePayments } from '@/lib/db/payroll';
import { won, formatDate } from '@/lib/format';
import { updatePaymentStatus, updateStaffPaymentStatus } from './actions';
import { getAdminContext } from '@/lib/admin-auth';
import Link from 'next/link';

const STATUS: Record<string,string> = { draft:'검토 전',approved:'지급 승인',exported:'이체 준비',paid:'지급 완료',worker_confirmed:'입금 확인',disputed:'확인 요청',cancelled:'취소' };
const ENGAGEMENT:Record<string,string>={regular:'상시 직원',fixed_term:'기간제',temporary:'임시 계약',daily:'단기 근무'};
const PAY:Record<string,string>={monthly:'월급',hourly:'시급',daily:'일급'};

function moveMonth(month:string,delta:number){const date=new Date(`${month}-01T00:00:00Z`);date.setUTCMonth(date.getUTCMonth()+delta);return date.toISOString().slice(0,7);}

export default async function PayrollPage({searchParams}:{searchParams:Promise<{month?:string}>}) {
  const params=await searchParams;
  const currentMonth=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,7);
  const selectedMonth=/^\d{4}-\d{2}$/.test(params.month??'')?params.month!:currentMonth;
  const [shop, paymentResult, staffRows, context] = await Promise.all([getShop(), getWagePayments(), getStaffWagePayments(selectedMonth), getAdminContext()]);
  if (!shop) redirect('/setup/claim-facility');
  const { rows, error } = paymentResult;
  const canManage = context?.accessRole === 'owner' || context?.accessRole === 'super';
  const pending = rows.filter(r => ['draft','approved','exported','disputed'].includes(r.status)).reduce((s,r)=>s+r.netAmount,0)+staffRows.filter(r=>['draft','approved','exported'].includes(r.status)).reduce((sum,row)=>sum+row.netAmount,0);
  const completed = rows.filter(r => ['paid','worker_confirmed'].includes(r.status)).reduce((s,r)=>s+r.netAmount,0)+staffRows.filter(r=>r.status==='paid').reduce((sum,row)=>sum+row.netAmount,0);
  return <main className="px-4">
    <div className="mt-3 mb-5 px-1"><p className="text-label font-bold text-primary">병원 직접 지급</p><h1 className="text-display font-extrabold text-ink">급여 지급관리</h1><p className="text-label text-sub mt-2">근무 기록을 승인하고 병원 계좌에서 워커에게 직접 지급하세요. 잇닿은 임금을 보관하지 않습니다.</p><a href="/api/payroll/export" className="inline-flex mt-3 h-10 px-4 items-center rounded-xl border border-primary/30 bg-white text-primary text-label font-bold">지급 검토 CSV 내려받기</a></div>
    <div className="grid grid-cols-2 gap-3 mb-5"><Card><p className="text-label text-sub">지급 예정</p><p className="text-title font-extrabold mt-1">{won(pending)}</p></Card><Card><p className="text-label text-sub">지급 완료</p><p className="text-title font-extrabold text-primary mt-1">{won(completed)}</p></Card></div>
    <Card className="bg-blue-50 border border-blue-100 mb-5"><p className="text-body font-bold text-ink">지급 흐름</p><p className="text-label text-sub mt-2 leading-5">근무 완료 → 금액 검토 → 지급 승인 → 이체 준비 → 병원 지급 완료 → 워커 입금 확인</p><p className="text-[13px] text-sub mt-2">3.3% 공제는 자동 적용하지 않습니다. 고용·세무 분류를 확인한 뒤 병원이 결정하세요.</p></Card>
    {!canManage&&<Card className="bg-amber-50 border border-amber-200 mb-4"><p className="text-body font-bold text-ink">조회 전용 권한</p><p className="text-label text-sub mt-1">지급 승인과 완료 처리는 병원 소유자 또는 급여 승인 담당자에게 요청해 주세요.</p></Card>}
    <div className="mb-3 mt-6 flex items-end justify-between px-1"><div><p className="text-[12px] font-bold text-primary">병원 등록 인력</p><h2 className="text-title font-extrabold">직원 급여</h2></div><div className="flex items-center gap-1 rounded-xl bg-white p-1 shadow-sm"><Link href={`/payroll?month=${moveMonth(selectedMonth,-1)}`} className="flex h-8 w-8 items-center justify-center rounded-lg text-lg" aria-label="이전 달">‹</Link><span className="min-w-16 text-center text-[12px] font-bold">{Number(selectedMonth.slice(5,7))}월</span><Link href={`/payroll?month=${moveMonth(selectedMonth,1)}`} className="flex h-8 w-8 items-center justify-center rounded-lg text-lg" aria-label="다음 달">›</Link></div></div>
    {staffRows.length===0?<Card className="py-8 text-center"><p className="font-bold">등록된 직원이 없어요</p><a href="/staff" className="mt-2 inline-block text-label font-bold text-primary">직원 등록하기 →</a></Card>:<div className="space-y-3">{staffRows.map(row=><Card key={row.staffId}>
      <div className="flex justify-between gap-3"><div><div className="flex items-center gap-2"><p className="text-body font-extrabold">{row.workerName}</p><span className="rounded bg-primary/5 px-1.5 py-0.5 text-[10px] font-bold text-primary">{ENGAGEMENT[row.engagementType]??'등록 직원'}</span></div><p className="mt-1 text-label text-sub">{row.payBasis?`${PAY[row.payBasis]} ${row.payRate?.toLocaleString('ko-KR')}원`:'급여 기준 미설정'}</p></div><span className="h-fit rounded-full bg-bg px-2.5 py-1 text-[12px] font-bold">{row.status==='config_required'?'설정 필요':STATUS[row.status]??row.status}</span></div>
      {row.status==='config_required'?<a href="/staff" className="mt-4 flex h-11 items-center justify-center rounded-xl bg-amber-50 text-label font-bold text-amber-700">직원관리에서 급여 기준 설정</a>:<>
        <div className="mt-4 rounded-xl bg-bg p-3 text-label"><div className="flex justify-between"><span className="text-sub">완료 근태</span><b>{row.workedDays}일 · {Math.floor(row.workedMinutes/60)}시간 {row.workedMinutes%60}분</b></div><div className="mt-2 flex justify-between border-t border-line pt-2"><span>세전 예상액</span><b className="text-primary">{won(row.grossAmount)}</b></div></div>
        {canManage&&row.status==='draft'&&<form action={updateStaffPaymentStatus} className="mt-3"><input type="hidden" name="staff_id" value={row.staffId}/><input type="hidden" name="period_month" value={row.periodMonth}/><button name="action" value="approve" className="h-11 w-full rounded-xl bg-primary text-label font-extrabold text-white">근태·금액 검토 후 지급 승인</button></form>}
        {canManage&&row.status==='approved'&&<form action={updateStaffPaymentStatus} className="mt-3"><input type="hidden" name="staff_id" value={row.staffId}/><input type="hidden" name="period_month" value={row.periodMonth}/><button name="action" value="mark_exported" className="h-11 w-full rounded-xl bg-ink text-label font-extrabold text-white">이체 준비 완료 표시</button></form>}
        {canManage&&row.status==='exported'&&<form action={updateStaffPaymentStatus} className="mt-3"><input type="hidden" name="staff_id" value={row.staffId}/><input type="hidden" name="period_month" value={row.periodMonth}/><button name="action" value="mark_paid" className="h-11 w-full rounded-xl bg-success text-label font-extrabold text-white">병원 지급 완료 표시</button></form>}
      </>}
    </Card>)}</div>}
    <div className="mb-3 mt-7 px-1"><p className="text-[12px] font-bold text-primary">공고 시급 자동 연동</p><h2 className="text-title font-extrabold">공고 지원 인력 지급</h2></div>
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
