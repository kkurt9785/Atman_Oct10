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
// 가짜 Supabase 조회: readAllRows(id 커서 · 500건 페이지)와 limit 조회 둘 다 흉내 낸다. id 가 없는 픽스처 행엔 표 이름+순번 id 를 붙인다
function setData(data:Record<string,unknown[]>,failure='') {
  const tables=Object.fromEntries(Object.entries(data).map(([table,rows])=>[table,(rows as Record<string,unknown>[]).map((row,i)=>({id:`${table}-${String(i).padStart(6,'0')}`,...row}))]));
  mocks.client.mockReturnValue({from:(table:string)=>{
    const filters:Array<(row:Record<string,unknown>)=>boolean>=[];
    let byId=false; let cap=Infinity;
    const q:any={
      select:()=>q, gte:()=>q, lte:()=>q,
      // eq 는 픽스처에 그 열이 있을 때만 거른다(status='completed' 등). facility_id 처럼 픽스처에 없는 열은 통과
      eq:(col:string,val:unknown)=>{filters.push(row=>!(col in row)||row[col]===val);return q;},
      // 급여 화면이 '완료 외' 기록 수를 세는 조회(neq status · not check_out_at is null)
      neq:(col:string,val:unknown)=>{filters.push(row=>row[col]!==val);return q;},
      not:(col:string)=>{filters.push(row=>row[col]!=null);return q;},
      order:(col:string)=>{if(col==='id')byId=true;return q;},
      limit:(n:number)=>{cap=n;return q;},
      gt:(col:string,val:string)=>{filters.push(row=>String(row[col])>val);return q;},
      then:(resolve:(value:unknown)=>unknown,reject?:(reason:unknown)=>unknown)=>{
        let rows=(tables[table]??[]).filter(row=>filters.every(f=>f(row)));
        if(byId)rows=[...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
        return Promise.resolve({data:rows.slice(0,cap),error:failure===table?{message:'offline'}:null}).then(resolve,reject);
      },
    };
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
  it('한 달 근태가 1,000건을 넘어도 끝까지 읽어 계산한다(50명 × 20일 이상)',async()=>{
    const people=Array.from({length:60},(_,i)=>({...staff,id:`staff-${String(i).padStart(3,'0')}`,name:`직원 ${String(i).padStart(3,'0')}`}));
    const days=Array.from({length:20},(_,d)=>`2026-09-${String(d+1).padStart(2,'0')}`);
    const records=people.flatMap(p=>days.map(day=>({...attendance,staff_id:p.id,work_date:day,check_in_at:`${day}T09:00:00+09:00`,check_out_at:`${day}T18:00:00+09:00`})));
    expect(records).toHaveLength(1200);
    setData({facility_staff:people,staff_attendances:records});
    const rows=await getStaffWagePayments('2026-09');
    expect(rows).toHaveLength(60);
    expect(rows.every(row=>row.workedDays===20&&row.workedMinutes===20*480)).toBe(true);
    expect(rows[0].workerName).toBe('직원 000');
  });
  it('완료 근태에 시간 누락이 있으면 계산을 중단한다',async()=>{
    setData({facility_staff:[staff],staff_attendances:[{...attendance,check_out_at:null}]});
    await expect(getStaffWagePayments('2026-09')).rejects.toThrow('출퇴근');
  });
  it('지각 등 완료 외 기록은 급여에서 빼고 건수만 알려 준다(10/22 QA P1 #2)',async()=>{
    setData({facility_staff:[staff],staff_attendances:[attendance,{...attendance,work_date:'2026-09-04',status:'late'},{...attendance,work_date:'2026-09-05',status:'pending_approval',check_out_at:null}]});
    expect((await getStaffWagePayments('2026-09'))[0]).toMatchObject({workedMinutes:480,workedDays:1,excludedRecords:1,saved:false});
  });
  it('저장된 지급 행이 있으면 saved 로 표시한다(홈 지급 대기와 같은 기준)',async()=>{
    setData({facility_staff:[staff],staff_attendances:[attendance],staff_wage_payments:[{staff_id:'staff',status:'draft',pay_basis:'hourly',pay_rate:12000,worked_minutes:480,worked_days:1,gross_amount:96000,net_amount:96000}]});
    expect((await getStaffWagePayments('2026-09'))[0]).toMatchObject({saved:true,status:'draft',netAmount:96000});
  });
  it('현재 급여 설정을 지워도 승인 당시 기준·금액·상태를 보존한다',async()=>{
    setData({facility_staff:[{...staff,pay_basis:null,pay_rate:null}],staff_wage_payments:[{staff_id:'staff',status:'approved',pay_basis:'hourly',pay_rate:15000,worked_minutes:480,worked_days:1,gross_amount:120000,net_amount:120000}]});
    expect((await getStaffWagePayments('2026-09'))[0]).toMatchObject({payBasis:'hourly',payRate:15000,status:'approved',grossAmount:120000});
  });
  it.each(['regular','fixed_term','temporary','daily'])('기존 %s 직원도 월급·일급 급여 대상에 포함한다',async engagement=>{
    setData({facility_staff:[{...staff,engagement_type:engagement,pay_basis:engagement==='daily'?'daily':'monthly',pay_rate:engagement==='daily'?100000:3000000}],staff_attendances:[attendance]});
    expect((await getStaffWagePayments('2026-09'))[0]).toMatchObject({engagementType:engagement,grossAmount:engagement==='daily'?100000:3000000});
  });
  it('공고 급여도 1,000건을 넘으면 끝까지 읽고, 조회 실패는 빈 합계로 처리하지 않는다',async()=>{
    setData({wage_payment_instructions:Array.from({length:1100},(_,i)=>({created_at:`2026-09-01T00:${String(i%60).padStart(2,'0')}:00Z`,gross_amount:1000,net_amount:1000,status:'approved',shifts:{shift_date:'2026-09-01'}}))});
    const result=await getWagePayments('2026-09');
    expect(result.error).toBeNull();
    expect(result.rows).toHaveLength(1100);
    setData({wage_payment_instructions:[{}]},'wage_payment_instructions');
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
