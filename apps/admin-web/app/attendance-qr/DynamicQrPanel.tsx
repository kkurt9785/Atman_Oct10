'use client';
import { useCallback, useEffect, useState } from 'react';
import { issueDynamicAttendanceQr } from './actions';
import { QrCanvas } from '@/components/QrCanvas';

const ROTATION_SECONDS=60;

export function DynamicQrPanel({workerOrigin}:{workerOrigin:string}){
  const [token,setToken]=useState('');
  const [seconds,setSeconds]=useState(0);
  const [error,setError]=useState('');
  const refresh=useCallback(async()=>{
    const result=await issueDynamicAttendanceQr();
    if(!result.ok){setError(result.error);setSeconds(60);return;} // 실패해도 마지막 QR 유지(토큰 5분 유효)
    // 화면의 QR은 60초마다 교체한다. 서버 토큰은 전송 지연을 흡수하도록
    // 교체 뒤 30초만 더 유효하며, 그 만료시간을 카운트다운으로 노출하지 않는다.
    setToken(result.token);setSeconds(60);setError(''); // 화면 60초 회전, 서버 토큰 5분
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{
    const timer=window.setInterval(()=>setSeconds(value=>{
      if(value<=1){void refresh();return ROTATION_SECONDS;} return value-1;
    }),1000);
    return ()=>window.clearInterval(timer);
  },[refresh]);
  // 워커 앱이 스캔 후 여는 주소 그대로를 QR에 담는다 (워커 /workplace/qr 페이지와 동일한 값)
  const src=token?`${workerOrigin}/workplace?attendanceToken=${encodeURIComponent(token)}`:'';
  return <section className="mt-5 rounded-3xl bg-white p-5 text-center shadow-card">
    <div className="flex items-center justify-between text-left"><div><p className="text-title font-extrabold">동적 출퇴근 QR</p><p className="mt-1 text-[12px] text-sub">직원이 휴대폰 카메라로 스캔해요.</p></div><span className="rounded-full bg-primary/10 px-3 py-1 text-[12px] font-bold text-primary">{seconds}초</span></div>
    {src?<div className="mt-4 flex h-[310px] items-center justify-center"><QrCanvas value={src} size={280} label="동적 출퇴근 QR"/></div>:<div className="py-20 text-sub">{error||'QR 생성 중...'}</div>}
    <button onClick={()=>void refresh()} className="h-11 w-full rounded-xl border border-line font-bold">새 QR로 갱신</button>
    <p className="mt-3 text-[11px] leading-5 text-sub">60초마다 자동으로 교체됩니다. 방금 스캔한 QR은 전송 지연을 고려해 교체 후 최대 30초만 더 사용할 수 있고, QR 원문은 저장하지 않습니다.</p>
  </section>;
}
