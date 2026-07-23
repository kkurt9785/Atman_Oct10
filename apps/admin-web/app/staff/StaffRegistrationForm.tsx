'use client';

import { useState } from 'react';
import { WorkforceActionForm } from '@/components/WorkforceActionForm';

const inputClass='mt-2 w-full h-12 rounded-xl border border-line bg-white px-3 text-body text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/10';

export function StaffRegistrationForm(){
  const [engagementType,setEngagementType]=useState('');
  const needsContract=engagementType&&engagementType!=='regular';

  return <WorkforceActionForm kind="add_staff" resetOnSuccess successMessage="직원을 등록했어요." className="px-5 pb-6">
    <section className="grid grid-cols-2 gap-x-3 gap-y-4 border-t border-line pt-5">
      <h3 className="col-span-2 text-[13px] font-extrabold text-ink">기본 정보</h3>
      <label className="col-span-2 text-label font-medium text-sub">이름<input name="name" required maxLength={80} className={inputClass} placeholder="예: 김지영"/></label>
      <label className="text-label font-medium text-sub">직종<select name="role" className={inputClass}><option value="rn">간호사</option><option value="na">간호조무사</option><option value="coordinator">코디네이터</option><option value="admin">행정</option><option value="other">기타</option></select></label>
      <label className="text-label font-medium text-sub">부서<input name="department" className={inputClass} placeholder="예: 외래"/></label>
      <label className="col-span-2 text-label font-medium text-sub">연락처 <span className="font-normal text-tertiary">· 직원 계정 초대에 사용</span><input name="phone" inputMode="tel" className={inputClass} placeholder="010-0000-0000"/></label>
    </section>

    <section className="mt-7 rounded-2xl bg-bg p-4">
      <h3 className="text-[13px] font-extrabold text-ink">근무 계약</h3>
      <p className="mt-1 text-[12px] leading-5 text-sub">근무 형태를 먼저 선택하면 필요한 계약기간만 보여드려요.</p>
      <label className="mt-4 block text-label font-medium text-sub">근무 형태
        <select name="engagement_type" required value={engagementType} onChange={event=>setEngagementType(event.target.value)} className={inputClass}>
          <option value="" disabled>선택해 주세요</option>
          <option value="regular">상시 직원 · 종료일 없음</option>
          <option value="fixed_term">기간제 계약</option>
          <option value="temporary">임시 계약</option>
          <option value="daily">단기 근무</option>
        </select>
      </label>
      {engagementType==='regular'&&<p className="mt-3 rounded-xl bg-white px-3 py-3 text-[12px] leading-5 text-sub">상시 직원은 계약 종료일을 입력하지 않아도 됩니다.</p>}
      {needsContract&&<div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-label font-medium text-sub">계약 시작<input name="contract_start" required type="date" className={inputClass}/></label>
        <label className="text-label font-medium text-sub">계약 종료<input name="contract_end" required type="date" className={inputClass}/></label>
      </div>}
    </section>

    <section className="mt-8 grid grid-cols-2 gap-x-3 gap-y-5 border-t border-line pt-6">
      <div className="col-span-2"><h3 className="text-[13px] font-extrabold text-ink">기본 근무시간</h3><p className="mt-1 text-[12px] leading-5 text-sub">야간근무는 퇴근시간을 다음 날 시간으로 선택해 주세요.</p></div>
      <label className="text-label font-medium text-sub">기본 출근<input name="default_start_time" type="time" defaultValue="09:00" className={inputClass}/></label>
      <label className="text-label font-medium text-sub">기본 퇴근<input name="default_end_time" type="time" defaultValue="18:00" className={inputClass}/></label>
      <fieldset className="col-span-2"><legend className="text-label font-medium text-sub mb-3">기본 근무요일</legend><div className="grid grid-cols-7 gap-1.5">{[['1','월'],['2','화'],['3','수'],['4','목'],['5','금'],['6','토'],['7','일']].map(([value,label])=><label key={value} className="flex min-h-11 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-line bg-white text-[12px] font-bold has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:checked]:text-primary"><input name="work_weekdays" type="checkbox" value={value} defaultChecked={Number(value)<=5} className="sr-only"/>{label}</label>)}</div></fieldset>
    </section>
    <input type="hidden" name="default_break_minutes" value="60"/>
    <button className="mt-7 h-12 w-full rounded-xl bg-ink text-white font-bold disabled:opacity-40">직원 등록하기</button>
  </WorkforceActionForm>;
}
