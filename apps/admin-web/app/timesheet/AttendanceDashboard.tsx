'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';
import { WorkforceActionForm } from '@/components/WorkforceActionForm';
import type { ClinicStaff } from '@/lib/db/clinic-workforce';
import type { StaffRow } from '@/lib/db/staff';

type Filter='all'|'working'|'issue'|'completed';
type Failure={
  id:string; target_type:string; action:string; authentication_method:string|null;
  distance_meters:number|null; gps_accuracy_meters:number|null; failure_reason:string|null;
  created_at:string; worker_name?:string|null;
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
};
const AUTH:Record<string,string>={GPS:'위치 인증',GPS_QR:'위치 + 동적 QR',QR:'동적 QR',QR_FALLBACK:'QR 보완 인증',ADMIN:'관리자 처리',qr:'기존 QR',button:'원터치'};
const FAIL:Record<string,string>={OUT_OF_RANGE:'사업장 반경 밖',GPS_ERROR:'위치 확인 실패',GPS_ACCURACY_LOW:'GPS 정확도 낮음',QR_EXPIRED:'QR 만료',QR_INVALID:'QR 무효',HOSPITAL_MISMATCH:'사업장 정보 불일치',TIME_NOT_ALLOWED:'인증 가능시간 아님',DUPLICATE_ATTENDANCE:'중복 요청',NOT_ASSIGNED:'배정 정보 없음',INVALID_STATE:'처리 순서 오류',ADMIN_REQUIRED:'관리자 승인 필요'};
const ENGAGEMENT:Record<string,string>={regular:'상시 직원',fixed_term:'기간제',temporary:'임시 계약',daily:'단기 근무'};
const fmt=(iso:string|null|undefined)=>iso?new Date(iso).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false}):'—';

function group(status:string):Filter{
  if(status==='working')return 'working';
  if(status==='completed')return 'completed';
  if(['late','absent','checkout_pending'].includes(status))return 'issue';
  return 'all';
}

export function AttendanceDashboard({staff,matched,failures}:{staff:ClinicStaff[];matched:StaffRow[];failures:Failure[]}){
  const [filter,setFilter]=useState<Filter>('all');
  const people=useMemo<Person[]>(()=>[
    ...staff.map((s):Person=>({kind:'staff',key:`staff-${s.id}`,name:s.name,subtitle:`${s.department??s.role??'부서 미지정'} · ${s.defaultStart.slice(0,5)}~${s.defaultEnd.slice(0,5)}`,employment:ENGAGEMENT[s.engagementType]??'직원',status:s.attendanceStatus,checkInAt:s.checkInAt,checkOutAt:s.checkOutAt,method:s.checkOutMethod??s.checkInMethod,distance:s.checkOutDistanceM??s.checkInDistanceM,staff:s})),
    ...matched.map((s):Person=>({kind:'shift',key:`shift-${s.shiftId}`,name:s.name,subtitle:`${s.job} · 오늘 확정 시프트`,employment:'단기 시프트',status:s.todayStatus==='근무중'?'working':s.todayStatus==='퇴근'?'completed':s.todayStatus==='결근'?'absent':'scheduled',checkInAt:s.checkInAt??null,checkOutAt:s.checkOutAt??null,method:s.checkOutMethod??s.checkInMethod??null,distance:s.checkOutDistanceM??s.checkInDistanceM??null,shift:s})),
  ],[staff,matched]);
  const counts={
    working:people.filter(p=>p.status==='working').length,
    completed:people.filter(p=>p.status==='completed').length,
    issue:people.filter(p=>group(p.status)==='issue').length+failures.length,
  };
  const visible=filter==='all'?people:people.filter(p=>group(p.status)===filter);

  return <>
    <div className="mt-4 grid grid-cols-3 gap-2">
      {([['working','근무 중',counts.working,'text-success'],['completed','퇴근 완료',counts.completed,'text-ink'],['issue','확인 필요',counts.issue,'text-red-600']] as const).map(([key,label,value,color])=>
        <button key={key} onClick={()=>setFilter(filter===key?'all':key)} className={`rounded-2xl border p-3 text-left transition ${filter===key?'border-primary bg-primary/5':'border-transparent bg-white shadow-card'}`}>
          <p className="text-[11px] text-sub">{label}</p><p className={`mt-1 text-title font-extrabold ${color}`}>{value}{key==='issue'?'건':'명'}</p>
        </button>)}
    </div>

    {counts.issue>0&&<section className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[13px] font-extrabold text-amber-900">먼저 확인할 기록이 {counts.issue}건 있어요</p><p className="mt-1 text-[12px] text-amber-800">조기 퇴근 승인과 인증 실패를 처리하면 급여 검토가 정확해져요.</p></div><button onClick={()=>setFilter('issue')} className="shrink-0 text-[12px] font-extrabold text-primary">모아보기</button></div>
    </section>}

    <div className="mt-6 flex items-end justify-between gap-3 px-1">
      <div><p className="text-[12px] font-bold text-primary">통합 인력</p><h2 className="text-title font-extrabold">오늘 근무자</h2></div>
      <div className="flex gap-1 rounded-xl bg-white p-1 shadow-sm">
        {([['all','전체'],['working','근무 중'],['issue','확인'],['completed','퇴근']] as const).map(([key,label])=><button key={key} onClick={()=>setFilter(key)} className={`h-10 rounded-lg px-2.5 text-[11px] font-bold ${filter===key?'bg-ink text-white':'text-sub'}`}>{label}</button>)}
      </div>
    </div>

    {visible.length===0?<Card className="mt-3 py-9 text-center"><p className="font-bold">{people.length?'해당 상태의 근무자가 없어요':'오늘 관리할 근무자가 없어요'}</p>{people.length===0&&<Link href="/staff" className="mt-2 inline-block text-label font-bold text-primary">직원 등록하기 →</Link>}</Card>:
      <div className="mt-3 space-y-3">{visible.map(person=>{
        const state=STATUS[person.status]??STATUS.scheduled;
        const staffRow=person.kind==='staff'?person.staff:null;
        const shiftRow=person.kind==='shift'?person.shift:null;
        return <Card key={person.key} className="p-4 shadow-card">
          <div className="flex justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><p className="font-bold">{person.name}</p><span className="rounded-md bg-bg px-1.5 py-0.5 text-[10px] font-bold text-sub">{person.employment}</span></div><p className="mt-1 truncate text-label text-sub">{person.subtitle}</p></div><span className={`h-fit shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${state.style}`}>{state.label}</span></div>
          <div className="mt-3 rounded-xl bg-bg px-3 py-2 text-label text-sub">
            <div>출근 <b className="text-ink">{fmt(person.checkInAt)}</b><span className="mx-2">→</span>퇴근 <b className="text-ink">{fmt(person.checkOutAt)}</b></div>
            {person.method&&<div className="mt-1 text-[11px]">인증 {AUTH[person.method]??person.method}{person.distance!=null?` · 사업장에서 ${person.distance}m`:''}</div>}
            {person.status==='completed'&&<div className="mt-1 text-[11px] font-bold text-success">근태 확정 · 급여 검토 가능</div>}
            {staffRow&&(staffRow.lateMinutes>0||staffRow.earlyLeaveMinutes>0)&&<div className="mt-1 text-[11px] text-warn">{staffRow.lateMinutes>0?`지각 ${staffRow.lateMinutes}분`:''}{staffRow.earlyLeaveMinutes>0?` · 조퇴 ${staffRow.earlyLeaveMinutes}분`:''}</div>}
          </div>
          {staffRow?.attendanceStatus==='checkout_pending'&&<div className="mt-3 rounded-xl border border-warn/30 bg-warn/5 p-3"><p className="text-[12px] font-bold text-warn">예정 시간 전 퇴근 요청 · {fmt(staffRow.checkoutRequestedAt)}</p><div className="mt-2 grid grid-cols-2 gap-2"><WorkforceActionForm kind="early_checkout" values={{staff_id:staffRow.id,work_date:staffRow.workDate,decision:'rejected'}}><button className="h-9 w-full rounded-lg border border-line bg-white text-[12px] font-bold">반려</button></WorkforceActionForm><WorkforceActionForm kind="early_checkout" values={{staff_id:staffRow.id,work_date:staffRow.workDate,decision:'approved'}}><button className="h-9 w-full rounded-lg bg-primary text-[12px] font-bold text-white">퇴근 승인</button></WorkforceActionForm></div></div>}
          <details className="mt-3">
            <summary className="cursor-pointer list-none text-right text-[12px] font-bold text-sub">관리자 직접 처리 ···</summary>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {staffRow?<><WorkforceActionForm kind="attendance" values={{staff_id:staffRow.id,work_date:staffRow.workDate,event:'check_in'}}><button disabled={Boolean(staffRow.checkInAt)} className="h-10 w-full rounded-lg bg-primary text-[12px] font-bold text-white disabled:opacity-30">출근</button></WorkforceActionForm><WorkforceActionForm kind="attendance" values={{staff_id:staffRow.id,work_date:staffRow.workDate,event:'check_out'}}><button disabled={!staffRow.checkInAt||Boolean(staffRow.checkOutAt)} className="h-10 w-full rounded-lg bg-ink text-[12px] font-bold text-white disabled:opacity-30">퇴근</button></WorkforceActionForm><WorkforceActionForm kind="attendance" values={{staff_id:staffRow.id,work_date:staffRow.workDate,event:'absent'}}><button disabled={Boolean(staffRow.checkInAt)} className="h-10 w-full rounded-lg border border-line text-[12px] font-bold disabled:opacity-30">결근</button></WorkforceActionForm></>:
              shiftRow?.applicationId&&<><WorkforceActionForm kind="shift_attendance" values={{application_id:shiftRow.applicationId,event:'check_in'}}><button disabled={Boolean(shiftRow.checkInAt)} className="col-span-1 h-10 w-full rounded-lg bg-primary text-[12px] font-bold text-white disabled:opacity-30">출근</button></WorkforceActionForm><WorkforceActionForm kind="shift_attendance" values={{application_id:shiftRow.applicationId,event:'check_out'}}><button disabled={!shiftRow.checkInAt||Boolean(shiftRow.checkOutAt)} className="col-span-2 h-10 w-full rounded-lg bg-ink text-[12px] font-bold text-white disabled:opacity-30">퇴근</button></WorkforceActionForm></>}
            </div>
          </details>
        </Card>;
      })}</div>}

    {failures.length>0&&<details className="mt-5 rounded-2xl border border-line bg-white p-4">
      <summary className="cursor-pointer list-none font-extrabold">인증 실패 기록 <span className="text-red-600">{failures.length}건</span><span className="float-right text-[12px] text-sub">자세히</span></summary>
      <div className="mt-3 divide-y divide-line">{failures.map(row=><div key={row.id} className="py-3"><div className="flex justify-between gap-2"><b className="text-[13px]">{row.worker_name??(row.target_type==='staff'?'직원':'단기인력')} · {row.action==='check_in'?'출근':'퇴근'}</b><span className="text-[11px] font-bold text-red-600">{FAIL[row.failure_reason??'']??row.failure_reason}</span></div><p className="mt-1 text-[11px] text-sub">{AUTH[row.authentication_method??'']??row.authentication_method}{row.distance_meters!=null?` · 거리 ${row.distance_meters}m`:''}{row.gps_accuracy_meters!=null?` · 오차 ±${row.gps_accuracy_meters}m`:''} · {fmt(row.created_at)}</p></div>)}</div>
    </details>}
  </>;
}
