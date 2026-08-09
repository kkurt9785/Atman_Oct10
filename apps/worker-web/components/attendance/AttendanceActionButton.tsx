'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';

type Result={ok:boolean;message?:string;reason?:string;method?:string;distanceM?:number;accuracyM?:number;action?:string;checkInAt?:string;checkOutAt?:string};
export type AttendanceMode='gps'|'gps_qr'|'qr'|'network'|'admin'|'gps_or_qr';
const METHOD:Record<string,string>={GPS:'위치 인증',GPS_QR:'위치 + 동적 QR',QR:'동적 QR',QR_FALLBACK:'QR 보완 인증',WORKPLACE_NET:'사업장 네트워크',ADMIN:'관리자 처리'};
const MODE_LABEL:Record<AttendanceMode,string>={gps:'위치 인증',gps_qr:'위치 + 동적 QR',qr:'동적 QR',network:'사업장 Wi-Fi/IP',admin:'관리자 승인',gps_or_qr:'위치 우선 · QR/Wi-Fi 보완'};

function position(){
  return new Promise<GeolocationPosition>((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{
    enableHighAccuracy:true,timeout:12_000,maximumAge:10_000,
  }));
}

export function AttendanceActionButton({targetType,targetId,action,qrToken,mode='gps_or_qr',onSuccess}:{
  targetType:'staff'|'shift';targetId:string;action:'check_in'|'check_out';qrToken?:string|null;mode?:AttendanceMode;onSuccess?:()=>void;
}){
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState<Result|null>(null);
  const [qrHelp,setQrHelp]=useState(false);
  async function run(){
    setLoading(true);setResult(null);
    let coords:{latitude:number;longitude:number;accuracy:number}|null=null;
    const needsGps=mode==='gps'||mode==='gps_qr'||mode==='gps_or_qr';
    if(needsGps){try{coords=(await position()).coords;}catch{/* Server decides whether QR/network fallback is allowed. */}}
    const {data,error}=await supabase.rpc('record_unified_attendance',{
      p_target_type:targetType,p_target_id:targetId,p_action:action,
      p_lat:coords?.latitude??null,p_lng:coords?.longitude??null,
      p_accuracy:coords?.accuracy??null,p_qr_token:qrToken??null,
    });
    const next=(data??{ok:false,message:error?.message?.replace(/^.*?: /,'')??'출퇴근 인증에 실패했어요.'}) as Result;
    setResult(next);setLoading(false);
    if(next.ok)onSuccess?.();
  }
  return <div className="mt-3">
    <button onClick={run} disabled={loading} className={`h-12 w-full rounded-xl text-[15px] font-extrabold text-white disabled:opacity-50 ${action==='check_in'?'bg-primary':'bg-ink'}`}>
      {loading?`${MODE_LABEL[mode]} 확인 중...`:action==='check_in'?'출근하기':'퇴근하기'}
    </button>
    {result&&<div role="status" className={`mt-2 rounded-xl p-3 text-[12px] font-bold ${result.ok?'bg-emerald-50 text-emerald-700':'bg-red-50 text-red-600'}`}>
      <p>{result.ok?`${action==='check_in'?'출근':'퇴근'}이 완료되었습니다.`:result.message}</p>
      {result.ok&&<><p className="mt-1 font-medium">{new Date(result.checkOutAt??result.checkInAt??Date.now()).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false})} · {METHOD[result.method??'']??result.method}{typeof result.distanceM==='number'?` · 사업장에서 ${result.distanceM}m`:''}{typeof result.accuracyM==='number'?` · 위치 오차 ±${Math.round(result.accuracyM)}m`:''}</p><button onClick={()=>window.location.reload()} className="mt-2 h-9 rounded-lg bg-white px-3 text-[12px] font-extrabold text-emerald-700">완료</button></>}
      {!result.ok&&<div className="mt-2 flex flex-wrap gap-2"><button onClick={run} className="h-9 rounded-lg bg-white px-3 text-[12px] font-extrabold text-red-600">다시 확인</button>{!qrToken&&<button onClick={()=>setQrHelp(true)} className="h-9 rounded-lg bg-white px-3 text-[12px] font-extrabold text-primary">동적 QR로 인증</button>}</div>}
    </div>}
    {qrHelp&&<div className="mt-2 rounded-xl border border-primary/20 bg-white p-3 text-[12px] leading-5 text-sub"><b className="text-ink">동적 QR로 다시 인증하세요</b><ol className="mt-1 list-decimal pl-4"><li>사업장 접수대·관리자 화면의 출퇴근 QR을 확인합니다.</li><li>휴대폰 기본 카메라로 QR을 스캔합니다.</li><li>열린 잇닿 화면에서 출퇴근 버튼을 누릅니다.</li></ol><button onClick={()=>setQrHelp(false)} className="mt-2 font-bold text-primary">확인</button></div>}
    <p className="mt-2 text-center text-[11px] text-sub">현재 인증: {MODE_LABEL[mode]}{(mode==='gps'||mode==='gps_qr'||mode==='gps_or_qr')?' · 위치는 버튼을 누른 순간에만 확인해요.':''}</p>
  </div>;
}
