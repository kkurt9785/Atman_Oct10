'use client';

import { useState, useTransition } from 'react';
import { runPayrollAction } from './actions';

export function PayrollActionForm({kind,action,values,label,className,needsAmount=false}:{
  kind:'marketplace'|'staff'; action:'approve'|'mark_exported'|'mark_paid';
  values:Record<string,string>; label:string; className:string; needsAmount?:boolean;
}){
  const [pending,startTransition]=useTransition();
  const [error,setError]=useState('');
  // 지급 완료는 되돌릴 수 없는 액션 — window.confirm 대신 2단계 확인(arming) 규약 적용
  const [armed,setArmed]=useState(false);
  const needsArming=action==='mark_paid';
  return <form className="mt-3" action={(data)=>{
    setError('');
    startTransition(async()=>{
      const result=await runPayrollAction(kind,data);
      if(!result.ok)setError(result.error);
      setArmed(false);
    });
  }}>
    {Object.entries(values).map(([name,value])=><input key={name} type="hidden" name={name} value={value}/>)}
    <input type="hidden" name="action" value={action}/>
    {needsAmount&&<label className="mb-2 block text-[12px] font-bold text-ink">일할계산 최종 세전액
      <input name="final_gross_amount" type="number" min="1" step="100" required placeholder="사업장이 검토한 최종 금액" className="mt-1 h-11 w-full rounded-xl border border-amber-300 bg-white px-3 text-label"/>
    </label>}
    {needsArming&&!armed
      ? <button type="button" onClick={()=>setArmed(true)} className={className}>{label}</button>
      : <button disabled={pending} className={`${className} disabled:opacity-50`}>{pending?'처리 중...':needsArming?'이체 확인했어요 · 지급 완료 확정':label}</button>}
    {needsArming&&armed&&!pending&&<button type="button" onClick={()=>setArmed(false)} className="mt-1.5 w-full text-center text-[12px] font-bold text-sub">아직이에요 (취소)</button>}
    {needsArming&&armed&&<p role="status" className="mt-1.5 text-center text-[11px] text-sub">실제 계좌이체를 확인한 뒤 확정해 주세요. 되돌릴 수 없습니다.</p>}
    {error&&<p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[12px] font-bold text-red-600">{error}</p>}
  </form>;
}
