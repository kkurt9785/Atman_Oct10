import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({client:vi.fn(),rpc:vi.fn(),context:vi.fn(),revalidate:vi.fn()}));
vi.mock('../../../admin-web/lib/supabase',()=>({adminClient:mocks.client,userClient:()=>({rpc:mocks.rpc})}));
vi.mock('../../../admin-web/lib/facility',()=>({getCurrentFacilityId:async()=>'facility'}));
vi.mock('../../../admin-web/lib/admin-auth',()=>({requireAdminContext:mocks.context}));
vi.mock('@/lib/admin-auth',()=>({requireAdminContext:mocks.context}));
vi.mock('@/lib/supabase',()=>({adminClient:mocks.client,userClient:()=>({rpc:mocks.rpc})}));
vi.mock('next/cache',()=>({revalidatePath:mocks.revalidate}));
vi.mock('../../../admin-web/node_modules/next/cache.js',()=>({revalidatePath:mocks.revalidate}));
import {getStaffWagePayments,getWagePayments} from '../../../admin-web/lib/db/payroll';
// Keep admin-local aliases under the admin tsconfig (checked by its build).
const actionModule='../../../admin-web/app/payroll/actions';
const {updateStaffPaymentStatus}=await import(actionModule);

const staff={id:'staff',name:'검증 직원',engagement_type:'regular',pay_basis:'hourly',pay_rate:12000,contract_start:null,contract_end:null,bank_name:'검증',account_last4:'1234'};
const attendance={staff_id:'staff',work_date:'2026-09-03',status:'completed',check_in_at:'2026-09-03T09:00:00+09:00',check_out_at:'2026-09-03T18:00:00+09:00',break_minutes:60};
function setData(data:Record<string,unknown[]>,failure='') {
  mocks.client.mockReturnValue({from:(table:string)=>{
    const q:Record<string,unknown>={};
    for(const method of ['select','eq','gte','lte','order'])q[method]=()=>q;
    q.limit=async()=>({data:data[table]??[],error:failure===table?{message:'offline'}:null});
    return q;
  }});
}
beforeEach(()=>{vi.clearAllMocks();setData({facility_staff:[staff],staff_attendances:[attendance]});mocks.context.mockResolvedValue({canViewPayroll:true,facilityId:'facility',accessToken:'qa-token',user:{id:'admin'}});mocks.rpc.mockResolvedValue({error:null});});
describe('월 급여 집계 및 상태 전환 무결성',()=>{
  it('기록된 휴게만 차감하고 근무일은 중복 없이 센다',async()=>{
    setData({facility_staff:[staff],staff_attendances:[attendance,{...attendance,check_in_at:'2026-09-03T19:00:00+09:00',check_out_at:'2026-09-03T20:00:00+09:00',break_minutes:0}]});
    expect((await getStaffWagePayments('2026-09'))[0]).toMatchObject({workedMinutes:540,workedDays:1,grossAmount:108000});
  });
  it.each(['facility_staff','staff_attendances','staff_wage_payments'])('%s 조회 실패는 빈 급여가 아니다',async table=>{
    setData({facility_staff:[staff],staff_attendances:[attendance]},table);
    await expect(getStaffWagePayments('2026-09')).rejects.toThrow('계산을 중단');
  });
  it('조회 상한에 닿으면 일부 집계로 지급하지 않는다',async()=>{
    setData({facility_staff:[staff],staff_attendances:Array(1000).fill(attendance)});
    await expect(getStaffWagePayments('2026-09')).rejects.toThrow('계산을 중단');
  });
  it('완료 근태에 시간 누락이 있으면 계산을 중단한다',async()=>{
    setData({facility_staff:[staff],staff_attendances:[{...attendance,check_out_at:null}]});
    await expect(getStaffWagePayments('2026-09')).rejects.toThrow('출퇴근');
  });
  it('현재 급여 설정을 지워도 승인 당시 기준·금액·상태를 보존한다',async()=>{
    setData({facility_staff:[{...staff,pay_basis:null,pay_rate:null}],staff_wage_payments:[{staff_id:'staff',status:'approved',pay_basis:'hourly',pay_rate:15000,worked_minutes:480,worked_days:1,gross_amount:120000,net_amount:120000}]});
    expect((await getStaffWagePayments('2026-09'))[0]).toMatchObject({payBasis:'hourly',payRate:15000,status:'approved',grossAmount:120000});
  });
  it.each(['regular','fixed_term','temporary','daily'])('기존 %s 직원도 월급·일급 급여 대상에 포함한다',async engagement=>{
    setData({facility_staff:[{...staff,engagement_type:engagement,pay_basis:engagement==='daily'?'daily':'monthly',pay_rate:engagement==='daily'?100000:3000000}],staff_attendances:[attendance]});
    expect((await getStaffWagePayments('2026-09'))[0]).toMatchObject({engagementType:engagement,grossAmount:engagement==='daily'?100000:3000000});
  });
  it('공고 급여도 조회 상한을 완전한 합계로 반환하지 않는다',async()=>{
    setData({wage_payment_instructions:Array(1000).fill({})});
    expect(await getWagePayments('2026-09')).toMatchObject({rows:[],error:expect.any(String)});
  });
  it('상태 전환은 현재 사용자 토큰의 단일 RPC로만 요청한다',async()=>{
    const form=new FormData();form.set('staff_id','staff');form.set('period_month','2026-09-01');form.set('action','mark_paid');
    await updateStaffPaymentStatus(form);
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith('transition_staff_wage_payment',{p_facility_id:'facility',p_staff_id:'staff',p_month:'2026-09-01',p_action:'mark_paid',p_final_gross:null});
  });
  it('DB가 순서 위반을 거부하면 성공 처리하지 않는다',async()=>{
    mocks.rpc.mockResolvedValue({error:{message:'현재 급여 상태에서는 처리할 수 없어요.'}});
    const form=new FormData();form.set('staff_id','staff');form.set('period_month','2026-09-01');form.set('action','mark_paid');
    await expect(updateStaffPaymentStatus(form)).rejects.toThrow('현재 급여 상태');
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('급여 열람 권한이 없으면 DB 호출 전 거부한다',async()=>{
    mocks.context.mockResolvedValue({canViewPayroll:false});
    await expect(updateStaffPaymentStatus(new FormData())).rejects.toThrow('권한');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
