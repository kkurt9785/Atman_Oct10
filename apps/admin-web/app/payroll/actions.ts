'use server';
import { revalidatePath } from 'next/cache';
import { requireAdminContext } from '@/lib/admin-auth';
import { adminClient, userClient } from '@/lib/supabase';

export async function updatePaymentStatus(formData: FormData) {
  const context = await requireAdminContext(['owner','super']);
  if (!context.canViewPayroll) throw new Error('급여 처리 권한이 없어요.');
  const id = String(formData.get('id') ?? '');
  const action = String(formData.get('action') ?? '');
  if (!id || !['approve','mark_exported','mark_paid'].includes(action)) throw new Error('올바르지 않은 지급 요청이에요.');
  if(action==='approve'){
    const admin=adminClient();
    if(!admin)throw new Error('서버 설정을 확인해 주세요.');
    const {data:facility}=await admin.from('facilities').select('is_demo')
      .eq('id',context.facilityId).maybeSingle();
    const {data:instruction}=await admin.from('wage_payment_instructions')
      .select('bank_name_snapshot,account_last4_snapshot,shifts!inner(shift_date)')
      .eq('id',id).eq('facility_id',context.facilityId).maybeSingle();
    if(!instruction)throw new Error('지급 요청을 찾지 못했어요.');
    const shift=(instruction as any).shifts;
    const shiftDate=Array.isArray(shift)?shift[0]?.shift_date:shift?.shift_date;
    const currentMonth=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,7);
    if(!shiftDate)throw new Error('근무일을 확인하지 못했어요.');
    if(!facility?.is_demo){
      if(shiftDate.slice(0,7)>=currentMonth)throw new Error('급여 승인은 마감된 이전 달 근무부터 가능해요.');
      const {data:closure}=await admin.from('attendance_period_closures').select('status')
        .eq('facility_id',context.facilityId).eq('period_month',`${shiftDate.slice(0,7)}-01`).maybeSingle();
      if(closure?.status!=='closed')throw new Error('근태 내역에서 해당 월을 먼저 마감해 주세요.');
    }
    if(!instruction.bank_name_snapshot||!/^\d{4}$/.test(instruction.account_last4_snapshot??''))throw new Error('근무자의 지급 은행과 계좌 끝 4자리를 먼저 확인해 주세요.');
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
  if(!context.canViewPayroll)throw new Error('급여 처리 권한이 없어요.');
  const staffId=String(formData.get('staff_id')??'');
  const periodMonth=String(formData.get('period_month')??'');
  const action=String(formData.get('action')??'');
  if(!staffId||!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(periodMonth)||!['approve','mark_exported','mark_paid'].includes(action)) throw new Error('올바르지 않은 직원 급여 요청이에요.');
  const finalText=String(formData.get('final_gross_amount')??'').trim();
  const finalGross=finalText ? Number(finalText) : null;
  if(finalGross!==null&&(!Number.isSafeInteger(finalGross)||finalGross<=0||finalGross>2147483647))throw new Error('최종 세전액을 올바른 원 단위 금액으로 입력해 주세요.');
  const sb=userClient(context.accessToken);
  if(!sb)throw new Error('서버 설정을 확인해 주세요.');
  // Authorization, fresh totals, state transition and audit are one DB transaction.
  const {error}=await sb.rpc('transition_staff_wage_payment',{
    p_facility_id:context.facilityId,p_staff_id:staffId,p_month:periodMonth,
    p_action:action,p_final_gross:finalGross,
  });
  if(error)throw new Error(error.message || '직원 급여 상태를 저장하지 못했어요.');
  revalidatePath('/payroll');
}
