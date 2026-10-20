'use client';
import {useEffect,useState} from 'react';
import {PwaInstallSheet} from './PwaInstallSheet';
import {usePwaInstall} from '@/lib/pwa-install';
import {LINKED_INSTALL_KEY, LINKED_INSTALL_EVENT} from '@/lib/linked-install';
const DISMISS_KEY='installBannerDismissedAt';
export function InstallBanner({hint='홈 화면에서 바로 새 근무를 확인해요'}:{hint?:string}={}){
  const install=usePwaInstall(),[dismissed,setDismissed]=useState(true),[guide,setGuide]=useState(false);
  const [linkedInstall, setLinkedInstall] = useState(true);
  useEffect(() => {
    function update() {
      try { setDismissed(Date.now()-Number(localStorage.getItem(DISMISS_KEY)??0)<14*86400000); } catch { /* optional */ }
      try { setLinkedInstall(Date.now() - Number(sessionStorage.getItem(LINKED_INSTALL_KEY) ?? 0) < 30 * 60 * 1000); }
      catch { setLinkedInstall(false); }
    }
    update();
    window.addEventListener(LINKED_INSTALL_EVENT, update);
    return () => window.removeEventListener(LINKED_INSTALL_EVENT, update);
  }, []);
  useEffect(()=>{try{setDismissed(Date.now()-Number(localStorage.getItem(DISMISS_KEY)??0)<14*86400000);}catch{setDismissed(false);}},[]);
  function dismiss(){try{localStorage.setItem(DISMISS_KEY,String(Date.now()));}catch{}setDismissed(true);setGuide(false);}
  function start(){if(install.available&&!install.inApp)void install.install();else setGuide(true);}
  if(!install.ready||install.installed||dismissed||linkedInstall||(!install.ios&&!install.inApp&&!install.available&&!install.pending&&!install.error))return null;
  return <>
    <div className="fixed bottom-[calc(var(--bottom-nav-height)+8px+env(safe-area-inset-bottom))] inset-x-3 z-40 mx-auto max-w-app rounded-2xl bg-ink p-3 text-white shadow-lg">
      <div className="flex items-center gap-2">
        <button type="button" disabled={install.busy} onClick={start} className="min-h-11 min-w-0 flex-1 text-left disabled:opacity-60"><p className="text-[13px] font-bold">홈 화면에 잇닿 추가</p><p className="mt-0.5 text-[11px] text-white/80">{install.pending?'설치 요청됨 · 브라우저에서 완료를 확인해 주세요':install.inApp?'외부 브라우저에서 추가할 수 있어요':install.ios?'Safari에서 홈 화면에 추가':hint}</p></button>
        <button type="button" disabled={install.busy} onClick={start} className="min-h-11 shrink-0 rounded-xl bg-white px-3 text-xs font-bold text-ink disabled:opacity-60">{install.busy?'여는 중':install.available&&!install.inApp?'설치':'방법 보기'}</button>
        <button type="button" onClick={dismiss} aria-label="설치 안내 닫기" className="h-11 w-11 shrink-0 text-lg">×</button>
      </div>
      {install.error&&<p role="alert" className="mt-2 text-xs text-white">{install.error}</p>}
    </div>
    {guide&&<PwaInstallSheet ios={install.ios} inApp={install.inApp} onClose={()=>setGuide(false)}/>}
  </>;
}
