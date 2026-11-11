'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';
import { WorkforceActionForm } from '@/components/WorkforceActionForm';
import type { ClinicStaff } from '@/lib/db/clinic-workforce';
import type { StaffRow } from '@/lib/db/staff';
import type { UpcomingShiftRow } from '@/lib/db/staff';
import { AttendanceRealtime } from './AttendanceRealtime';
import { todayHeadcount } from '@/lib/today-headcount';

type Filter='all'|'working'|'waiting'|'completed'|'leave';
type Failure={
  id:string; target_type:string; action:string; authentication_method:string|null;
  distance_meters:number|null; gps_accuracy_meters:number|null; failure_reason:string|null;
  created_at:string; worker_name?:string|null;
};
type ArrivalAlert={
  shiftId:string|null;staffId:string|null;personName:string;employment:'shift'|'staff';
  replacementEligible:boolean;shiftDate:string;startTime:string;department:string|null;
};
type Person =
  | {kind:'staff';key:string;name:string;subtitle:string;employment:string;status:string;checkInAt:string|null;checkOutAt:string|null;method:string|null;distance:number|null;staff:ClinicStaff}
  | {kind:'shift';key:string;name:string;subtitle:string;employment:string;status:string;checkInAt:string|null;checkOutAt:string|null;method:string|null;distance:number|null;shift:StaffRow};

const STATUS:Record<string,{label:string;style:string}>={
  scheduled:{label:'출근 예정',style:'bg-primary/10 text-primary'},
  working:{label:'근무 중',style:'bg-success/15 text-success'},
  checkout_pending:{label:'승인 대기',style:'bg-warn/15 text-warn'},
  completed:{label:'퇴근 완료',style:'bg-bg text-sub'},
  late:{label:'지각',style:'bg-warn/15 text-warn'},
  absent:{label:'결근',style:'bg-red-50 text-red-600'},
  leave:{label:'휴가',style:'bg-purple-50 text-purple-600'},
  off:{label:'근무 없음',style:'bg-bg text-sub'},
};
const AUTH:Record<string,string>={GPS:'위치 인증',GPS_QR:'위치 + 동적 QR',QR:'동적 QR',QR_FALLBACK:'QR 보완 인증',WORKPLACE_NET:'사업장 네트워크',ADMIN:'관리자 처리',qr:'기존 QR',button:'원터치'};
const FAIL:Record<string,string>={OUT_OF_RANGE:'사업장 반경 밖',GPS_ERROR:'위치 확인 실패',GPS_ACCURACY_LOW:'GPS 정확도 낮음',QR_EXPIRED:'QR 만료',QR_INVALID:'QR 무효',HOSPITAL_MISMATCH:'사업장 정보 불일치',TIME_NOT_ALLOWED:'인증 가능시간 아님',DUPLICATE_ATTENDANCE:'중복 요청',NOT_ASSIGNED:'배정 정보 없음',NOT_SCHEDULED:'오늘 근무 일정 없음',INVALID_STATE:'처리 순서 오류',ADMIN_REQUIRED:'관리자 승인 필요'};
const ENGAGEMENT:Record<string,string>={regular:'상시 직원',fixed_term:'기간제',temporary:'임시 계약',daily:'단기 근무'};
const fmt=(iso:string|null|undefined)=>iso?new Date(iso).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Seoul'}):'—';

// 지각은 이미 출근한 사람 — '확인 필요'에 가두지 않고 근무 중 목록에서 뱃지로 보여준다(수동 처리 버튼도 거기 있음)
const isIssue=(status:string)=>['absent','checkout_pending'].includes(status);
// 숫자 칸 하나에 한 묶음: 근무 중(지각·퇴근 승인 대기 포함) · 미출근(출근 예정·결근) · 퇴근 · 휴가
function bucket(status:string):Filter{
  if(['working','late','checkout_pending'].includes(status))return 'working';
  if(['scheduled','absent'].includes(status))return 'waiting';
  if(status==='completed')return 'completed';
  if(status==='leave')return 'leave';
  return 'all';
}

export function AttendanceDashboard({staff,matched,upcoming,failures,arrivalAlerts,facilityId,summaryHref,isGigworker=false}:{staff:ClinicStaff[];matched:StaffRow[];upcoming:UpcomingShiftRow[];failures:Failure[];arrivalAlerts:ArrivalAlert[];facilityId:string|null;summaryHref:string;isGigworker?:boolean}){
  const [filter,setFilter]=useState<Filter>('all');
  // 승인·반려가 끝난 조기 퇴근은 새로고침 결과를 기다리지 않고 바로 바꿔 보여 준다 — 처리 뒤에도 카드가 버튼째 남았다(2026-11-05 QA).
  // 같은 사람이 다시 요청하면 요청 시각이 달라 다시 보인다
  const [decided,setDecided]=useState<Record<string,'completed'|'working'>>({});
  const [decidedNotice,setDecidedNotice]=useState('');
  const decisionKey=(p:Person)=>`${p.key}:${(p.kind==='staff'?p.staff.checkoutRequestedAt:p.shift.checkoutRequestedAt)??''}`;
  const decide=(p:Person,next:'completed'|'working')=>()=>{setDecided(current=>({...current,[decisionKey(p)]:next}));setDecidedNotice(`${p.name}님 ${next==='completed'?'퇴근을 승인했어요.':'조기 퇴근 요청을 반려했어요.'}`);};
  const rawPeople=useMemo<Person[]>(()=>[
    ...staff.filter((s)=>s.scheduledToday||s.attendanceStatus!=='off').map((s):Person=>({kind:'staff',key:`staff-${s.id}`,name:s.name,subtitle:`${s.department??s.role??'업무 미지정'} · ${s.defaultStart.slice(0,5)}~${s.defaultEnd.slice(0,5)}`,employment:s.workerKind==='gig'?'단기 근무':ENGAGEMENT[s.engagementType]??'직원',status:s.attendanceStatus,checkInAt:s.checkInAt,checkOutAt:s.checkOutAt,method:s.checkOutMethod??s.checkInMethod,distance:s.checkOutDistanceM??s.checkInDistanceM,staff:s})),
    ...matched.map((s):Person=>({kind:'shift',key:`shift-${s.shiftId}`,name:s.name,subtitle:`${s.job} · 오늘 확정 근무`,employment:'단기 근무',status:s.todayStatus==='근무중'?'working':s.todayStatus==='승인대기'?'checkout_pending':s.todayStatus==='퇴근'?'completed':s.todayStatus==='결근'?'absent':'scheduled',checkInAt:s.checkInAt??null,checkOutAt:s.checkOutAt??null,method:s.checkOutMethod??s.checkInMethod??null,distance:s.checkOutDistanceM??s.checkInDistanceM??null,shift:s})),
  ],[staff,matched,isGigworker]);
  const people=useMemo(()=>rawPeople.map(p=>{const next=p.status==='checkout_pending'?decided[decisionKey(p)]:undefined;return next?{...p,status:next}:p;}),[rawPeople,decided]);
  // 홈 '오늘 근무 N명'과 같은 함수 — 휴가 제외·확인 필요 포함·같은 사람의 여러 기록은 1명. 휴가자는 목록에서 빼지 않고 '휴가' 칩으로 따로
  const head=todayHeadcount(staff,matched);
  const leavePeople=people.filter(p=>p.status==='leave');
  const workPeople=people.filter(p=>p.status!=='leave');
  // 숫자 칸은 사람 기준 — 한 사람이 직원 근태와 단기 근무를 같이 가져도 1명으로 세어 '전체'와 합이 맞는다(근무 중 > 미출근 > 퇴근 순으로 한 칸에만)
  const personKey=(p:Person)=>p.kind==='staff'?(p.staff.workerId?`worker:${p.staff.workerId}`:`staff:${p.staff.id}`):`worker:${p.shift.id}`;
  const rank:Record<Filter,number>={working:3,waiting:2,completed:1,all:0,leave:0};
  const personBucket=new Map<string,Filter>();
  for(const p of workPeople){const next=bucket(p.status);const prev=personBucket.get(personKey(p));if(!prev||rank[next]>rank[prev])personBucket.set(personKey(p),next);}
  const countOf=(key:Filter)=>[...personBucket.values()].filter(value=>value===key).length;
  const counts={
    working:countOf('working'),
    waiting:countOf('waiting'),
    completed:countOf('completed'),
    issue:people.filter(p=>isIssue(p.status)).length+failures.length+arrivalAlerts.length,
  };
  const visible=filter==='leave'?leavePeople:filter==='all'?workPeople:workPeople.filter(p=>bucket(p.status)===filter);
  const issuePeople=people.filter(person=>isIssue(person.status));

  // 탭 셋(확인 필요·오늘 근무자·7일 일정)을 한 화면으로 폈다 — 확인할 기록이 있으면 '오늘 근무자' 숫자를 보려고 탭을 한 번 더 눌러야 했다(2026-11-10 근태 화면 정리).
  // 확인 필요는 있을 때만 맨 위 카드로, 그 아래 숫자 칸(누르면 그 상태만)과 오늘 근무자, 7일 일정은 맨 아래 접어 둔다.
  const todayCount=head.working;
  const tiles=([['all','전체',todayCount],['working','근무 중',counts.working],['waiting','미출근',counts.waiting],['completed','퇴근',counts.completed],['leave','휴가',head.onLeave]] as [Filter,string,number][]);

  return <>
    <AttendanceRealtime facilityId={facilityId}/>
    {decidedNotice&&<p role="status" className="mt-3 rounded-xl bg-success/10 px-3 py-2 text-[0.75rem] font-bold text-success">{decidedNotice}</p>}
    <div id="approvals" className="scroll-mt-32">{counts.issue>0&&<section aria-labelledby="attendance-issue-title">
      <h2 id="attendance-issue-title" className="mt-4 flex items-center gap-2 px-1 text-[0.9375rem] font-extrabold text-ink">확인 필요<span className="rounded-full bg-red-100 px-2 py-0.5 text-[0.75rem] text-red-600">{counts.issue}건</span></h2>
      <div className="mt-2 space-y-3">{arrivalAlerts.map(alert=><Card key={`arrival-${alert.shiftId??alert.staffId}`} className="border border-red-200 bg-red-50/40 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[0.75rem] font-extrabold text-red-600">시작 시간 지남 · 출근 확인 필요</p><p className="mt-1 text-body font-extrabold text-ink">{alert.personName}</p><p className="mt-1 text-[0.75rem] leading-5 text-sub">{alert.employment==='staff'?'기존 직원':'단기 근무'} · {alert.startTime.slice(0,5)} 시작{alert.department?` · ${alert.department}`:''}</p></div><span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[0.6875rem] font-extrabold text-red-600">미출근</span></div><p className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-[0.75rem] leading-5 text-sub">출근 기록이 들어오면 이 항목은 자동으로 사라져요. 연락하거나 {isGigworker?'사장님이':'관리자가'} 직접 처리한 뒤 근태를 확정해 주세요.</p></Card>)}{issuePeople.map(person=>{
        const staffRow=person.kind==='staff'?person.staff:null;const shiftRow=person.kind==='shift'?person.shift:null;const state=STATUS[person.status]??STATUS.scheduled;
        const requestedAt=staffRow?.checkoutRequestedAt??shiftRow?.checkoutRequestedAt;
        return <Card key={`issue-${person.key}`} className="border border-amber-200 p-4"><div className="flex justify-between"><div><b>{person.name}</b><p className="mt-1 text-[0.75rem] text-sub">{person.subtitle}</p>{person.status==='checkout_pending'&&<p className="mt-2 text-[0.75rem] font-bold text-warn">예정 시간 전 퇴근 요청 · {fmt(requestedAt)}</p>}</div><span className={`h-fit rounded-full px-2.5 py-1 text-[0.6875rem] font-bold ${state.style}`}>{state.label}</span></div>{staffRow?.attendanceStatus==='checkout_pending'&&<div className="mt-3 grid grid-cols-2 gap-2"><WorkforceActionForm kind="early_checkout" values={{staff_id:staffRow.id,work_date:staffRow.workDate,decision:'rejected'}} onSuccess={decide(person,'working')}><button className="h-11 w-full rounded-lg border border-line bg-white text-[0.75rem] font-bold">반려</button></WorkforceActionForm><WorkforceActionForm kind="early_checkout" values={{staff_id:staffRow.id,work_date:staffRow.workDate,decision:'approved'}} onSuccess={decide(person,'completed')}><button className="h-11 w-full rounded-lg bg-primary text-[0.75rem] font-bold text-white">퇴근 승인</button></WorkforceActionForm></div>}{shiftRow?.todayStatus==='승인대기'&&shiftRow.applicationId&&<div className="mt-3 grid grid-cols-2 gap-2"><WorkforceActionForm kind="shift_early_checkout" values={{application_id:shiftRow.applicationId,decision:'rejected'}} onSuccess={decide(person,'working')}><button className="h-11 w-full rounded-lg border border-line bg-white text-[0.75rem] font-bold">반려</button></WorkforceActionForm><WorkforceActionForm kind="shift_early_checkout" values={{application_id:shiftRow.applicationId,decision:'approved'}} onSuccess={decide(person,'completed')}><button className="h-11 w-full rounded-lg bg-primary text-[0.75rem] font-bold text-white">퇴근 승인</button></WorkforceActionForm></div>}</Card>;
      })}{failures.length>0&&<details className="rounded-2xl border border-red-100 bg-white p-4"><summary className="cursor-pointer list-none font-extrabold">인증 실패 {failures.length}건 <span className="float-right text-[0.75rem] text-sub">확인 ›</span></summary><div className="mt-3 divide-y divide-line">{failures.map(row=><div key={row.id} className="py-3"><b className="text-[0.75rem]">{row.worker_name??'근무자'} · {FAIL[row.failure_reason??'']??row.failure_reason}</b><p className="mt-1 text-[0.6875rem] text-sub">{AUTH[row.authentication_method??'']??row.authentication_method} · {fmt(row.created_at)}</p></div>)}</div></details>}</div>
    </section>}</div>

    <h2 className="mt-5 px-1 text-[0.9375rem] font-extrabold text-ink">오늘 근무자</h2>
    <div role="group" aria-label="상태별 인원 · 누르면 그 상태만 보여요" className="mt-2 grid grid-cols-5 gap-1 rounded-2xl bg-white p-1 shadow-sm">
      {tiles.map(([key,label,count])=><button key={key} type="button" onClick={()=>setFilter(key)} aria-pressed={filter===key} className={`flex min-h-[3.75rem] min-w-0 flex-col items-center justify-center rounded-xl ${filter===key?'bg-ink text-white':'text-sub active:bg-bg'}`}><b className={`text-[1.375rem] leading-7 ${filter===key?'text-white':count===0?'text-tertiary':key==='waiting'?'text-warn':key==='leave'?'text-purple-600':'text-ink'}`}>{count}</b><span className="text-[0.6875rem] font-bold">{label}</span></button>)}
    </div>

    {visible.length===0?<Card className="mt-3 py-9 text-center"><p className="font-bold">{people.length?(filter==='all'?'오늘 근무할 사람이 없어요':'해당 상태의 근무자가 없어요'):'오늘 관리할 근무자가 없어요'}</p>{filter==='all'&&leavePeople.length>0&&<p className="mt-1 text-label text-sub">휴가 {head.onLeave}명은 '휴가'에서 볼 수 있어요.</p>}{people.length===0&&<Link href="/staff" className="mt-2 inline-block text-label font-bold text-primary">직원 등록하기 →</Link>}</Card>:
      <div className="mt-3 space-y-3">{visible.map(person=>{
        const state=STATUS[person.status]??STATUS.scheduled;
        const staffRow=person.kind==='staff'?person.staff:null;
        const shiftRow=person.kind==='shift'?person.shift:null;
        return <Card key={person.key} className="p-4 shadow-card">
          <div className="flex justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><p className="font-bold">{person.name}</p><span className="rounded-md bg-bg px-1.5 py-0.5 text-[0.6875rem] font-bold text-sub">{person.employment}</span></div><p className="mt-1 truncate text-label text-sub">{person.subtitle}</p></div><span className={`h-fit shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-bold ${state.style}`}>{state.label}</span></div>
          <div className="mt-3 rounded-xl bg-bg px-3 py-2 text-label text-sub">
            <div>출근 <b className="text-ink">{fmt(person.checkInAt)}</b><span className="mx-2">→</span>퇴근 <b className="text-ink">{fmt(person.checkOutAt)}</b></div>
            {person.method&&<div className="mt-1 text-[0.6875rem]">인증 {AUTH[person.method]??person.method}{person.distance!=null?` · 사업장에서 ${person.distance}m`:''}</div>}
            {person.status==='completed'&&(isGigworker?<Link href="/gig-pay" className="mt-1 inline-flex min-h-8 items-center text-[0.6875rem] font-bold text-success">근태 확정 · 지급 관리에서 지급할 수 있어요 →</Link>:<div className="mt-1 text-[0.6875rem] font-bold text-success">근태 확정 · 급여 검토 가능</div>)}
            {staffRow&&(staffRow.lateMinutes>0||staffRow.earlyLeaveMinutes>0)&&<div className="mt-1 text-[0.6875rem] text-warn">{staffRow.lateMinutes>0?`지각 ${staffRow.lateMinutes}분`:''}{staffRow.earlyLeaveMinutes>0?` · 조퇴 ${staffRow.earlyLeaveMinutes}분`:''}</div>}
          </div>
          {/* 조기 퇴근 승인·반려 버튼은 위 '확인 필요' 카드 한 곳에만 둔다 — 같은 버튼이 두 군데 있었다 */}
          {person.status==='checkout_pending'&&<a href="#approvals" className="mt-2 flex min-h-11 items-center text-[0.75rem] font-bold text-warn">예정 시간 전 퇴근 요청 · 위 '확인 필요'에서 승인해요 ↑</a>}
          <details className="mt-3">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-end text-right text-[0.75rem] font-bold text-sub">{isGigworker?'사장님이 직접 처리':'관리자 직접 처리'} ···</summary>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {staffRow?<><WorkforceActionForm kind="attendance" values={{staff_id:staffRow.id,work_date:staffRow.workDate,event:'check_in'}}><button disabled={Boolean(staffRow.checkInAt)} className="h-10 w-full rounded-lg bg-primary text-[0.75rem] font-bold text-white disabled:opacity-30">출근</button></WorkforceActionForm><WorkforceActionForm kind="attendance" values={{staff_id:staffRow.id,work_date:staffRow.workDate,event:'check_out'}}><button disabled={!staffRow.checkInAt||Boolean(staffRow.checkOutAt)} className="h-10 w-full rounded-lg bg-ink text-[0.75rem] font-bold text-white disabled:opacity-30">퇴근</button></WorkforceActionForm><WorkforceActionForm kind="attendance" values={{staff_id:staffRow.id,work_date:staffRow.workDate,event:'absent'}}><button disabled={Boolean(staffRow.checkInAt)} className="h-10 w-full rounded-lg border border-line text-[0.75rem] font-bold disabled:opacity-30">결근</button></WorkforceActionForm></>:
              shiftRow?.applicationId&&<><WorkforceActionForm kind="shift_attendance" values={{application_id:shiftRow.applicationId,event:'check_in'}}><button disabled={Boolean(shiftRow.checkInAt)} className="col-span-1 h-10 w-full rounded-lg bg-primary text-[0.75rem] font-bold text-white disabled:opacity-30">출근</button></WorkforceActionForm><WorkforceActionForm kind="shift_attendance" values={{application_id:shiftRow.applicationId,event:'check_out'}}><button disabled={!shiftRow.checkInAt||Boolean(shiftRow.checkOutAt)} className="col-span-2 h-10 w-full rounded-lg bg-ink text-[0.75rem] font-bold text-white disabled:opacity-30">퇴근</button></WorkforceActionForm></>}
            </div>
          </details>
        </Card>;
      })}</div>}

    {!isGigworker&&upcoming.length>0&&<details className="mt-4 rounded-2xl bg-white shadow-card"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-[0.8125rem] font-extrabold [&::-webkit-details-marker]:hidden">앞으로 7일 확정된 단기 근무 {upcoming.length}건<span className="text-[0.75rem] text-sub">보기 ›</span></summary><div className="divide-y divide-line border-t border-line">{upcoming.map(row=><div key={row.id} className="flex items-center justify-between px-4 py-3"><div><b className="text-[0.8125rem]">{row.name}</b><p className="mt-0.5 text-[0.6875rem] text-sub">{row.job}</p></div><p className="text-right text-[0.75rem] font-bold text-primary">{row.shiftDate.slice(5).replace('-','/')}<span className="block text-[0.6875rem] text-sub">{row.startTime.slice(0,5)}~{row.endTime.slice(0,5)}</span></p></div>)}</div></details>}
    {/* 월 요약은 위 탭 띠('월별')에 있다 — 초대 근무(긱) 사업장은 띠가 없어 두 칸을 그대로 둔다 */}
    <section className="mt-5">{isGigworker?<div className="grid grid-cols-2 gap-2"><Link href={summaryHref} className="rounded-2xl bg-primary p-4 text-white"><b className="text-[0.875rem]">월 근태 요약</b><p className="mt-1 text-[0.6875rem] text-white/75">누적시간·지각·조퇴</p></Link><Link href="/attendance-history" className="rounded-2xl bg-white p-4 shadow-card"><b className="text-[0.875rem]">전체 근태 내역</b><p className="mt-1 text-[0.6875rem] text-sub">근무자별 기록과 수정</p></Link></div>:<Link href="/attendance-history" className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-card"><span><b className="text-[0.875rem]">전체 근태 내역</b><span className="mt-1 block text-[0.6875rem] text-sub">지난 기록을 날짜별로 찾고 고쳐요</span></span><span className="font-bold text-primary">→</span></Link>}</section>
  </>;
}
