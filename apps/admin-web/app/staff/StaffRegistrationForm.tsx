'use client';

import { isGigworkerFacility } from '@/lib/facility-mode';
import { useState } from 'react';
import { WorkforceActionForm } from '@/components/WorkforceActionForm';
import { ContractRangePicker } from '@/components/ContractRangePicker';
import { CopyInviteButton } from './CopyInviteButton';

const inputClass='mt-2 w-full h-12 rounded-xl border border-line bg-white px-3 text-body text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/10';
type CreatedStaff={inviteToken?:string|null};

export function StaffRegistrationForm({facilityType='clinic',initialEngagementType,workerOrigin,workerKind='staff'}:{facilityType?:string;initialEngagementType?:string;workerOrigin?:string;workerKind?:'staff'|'gig'}){
  const [engagementType,setEngagementType]=useState(initialEngagementType??'');
  const [payBasis,setPayBasis]=useState(initialEngagementType?'hourly':'monthly');
  const [scheduleMode,setScheduleMode]=useState<'single'|'range'|'repeat'>('single');
  const [singleDate,setSingleDate]=useState('');
  const [inviteUrl,setInviteUrl]=useState('');
  const needsContract=engagementType&&engagementType!=='regular';
  const isPharmacy=facilityType==='pharmacy';
  const isGigworker=isGigworkerFacility({facility_type:facilityType});
  // 긱 근무자 등록은 사업장 종류와 무관하게 간단 폼: 이름·일정·시급 → 잇기 링크. 직종·부서·계약 폼은 직원용이다.
  const useGigForm=isGigworker||workerKind==='gig';

  if(useGigForm){
    return <WorkforceActionForm kind="add_staff" successMessage="근무자와 초대 정보를 만들었어요." onSuccess={(raw)=>{
      const result=(raw??{}) as CreatedStaff;
      setInviteUrl(result.inviteToken&&workerOrigin?`${workerOrigin}/gig/join?token=${result.inviteToken}`:'');
    }} className="px-5 pb-6">
      <input type="hidden" name="role" value="other"/>
      <input type="hidden" name="worker_kind" value="gig"/>
      <input type="hidden" name="engagement_type" value={scheduleMode==='repeat'?'temporary':'daily'}/><input type="hidden" name="schedule_mode" value={scheduleMode}/>
      <section className="grid grid-cols-2 gap-x-3 gap-y-4 border-t border-line pt-5">
        <h3 className="col-span-2 text-[0.8125rem] font-extrabold text-ink">누가 근무하나요?</h3>
        <label className="col-span-2 text-label font-medium text-sub">이름<input name="name" required maxLength={80} className={inputClass} placeholder="예: 김지영"/></label>
        <label className="col-span-2 text-label font-medium text-sub">휴대전화 <span className="font-normal text-tertiary">· 선택, 서로 공개되지 않아요</span><input name="phone" inputMode="tel" className={inputClass} placeholder="몰라도 바로 초대할 수 있어요"/></label>
        <label className="col-span-2 text-label font-medium text-sub">근무 내용 <span className="font-normal text-tertiary">· 선택</span><input name="department" className={inputClass} placeholder="예: 행사 안내, 포장, 매장 보조"/></label>
      </section>

      <section className="mt-7 rounded-2xl bg-bg p-4">
        <h3 className="text-[0.8125rem] font-extrabold text-ink">언제 근무하나요?</h3>
        <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="근무 일정 방식">
          <button type="button" onClick={()=>setScheduleMode('single')} aria-pressed={scheduleMode==='single'} className={`h-11 rounded-xl text-[0.8125rem] font-extrabold ${scheduleMode==='single'?'bg-primary text-white':'border border-line bg-white text-sub'}`}>하루 근무</button>
          <button type="button" onClick={()=>setScheduleMode('range')} aria-pressed={scheduleMode==='range'} className={`h-11 rounded-xl text-[0.8125rem] font-extrabold ${scheduleMode==='range'?'bg-primary text-white':'border border-line bg-white text-sub'}`}>연속 며칠</button>
          <button type="button" onClick={()=>setScheduleMode('repeat')} aria-pressed={scheduleMode==='repeat'} className={`h-11 rounded-xl text-[0.8125rem] font-extrabold ${scheduleMode==='repeat'?'bg-primary text-white':'border border-line bg-white text-sub'}`}>요일 반복</button>
        </div>
        {scheduleMode==='single'?<div className="mt-4">
          <label className="text-label font-medium text-sub">근무 날짜<input type="date" required value={singleDate} onChange={(event)=>setSingleDate(event.target.value)} className={inputClass}/></label>
          <input type="hidden" name="contract_start" value={singleDate}/><input type="hidden" name="contract_end" value={singleDate}/>
          <p className="mt-2 text-[0.6875rem] leading-4 text-sub">선택한 날짜의 요일이 자동 적용돼요.</p>
        </div>:<>
          <ContractRangePicker label="근무 기간"/>
          {scheduleMode==='range'&&<p className="mt-2 text-sm leading-5 text-sub">선택한 기간의 모든 날에 근무해요. 예: 19~21일은 주말을 포함한 3일 근무예요.</p>}
          {scheduleMode==='repeat'&&<fieldset className="mt-4"><legend className="mb-3 text-label font-medium text-sub">반복 요일</legend><div className="grid grid-cols-7 gap-1.5">{[['1','월'],['2','화'],['3','수'],['4','목'],['5','금'],['6','토'],['7','일']].map(([value,label])=><label key={value} className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-line bg-white text-[0.75rem] font-bold has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:checked]:text-primary"><input name="work_weekdays" type="checkbox" value={value} defaultChecked={Number(value)<=5} className="sr-only"/>{label}</label>)}</div></fieldset>}
        </>}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-label font-medium text-sub">출근시간<input name="default_start_time" type="time" defaultValue="09:00" required className={inputClass}/></label>
          <label className="text-label font-medium text-sub">퇴근시간<input name="default_end_time" type="time" defaultValue="18:00" required className={inputClass}/></label>
        </div>
        <label className="mt-4 block text-label font-medium text-sub">휴게시간<select name="default_break_minutes" defaultValue="60" className={inputClass}><option value="0">없음</option><option value="30">30분</option><option value="60">1시간</option><option value="90">1시간 30분</option></select></label>
      </section>

      <details className="mt-5 rounded-2xl border border-line bg-white p-4">
        <summary className="cursor-pointer text-[0.8125rem] font-extrabold text-sub">급여 기준도 함께 기록하기 · 선택</summary>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-label font-medium text-sub">계산 방식<select name="pay_basis" className={inputClass} defaultValue=""><option value="">선택 안 함</option><option value="hourly">시급</option><option value="daily">일급</option></select></label>
          <label className="text-label font-medium text-sub">금액<input name="pay_rate" type="number" min="0" step="1" className={inputClass} placeholder="예: 15000"/></label>
        </div>
      </details>

      {inviteUrl&&<section className="mt-5 rounded-2xl border border-success/30 bg-success/5 p-4">
        <p className="text-[0.875rem] font-extrabold text-ink">등록 완료 · 근무자의 직접 수락이 필요해요</p>
        <p className="mt-1 text-[0.75rem] leading-5 text-sub">전화번호 입력 여부와 관계없이 링크나 QR을 연 근무자가 카카오 로그인 후 수락해야 사업장·워크룸에 연결돼요.</p><div className="mt-3"><CopyInviteButton url={inviteUrl} primary/></div>
      </section>}
      <button className="mt-6 h-12 w-full rounded-xl bg-ink text-white font-bold disabled:opacity-40">근무자 등록하고 일회용 초대 만들기</button>
      {isGigworker&&<p className="mt-2 text-center text-[0.6875rem] leading-4 text-sub">무료 베타는 현장별 관리 대상 3명까지예요. 초대 대기·미래 계약도 포함되며 종료 처리한 계약과 종료일이 지난 계약은 제외해요.</p>}
    </WorkforceActionForm>;
  }

  return <WorkforceActionForm kind="add_staff" resetOnSuccess successMessage="직원을 등록했어요." className="px-5 pb-6">
    <section className="grid grid-cols-2 gap-x-3 gap-y-4 border-t border-line pt-5">
      <h3 className="col-span-2 text-[0.8125rem] font-extrabold text-ink">기본 정보</h3>
      <label className="col-span-2 text-label font-medium text-sub">이름<input name="name" required maxLength={80} className={inputClass} placeholder="예: 김지영"/></label>
      <label className="text-label font-medium text-sub">{isGigworker?'업무 유형':'직종'}<select name="role" className={inputClass}>{isGigworker?<><option value="other">일반 업무</option><option value="admin">매장·사무</option><option value="coordinator">현장 운영</option></>:isPharmacy?<><option value="pharmacist">약사</option><option value="pharmacy_staff">약국 전산·사무직</option><option value="admin">관리·행정</option><option value="other">기타</option></>:<><option value="rn">간호사</option><option value="na">간호조무사</option><option value="pharmacist">약사</option><option value="coordinator">코디네이터</option><option value="admin">행정</option><option value="other">기타</option></>}</select></label>
      <label className="text-label font-medium text-sub">{isPharmacy?'담당 업무':isGigworker?'근무 내용':'부서'}<input name="department" className={inputClass} placeholder={isPharmacy?'예: 조제실, 전산·접수':isGigworker?'예: 행사 안내, 포장':'예: 외래'}/></label>
      <label className="col-span-2 text-label font-medium text-sub">연락처 <span className="font-normal text-tertiary">· 직원 계정 초대에 사용</span><input name="phone" inputMode="tel" className={inputClass} placeholder="010-0000-0000"/></label>
    </section>

    <section className="mt-7 rounded-2xl bg-bg p-4">
      <h3 className="text-[0.8125rem] font-extrabold text-ink">근무 계약</h3>
      <p className="mt-1 text-[0.75rem] leading-5 text-sub">근무 형태를 먼저 선택하면 필요한 계약기간만 보여드려요.</p>
      <label className="mt-4 block text-label font-medium text-sub">근무 형태
        <select name="engagement_type" required value={engagementType} onChange={event=>setEngagementType(event.target.value)} className={inputClass}>
          <option value="" disabled>선택해 주세요</option>
          <option value="regular">상시 직원 · 종료일 없음</option>
          <option value="fixed_term">기간제 계약</option>
          <option value="temporary">임시 계약</option>
          <option value="daily">단기 근무</option>
        </select>
      </label>
      {engagementType==='regular'&&<p className="mt-3 rounded-xl bg-white px-3 py-3 text-[0.75rem] leading-5 text-sub">상시 직원은 계약 종료일을 입력하지 않아도 돼요.</p>}
      {needsContract&&<ContractRangePicker/>}
    </section>

    <section className="mt-8 grid grid-cols-2 gap-x-3 gap-y-5 border-t border-line pt-6">
      <div className="col-span-2"><h3 className="text-[0.8125rem] font-extrabold text-ink">기본 근무시간</h3><p className="mt-1 text-[0.75rem] leading-5 text-sub">야간근무는 퇴근시간을 다음 날 시간으로 선택해 주세요.</p></div>
      <label className="text-label font-medium text-sub">기본 출근<input name="default_start_time" type="time" defaultValue="09:00" className={inputClass}/></label>
      <label className="text-label font-medium text-sub">기본 퇴근<input name="default_end_time" type="time" defaultValue="18:00" className={inputClass}/></label>
      <fieldset className="col-span-2"><legend className="text-label font-medium text-sub mb-3">기본 근무요일</legend><div className="grid grid-cols-7 gap-1.5">{[['1','월'],['2','화'],['3','수'],['4','목'],['5','금'],['6','토'],['7','일']].map(([value,label])=><label key={value} className="flex min-h-11 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-line bg-white text-[0.75rem] font-bold has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:checked]:text-primary"><input name="work_weekdays" type="checkbox" value={value} defaultChecked={Number(value)<=5} className="sr-only"/>{label}</label>)}</div></fieldset>
    </section>
    <section className="mt-8 border-t border-line pt-6">
      <h3 className="text-[0.8125rem] font-extrabold text-ink">급여 기준</h3>
      <p className="mt-1 text-[0.75rem] leading-5 text-sub">근태 기록과 연결해 급여 지급관리에서 세전 예상액을 계산해요.</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-label font-medium text-sub">계산 방식<select name="pay_basis" value={payBasis} onChange={event=>setPayBasis(event.target.value)} className={inputClass}><option value="monthly">월급</option><option value="hourly">시급</option><option value="daily">일급</option></select></label>
        <label className="text-label font-medium text-sub">{payBasis==='monthly'?'세전 월급':payBasis==='hourly'?'시급':'일급'}<input name="pay_rate" type="number" min="1" step={payBasis==='monthly'?'10000':'100'} required className={inputClass} placeholder={payBasis==='monthly'?'예: 3000000':payBasis==='hourly'?'예: 15000':'예: 150000'}/></label>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3"><label className="text-label font-medium text-sub">지급 은행<input name="bank_name" maxLength={40} className={inputClass} placeholder="예: 국민은행"/></label><label className="text-label font-medium text-sub">계좌 끝 4자리<input name="account_last4" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} className={inputClass} placeholder="1234"/></label></div>
      <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[0.6875rem] leading-5 text-amber-700">세금·4대보험·수당은 자동으로 공제하지 않아요. 최종 지급액은 사업장이 노무·세무 기준에 따라 확인해 주세요.</p>
    </section>
    <input type="hidden" name="default_break_minutes" value="60"/>
    {/* 병원·약국의 '외부 단기근로자 초대'(entry=gigworker)는 직원이 아니라 긱 근무자로 저장한다 — 지급·계좌·비공개 대화가 열린다 */}
    <input type="hidden" name="worker_kind" value={workerKind}/>
    <button className="mt-7 h-12 w-full rounded-xl bg-ink text-white font-bold disabled:opacity-40">직원 등록하기</button>
  </WorkforceActionForm>;
}
