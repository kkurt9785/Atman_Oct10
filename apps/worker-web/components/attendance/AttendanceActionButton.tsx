'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export type AttendanceResult={ok:boolean;message?:string;reason?:string;method?:string;distanceM?:number;accuracyM?:number;action?:string;checkInAt?:string;checkOutAt?:string;status?:'approved'|'pending';lateMinutes?:number;earlyLeaveMinutes?:number};
export type AttendanceMode='gps'|'gps_qr'|'qr'|'network'|'admin'|'gps_or_qr';
const METHOD:Record<string,string>={GPS:'위치 인증',GPS_QR:'위치 + 동적 QR',QR:'동적 QR',QR_FALLBACK:'QR 보완 인증',WORKPLACE_NET:'사업장 네트워크',ADMIN:'관리자 처리'};
const MODE_LABEL:Record<AttendanceMode,string>={gps:'위치 인증',gps_qr:'위치 + 동적 QR',qr:'동적 QR',network:'사업장 네트워크',admin:'관리자 승인',gps_or_qr:'위치 우선 · QR 보완'};

function position(timeoutMs=12_000){
  return new Promise<GeolocationPosition>((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{
    enableHighAccuracy:true,timeout:timeoutMs,maximumAge:10_000,
  }));
}

async function nudgeAdminNotifications(){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session)return;
  const adminBase=process.env.NEXT_PUBLIC_ADMIN_WEB_URL??(window.location.hostname==='localhost'?'http://localhost:3002':'https://admin.itdot.co.kr');
  fetch(`${adminBase}/api/attendance/nudge`,{
    method:'POST',headers:{Authorization:`Bearer ${session.access_token}`},keepalive:true,
  }).catch(()=>undefined);
}

export function AttendanceActionButton({targetType,targetId,action,qrToken,mode='gps_or_qr',onSuccess}:{
  targetType:'staff'|'shift';targetId:string;action:'check_in'|'check_out';qrToken?:string|null;mode?:AttendanceMode;onSuccess?:(result:AttendanceResult)=>void;
}){
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState<AttendanceResult|null>(null);
  const [qrHelp,setQrHelp]=useState(false);
  const [locationIssue,setLocationIssue]=useState<string|null>(null);
  async function run(){
    setLoading(true);setResult(null);setLocationIssue(null);
    let coords:{latitude:number;longitude:number;accuracy:number}|null=null;
    const needsGps=mode==='gps'||mode==='gps_qr'||mode==='gps_or_qr';
    // QR을 방금 찍고 들어온 경우(실내라 GPS가 안 잡히는 상황)는 위치를 오래 기다리지 않는다 — gps_qr(둘 다 필수)만 예외
    const gpsTimeout=qrToken&&mode!=='gps_qr'?4_000:12_000;
    if(needsGps){try{coords=(await position(gpsTimeout)).coords;}catch(error){
      const code=(error as GeolocationPositionError)?.code;
      setLocationIssue(code===1?'휴대폰 위치 권한이 꺼져 있어요. 설정에서 위치 권한을 허용하거나 QR로 인증해 주세요.':code===3?'위치를 확인하는 데 시간이 걸리고 있어요. 다시 시도하거나 QR로 인증해 주세요.':'현재 위치를 확인하지 못했어요. 사업장 근처에서 다시 시도해 주세요.');
    }}
    const {data,error}=await supabase.rpc('record_unified_attendance',{
      p_target_type:targetType,p_target_id:targetId,p_action:action,
      p_lat:coords?.latitude??null,p_lng:coords?.longitude??null,
      p_accuracy:coords?.accuracy??null,p_qr_token:qrToken??null,
    });
    const next=(data??{ok:false,message:error?.message?.replace(/^.*?: /,'')??'출퇴근 인증에 실패했어요.'}) as AttendanceResult;
    void nudgeAdminNotifications();
    setResult(next);setLoading(false);
    if(next.ok)onSuccess?.(next);
  }
  return <div className="mt-3">
    <button onClick={run} disabled={loading} className={`h-12 w-full rounded-xl text-[15px] font-extrabold text-white disabled:opacity-50 ${action==='check_in'?'bg-primary':'bg-ink'}`}>
      {loading?`${MODE_LABEL[mode]} 확인 중...`:action==='check_in'?'출근하기':'퇴근하기'}
    </button>
    {result&&<div role="status" className={`mt-2 rounded-xl p-3 text-[12px] font-bold ${result.ok?(result.status==='pending'?'bg-amber-50 text-amber-700':'bg-emerald-50 text-emerald-700'):'bg-red-50 text-red-600'}`}>
      <p>{result.ok?(action==='check_out'&&result.status==='pending'?'조기 퇴근 승인을 요청했어요.':`${action==='check_in'?'출근':'퇴근'}이 완료됐어요.`):result.message}</p>
      {result.ok&&(result.lateMinutes??0)>0&&<p className="mt-1 font-medium">지각 {result.lateMinutes}분으로 기록됐어요.</p>}
      {result.ok&&result.status!=='pending'&&(result.earlyLeaveMinutes??0)>0&&<p className="mt-1 font-medium">예정보다 {result.earlyLeaveMinutes}분 일찍 퇴근한 것으로 기록됐어요.</p>}
      {!result.ok&&result.reason==='QR_EXPIRED'&&<p className="mt-1 font-medium">관리자 화면의 새 QR을 다시 찍어 주세요. QR은 화면에서 60초마다 바뀌어요.</p>}
      {result.ok&&result.status==='pending'&&<p className="mt-1 font-medium">관리자가 승인하면 퇴근 시간과 근무시간이 확정돼요.</p>}
      {result.ok&&<p className="mt-1 font-medium">{new Date(result.checkOutAt??result.checkInAt??Date.now()).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false})} · {METHOD[result.method??'']??result.method}{typeof result.distanceM==='number'?` · 사업장에서 ${result.distanceM}m`:''}{typeof result.accuracyM==='number'?` · 위치 오차 ±${Math.round(result.accuracyM)}m`:''}</p>}
      {!result.ok&&<div className="mt-2 flex flex-wrap gap-2"><button onClick={run} className="h-9 rounded-lg bg-white px-3 text-[12px] font-extrabold text-red-600">다시 확인</button>{!qrToken&&<button onClick={()=>setQrHelp(true)} className="h-9 rounded-lg bg-white px-3 text-[12px] font-extrabold text-primary">동적 QR로 인증</button>}</div>}
    </div>}
    {locationIssue&&<p role="alert" className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] font-bold leading-5 text-amber-700">{locationIssue}</p>}
    {qrHelp&&<div className="mt-2 rounded-xl border border-primary/20 bg-white p-3 text-[12px] leading-5 text-sub"><b className="text-ink">사업장 QR로 인증하는 방법</b><ol className="mt-1 list-decimal pl-4"><li>사업장 접수대·관리자 화면의 동적 출퇴근 QR을 확인합니다.</li><li>아이폰은 기본 카메라, 갤럭시는 카메라의 QR 스캔으로 비춥니다.</li><li>권한 창이 나오면 카메라 허용을 누르고 열린 잇닿 화면에서 출퇴근 버튼을 누릅니다.</li></ol><button onClick={()=>setQrHelp(false)} className="mt-2 font-bold text-primary">확인</button></div>}
    <p className="mt-2 text-center text-[11px] text-sub">{mode==='gps_or_qr'?'버튼만 누르면 사용 가능한 방법을 자동으로 확인해요.':`현재 인증: ${MODE_LABEL[mode]}`}{(mode==='gps'||mode==='gps_qr'||mode==='gps_or_qr')?' 위치는 버튼을 누른 순간에만 확인합니다.':''}</p>
  </div>;
}
