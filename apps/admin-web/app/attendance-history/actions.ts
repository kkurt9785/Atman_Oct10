'use server';
import { revalidatePath } from 'next/cache';
import { requireAdminContext } from '@/lib/admin-auth';
import { adminClient } from '@/lib/supabase';

const text=(f:FormData,k:string)=>String(f.get(k)??'').trim();
const validMonth=(v:string)=>/^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export async function setAttendancePeriodAction(form:FormData){
  const context=await requireAdminContext(['owner','operator','super']);const sb=adminClient();
  if(!sb)throw new Error('서버 설정을 확인해 주세요.');
  const month=text(form,'month'),action=text(form,'action'),reason=text(form,'reason');
  if(!validMonth(month)||!['close','reopen'].includes(action)||reason.length<5)throw new Error('마감 월과 사유를 확인해 주세요.');
  const currentMonth=new Date(Date.now()+9*3600000).toISOString().slice(0,7);
  if(action==='close'&&month>=currentMonth)throw new Error('이번 달 근태는 다음 달부터 마감할 수 있어요.');
  const now=new Date().toISOString();
  const patch=action==='close'?{status:'closed',closed_by:context.user.id,closed_at:now,reopened_by:null,reopened_at:null}:{status:'open',reopened_by:context.user.id,reopened_at:now};
  const {error}=await sb.from('attendance_period_closures').upsert({facility_id:context.facilityId,period_month:`${month}-01`,reason,...patch},{onConflict:'facility_id,period_month'});
  if(error)throw new Error('근태 마감 상태를 저장하지 못했어요.');
  revalidatePath('/attendance-history');revalidatePath('/payroll');
}

export async function correctStaffAttendanceAction(form:FormData){
  const context=await requireAdminContext(['owner','operator','super']);const sb=adminClient();
  if(!sb)throw new Error('서버 설정을 확인해 주세요.');
  const id=text(form,'attendance_id'),month=text(form,'month'),reason=text(form,'reason');
  const checkIn=text(form,'check_in'),checkOut=text(form,'check_out');const breakMinutes=Number(text(form,'break_minutes'));
  if(!id||!validMonth(month)||reason.length<5||!checkIn||!checkOut||!Number.isInteger(breakMinutes)||breakMinutes<0||breakMinutes>480)throw new Error('수정 시간·휴게시간·사유를 확인해 주세요.');
  const {data:closure}=await sb.from('attendance_period_closures').select('status').eq('facility_id',context.facilityId).eq('period_month',`${month}-01`).maybeSingle();
  if(closure?.status==='closed')throw new Error('마감된 월은 먼저 재개방해야 수정할 수 있어요.');
  const {data:before}=await sb.from('staff_attendances').select('*').eq('id',id).eq('facility_id',context.facilityId).maybeSingle();
  if(!before||!String(before.work_date).startsWith(month))throw new Error('수정할 근태 기록을 찾지 못했어요.');
  const inAt=new Date(`${checkIn}:00+09:00`),outAt=new Date(`${checkOut}:00+09:00`);
  if(!Number.isFinite(inAt.getTime())||!Number.isFinite(outAt.getTime())||outAt<=inAt)throw new Error('퇴근시간은 출근시간보다 늦어야 해요.');
  const after={check_in_at:inAt.toISOString(),check_out_at:outAt.toISOString(),break_minutes:breakMinutes,status:'completed',corrected_by:context.user.id,correction_reason:reason,approved_by:context.user.id,approved_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const {data:updated,error}=await sb.from('staff_attendances').update(after).eq('id',id).eq('facility_id',context.facilityId).select('*').single();
  if(error)throw new Error('근태 기록을 수정하지 못했어요.');
  await sb.from('staff_attendance_change_logs').insert({facility_id:context.facilityId,attendance_id:id,changed_by:context.user.id,action:'correct',reason,before_data:before,after_data:updated});
  revalidatePath('/attendance-history');revalidatePath('/payroll');revalidatePath('/timesheet');
}
