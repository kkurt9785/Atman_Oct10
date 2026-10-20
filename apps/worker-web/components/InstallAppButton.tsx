'use client';
import {useState} from 'react';
import {PwaInstallSheet} from './PwaInstallSheet';
import {usePwaInstall} from '@/lib/pwa-install';
export function InstallAppButton({label='홈 화면에 앱 추가',dark=false}:{label?:string;dark?:boolean}){
  const install=usePwaInstall(),[guide,setGuide]=useState(false);
  if(!install.ready||install.installed)return null;
  return <>
    <button type="button" disabled={install.busy} onClick={()=>{if(install.available&&!install.inApp)void install.install();else setGuide(true);}} className={`flex min-h-12 w-full items-center justify-center rounded-xl border px-3 text-[14px] font-extrabold disabled:opacity-60 ${dark?'border-white/20 bg-white/8 text-white':'border-line bg-white text-ink'}`}>
      {install.busy?'설치 창 여는 중…':install.pending?'설치 진행 확인 · 안내':label}
    </button>
    {install.pending&&<p role="status" className={`mt-2 text-center text-xs ${dark?'text-white/80':'text-sub'}`}>설치 요청을 전달했어요. 브라우저에서 완료한 뒤 홈 화면의 잇닿 아이콘을 확인해 주세요.</p>}
    {install.error&&<p role="alert" className="mt-2 text-xs text-red-600">{install.error}</p>}
    {guide&&<PwaInstallSheet ios={install.ios} inApp={install.inApp} onClose={()=>setGuide(false)}/>}
  </>;
}
