'use server';
import { revalidatePath } from 'next/cache';
import { requireAdminContext } from '@/lib/admin-auth';
import { adminClient, userClient } from '@/lib/supabase';

export async function updatePaymentStatus(formData: FormData) {
  const context = await requireAdminContext(['owner','super']);
  const id = String(formData.get('id') ?? '');
  const action = String(formData.get('action') ?? '');
  if (!id || !['approve','mark_exported','mark_paid'].includes(action)) throw new Error('올바르지 않은 지급 요청입니다.');
  if(action==='approve'){
    const admin=adminClient();
    if(!admin)throw new Error('서버 설정을 확인해 주세요.');
    const {data:instruction}=await admin.from('wage_payment_instructions')
      .select('bank_name_snapshot,account_last4_snapshot,shifts!inner(shift_date)')
      .eq('id',id).eq('facility_id',context.facilityId).maybeSingle();
    if(!instruction)throw new Error('지급 요청을 찾지 못했어요.');
    const shift=(instruction as any).shifts;
    const shiftDate=Array.isArray(shift)?shift[0]?.shift_date:shift?.shift_date;
    const currentMonth=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,7);
    if(!shiftDate||shiftDate.slice(0,7)>=currentMonth)throw new Error('급여 승인은 마감된 이전 달 근무부터 가능해요.');
    if(!instruction.bank_name_snapshot||!/^\d{4}$/.test(instruction.account_last4_snapshot??''))throw new Error('워커의 지급 은행과 계좌 끝 4자리를 먼저 확인해 주세요.');
  }
  const sb = userClient(context.accessToken);
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const { error } = await sb.rpc('update_wage_payment_status', {
    p_instruction_id: id, p_action: action, p_payment_reference: null, p_dispute_reason: null,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/payroll');
}

export async function runPayrollAction(kind:'marketplace'|'staff',formData:FormData){
  try{
    if(kind==='marketplace')await updatePaymentStatus(formData);
    else await updateStaffPaymentStatus(formData);
    return {ok:true,error:''};
  }catch(error){
    return {ok:false,error:error instanceof Error?error.message:'처리하지 못했어요. 다시 시도해 주세요.'};
  }
}

export async function updateStaffPaymentStatus(formData:FormData){
  const context=await requireAdminContext(['owner','super']);
  const staffId=String(formData.get('staff_id')??'');
  const periodMonth=String(formData.get('period_month')??'');
  const action=String(formData.get('action')??'');
  if(!staffId||!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(periodMonth)||!['approve','mark_exported','mark_paid'].includes(action)) throw new Error('올바르지 않은 직원 급여 요청입니다.');
  const sb=adminClient();
  if(!sb)throw new Error('서버 설정을 확인해 주세요.');
  const {data:staff}=await sb.from('facility_staff').select('id,pay_basis,pay_rate,contract_start,contract_end,bank_name,account_last4')
    .eq('id',staffId).eq('facility_id',context.facilityId).maybeSingle();
  if(!staff?.pay_basis||!staff.pay_rate)throw new Error('직원의 급여 기준을 먼저 설정해 주세요.');
  const next=new Date(`${periodMonth}T00:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);
  const endDate=new Date(next.getTime()-86_400_000).toISOString().slice(0,10);
  if((staff.contract_start&&staff.contract_start>endDate)||(staff.contract_end&&staff.contract_end<periodMonth))throw new Error('이 직원의 계약기간과 급여기간이 겹치지 않아요.');
  const {data:attendance}=await sb.from('staff_attendances').select('check_in_at,check_out_at,break_minutes')
    .eq('staff_id',staffId).gte('work_date',periodMonth).lte('work_date',endDate).eq('status','completed');
  let minutes=0;let days=0;
  for(const row of attendance??[]){if(!row.check_in_at||!row.check_out_at)continue;minutes+=Math.max(0,Math.round((new Date(row.check_out_at).getTime()-new Date(row.check_in_at).getTime())/60000)-Number(row.break_minutes??0));days++;}
  const gross=staff.pay_basis==='monthly'?staff.pay_rate:staff.pay_basis==='daily'?days*staff.pay_rate:Math.round(minutes/60*staff.pay_rate);
  const {data:existing}=await sb.from('staff_wage_payments').select('id,status,pay_basis,pay_rate,worked_minutes,worked_days,gross_amount,net_amount').eq('staff_id',staffId).eq('period_month',periodMonth).maybeSingle();
  const expected=action==='approve'?'draft':action==='mark_exported'?'approved':'exported';
  if(existing&&existing.status!==expected)throw new Error('현재 급여 상태에서는 처리할 수 없어요.');
  if(action==='approve'){
    const currentMonth=`${new Date(Date.now()+9*60*60*1000).toISOString().slice(0,7)}-01`;
    if(periodMonth>=currentMonth)throw new Error('급여 승인은 마감된 이전 달부터 가능해요.');
    if(!staff.bank_name||!/^\d{4}$/.test(staff.account_last4??''))throw new Error('지급 은행과 계좌 끝 4자리를 먼저 등록해 주세요.');
  }
  const needsProration=staff.pay_basis==='monthly'&&Boolean(
    (staff.contract_start&&staff.contract_start>periodMonth&&staff.contract_start<=endDate)||
    (staff.contract_end&&staff.contract_end>=periodMonth&&staff.contract_end<endDate)
  );
  const finalGross=Number(formData.get('final_gross_amount')??0);
  if(action==='approve'&&needsProration&&(!Number.isInteger(finalGross)||finalGross<=0))throw new Error('중도 계약 월은 일할계산한 최종 세전액을 입력해 주세요.');
  const approvedGross=needsProration?finalGross:gross;
  if(action==='approve'&&approvedGross<=0)throw new Error('지급 승인할 근무·급여 금액이 없어요.');
  const status=action==='approve'?'approved':action==='mark_exported'?'exported':'paid';
  const now=new Date().toISOString();
  const frozen=existing&&existing.status!=='draft';
  const payload:any={facility_id:context.facilityId,staff_id:staffId,period_month:periodMonth,
    pay_basis:frozen?existing.pay_basis:staff.pay_basis,pay_rate:frozen?existing.pay_rate:staff.pay_rate,
    worked_minutes:frozen?existing.worked_minutes:minutes,worked_days:frozen?existing.worked_days:days,
    gross_amount:frozen?existing.gross_amount:approvedGross,net_amount:frozen?existing.net_amount:approvedGross,status,updated_at:now};
  if(action==='approve'){payload.approved_by=context.user.id;payload.approved_at=now;}
  if(action==='mark_exported')payload.exported_at=now;
  if(action==='mark_paid')payload.paid_at=now;
  const {error}=await sb.from('staff_wage_payments').upsert(payload,{onConflict:'staff_id,period_month'});
  if(error)throw new Error('직원 급여 상태를 저장하지 못했어요.');
  await sb.from('audit_logs').insert({actor_type:'admin',actor_id:context.user.id,action:`staff_wage_payment.${action}`,entity_type:'facility_staff',entity_id:staffId,after_data:{period_month:periodMonth,status}});
  revalidatePath('/payroll');
}
