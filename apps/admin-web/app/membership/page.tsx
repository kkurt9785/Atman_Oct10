import { won, formatDate } from '@/lib/format';
const SUB_STATUS: Record<string,string> = { pending:'개시 대기', active:'이용 중', past_due:'결제 지연' };
import { adminClient } from '@/lib/supabase';
import ServiceInvoicePayButton from './CreditChargePanel';
import { getAdminContext } from '@/lib/admin-auth';
import { redirect } from 'next/navigation';

type Plan={code:string;name:string;monthly_fee:number;included_facilities:number;included_admin_seats:number;included_active_workers:number;included_attendance_slots:number;included_job_posting_slots:number;features:Record<string,unknown>};

const UNLIMITED = 999999;
const cap = (n:number)=> n>=UNLIMITED ? '무제한' : `${n}`;
// 플랜별 핵심 혜택 4줄 (decoy 편성이 눈에 보이게)
const PLAN_PERKS:Record<string,string[]> = {
  free:['공고 월 5건','인력풀 반복초대 10명','관리자 1명','근태·급여지시·채팅'],
  basic:['공고 월 15건','인력풀 반복초대 20명','관리자 2명','반복초대 기능'],
  pro:['공고 무제한','인력풀 반복초대 60명','관리자 5명','자격검증·운영자동화·분석'],
  enterprise:['공고 무제한','인력풀 반복초대 무제한','관리자 15명 · 지점 3개','API·감사로그·전담지원'],
};
type Invoice={id:string;invoice_number:string;period_start:string;period_end:string;total_amount:number;status:string;due_date:string|null};

async function getBilling(facilityId:string) {
  const sb=adminClient();
  if(!sb) return {plans:[] as Plan[],invoices:[] as Invoice[],subscription:null as any,usage:[] as any[],error:'서버 연결 정보를 확인하지 못했어요.'};
  const [plans,subscription,invoices,usage]=await Promise.all([
    sb.from('service_plans').select('*').eq('is_active',true).order('sort_order'),
    sb.from('facility_subscriptions').select('status,current_period_end,plan_code,service_plans(name,monthly_fee)').eq('facility_id',facilityId).in('status',['pending','active','past_due']).maybeSingle(),
    sb.from('service_invoices').select('id,invoice_number,period_start,period_end,total_amount,status,due_date').eq('facility_id',facilityId).order('created_at',{ascending:false}).limit(12),
    sb.from('service_usage_events').select('usage_type,quantity').eq('facility_id',facilityId).gte('occurred_at',new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString()),
  ]);
  const failed = [plans, subscription, invoices, usage].find((result) => result.error);
  if (failed?.error) {
    return {plans:[] as Plan[],invoices:[] as Invoice[],subscription:null as any,usage:[] as any[],error:'요금제와 청구 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'};
  }
  return {plans:(plans.data??[]) as Plan[],subscription:subscription.data,invoices:(invoices.data??[]) as Invoice[],usage:usage.data??[],error:null};
}

const USAGE:Record<string,string>={active_worker:'인력풀 반복초대',attendance_slot:'근태관리',job_posting_slot:'공고 게시',license_verification:'면허 검증',notification_usage:'알림',api_usage:'API',job_boost:'공고 Boost'};
const INVOICE:Record<string,string>={draft:'작성 중',issued:'결제 대기',paying:'결제 확인 중',paid:'결제 완료',overdue:'미납',void:'취소'};


export default async function MembershipPage(){
  const context = await getAdminContext();
  if (!context) redirect('/setup/claim-facility');
  const {plans,subscription,invoices,usage,error}=await getBilling(context.facilityId);
  const canPay = context.accessRole === 'owner' || context.accessRole === 'super';
  const usageMap=usage.reduce((m:any,r:any)=>{m[r.usage_type]=(m[r.usage_type]??0)+r.quantity;return m;},{});
  return <main className="px-4 pb-28">
    <div className="mt-3 mb-5 px-1"><p className="text-label font-bold text-primary">임금과 완전히 분리된 요금</p><h1 className="text-display font-extrabold text-ink">요금제·청구</h1><p className="text-label text-sub mt-2 leading-5">잇닿 이용료는 병원 규모(공고·인력풀·관리자) 기준입니다. 워커 임금이나 채용 성공액에 연동되지 않습니다.</p></div>
    {error ? <div className="bg-white rounded-2xl p-8 text-center border border-red-200"><p role="alert" className="text-body font-bold text-red-600">청구 정보를 불러오지 못했어요</p><p className="text-label text-sub mt-2">{error}</p><a href="/membership" className="inline-flex mt-4 px-4 h-10 items-center rounded-xl bg-ink text-white text-label font-bold">다시 불러오기</a></div> : <>
    <div className="bg-primary rounded-2xl p-5 text-white mb-5"><p className="text-[12px] text-white/70">현재 구독</p><p className="text-[22px] font-extrabold mt-1">{subscription?.service_plans?.name??'파일럿 이용 중'}</p><p className="text-[12px] text-white/70 mt-2">{subscription?.current_period_end?`${formatDate(subscription.current_period_end)}까지 · ${SUB_STATUS[subscription.status]??'이용 중'}`:'정식 청구 전 제한 파일럿'}</p></div>
    {!canPay&&<div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-5"><p className="text-body font-bold text-ink">조회 전용 권한</p><p className="text-label text-sub mt-1">청구서 결제는 병원 소유자 또는 결제 승인 담당자에게 요청해 주세요.</p></div>}
    <h2 className="text-title font-extrabold px-1 mb-3">요금제</h2>
    <div className="space-y-3 mb-4">{plans.map(plan=>{
      const isCurrent = subscription?.plan_code===plan.code;
      const popular = plan.features?.popular === true;
      const perks = PLAN_PERKS[plan.code] ?? [`공고 ${cap(plan.included_job_posting_slots)}건`,`인력풀 ${cap(plan.included_active_workers)}명`,`관리자 ${plan.included_admin_seats}명`];
      return <article key={plan.code} className={`bg-white rounded-2xl p-5 ${popular?'ring-2 ring-primary shadow-lg':'shadow-card'} ${isCurrent?'ring-2 ring-success':''}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-title font-extrabold">{plan.name}</p>
            {popular&&<span className="text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-primary text-white">★ 인기</span>}
            {isCurrent&&<span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-success/15 text-success">이용 중</span>}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-[22px] font-extrabold text-ink leading-none">{plan.monthly_fee===0?'무료':won(plan.monthly_fee)}</p>
            {plan.monthly_fee>0&&<p className="text-[11px] text-tertiary mt-0.5">월 · 부가세 별도</p>}
          </div>
        </div>
        {typeof plan.features?.tagline==='string'&&<p className="text-[13px] text-sub mt-1.5">{plan.features.tagline as string}</p>}
        <ul className="mt-3 space-y-1.5">{perks.map((perk,i)=><li key={i} className="flex items-center gap-2 text-[13px] text-ink"><span className={popular?'text-primary':'text-sub'}>✓</span>{perk}</li>)}</ul>
      </article>;
    })}</div>
    <div className="mb-7 bg-primary/5 border border-primary/15 rounded-2xl p-4">
      <p className="text-label font-bold text-primary">💡 임금은 병원이 직접 지급 = 중개 수수료 0원</p>
      <p className="text-[13px] text-sub leading-5 mt-1">월 시프트 20건 병원이라면, 임금의 10~15%를 떼는 중개 방식 대비 <b className="text-ink">월 수십만 원을 아낍니다.</b> 잇닿은 정액 이용료만, 임금엔 손대지 않아요.</p>
    </div>
    <h2 className="text-title font-extrabold px-1 mb-3">이번 달 사용량</h2>
    <div className="bg-white rounded-2xl shadow-card p-4 mb-7">{Object.keys(usageMap).length===0?<p className="text-label text-sub py-4 text-center">이번 달 기록된 초과 사용량이 없어요.</p>:Object.entries(usageMap).map(([key,value])=><div key={key} className="flex justify-between py-2 border-b border-line last:border-0 text-label"><span className="text-sub">{USAGE[key]??'기타 사용량'}</span><b>{String(value)}건</b></div>)}</div>
    <h2 className="text-title font-extrabold px-1 mb-3">청구서</h2>
    {invoices.length===0?<div className="bg-white rounded-2xl p-8 text-center text-label text-sub">발행된 서비스 청구서가 없어요.</div>:<div className="space-y-3">{invoices.map(invoice=><article key={invoice.id} className="bg-white rounded-2xl p-4 shadow-card"><div className="flex justify-between gap-3"><div><p className="text-body font-bold">{invoice.invoice_number}</p><p className="text-[13px] text-sub mt-1">{formatDate(invoice.period_start)} – {formatDate(invoice.period_end)}</p></div><div className="text-right"><p className="font-extrabold">{won(invoice.total_amount)}</p><p className="text-[13px] text-sub mt-1">{INVOICE[invoice.status]??'확인 중'}</p></div></div>{canPay&&['issued','overdue'].includes(invoice.status)&&<div className="mt-3"><ServiceInvoicePayButton invoiceId={invoice.id} amount={invoice.total_amount}/></div>}</article>)}</div>}
    <div className="mt-6 bg-blue-50 border border-blue-100 rounded-2xl p-4"><p className="text-label font-bold text-ink">별도 부가서비스</p><p className="text-[13px] text-sub leading-5 mt-1">공고 Boost, 면허 검증, SMS·푸시 초과 사용, 추가 관리자·인력풀, API·ERP 연동은 청구서에 항목별로 표시됩니다.</p></div>
    </>}
  </main>;
}
