import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';
import { summarizeAttendancePeriod, type RecordedAttendance } from '../shared/gig-pay/calculation';
import { roundPay } from '../shared/gig-pay/shift-pay';

export type WagePaymentRow = {
  id: string; workerName: string; shiftDate: string; grossAmount: number; netAmount: number;
  deductionStatus: string; dueDate: string | null; status: string; approvedAt: string | null;
  paidAt: string | null; workerConfirmedAt: string | null; disputeReason: string | null;
  bankName:string|null;accountLast4:string|null;
};

export type WagePaymentResult = { rows: WagePaymentRow[]; error: string | null };

export type StaffWagePaymentRow = {
  staffId:string; workerName:string; engagementType:string; periodMonth:string;
  payBasis:string|null; payRate:number|null; workedMinutes:number; workedDays:number;
  grossAmount:number; netAmount:number; status:string;
  bankName:string|null;accountLast4:string|null;
  needsProration:boolean; prorationReason:string|null; accountReady:boolean;
  /** 저장된 지급 행(검토·승인·이체·완료)이 있는지 — 없으면 화면에서 계산한 '검토 전' 예상치 */
  saved:boolean;
  /** 이 달에 퇴근까지 찍혔지만 상태가 완료가 아닌 기록 수(지각·승인 대기 등) — 급여에서 빠지는 이유를 보여 준다 */
  excludedRecords:number;
};

function validMonth(value?:string){
  if(!value||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))return null;
  return value;
}

export async function getStaffWagePayments(requestedMonth?:string):Promise<StaffWagePaymentRow[]>{
  const facilityId=await getCurrentFacilityId();
  const sb=adminClient();
  if(!sb||!facilityId)throw new Error('사업장 또는 서버 연결 정보를 확인하지 못했어요.');
  const now=new Date(Date.now()+9*60*60*1000);
  const selectedMonth=validMonth(requestedMonth)??now.toISOString().slice(0,7);
  const periodMonth=`${selectedMonth}-01`;
  const nextMonth=new Date(`${periodMonth}T00:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth()+1);
  const endDate=new Date(nextMonth.getTime()-86_400_000).toISOString().slice(0,10);
  const [{data:staff,error:staffError},{data:attendance,error:attendanceError},{data:payments,error:paymentError},{data:excluded,error:excludedError}]=await Promise.all([
    sb.from('facility_staff').select('id,name,engagement_type,status,contract_start,contract_end,pay_basis,pay_rate,default_break_minutes,bank_name,account_last4').eq('facility_id',facilityId).order('name').limit(1000),
    sb.from('staff_attendances').select('staff_id,work_date,check_in_at,check_out_at,break_minutes,status').eq('facility_id',facilityId).gte('work_date',periodMonth).lte('work_date',endDate).eq('status','completed').limit(1000),
    sb.from('staff_wage_payments').select('staff_id,pay_basis,pay_rate,worked_minutes,worked_days,gross_amount,net_amount,status').eq('facility_id',facilityId).eq('period_month',periodMonth).limit(1000),
    // 퇴근까지 찍혔는데 완료가 아닌 기록(지각·승인 대기) — 급여엔 안 들어가므로 건수만 세어 안내한다
    sb.from('staff_attendances').select('staff_id').eq('facility_id',facilityId).gte('work_date',periodMonth).lte('work_date',endDate).neq('status','completed').not('check_out_at','is',null).limit(1000),
  ]);
  if(staffError||attendanceError||paymentError||excludedError||[staff,attendance,payments,excluded].some(rows=>(rows?.length??0)>=1000)) {
    throw new Error('급여 자료 전체를 확인하지 못했어요. 일부 금액으로 처리하지 않도록 계산을 중단했어요.');
  }
  const attendanceMap=new Map<string,RecordedAttendance[]>();
  for(const row of (attendance??[]) as Array<RecordedAttendance & {staff_id:string}>) {
    if(!row.check_in_at||!row.check_out_at||!Number.isFinite(Date.parse(row.check_in_at))||!Number.isFinite(Date.parse(row.check_out_at))||Date.parse(row.check_out_at)<Date.parse(row.check_in_at)) {
      throw new Error('완료 근태의 출퇴근 시간을 먼저 확인해 주세요.');
    }
    const records=attendanceMap.get(row.staff_id)??[];
    records.push(row);attendanceMap.set(row.staff_id,records);
  }
  const paymentMap=new Map((payments??[]).map((row:any)=>[row.staff_id,row]));
  const excludedMap=new Map<string,number>();
  for(const row of (excluded??[]) as Array<{staff_id:string}>) excludedMap.set(row.staff_id,(excludedMap.get(row.staff_id)??0)+1);
  return ((staff??[]) as any[]).filter(row=>{
    const saved:any=paymentMap.get(row.id);
    const overlaps=(!row.contract_start||row.contract_start<=endDate)&&(!row.contract_end||row.contract_end>=periodMonth);
    return Boolean(saved)||overlaps;
  }).map(row=>{
    const work=summarizeAttendancePeriod(attendanceMap.get(row.id)??[],periodMonth,endDate);
    const saved:any=paymentMap.get(row.id);
    const rate=Number(row.pay_rate)||null;
    const calculated=!rate?0:row.pay_basis==='monthly'?rate:row.pay_basis==='daily'?work.days*rate:roundPay(work.minutes,rate);
    const frozen=saved&&['approved','exported','paid'].includes(saved.status);
    const startsMidMonth=Boolean(row.contract_start&&row.contract_start>periodMonth&&row.contract_start<=endDate);
    const endsMidMonth=Boolean(row.contract_end&&row.contract_end>=periodMonth&&row.contract_end<endDate);
    const needsProration=row.pay_basis==='monthly'&&(startsMidMonth||endsMidMonth);
    const prorationReason=startsMidMonth&&endsMidMonth?'입·퇴사일이 모두 급여기간 안에 있어요':startsMidMonth?'급여기간 중 계약이 시작됐어요':endsMidMonth?'급여기간 중 계약이 종료됐어요':null;
    return {staffId:row.id,workerName:row.name,engagementType:row.engagement_type,periodMonth,
      payBasis:frozen?saved.pay_basis:row.pay_basis,payRate:frozen?saved.pay_rate:rate,workedMinutes:frozen?saved.worked_minutes:work.minutes,
      workedDays:frozen?saved.worked_days:work.days,grossAmount:frozen?saved.gross_amount:calculated,
      netAmount:frozen?saved.net_amount:calculated,status:frozen?saved.status:!rate?'config_required':saved?.status??(selectedMonth===now.toISOString().slice(0,7)?'collecting':'draft'),
      bankName:row.bank_name??null,accountLast4:row.account_last4??null,
      needsProration,prorationReason,accountReady:Boolean(row.bank_name&&/^\d{4}$/.test(row.account_last4??'')),
      saved:Boolean(saved),excludedRecords:excludedMap.get(row.id)??0};
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

export async function getWagePayments(requestedMonth?:string): Promise<WagePaymentResult> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return { rows: [], error: '사업장 또는 서버 연결 정보를 확인하지 못했어요.' };
  const month=validMonth(requestedMonth)??new Date(Date.now()+9*60*60*1000).toISOString().slice(0,7);
  const next=new Date(`${month}-01T00:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);
  const end=new Date(next.getTime()-86_400_000).toISOString().slice(0,10);
  const { data, error } = await sb.from('wage_payment_instructions')
    .select('id,gross_amount,net_amount,deduction_status,due_date,status,approved_at,paid_at,worker_confirmed_at,dispute_reason,bank_name_snapshot,account_last4_snapshot,workers(name),shifts!inner(shift_date)')
    .eq('facility_id', facilityId).gte('shifts.shift_date',`${month}-01`).lte('shifts.shift_date',end)
    .order('created_at', { ascending: false }).limit(1000);
  if (error || (data?.length ?? 0) >= 1000) return { rows: [], error: '급여 지급 요청 전체를 확인하지 못했어요. 일부 합계로 처리할 수 없어요.' };
  return { rows: ((data ?? []) as any[]).map((row) => ({
    id: row.id, workerName: row.workers?.name ?? '근무자', shiftDate: row.shifts?.shift_date ?? '-',
    grossAmount: row.gross_amount, netAmount: row.net_amount, deductionStatus: row.deduction_status,
    dueDate: row.due_date, status: row.status, approvedAt: row.approved_at, paidAt: row.paid_at,
    workerConfirmedAt: row.worker_confirmed_at, disputeReason: row.dispute_reason,
    bankName:row.bank_name_snapshot??null,accountLast4:row.account_last4_snapshot??null,
  })), error: null };
}

export function hahrFeature(plan: string) { return plan === 'bundle' || plan === 'hr' || plan === 'growth' || plan === 'network'; }
