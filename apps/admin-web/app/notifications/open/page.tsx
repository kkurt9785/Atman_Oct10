'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { safeFacilityDestination } from '@/lib/notification-destination';

export default function OpenNotificationPage() {
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  const running=useRef(false);
  useEffect(()=>{
    if(running.current)return;
    running.current=true;
    async function open() {
      setError('');
      try {
        const params=new URLSearchParams(window.location.search);
        const facilityId=params.get('facility');
        if(!facilityId)throw new Error('현장 정보가 없는 알림이에요. 현장 목록에서 확인해 주세요.');
        const response=await fetch('/api/facilities',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({facilityId})});
        if(!response.ok)throw new Error(response.status===403?'이 현장의 접근 권한이 없거나 변경됐어요.':'현장을 확인하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.');
        window.location.replace(safeFacilityDestination(params.get('next')));
      } catch(error) {setError(error instanceof Error?error.message:'현장을 열지 못했어요.');running.current=false;}
    }
    void open();
  },[attempt]);
  return <main className="px-4 py-8"><h1 className="text-xl font-bold">알림의 현장으로 이동</h1>{error?<div role="alert" className="mt-4 rounded-xl bg-red-50 p-4"><p>{error}</p><button onClick={()=>setAttempt(value=>value+1)} className="mt-3 min-h-11 rounded-xl bg-primary px-4 font-bold text-white">다시 시도</button><Link href="/sites" className="ml-3 inline-flex min-h-11 items-center text-primary">현장 목록</Link></div>:<p role="status" className="mt-4">현장 권한을 확인하고 있어요. 확인되기 전에는 업무 화면을 열지 않아요.</p>}</main>;
}
