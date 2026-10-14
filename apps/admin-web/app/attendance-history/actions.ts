'use server';
import { revalidatePath } from 'next/cache';
import { requireAdminContext } from '@/lib/admin-auth';
import { userClient } from '@/lib/supabase';

const text=(f:FormData,k:string)=>String(f.get(k)??'').trim();
const validMonth=(v:string)=>/^\d{4}-(0[1-9]|1[0-2])$/.test(v);
function refreshAttendance(){
  revalidatePath('/attendance-history');revalidatePath('/attendance-history/staff/[staffId]','page');
  revalidatePath('/payroll');revalidatePath('/timesheet');revalidatePath('/gig-pay');revalidatePath('/');
}

export async function setAttendancePeriodAction(form:FormData){
  const context=await requireAdminContext(['owner','operator','super']);const sb=userClient(context.accessToken);
  if(!sb)throw new Error('서버 설정을 확인해 주세요.');
  const month=text(form,'month'),action=text(form,'action'),reason=text(form,'reason');
  if(!validMonth(month)||!['close','reopen'].includes(action)||reason.length<5)throw new Error('마감 월과 사유를 확인해 주세요.');
  const {error}=await sb.rpc('set_attendance_period_state',{p_facility_id:context.facilityId,p_month:`${month}-01`,p_action:action,p_reason:reason});
  if(error)throw new Error(error.code==='P0001'?error.message:'근태 마감 상태를 저장하지 못했어요.');
  refreshAttendance();
}

export async function correctStaffAttendanceAction(form:FormData){
  const context=await requireAdminContext(['owner','operator','super']);const sb=userClient(context.accessToken);
  if(!sb)throw new Error('서버 설정을 확인해 주세요.');
  const id=text(form,'attendance_id'),month=text(form,'month'),reason=text(form,'reason');
  const checkIn=text(form,'check_in'),checkOut=text(form,'check_out'),breakText=text(form,'break_minutes');const breakMinutes=Number(breakText);
  if(!id||!validMonth(month)||reason.length<5||!checkIn||!checkOut||!breakText||!Number.isInteger(breakMinutes)||breakMinutes<0||breakMinutes>480)throw new Error('수정 시간·휴게시간·사유를 확인해 주세요.');
  const inAt=new Date(`${checkIn}:00+09:00`),outAt=new Date(`${checkOut}:00+09:00`);
  if(!Number.isFinite(inAt.getTime())||!Number.isFinite(outAt.getTime())||outAt<=inAt)throw new Error('퇴근시간은 출근시간보다 늦어야 해요.');
  const {error}=await sb.rpc('correct_staff_attendance',{
    p_facility_id:context.facilityId,p_attendance_id:id,p_month:`${month}-01`,
    p_check_in:inAt.toISOString(),p_check_out:outAt.toISOString(),p_break_minutes:breakMinutes,p_reason:reason,
  });
  if(error)throw new Error(error.code==='P0001'?error.message:'근태 수정과 이력을 저장하지 못했어요. 다시 확인해 주세요.');
  refreshAttendance();
}
