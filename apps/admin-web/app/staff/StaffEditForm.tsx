'use client';

import { useState } from 'react';
import { WorkforceActionForm } from '@/components/WorkforceActionForm';
import { STAFF_ROLE_LABEL } from '@/lib/constants';
import { WEEKDAY_LABELS, breakMinuteOptions, breakMinutesLabel, type WeekdayHours } from '@/lib/staff-schedule';

const inputClass='mt-1.5 h-11 w-full rounded-xl border border-line bg-white px-3 text-[0.8125rem] text-ink outline-none focus:border-primary';
const PHARMACY_ROLES=['pharmacist','pharmacy_staff','admin','other'];
const CLINIC_ROLES=['rn','na','dental_hygienist','pharmacist','coordinator','admin','other'];

export type EditableStaff={
  id:string; name:string; role:string; department:string|null; phone:string|null;
  engagementType:string; baseStart:string; baseEnd:string; workWeekdays:number[];
  weekdayHours:WeekdayHours; hireDate:string|null; defaultBreakMinutes:number;
};

// 직원 정보 수정 — 이름·직종·부서·연락처·입사일·기본 근무시간·휴게시간·근무요일·요일별 시간.
export function StaffEditForm({staff,facilityType,today}:{staff:EditableStaff;facilityType?:string;today:string}){
  const [days,setDays]=useState<number[]>(staff.workWeekdays);
  const roleKeys=facilityType==='pharmacy'?PHARMACY_ROLES:CLINIC_ROLES;
  // 지금 저장된 직종이 목록에 없으면(예: 요양보호사) 그대로 고를 수 있게 남긴다
  const roles=roleKeys.includes(staff.role)?roleKeys:[staff.role,...roleKeys];
  const hasCustomHours=Object.keys(staff.weekdayHours).length>0;
  const toggle=(day:number)=>setDays((current)=>current.includes(day)?current.filter((value)=>value!==day):[...current,day].sort());
  const phone=staff.phone?.startsWith('DEMO-')?'':staff.phone??'';

  return <WorkforceActionForm kind="update_staff" values={{staff_id:staff.id}} className="grid grid-cols-2 gap-x-2 gap-y-3 px-3 pb-3" successMessage="직원 정보를 저장했어요.">
    <label className="col-span-2 text-[0.75rem] font-medium text-sub">이름<input name="name" required maxLength={40} defaultValue={staff.name} className={inputClass}/></label>
    <label className="text-[0.75rem] font-medium text-sub">직종<select name="role" defaultValue={staff.role} className={inputClass}>{roles.map((key)=><option key={key} value={key}>{STAFF_ROLE_LABEL[key]??key}</option>)}</select></label>
    <label className="text-[0.75rem] font-medium text-sub">{facilityType==='pharmacy'?'담당 업무':'부서'}<input name="department" maxLength={40} defaultValue={staff.department??''} className={inputClass} placeholder={facilityType==='pharmacy'?'예: 조제실':'예: 진료실, 데스크'}/></label>
    <label className="col-span-2 text-[0.75rem] font-medium text-sub">연락처<input name="phone" inputMode="tel" defaultValue={phone} className={inputClass} placeholder="010-0000-0000"/></label>
    {staff.engagementType==='regular'&&<label className="col-span-2 text-[0.75rem] font-medium text-sub">입사일 <span className="font-normal text-tertiary">· 연차 계산 기준이에요</span><input name="contract_start" type="date" max={today} defaultValue={staff.hireDate??''} className={inputClass}/></label>}
    <label className="text-[0.75rem] font-medium text-sub">기본 출근<input name="default_start_time" type="time" required defaultValue={staff.baseStart.slice(0,5)} className={inputClass}/></label>
    <label className="text-[0.75rem] font-medium text-sub">기본 퇴근<input name="default_end_time" type="time" required defaultValue={staff.baseEnd.slice(0,5)} className={inputClass}/></label>
    <label className="col-span-2 text-[0.75rem] font-medium text-sub">휴게시간 <span className="font-normal text-tertiary">· 점심처럼 근무시간에서 빼는 시간이에요. 저장한 뒤 퇴근부터 적용돼요</span><select name="default_break_minutes" defaultValue={String(staff.defaultBreakMinutes)} className={inputClass}>{breakMinuteOptions(staff.defaultBreakMinutes).map((minutes)=><option key={minutes} value={minutes}>{breakMinutesLabel(minutes)}</option>)}</select></label>
    <fieldset className="col-span-2"><legend className="mb-1.5 text-[0.75rem] font-medium text-sub">근무요일</legend>
      <div className="grid grid-cols-7 gap-1.5">{WEEKDAY_LABELS.map((label,index)=>{const day=index+1;return <label key={day} className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-line bg-white text-[0.75rem] font-bold has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:checked]:text-primary"><input name="work_weekdays" type="checkbox" value={day} checked={days.includes(day)} onChange={()=>toggle(day)} className="sr-only"/>{label}</label>;})}</div>
    </fieldset>
    <details open={hasCustomHours} className="col-span-2 rounded-xl border border-line bg-white">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-[0.75rem] font-bold text-ink"><span>요일마다 시간이 다르면</span><span className="text-sub">{hasCustomHours?`${Object.keys(staff.weekdayHours).length}개 요일 설정됨`:'예: 토요일 9~13시'} ›</span></summary>
      <div className="px-3 pb-3">
        <p className="text-[0.6875rem] leading-4 text-sub">시간이 다른 요일만 적어 주세요. 비워 두면 기본 출근·퇴근 시간을 써요. 출퇴근 지각·조퇴 판정도 이 시간으로 해요.</p>
        {days.length===0&&<p className="mt-2 text-[0.6875rem] font-bold text-warn">근무요일을 먼저 골라 주세요.</p>}
        {days.map((day)=><div key={day} className="mt-2 grid grid-cols-[2rem_1fr_1fr] items-center gap-2">
          <span className="text-[0.75rem] font-bold text-ink">{WEEKDAY_LABELS[day-1]}</span>
          <input name={`wh_start_${day}`} type="time" aria-label={`${WEEKDAY_LABELS[day-1]}요일 출근`} defaultValue={staff.weekdayHours[String(day)]?.start??''} className="h-11 rounded-xl border border-line bg-white px-2 text-[0.8125rem]"/>
          <input name={`wh_end_${day}`} type="time" aria-label={`${WEEKDAY_LABELS[day-1]}요일 퇴근`} defaultValue={staff.weekdayHours[String(day)]?.end??''} className="h-11 rounded-xl border border-line bg-white px-2 text-[0.8125rem]"/>
        </div>)}
      </div>
    </details>
    <button className="col-span-2 h-11 rounded-xl bg-ink text-[0.8125rem] font-bold text-white">정보 저장</button>
  </WorkforceActionForm>;
}

// 퇴사 처리 — 되돌릴 수 없어서 이름을 한 번 더 적게 한다. 근태·급여·휴가 기록은 남는다.
export function StaffRetireForm({staffId,name,today}:{staffId:string;name:string;today:string}){
  const [typed,setTyped]=useState('');
  return <WorkforceActionForm kind="retire_staff" values={{staff_id:staffId}} className="grid gap-3 px-3 pb-3" successMessage="퇴사 처리했어요. 직원 목록과 출퇴근에서 빠졌어요.">
    <p className="text-[0.6875rem] leading-5 text-sub">퇴사 처리하면 직원 목록·출퇴근·워크룸에서 빠지고, 지금까지의 근태·급여·휴가 기록은 그대로 남아요. 답을 기다리는 휴가 신청은 반려로 닫혀요. 다시 일하게 되면 새로 등록해 주세요.</p>
    <label className="text-[0.75rem] font-medium text-sub">마지막 근무일<input name="last_day" type="date" max={today} defaultValue={today} required className={inputClass}/></label>
    <label className="text-[0.75rem] font-medium text-sub">확인을 위해 직원 이름 <b className="text-ink">{name}</b> 을(를) 적어 주세요<input name="confirm_name" value={typed} onChange={(event)=>setTyped(event.target.value)} autoComplete="off" className={inputClass} placeholder={name}/></label>
    <button disabled={typed.trim()!==name} className="h-11 rounded-xl border border-red-200 bg-white text-[0.8125rem] font-extrabold text-red-600 disabled:opacity-40">퇴사 처리하기</button>
  </WorkforceActionForm>;
}
