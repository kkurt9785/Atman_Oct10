'use client';
import { useState, useTransition } from 'react';
import { correctStaffAttendanceAction, setAttendancePeriodAction } from './actions';

export function HistoryActionForm({kind,children,className=''}:{kind:'correct'|'period';children:React.ReactNode;className?:string}){
  const [pending,start]=useTransition();const [message,setMessage]=useState('');
  return <form className={className} action={form=>start(async()=>{setMessage('');try{if(kind==='correct')await correctStaffAttendanceAction(form);else await setAttendancePeriodAction(form);setMessage('저장했어요.');}catch(error){setMessage(error instanceof Error?error.message:'저장하지 못했어요.');}})}>
    {children}
    {message&&<p role="status" className={`mt-2 text-[11px] font-bold ${message==='저장했어요.'?'text-success':'text-red-600'}`}>{message}</p>}
    {pending&&<p className="mt-2 text-[11px] font-bold text-primary">처리 중...</p>}
  </form>;
}
