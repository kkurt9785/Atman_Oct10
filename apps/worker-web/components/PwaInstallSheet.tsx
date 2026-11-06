'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {installPlatform} from '@/lib/pwa-install';
import {detectBrowser,openInExternalBrowser} from '@/lib/in-app-browser';
import {InstallGallery,InstallSteps,installStepsFor} from '@/components/install/InstallSteps';
// 홈 화면에 추가하는 방법 — 그 브라우저의 실제 버튼을 순서대로 보여 준다(components/install/InstallSteps).
// 카카오톡 안에서는 설치 메뉴가 없어 사파리·크롬으로 넘기는 버튼을, 다른 앱 안 브라우저는 주소 복사를 먼저 보여 준다.
export function PwaInstallSheet({onClose,ios:iosOverride,inApp:inAppOverride,note}:{onClose:()=>void;ios?:boolean;inApp?:boolean;note?:string}){
  const userAgent=typeof navigator==='undefined'?'':navigator.userAgent,touch=typeof navigator==='undefined'?0:navigator.maxTouchPoints;
  const device=installPlatform(userAgent,touch),browser=detectBrowser(userAgent,touch);
  const ios=iosOverride??device.ios,inApp=inAppOverride??device.inApp;
  // 알 수 없는 브라우저는 그 기기의 기본 브라우저(아이폰 사파리·안드로이드 크롬) 순서로 안내한다.
  // 앱 안 브라우저면 바깥(아이폰 사파리·안드로이드 크롬)에서 이어서 할 순서를 보여 준다
  const steps=installStepsFor(browser)??installStepsFor({...browser,inApp:false,ios,android:!ios,safari:ios,chromeIos:false,samsung:false,safariMajor:null});
  const ref=useRef<HTMLElement>(null),title=useId(),[copyMessage,setCopyMessage]=useState('');
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;ref.current?.focus();
    function key(event:KeyboardEvent){
      if(event.key==='Escape'){event.preventDefault();onClose();}
      if(event.key==='Tab'){
        const items=Array.from(ref.current?.querySelectorAll<HTMLElement>('button, a[href], input')??[]),first=items[0],last=items.at(-1);
        if(event.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===ref.current)){event.preventDefault();first?.focus();}
      }
    }
    document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus();};
  },[onClose]);
  async function copy(){try{await navigator.clipboard.writeText(window.location.href);setCopyMessage('주소를 복사했어요. 외부 브라우저 주소창에 붙여넣어 주세요.');}catch{setCopyMessage('브라우저 메뉴에서 주소를 복사해 외부 브라우저에 붙여넣어 주세요.');}}
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
    <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={title} onClick={event=>event.stopPropagation()} className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-6 pb-[calc(24px+env(safe-area-inset-bottom))] text-ink">
      <h2 id={title} className="text-xl font-extrabold">{ios?'iPhone·iPad에 잇닿 추가':'홈 화면에 잇닿 추가'}</h2>
      <p className="mt-2 text-sm leading-6 text-sub">{note??'설치하지 않아도 그대로 쓸 수 있어요. 자주 쓰려면 홈 화면에 추가해 주세요.'}</p>
      {inApp&&(browser.kakao
        ?<div className="mt-4 rounded-xl bg-primary/5 p-3 text-sm leading-6"><p>카카오톡 안에서는 설치 메뉴가 없어요. {ios?'사파리':'크롬 같은 브라우저'}로 열어서 이어서 추가해 주세요.</p><button type="button" onClick={()=>openInExternalBrowser()} className="mt-2 min-h-11 w-full rounded-xl bg-primary font-bold text-white">{ios?'사파리로 열기':'브라우저로 열기'}</button></div>
        :<div className="mt-4 rounded-xl bg-primary/5 p-3 text-sm leading-6"><p>현재 앱 안의 브라우저에서는 설치 메뉴가 보이지 않을 수 있어요. 메뉴에서 <b>외부 브라우저로 열기</b>를 찾거나 주소를 복사해 {ios?'Safari':'Chrome 등 설치를 지원하는 브라우저'}에서 열어 주세요.</p><button type="button" onClick={()=>void copy()} className="mt-2 min-h-11 font-bold text-primary">현재 주소 복사</button>{copyMessage&&<p role="status">{copyMessage}</p>}</div>)}
      {steps&&<><InstallGallery steps={steps} className="mt-4"/><InstallSteps steps={steps} className="my-4"/></>}
      <p className="mb-4 text-xs leading-5 text-sub">메뉴가 없으면 지원 브라우저에서 다시 시도해 주세요. 설치만으로 알림이 켜지지는 않아요. 앱에서 알림을 별도로 허용해야 해요.</p>
      <button type="button" onClick={onClose} className="min-h-12 w-full rounded-xl bg-primary font-bold text-white">확인했어요</button>
    </section>
  </div>;
}
