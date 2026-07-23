import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';

export type WagePaymentRow = {
  id: string; workerName: string; shiftDate: string; grossAmount: number; netAmount: number;
  deductionStatus: string; dueDate: string | null; status: string; approvedAt: string | null;
  paidAt: string | null; workerConfirmedAt: string | null; disputeReason: string | null;
};

export type WagePaymentResult = { rows: WagePaymentRow[]; error: string | null };

export type StaffWagePaymentRow = {
  staffId:string; workerName:string; engagementType:string; periodMonth:string;
  payBasis:string|null; payRate:number|null; workedMinutes:number; workedDays:number;
  grossAmount:number; netAmount:number; status:string;
  bankName:string|null;accountLast4:string|null;
};

export async function getStaffWagePayments(requestedMonth?:string):Promise<StaffWagePaymentRow[]>{
  const facilityId=await getCurrentFacilityId();
  const sb=adminClient();
  if(!sb||!facilityId)return [];
  const now=new Date(Date.now()+9*60*60*1000);
  const periodMonth=/^\d{4}-\d{2}$/.test(requestedMonth??'')?`${requestedMonth}-01`:`${now.toISOString().slice(0,7)}-01`;
  const nextMonth=new Date(`${periodMonth}T00:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth()+1);
  const endDate=new Date(nextMonth.getTime()-86_400_000).toISOString().slice(0,10);
  const [{data:staff},{data:attendance},{data:payments}]=await Promise.all([
    sb.from('facility_staff').select('id,name,engagement_type,pay_basis,pay_rate,default_break_minutes,bank_name,account_last4').eq('facility_id',facilityId).neq('status','ended').order('name'),
    sb.from('staff_attendances').select('staff_id,check_in_at,check_out_at,break_minutes,status').eq('facility_id',facilityId).gte('work_date',periodMonth).lte('work_date',endDate).eq('status','completed'),
    sb.from('staff_wage_payments').select('staff_id,worked_minutes,worked_days,gross_amount,net_amount,status').eq('facility_id',facilityId).eq('period_month',periodMonth),
  ]);
  const attendanceMap=new Map<string,{minutes:number;days:number}>();
  for(const row of (attendance??[]) as any[]){
    if(!row.check_in_at||!row.check_out_at)continue;
    const current=attendanceMap.get(row.staff_id)??{minutes:0,days:0};
    const raw=Math.max(0,Math.round((new Date(row.check_out_at).getTime()-new Date(row.check_in_at).getTime())/60000)-Number(row.break_minutes??0));
    current.minutes+=raw;current.days+=1;attendanceMap.set(row.staff_id,current);
  }
  const paymentMap=new Map((payments??[]).map((row:any)=>[row.staff_id,row]));
  return ((staff??[]) as any[]).map(row=>{
    const work=attendanceMap.get(row.id)??{minutes:0,days:0};
    const saved:any=paymentMap.get(row.id);
    const rate=Number(row.pay_rate)||null;
    const calculated=!rate?0:row.pay_basis==='monthly'?rate:row.pay_basis==='daily'?work.days*rate:Math.round(work.minutes/60*rate);
    const frozen=saved&&saved.status!=='draft';
    return {staffId:row.id,workerName:row.name,engagementType:row.engagement_type,periodMonth,
      payBasis:row.pay_basis,payRate:rate,workedMinutes:frozen?saved.worked_minutes:work.minutes,
      workedDays:frozen?saved.worked_days:work.days,grossAmount:frozen?saved.gross_amount:calculated,
      netAmount:frozen?saved.net_amount:calculated,status:!rate?'config_required':saved?.status??'draft',
      bankName:row.bank_name??null,accountLast4:row.account_last4??null};
  });
}

export async function getUnifiedWorkforceSummary(){
  const facilityId=await getCurrentFacilityId();
  const sb=adminClient();
  if(!sb||!facilityId)return {totalMinutes:0,estimatedPay:0,workingNow:0};
  const today=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10);
  const monthStart=`${today.slice(0,7)}-01`;
  const [managed,{data:shiftWages},{count:managedWorking},{count:shiftWorking}]=await Promise.all([
    getStaffWagePayments(),
    sb.from('wage_calculations').select('worked_minutes,gross').eq('org_id',facilityId).gte('calculated_at',`${monthStart}T00:00:00+09:00`),
    sb.from('staff_attendances').select('id',{count:'exact',head:true}).eq('facility_id',facilityId).eq('work_date',today).in('status',['working','late','checkout_pending']),
    sb.from('shift_attendances').select('id,shifts!inner(facility_id,shift_date)',{count:'exact',head:true}).eq('shifts.facility_id',facilityId).eq('shifts.shift_date',today).not('check_in_at','is',null).is('check_out_at',null),
  ]);
  return {
    totalMinutes:managed.reduce((sum,row)=>sum+row.workedMinutes,0)+(shiftWages??[]).reduce((sum:number,row:any)=>sum+Number(row.worked_minutes??0),0),
    estimatedPay:managed.reduce((sum,row)=>sum+row.grossAmount,0)+(shiftWages??[]).reduce((sum:number,row:any)=>sum+Number(row.gross??0),0),
    workingNow:(managedWorking??0)+(shiftWorking??0),
  };
}

export async function getWagePayments(): Promise<WagePaymentResult> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return { rows: [], error: '병원 또는 서버 연결 정보를 확인하지 못했어요.' };
  const { data, error } = await sb.from('wage_payment_instructions')
    .select('id,gross_amount,net_amount,deduction_status,due_date,status,approved_at,paid_at,worker_confirmed_at,dispute_reason,workers(name),shifts(shift_date)')
    .eq('facility_id', facilityId).order('created_at', { ascending: false }).limit(100);
  if (error) return { rows: [], error: '급여 지급 요청을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' };
  return { rows: ((data ?? []) as any[]).map((row) => ({
    id: row.id, workerName: row.workers?.name ?? '워커', shiftDate: row.shifts?.shift_date ?? '-',
    grossAmount: row.gross_amount, netAmount: row.net_amount, deductionStatus: row.deduction_status,
    dueDate: row.due_date, status: row.status, approvedAt: row.approved_at, paidAt: row.paid_at,
    workerConfirmedAt: row.worker_confirmed_at, disputeReason: row.dispute_reason,
  })), error: null };
}

export function hahrFeature(plan: string) { return plan === 'bundle' || plan === 'hr' || plan === 'growth' || plan === 'network'; }
