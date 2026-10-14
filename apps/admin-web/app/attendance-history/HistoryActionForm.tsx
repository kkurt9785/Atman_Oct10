'use client';
import { useRef, useState } from 'react';
import { correctStaffAttendanceAction, setAttendancePeriodAction } from './actions';

export function HistoryActionForm({kind,children,className=''}:{kind:'correct'|'period';children:React.ReactNode;className?:string}){
  const [pending,setPending]=useState(false);const [message,setMessage]=useState('');const busy=useRef(false);
  async function submit(form:FormData){
    if(busy.current)return;
    busy.current=true;setPending(true);setMessage('');
    try{if(kind==='correct')await correctStaffAttendanceAction(form);else await setAttendancePeriodAction(form);setMessage('저장했어요.');}
    catch(error){setMessage(error instanceof Error?error.message:'저장하지 못했어요.');}
    finally{busy.current=false;setPending(false);}
  }
  return <form className={className} action={submit} aria-busy={pending}>
    <fieldset disabled={pending} className="min-w-0 disabled:opacity-60">{children}</fieldset>
    {message&&<p role={message==='저장했어요.'?'status':'alert'} className={`mt-2 text-[0.6875rem] font-bold ${message==='저장했어요.'?'text-success':'text-red-600'}`}>{message}</p>}
    {pending&&<p role="status" className="mt-2 text-[0.75rem] font-bold text-primary">저장 중이에요. 잠시만 기다려 주세요.</p>}
  </form>;
}
