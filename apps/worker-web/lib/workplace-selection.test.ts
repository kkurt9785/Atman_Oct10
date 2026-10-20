import { describe, expect, it } from 'vitest';
import { selectWorkplaceShift, selectWorkplaceStaff, currentStaffAttendance, staffAttendanceLabel, attendancePolicyHelp } from './workplace-selection';
const row=(id:string,date:string,active=false,facility='a')=>({id,status:'accepted',checked_in_at:active?'2026-10-31T13:00:00Z':null,checked_out_at:null,shifts:{shift_date:date,start_time:'09:00',facilities:{id:facility}}});
describe('workplace selection',()=>{
  it('never substitutes another staff member for a conflicting explicit staff and QR facility',()=>{
    const rows=[{id:'staff-a',facilities:{id:'a'}},{id:'staff-b',facilities:{id:'b'}}];
    expect(selectWorkplaceStaff(rows,'b','staff-a')).toBeNull();
    expect(selectWorkplaceStaff(rows,'b','staff-b')?.id).toBe('staff-b');
    expect(selectWorkplaceStaff(rows,null,'staff-a')?.id).toBe('staff-a');
  });
  it('prioritizes an ongoing overnight shift over today’s unstarted shift',()=>{
    expect(selectWorkplaceShift([row('next','2026-11-01'),row('night','2026-10-31',true)],'2026-11-01')?.id).toBe('night');
  });
  it('honors explicit target and never substitutes a different QR facility',()=>{
    const rows=[row('a','2026-11-01',true),row('b','2026-11-01',false,'b')];
    expect(selectWorkplaceShift(rows,'2026-11-01','b')?.id).toBe('b');
    expect(selectWorkplaceShift(rows,'2026-11-01',null,'b')?.id).toBe('b');
    expect(selectWorkplaceShift(rows,'2026-11-01','a','b')).toBeNull();
    expect(selectWorkplaceShift(rows,'2026-11-01',null,'missing')).toBeNull();
  });
  it('uses earliest start independently of database row order',()=>{
    const late={...row('late','2026-11-01'),shifts:{...row('x','2026-11-01').shifts,start_time:'18:00'}};
    expect(selectWorkplaceShift([late,row('early','2026-11-01')],'2026-11-01')?.id).toBe('early');
  });
  it('retains open attendance across month boundary and prioritizes it over today',()=>{
    const open:{staff_id:string;work_date:string;check_in_at:string|null;check_out_at:string|null}={staff_id:'staff',work_date:'2026-10-31',check_in_at:'2026-10-31T13:00:00Z',check_out_at:null};
    const today:typeof open={...open,work_date:'2026-11-01',check_in_at:null};
    expect(currentStaffAttendance([today],[open],'2026-11-01').staff).toEqual(open);
    expect(currentStaffAttendance([{...open,check_out_at:'done'}],[],'2026-11-01')).toEqual({});
  });
  it('shows completed and approval states before working',()=>{
    expect(staffAttendanceLabel({check_in_at:'in',check_out_at:'out'})).toBe('퇴근 완료');
    expect(staffAttendanceLabel({check_in_at:'in',check_out_at:null,status:'checkout_pending'})).toBe('퇴근 승인 대기');
    expect(staffAttendanceLabel(null)).toBe('출근 전');
  });
  it('does not promise a GPS bypass for strengthened or admin policies',()=>{
    expect(attendancePolicyHelp('gps_qr')).toContain('모두');
    expect(attendancePolicyHelp('admin')).not.toContain('QR');
    expect(attendancePolicyHelp('network')).toContain('네트워크');
  });
});
