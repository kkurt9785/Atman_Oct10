'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { runWorkforceAction, type WorkforceActionKind } from '@/lib/actions/clinic-workforce';

export function WorkforceActionForm({
  kind, values, className, children, resetOnSuccess=false, successMessage,
}:{
  kind:WorkforceActionKind;
  values?:Record<string,string>;
  className?:string;
  children:React.ReactNode;
  resetOnSuccess?:boolean;
  successMessage?:string;
}){
  const formRef=useRef<HTMLFormElement>(null);
  const router=useRouter();
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();
    setLoading(true);setError('');setMessage('');
    const data=new FormData(event.currentTarget);
    Object.entries(values??{}).forEach(([key,value])=>data.set(key,value));
    const result=await runWorkforceAction(kind,data);
    setLoading(false);
    if(!result.ok){setError(result.error??'처리하지 못했어요.');return;}
    if(resetOnSuccess)formRef.current?.reset();
    setMessage(successMessage??'처리됐어요.');
    router.refresh();
  }
  return <form ref={formRef} onSubmit={submit} className={className}>
    <fieldset disabled={loading} className="contents disabled:opacity-60">{children}</fieldset>
    {loading&&<p className="col-span-full text-[12px] font-bold text-primary mt-1">처리 중...</p>}
    {error&&<p role="alert" className="col-span-full rounded-lg bg-red-50 px-3 py-2 text-[12px] font-bold text-red-600 mt-1">{error}</p>}
    {message&&<p role="status" className="col-span-full rounded-lg bg-success/10 px-3 py-2 text-[12px] font-bold text-success mt-1">{message}</p>}
  </form>;
}
