'use client';

import { useState, useTransition } from 'react';
import { runPayrollAction } from './actions';

export function PayrollActionForm({kind,action,values,label,className,needsAmount=false}:{
  kind:'marketplace'|'staff'; action:'approve'|'mark_exported'|'mark_paid';
  values:Record<string,string>; label:string; className:string; needsAmount?:boolean;
}){
  const [pending,startTransition]=useTransition();
  const [error,setError]=useState('');
  return <form className="mt-3" action={(data)=>{
    if(action==='mark_paid'&&!window.confirm('실제 계좌이체를 확인했나요? 지급 완료 처리는 되돌릴 수 없습니다.'))return;
    setError('');
    startTransition(async()=>{
      const result=await runPayrollAction(kind,data);
      if(!result.ok)setError(result.error);
    });
  }}>
    {Object.entries(values).map(([name,value])=><input key={name} type="hidden" name={name} value={value}/>)}
    <input type="hidden" name="action" value={action}/>
    {needsAmount&&<label className="mb-2 block text-[12px] font-bold text-ink">일할계산 최종 세전액
      <input name="final_gross_amount" type="number" min="1" step="100" required placeholder="병원이 검토한 최종 금액" className="mt-1 h-11 w-full rounded-xl border border-amber-300 bg-white px-3 text-label"/>
    </label>}
    <button disabled={pending} className={`${className} disabled:opacity-50`}>{pending?'처리 중...':label}</button>
    {error&&<p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[12px] font-bold text-red-600">{error}</p>}
  </form>;
}
