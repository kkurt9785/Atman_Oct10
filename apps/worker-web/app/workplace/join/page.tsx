'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

function JoinWorkplaceContent(){
  const params=useSearchParams();
  const token=params.get('token');
  const [status,setStatus]=useState<'loading'|'success'|'error'>('loading');
  const [message,setMessage]=useState('직원 초대를 확인하고 있어요...');

  useEffect(()=>{void (async()=>{
    if(!token){setStatus('error');setMessage('초대 링크가 올바르지 않아요. 병원에 새 링크를 요청해 주세요.');return;}
    const {data:{user}}=await supabase.auth.getUser();
    if(!user){
      const next=`/workplace/join?token=${encodeURIComponent(token)}`;
      window.localStorage.setItem('atman_auth_next',next);
      window.location.href='/onboarding';
      return;
    }
    const {error}=await supabase.rpc('claim_facility_staff_invite',{p_token:token});
    if(error){
      setStatus('error');
      setMessage(error.message.replace(/^.*?: /,''));
      return;
    }
    setStatus('success');
    setMessage('병원 직원 계정 연결이 완료됐어요.');
  })();},[token]);

  return <main className="min-h-screen bg-bg px-5 pt-16 pb-24">
    <section className="mx-auto max-w-md rounded-3xl bg-white p-6 text-center shadow-sm">
      <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full text-2xl ${status==='success'?'bg-emerald-50 text-emerald-600':status==='error'?'bg-red-50 text-red-600':'bg-primary/10 text-primary'}`}>{status==='success'?'✓':status==='error'?'!':'…'}</div>
      <p className="mt-5 text-[13px] font-bold text-primary">직원 계정 연결</p>
      <h1 className="mt-1 text-[24px] font-extrabold">내 직장 초대</h1>
      <p role="status" className="mt-3 text-[14px] leading-6 text-sub">{message}</p>
      {status==='success'&&<Link href="/workplace" className="mt-6 flex h-12 items-center justify-center rounded-xl bg-primary font-bold text-white">출퇴근·휴가 관리 시작하기</Link>}
      {status==='error'&&<p className="mt-5 rounded-xl bg-bg p-3 text-[12px] leading-5 text-sub">로그인한 계정의 연락처가 병원에 등록된 직원 연락처와 같아야 합니다.</p>}
    </section>
  </main>;
}

export default function JoinWorkplacePage(){
  return <Suspense fallback={<main className="min-h-screen bg-bg p-8 text-center text-sub">초대를 확인하고 있어요...</main>}><JoinWorkplaceContent/></Suspense>;
}
