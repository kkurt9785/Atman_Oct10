import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), userClient: vi.fn(), authorize: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin-auth', () => ({ requireAdminContext: mocks.authorize }));
vi.mock('@/lib/supabase', () => ({ userClient: mocks.userClient }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('../../../admin-web/node_modules/next/cache.js', () => ({ revalidatePath: mocks.revalidate }));
// Admin-local aliases are checked by the admin tsconfig, not worker's aliases.
const modulePath='../../../admin-web/app/attendance-history/actions';
const {correctStaffAttendanceAction,setAttendancePeriodAction}=await import(modulePath);
function form(){const data=new FormData();for(const [key,value] of Object.entries({attendance_id:'attendance-1',month:'2020-02',check_in:'2020-02-10T09:00',check_out:'2020-02-10T18:00',break_minutes:'0',reason:'직원 요청으로 기록 보완',action:'close'}))data.set(key,value);return data;}
beforeEach(()=>{
  vi.clearAllMocks();mocks.authorize.mockResolvedValue({facilityId:'facility-1',accessToken:'user-jwt',user:{id:'user-1'}});
  mocks.userClient.mockReturnValue({rpc:mocks.rpc});mocks.rpc.mockResolvedValue({error:null});
});
describe('근태 수정의 사용자 권한 RPC',()=>{
  it('사용자 JWT로 수정과 이력을 하나의 RPC에 전달하고 0분 휴게를 보존한다',async()=>{
    await correctStaffAttendanceAction(form());
    expect(mocks.userClient).toHaveBeenCalledWith('user-jwt');
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('correct_staff_attendance',{
      p_facility_id:'facility-1',p_attendance_id:'attendance-1',p_month:'2020-02-01',
      p_check_in:'2020-02-10T00:00:00.000Z',p_check_out:'2020-02-10T09:00:00.000Z',p_break_minutes:0,p_reason:'직원 요청으로 기록 보완',
    });
    expect(mocks.revalidate).toHaveBeenCalledWith('/gig-pay');
  });
  it('DB 지급 보호 메시지를 전달하고 성공 갱신을 하지 않는다',async()=>{
    mocks.rpc.mockResolvedValue({error:{code:'P0001',message:'지급에 포함된 근태는 수정할 수 없어요.'}});
    await expect(correctStaffAttendanceAction(form())).rejects.toThrow('지급에 포함');
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('빈 휴게 입력을 0분으로 간주하지 않는다',async()=>{
    const data=form();data.set('break_minutes','');
    await expect(correctStaffAttendanceAction(data)).rejects.toThrow('휴게시간');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('권한 검사 실패 시 DB를 호출하지 않는다',async()=>{
    mocks.authorize.mockRejectedValue(new Error('권한 없음'));
    await expect(correctStaffAttendanceAction(form())).rejects.toThrow('권한');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('월 마감도 같은 사용자 권한의 원자적 RPC를 사용한다',async()=>{
    await setAttendancePeriodAction(form());
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('set_attendance_period_state',{p_facility_id:'facility-1',p_month:'2020-02-01',p_action:'close',p_reason:'직원 요청으로 기록 보완'});
  });
});
