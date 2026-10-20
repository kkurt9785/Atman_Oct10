import { adminClient } from '../supabase';
import { getFacilityAccessInfo } from '../admin-auth';
import { todayKST } from '../date';
import { readAllRows } from './read-all-rows';
import { isAttendanceCovered } from '../shared/gig-pay/calculation';

export async function getSiteSummary(userId:string,facilityId:string) {
  const access=await getFacilityAccessInfo(userId,facilityId);
  if(!access)throw new Error('현장 접근 권한을 확인하지 못했어요.');
  const sb=adminClient();if(!sb)throw new Error('연결 정보를 확인하지 못했어요.');
  const today=todayKST();
  const [staff,open,assignments,leaves,settings]=await Promise.all([
    readAllRows(()=>sb.from('facility_staff').select('id,worker_kind,status,contract_start,contract_end,work_weekdays,default_start_time').eq('facility_id',facilityId).neq('status','ended')),
    readAllRows(()=>sb.from('staff_attendances').select('id,staff_id,status,check_in_at,check_out_at,work_date').eq('facility_id',facilityId).or(`work_date.eq.${today},status.eq.checkout_pending,check_out_at.is.null`)),
    readAllRows(()=>sb.from('gig_assignments').select('id,staff_id,starts_on,ends_on,work_weekdays,start_time,source').eq('facility_id',facilityId).in('status',['planned','active']).lte('starts_on',today).gte('ends_on',today)),
    readAllRows(()=>sb.from('staff_leave_requests').select('id,staff_id').eq('facility_id',facilityId).eq('status','approved').lte('start_date',today).gte('end_date',today)),
    sb.from('facility_attendance_settings').select('late_grace_minutes').eq('facility_id',facilityId).maybeSingle(),
  ]);
  if(settings.error)throw new Error('근태 설정을 확인하지 못했어요.');
  const day=new Date(`${today}T00:00:00Z`).getUTCDay()||7;
  const now=new Date(Date.now()+9*3600000).toISOString().slice(11,16);
  const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3,5));
  const grace=Math.max(0,Number(settings.data?.late_grace_minutes??20));
  const missing=staff.data.filter(person=>{
    if(person.status!=='active'||leaves.data.some(row=>row.staff_id===person.id))return false;
    if(open.data.some(row=>row.staff_id===person.id&&(row.check_in_at||row.work_date===today)))return false;
    if(person.worker_kind==='gig') {
      const own=assignments.data.filter(row=>row.staff_id===person.id);
      const effective=own.some(row=>row.source==='admin')?own.filter(row=>row.source==='admin'):own;
      return effective.some(row=>(row.work_weekdays??[]).map(Number).includes(day)&&minutes(now)>minutes(row.start_time)+grace);
    }
    return (!person.contract_start||person.contract_start<=today)&&(!person.contract_end||person.contract_end>=today)
      &&(person.work_weekdays??[]).map(Number).includes(day)&&minutes(now)>minutes(person.default_start_time)+grace;
  }).length;
  let unpaid:number|null=null;
  if(access.canViewPayroll) {
    const [completed,payouts]=await Promise.all([
      readAllRows(()=>sb.from('staff_attendances').select('id,staff_id,work_date,check_out_at,facility_staff!inner(worker_kind)').eq('facility_id',facilityId).eq('facility_staff.worker_kind','gig').eq('status','completed').not('check_in_at','is',null).not('check_out_at','is',null).lte('work_date',today)),
      readAllRows(()=>sb.from('gig_payouts').select('id,staff_id,attendance_ids,period_start,period_end,covered_until,status').eq('facility_id',facilityId).neq('status','cancelled')),
    ]);
    unpaid=completed.data.filter(row=>!isAttendanceCovered(row,payouts.data.filter(payout=>payout.staff_id===row.staff_id))).length;
  }
  return {missing,working:open.data.filter(row=>row.check_in_at&&!row.check_out_at&&['working','late'].includes(row.status)).length,
    pending:open.data.filter(row=>row.status==='checkout_pending').length,unpaid};
}
