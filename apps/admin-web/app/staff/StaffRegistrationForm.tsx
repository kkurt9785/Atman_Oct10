'use client';

import { useState } from 'react';
import { WorkforceActionForm } from '@/components/WorkforceActionForm';

const inputClass='mt-2 w-full h-12 rounded-xl border border-line bg-white px-3 text-body text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/10';
const toDateKey=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const formatDate=(value:string)=>value?`${Number(value.slice(5,7))}월 ${Number(value.slice(8,10))}일`:'';

function ContractRangePicker(){
  const today=new Date();
  const [open,setOpen]=useState(false);
  const [month,setMonth]=useState(new Date(today.getFullYear(),today.getMonth(),1));
  const [start,setStart]=useState('');
  const [end,setEnd]=useState('');
  const firstDay=new Date(month.getFullYear(),month.getMonth(),1);
  const gridStart=new Date(month.getFullYear(),month.getMonth(),1-firstDay.getDay());
  const days=Array.from({length:42},(_,index)=>new Date(gridStart.getFullYear(),gridStart.getMonth(),gridStart.getDate()+index));

  function selectDate(value:string){
    if(!start||end||value<start){setStart(value);setEnd('');return;}
    setEnd(value);
  }

  return <div className="mt-4">
    <label className="text-label font-medium text-sub">계약기간</label>
    <input type="hidden" name="contract_start" value={start}/>
    <input type="hidden" name="contract_end" value={end}/>
    <button type="button" onClick={()=>setOpen(value=>!value)} className={`mt-2 flex min-h-14 w-full items-center justify-between rounded-xl border bg-white px-4 text-left ${open?'border-primary ring-2 ring-primary/10':'border-line'}`}>
      <span><span className={`block text-[14px] font-bold ${start?'text-ink':'text-tertiary'}`}>{start?(end?`${formatDate(start)}  →  ${formatDate(end)}`:`${formatDate(start)}  →  종료일 선택`):'시작일과 종료일을 선택해 주세요'}</span>{start&&end&&<span className="mt-0.5 block text-[11px] text-sub">{start} ~ {end}</span>}</span>
      <span aria-hidden className="text-[18px]">▣</span>
    </button>
    {open&&<div className="mt-3 rounded-2xl border border-line bg-white p-4 shadow-card">
      <div className="flex items-center justify-between">
        <button type="button" aria-label="이전 달" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))} className="h-10 w-10 rounded-full text-[20px] active:bg-bg">‹</button>
        <b className="text-[15px]">{month.getFullYear()}년 {month.getMonth()+1}월</b>
        <button type="button" aria-label="다음 달" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))} className="h-10 w-10 rounded-full text-[20px] active:bg-bg">›</button>
      </div>
      <p className="mt-2 rounded-xl bg-primary/5 px-3 py-2 text-center text-[12px] font-bold text-primary">{!start?'계약 시작일을 선택하세요':!end?'이제 계약 종료일을 선택하세요':'계약기간 선택 완료'}</p>
      <div className="mt-3 grid grid-cols-7 text-center text-[11px] font-bold text-sub">{['일','월','화','수','목','금','토'].map(day=><span key={day} className="py-2">{day}</span>)}</div>
      <div className="grid grid-cols-7">{days.map(date=>{const key=toDateKey(date);const current=date.getMonth()===month.getMonth();const selected=key===start||key===end;const between=start&&end&&key>start&&key<end;return <button type="button" key={key} onClick={()=>selectDate(key)} className={`h-11 text-[13px] font-semibold ${!current?'text-tertiary/40':'text-ink'} ${between?'bg-primary/5 text-primary':''} ${selected?'rounded-xl bg-primary text-white':''}`}>{date.getDate()}</button>;})}</div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={()=>{setStart('');setEnd('');}} className="h-11 rounded-xl bg-bg text-[13px] font-bold text-sub">다시 선택</button>
        <button type="button" disabled={!start||!end} onClick={()=>setOpen(false)} className="h-11 rounded-xl bg-ink text-[13px] font-bold text-white disabled:opacity-30">기간 적용</button>
      </div>
    </div>}
  </div>;
}

export function StaffRegistrationForm(){
  const [engagementType,setEngagementType]=useState('');
  const [payBasis,setPayBasis]=useState('monthly');
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
      {needsContract&&<ContractRangePicker/>}
    </section>

    <section className="mt-8 grid grid-cols-2 gap-x-3 gap-y-5 border-t border-line pt-6">
      <div className="col-span-2"><h3 className="text-[13px] font-extrabold text-ink">기본 근무시간</h3><p className="mt-1 text-[12px] leading-5 text-sub">야간근무는 퇴근시간을 다음 날 시간으로 선택해 주세요.</p></div>
      <label className="text-label font-medium text-sub">기본 출근<input name="default_start_time" type="time" defaultValue="09:00" className={inputClass}/></label>
      <label className="text-label font-medium text-sub">기본 퇴근<input name="default_end_time" type="time" defaultValue="18:00" className={inputClass}/></label>
      <fieldset className="col-span-2"><legend className="text-label font-medium text-sub mb-3">기본 근무요일</legend><div className="grid grid-cols-7 gap-1.5">{[['1','월'],['2','화'],['3','수'],['4','목'],['5','금'],['6','토'],['7','일']].map(([value,label])=><label key={value} className="flex min-h-11 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-line bg-white text-[12px] font-bold has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:checked]:text-primary"><input name="work_weekdays" type="checkbox" value={value} defaultChecked={Number(value)<=5} className="sr-only"/>{label}</label>)}</div></fieldset>
    </section>
    <section className="mt-8 border-t border-line pt-6">
      <h3 className="text-[13px] font-extrabold text-ink">급여 기준</h3>
      <p className="mt-1 text-[12px] leading-5 text-sub">근태 기록과 연결해 급여 지급관리에서 세전 예상액을 계산합니다.</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-label font-medium text-sub">계산 방식<select name="pay_basis" value={payBasis} onChange={event=>setPayBasis(event.target.value)} className={inputClass}><option value="monthly">월급</option><option value="hourly">시급</option><option value="daily">일급</option></select></label>
        <label className="text-label font-medium text-sub">{payBasis==='monthly'?'세전 월급':payBasis==='hourly'?'시급':'일급'}<input name="pay_rate" type="number" min="1" step={payBasis==='monthly'?'10000':'100'} required className={inputClass} placeholder={payBasis==='monthly'?'예: 3000000':payBasis==='hourly'?'예: 15000':'예: 150000'}/></label>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3"><label className="text-label font-medium text-sub">지급 은행<input name="bank_name" maxLength={40} className={inputClass} placeholder="예: 국민은행"/></label><label className="text-label font-medium text-sub">계좌 끝 4자리<input name="account_last4" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} className={inputClass} placeholder="1234"/></label></div>
      <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-700">세금·4대보험·수당은 자동 공제하지 않습니다. 최종 지급액은 병원이 노무·세무 기준에 따라 확인해 주세요.</p>
    </section>
    <input type="hidden" name="default_break_minutes" value="60"/>
    <button className="mt-7 h-12 w-full rounded-xl bg-ink text-white font-bold disabled:opacity-40">직원 등록하기</button>
  </WorkforceActionForm>;
}
