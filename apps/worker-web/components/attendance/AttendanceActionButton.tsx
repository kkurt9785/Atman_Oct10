'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { BrandMark } from '@/components/brand/BrandMark';

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

export type AttendanceActionProps={
  targetType:'staff'|'shift';targetId:string;action:'check_in'|'check_out';qrToken?:string|null;mode?:AttendanceMode;onSuccess?:(result:AttendanceResult)=>void;
};

// 출퇴근 기록 한 번: 위치(필요하면) → record_unified_attendance → 결과. 버튼 모양과 무관하게 같은 절차를 쓴다.
function useAttendanceAction({targetType,targetId,action,qrToken,mode='gps_or_qr',onSuccess}:AttendanceActionProps){
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState<AttendanceResult|null>(null);
  const [locationIssue,setLocationIssue]=useState<string|null>(null);
  async function run(){
    if(loading)return;
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
  return {run,loading,result,locationIssue,mode};
}

function AttendanceFeedback({action,result,locationIssue,qrToken,mode,onRetry,dark=false}:{action:'check_in'|'check_out';result:AttendanceResult|null;locationIssue:string|null;qrToken?:string|null;mode:AttendanceMode;onRetry:()=>void;dark?:boolean}){
  const [qrHelp,setQrHelp]=useState(false);
  return <>
    {result&&<div role="status" className={`mt-3 rounded-xl p-3 text-[12px] font-bold ${result.ok?(result.status==='pending'?'bg-amber-50 text-amber-700':'bg-emerald-50 text-emerald-700'):'bg-red-50 text-red-600'}`}>
      <p>{result.ok?(action==='check_out'&&result.status==='pending'?'조기 퇴근 승인을 요청했어요.':`${action==='check_in'?'출근':'퇴근'}이 완료됐어요.`):result.message}</p>
      {result.ok&&(result.lateMinutes??0)>0&&<p className="mt-1 font-medium">지각 {result.lateMinutes}분으로 기록됐어요.</p>}
      {result.ok&&result.status!=='pending'&&(result.earlyLeaveMinutes??0)>0&&<p className="mt-1 font-medium">예정보다 {result.earlyLeaveMinutes}분 일찍 퇴근한 것으로 기록됐어요.</p>}
      {!result.ok&&result.reason==='QR_EXPIRED'&&<p className="mt-1 font-medium">관리자 화면의 새 QR을 다시 찍어 주세요. QR은 화면에서 60초마다 바뀌어요.</p>}
      {result.ok&&result.status==='pending'&&<p className="mt-1 font-medium">관리자가 승인하면 퇴근 시간과 근무시간이 확정돼요.</p>}
      {result.ok&&<p className="mt-1 font-medium">{new Date(result.checkOutAt??result.checkInAt??Date.now()).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false})} · {METHOD[result.method??'']??result.method}{typeof result.distanceM==='number'?` · 사업장에서 ${result.distanceM}m`:''}{typeof result.accuracyM==='number'?` · 위치 오차 ±${Math.round(result.accuracyM)}m`:''}</p>}
      {!result.ok&&<div className="mt-2 flex flex-wrap gap-2"><button onClick={onRetry} className="h-9 rounded-lg bg-white px-3 text-[12px] font-extrabold text-red-600">다시 확인</button>{!qrToken&&<button onClick={()=>setQrHelp(true)} className="h-9 rounded-lg bg-white px-3 text-[12px] font-extrabold text-primary">동적 QR로 인증</button>}</div>}
    </div>}
    {locationIssue&&<p role="alert" className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] font-bold leading-5 text-amber-700">{locationIssue}</p>}
    {qrHelp&&<div className="mt-2 rounded-xl border border-primary/20 bg-white p-3 text-[12px] leading-5 text-sub"><b className="text-ink">사업장 QR로 인증하는 방법</b><ol className="mt-1 list-decimal pl-4"><li>사업장 접수대·관리자 화면의 동적 출퇴근 QR을 확인합니다.</li><li>아이폰은 기본 카메라, 갤럭시는 카메라의 QR 스캔으로 비춥니다.</li><li>권한 창이 나오면 카메라 허용을 누르고 열린 잇닿 화면에서 출퇴근 버튼을 누릅니다.</li></ol><button onClick={()=>setQrHelp(false)} className="mt-2 font-bold text-primary">확인</button></div>}
    <p className={`mt-2 text-center text-[11px] ${dark?'text-white/55':'text-sub'}`}>{mode==='gps_or_qr'?'누르면 사용 가능한 방법을 자동으로 확인해요.':`현재 인증: ${MODE_LABEL[mode]}`}{(mode==='gps'||mode==='gps_qr'||mode==='gps_or_qr')?' 위치는 누른 순간에만 확인합니다.':''}</p>
  </>;
}

// 기본 가로 버튼 (휴가·이력 등 보조 화면용)
export function AttendanceActionButton(props:AttendanceActionProps){
  const {run,loading,result,locationIssue,mode}=useAttendanceAction(props);
  return <div className="mt-3">
    <button onClick={run} disabled={loading} className={`h-12 w-full rounded-xl text-[15px] font-extrabold text-white disabled:opacity-50 ${props.action==='check_in'?'bg-primary':'bg-ink'}`}>
      {loading?`${MODE_LABEL[mode]} 확인 중...`:props.action==='check_in'?'출근하기':'퇴근하기'}
    </button>
    <AttendanceFeedback action={props.action} result={result} locationIssue={locationIssue} qrToken={props.qrToken} mode={mode} onRetry={run}/>
  </div>;
}

const HOLD_MS=1000;

// '닿기' — 잇닿의 시그니처 출퇴근 동작. 큰 원을 1초 길게 누르면 기록된다.
// 실수로 스치는 탭은 무시되고, 누르는 동안 테두리가 차오른다. 로고(맞닿음)와 같은 도형을 가운데에 둔다.
export function TouchToCheckButton(props:AttendanceActionProps&{dark?:boolean}){
  const {run,loading,result,locationIssue,mode}=useAttendanceAction(props);
  const [progress,setProgress]=useState(0);
  const holdStart=useRef<number|null>(null);
  const frame=useRef<number>(0);
  const fired=useRef(false);
  const checkingIn=props.action==='check_in';

  useEffect(()=>()=>cancelAnimationFrame(frame.current),[]);

  function tick(){
    if(holdStart.current==null)return;
    const ratio=Math.min(1,(performance.now()-holdStart.current)/HOLD_MS);
    setProgress(ratio);
    if(ratio>=1){
      if(!fired.current){fired.current=true;holdStart.current=null;setProgress(0);if('vibrate' in navigator)navigator.vibrate?.(30);void run();}
      return;
    }
    frame.current=requestAnimationFrame(tick);
  }
  function start(event:React.PointerEvent<HTMLButtonElement>){
    if(loading)return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    fired.current=false;holdStart.current=performance.now();
    frame.current=requestAnimationFrame(tick);
  }
  function stop(){
    holdStart.current=null;cancelAnimationFrame(frame.current);setProgress(0);
  }
  // 키보드·보조기기: Enter/Space 로도 바로 실행되게 (길게 누르기는 촉각 확인용이지 필수 조건이 아니다)
  function onKeyDown(event:React.KeyboardEvent<HTMLButtonElement>){
    if(event.key==='Enter'||event.key===' '){event.preventDefault();void run();}
  }

  const ringColor=checkingIn?'#3182F6':'#FFFFFF';
  const fill=checkingIn?'bg-primary':'bg-white';
  const text=checkingIn?'text-white':'text-ink';
  return <div className="mt-2 flex flex-col items-center">
    <button
      type="button"
      aria-label={checkingIn?'길게 눌러 출근 기록':'길게 눌러 퇴근 기록'}
      disabled={loading}
      onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onKeyDown={onKeyDown}
      onContextMenu={(event)=>event.preventDefault()}
      style={{background:`conic-gradient(${ringColor} ${Math.round(progress*360)}deg, ${props.dark?'rgba(255,255,255,0.16)':'rgba(49,130,246,0.18)'} 0deg)`,touchAction:'none',WebkitUserSelect:'none',userSelect:'none'}}
      className="flex h-[168px] w-[168px] select-none items-center justify-center rounded-full p-[7px] shadow-btn transition-transform active:scale-[0.97] disabled:opacity-70"
    >
      <span className={`flex h-full w-full flex-col items-center justify-center gap-1 rounded-full ${fill} ${text}`}>
        <BrandMark size={36} tone={checkingIn?'onPrimary':'light'}/>
        <span className="text-[19px] font-extrabold tracking-[-0.3px]">{loading?'확인 중':checkingIn?'닿기':'퇴근'}</span>
        <span className={`text-[11px] ${checkingIn?'text-white/85':'text-sub'}`}>{loading?MODE_LABEL[mode]:checkingIn?'길게 눌러 출근':'길게 눌러 퇴근'}</span>
      </span>
    </button>
    <div className="w-full">
      <AttendanceFeedback action={props.action} result={result} locationIssue={locationIssue} qrToken={props.qrToken} mode={mode} onRetry={run} dark={props.dark}/>
    </div>
  </div>;
}
