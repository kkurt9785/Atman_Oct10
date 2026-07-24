'use client';
import { useCallback, useEffect, useState } from 'react';
import { issueDynamicAttendanceQr } from './actions';

export function DynamicQrPanel({workerOrigin}:{workerOrigin:string}){
  const [token,setToken]=useState('');
  const [seconds,setSeconds]=useState(0);
  const [error,setError]=useState('');
  const refresh=useCallback(async()=>{
    const result=await issueDynamicAttendanceQr();
    if(!result.ok){setError(result.error);return;}
    setToken(result.token);setSeconds(Math.max(1,Math.floor((new Date(result.expiresAt).getTime()-Date.now())/1000)));setError('');
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{
    const timer=window.setInterval(()=>setSeconds(value=>{
      if(value<=1){void refresh();return 60;} return value-1;
    }),1000);
    return ()=>window.clearInterval(timer);
  },[refresh]);
  const src=token?`${workerOrigin}/workplace/qr?attendanceToken=${encodeURIComponent(token)}`:'';
  return <section className="mt-5 rounded-3xl bg-white p-5 text-center shadow-card">
    <div className="flex items-center justify-between text-left"><div><p className="text-title font-extrabold">동적 출퇴근 QR</p><p className="mt-1 text-[12px] text-sub">직원이 휴대폰 카메라로 스캔해요.</p></div><span className="rounded-full bg-primary/10 px-3 py-1 text-[12px] font-bold text-primary">{seconds}초</span></div>
    {src?<iframe title="동적 출퇴근 QR" src={src} className="mt-4 h-[310px] w-full border-0 bg-white"/>:<div className="py-20 text-sub">{error||'QR 생성 중...'}</div>}
    <button onClick={()=>void refresh()} className="h-11 w-full rounded-xl border border-line font-bold">새 QR로 갱신</button>
    <p className="mt-3 text-[11px] leading-5 text-sub">60초마다 자동 갱신됩니다. QR 원문은 저장하지 않고 해시만 서버에 보관합니다.</p>
  </section>;
}
