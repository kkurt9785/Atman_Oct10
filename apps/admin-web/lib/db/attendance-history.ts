import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';

export type AttendanceHistoryRow={
  id:string;kind:'staff'|'shift';staffId:string|null;name:string;employment:string;role:string;workDate:string;
  scheduledStart:string|null;scheduledEnd:string|null;checkInAt:string|null;checkOutAt:string|null;
  breakMinutes:number;workedMinutes:number;status:string;method:string|null;
  lateMinutes:number;earlyLeaveMinutes:number;correctionReason:string|null;
};
function monthEnd(month:string){const d=new Date(`${month}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+1);return new Date(d.getTime()-86400000).toISOString().slice(0,10);}

export async function getAttendanceHistory(month:string){
  const facilityId=await getCurrentFacilityId();const sb=adminClient();
  if(!facilityId||!sb)return {rows:[] as AttendanceHistoryRow[],closed:false};
  const start=`${month}-01`,end=monthEnd(month);
  const [{data:staff},{data:shifts},{data:closure}]=await Promise.all([
    sb.from('staff_attendances').select('id,staff_id,work_date,scheduled_start,scheduled_end,check_in_at,check_out_at,break_minutes,status,check_in_method,check_out_method,late_minutes,early_leave_minutes,correction_reason,facility_staff(name,role,engagement_type)')
      .eq('facility_id',facilityId).gte('work_date',start).lte('work_date',end).order('work_date',{ascending:false}),
    sb.from('shift_attendances').select('id,check_in_at,check_out_at,check_in_method,check_out_method,late_minutes,early_leave_minutes,workers(name,role),shifts!inner(facility_id,shift_date,start_time,end_time)')
      .eq('shifts.facility_id',facilityId).gte('shifts.shift_date',start).lte('shifts.shift_date',end),
    sb.from('attendance_period_closures').select('status').eq('facility_id',facilityId).eq('period_month',start).maybeSingle(),
  ]);
  const rows:AttendanceHistoryRow[]=[];
  for(const raw of (staff??[]) as any[]){const person=Array.isArray(raw.facility_staff)?raw.facility_staff[0]:raw.facility_staff;const worked=raw.check_in_at&&raw.check_out_at?Math.max(0,Math.round((new Date(raw.check_out_at).getTime()-new Date(raw.check_in_at).getTime())/60000)-Number(raw.break_minutes??0)):0;rows.push({id:raw.id,kind:'staff',staffId:raw.staff_id??null,name:person?.name??'직원',employment:person?.engagement_type??'regular',role:person?.role??'',workDate:raw.work_date,scheduledStart:raw.scheduled_start,scheduledEnd:raw.scheduled_end,checkInAt:raw.check_in_at,checkOutAt:raw.check_out_at,breakMinutes:Number(raw.break_minutes??0),workedMinutes:worked,status:raw.status,method:raw.check_out_method??raw.check_in_method,lateMinutes:Number(raw.late_minutes??0),earlyLeaveMinutes:Number(raw.early_leave_minutes??0),correctionReason:raw.correction_reason});}
  for(const raw of (shifts??[]) as any[]){const person=Array.isArray(raw.workers)?raw.workers[0]:raw.workers;const shift=Array.isArray(raw.shifts)?raw.shifts[0]:raw.shifts;const worked=raw.check_in_at&&raw.check_out_at?Math.max(0,Math.round((new Date(raw.check_out_at).getTime()-new Date(raw.check_in_at).getTime())/60000)):0;rows.push({id:raw.id,kind:'shift',staffId:null,name:person?.name??'단기 워커',employment:'shift',role:person?.role??'',workDate:shift?.shift_date,scheduledStart:shift?.start_time,scheduledEnd:shift?.end_time,checkInAt:raw.check_in_at,checkOutAt:raw.check_out_at,breakMinutes:0,workedMinutes:worked,status:raw.check_out_at?'completed':raw.check_in_at?'working':'scheduled',method:raw.check_out_method??raw.check_in_method,lateMinutes:Number(raw.late_minutes??0),earlyLeaveMinutes:Number(raw.early_leave_minutes??0),correctionReason:null});}
  return {rows:rows.sort((a,b)=>b.workDate.localeCompare(a.workDate)||a.name.localeCompare(b.name)),closed:closure?.status==='closed'};
}

export type StaffAttendanceDetail={
  staff:{id:string;name:string;role:string;engagementType:string;department:string|null;defaultStart:string|null;defaultEnd:string|null}|null;
  rows:AttendanceHistoryRow[];
  firstWorkDate:string|null;
  summary:{workDays:number;workedMinutes:number;lateCount:number;lateMinutes:number;earlyLeaveMinutes:number;absentCount:number};
};

// 직원 1명의 월별 근태 상세 — 목록 페이지의 3개월 제한과 달리 전체 기간 조회 가능
export async function getStaffAttendanceDetail(staffId:string,month:string):Promise<StaffAttendanceDetail>{
  const empty:StaffAttendanceDetail={staff:null,rows:[],firstWorkDate:null,summary:{workDays:0,workedMinutes:0,lateCount:0,lateMinutes:0,earlyLeaveMinutes:0,absentCount:0}};
  const facilityId=await getCurrentFacilityId();const sb=adminClient();
  if(!facilityId||!sb)return empty;
  const start=`${month}-01`,end=monthEnd(month);
  const [{data:staff},{data:attendances},{data:first}]=await Promise.all([
    sb.from('facility_staff').select('id,name,role,engagement_type,department,default_start_time,default_end_time')
      .eq('id',staffId).eq('facility_id',facilityId).maybeSingle(),
    sb.from('staff_attendances').select('id,staff_id,work_date,scheduled_start,scheduled_end,check_in_at,check_out_at,break_minutes,status,check_in_method,check_out_method,late_minutes,early_leave_minutes,correction_reason')
      .eq('facility_id',facilityId).eq('staff_id',staffId).gte('work_date',start).lte('work_date',end).order('work_date',{ascending:false}),
    sb.from('staff_attendances').select('work_date').eq('facility_id',facilityId).eq('staff_id',staffId)
      .order('work_date',{ascending:true}).limit(1).maybeSingle(),
  ]);
  if(!staff)return empty;
  const rows:AttendanceHistoryRow[]=((attendances??[]) as any[]).map(raw=>{
    const worked=raw.check_in_at&&raw.check_out_at?Math.max(0,Math.round((new Date(raw.check_out_at).getTime()-new Date(raw.check_in_at).getTime())/60000)-Number(raw.break_minutes??0)):0;
    return {id:raw.id,kind:'staff' as const,staffId:raw.staff_id,name:staff.name,employment:staff.engagement_type,role:staff.role,workDate:raw.work_date,scheduledStart:raw.scheduled_start,scheduledEnd:raw.scheduled_end,checkInAt:raw.check_in_at,checkOutAt:raw.check_out_at,breakMinutes:Number(raw.break_minutes??0),workedMinutes:worked,status:raw.status,method:raw.check_out_method??raw.check_in_method,lateMinutes:Number(raw.late_minutes??0),earlyLeaveMinutes:Number(raw.early_leave_minutes??0),correctionReason:raw.correction_reason};
  });
  return {
    staff:{id:staff.id,name:staff.name,role:staff.role,engagementType:staff.engagement_type,department:staff.department,defaultStart:staff.default_start_time,defaultEnd:staff.default_end_time},
    rows,
    firstWorkDate:first?.work_date??null,
    summary:{
      workDays:rows.filter(r=>r.checkInAt).length,
      workedMinutes:rows.reduce((s,r)=>s+r.workedMinutes,0),
      lateCount:rows.filter(r=>r.lateMinutes>0).length,
      lateMinutes:rows.reduce((s,r)=>s+r.lateMinutes,0),
      earlyLeaveMinutes:rows.reduce((s,r)=>s+r.earlyLeaveMinutes,0),
      absentCount:rows.filter(r=>r.status==='absent').length,
    },
  };
}
