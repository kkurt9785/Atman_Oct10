'use server';
import { revalidatePath } from 'next/cache';
import { requireAdminContext } from '@/lib/admin-auth';
import { adminClient, userClient } from '@/lib/supabase';

export async function updatePaymentStatus(formData: FormData) {
  const context = await requireAdminContext(['owner','super']);
  const id = String(formData.get('id') ?? '');
  const action = String(formData.get('action') ?? '');
  if (!id || !['approve','mark_exported','mark_paid'].includes(action)) throw new Error('올바르지 않은 지급 요청입니다.');
  const sb = userClient(context.accessToken);
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const { error } = await sb.rpc('update_wage_payment_status', {
    p_instruction_id: id, p_action: action, p_payment_reference: null, p_dispute_reason: null,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/payroll');
}

export async function updateStaffPaymentStatus(formData:FormData){
  const context=await requireAdminContext(['owner','super']);
  const staffId=String(formData.get('staff_id')??'');
  const periodMonth=String(formData.get('period_month')??'');
  const action=String(formData.get('action')??'');
  if(!staffId||!/^\d{4}-\d{2}-01$/.test(periodMonth)||!['approve','mark_exported','mark_paid'].includes(action)) throw new Error('올바르지 않은 직원 급여 요청입니다.');
  const sb=adminClient();
  if(!sb)throw new Error('서버 설정을 확인해 주세요.');
  const {data:staff}=await sb.from('facility_staff').select('id,pay_basis,pay_rate')
    .eq('id',staffId).eq('facility_id',context.facilityId).neq('status','ended').maybeSingle();
  if(!staff?.pay_basis||!staff.pay_rate)throw new Error('직원의 급여 기준을 먼저 설정해 주세요.');
  const next=new Date(`${periodMonth}T00:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);
  const endDate=new Date(next.getTime()-86_400_000).toISOString().slice(0,10);
  const {data:attendance}=await sb.from('staff_attendances').select('check_in_at,check_out_at,break_minutes')
    .eq('staff_id',staffId).gte('work_date',periodMonth).lte('work_date',endDate).eq('status','completed');
  let minutes=0;let days=0;
  for(const row of attendance??[]){if(!row.check_in_at||!row.check_out_at)continue;minutes+=Math.max(0,Math.round((new Date(row.check_out_at).getTime()-new Date(row.check_in_at).getTime())/60000)-Number(row.break_minutes??0));days++;}
  const gross=staff.pay_basis==='monthly'?staff.pay_rate:staff.pay_basis==='daily'?days*staff.pay_rate:Math.round(minutes/60*staff.pay_rate);
  const {data:existing}=await sb.from('staff_wage_payments').select('id,status,pay_basis,pay_rate,worked_minutes,worked_days,gross_amount,net_amount').eq('staff_id',staffId).eq('period_month',periodMonth).maybeSingle();
  const expected=action==='approve'?'draft':action==='mark_exported'?'approved':'exported';
  if(existing&&existing.status!==expected)throw new Error('현재 급여 상태에서는 처리할 수 없어요.');
  const status=action==='approve'?'approved':action==='mark_exported'?'exported':'paid';
  const now=new Date().toISOString();
  const frozen=existing&&existing.status!=='draft';
  const payload:any={facility_id:context.facilityId,staff_id:staffId,period_month:periodMonth,
    pay_basis:frozen?existing.pay_basis:staff.pay_basis,pay_rate:frozen?existing.pay_rate:staff.pay_rate,
    worked_minutes:frozen?existing.worked_minutes:minutes,worked_days:frozen?existing.worked_days:days,
    gross_amount:frozen?existing.gross_amount:gross,net_amount:frozen?existing.net_amount:gross,status,updated_at:now};
  if(action==='approve'){payload.approved_by=context.user.id;payload.approved_at=now;}
  if(action==='mark_exported')payload.exported_at=now;
  if(action==='mark_paid')payload.paid_at=now;
  const {error}=await sb.from('staff_wage_payments').upsert(payload,{onConflict:'staff_id,period_month'});
  if(error)throw new Error('직원 급여 상태를 저장하지 못했어요.');
  await sb.from('audit_logs').insert({actor_type:'admin',actor_id:context.user.id,action:`staff_wage_payment.${action}`,entity_type:'facility_staff',entity_id:staffId,after_data:{period_month:periodMonth,status}});
  revalidatePath('/payroll');
}
