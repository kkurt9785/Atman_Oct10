'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {installPlatform} from '@/lib/pwa-install';
export function PwaInstallSheet({onClose,ios:iosOverride,inApp:inAppOverride}:{onClose:()=>void;ios?:boolean;inApp?:boolean}){
  const device=typeof navigator==='undefined'?{ios:false,inApp:false}:installPlatform(navigator.userAgent,navigator.maxTouchPoints);
  const ios=iosOverride??device.ios,inApp=inAppOverride??device.inApp;
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
      <p className="mt-2 text-sm leading-6 text-sub">설치 없이도 시연할 수 있어요. 자주 쓰려면 홈 화면에 추가해 주세요.</p>
      {inApp&&<div className="mt-4 rounded-xl bg-primary/5 p-3 text-sm leading-6"><p>현재 앱 안의 브라우저에서는 설치 메뉴가 보이지 않을 수 있어요. 메뉴에서 <b>외부 브라우저로 열기</b>를 찾거나 주소를 복사해 {ios?'Safari':'Chrome 등 설치를 지원하는 브라우저'}에서 열어 주세요.</p><button type="button" onClick={()=>void copy()} className="mt-2 min-h-11 font-bold text-primary">현재 주소 복사</button>{copyMessage&&<p role="status">{copyMessage}</p>}</div>}
      <ol className="my-5 list-decimal space-y-3 pl-5 text-sm leading-6">
        {ios?<><li>Safari에서 <b>공유(↑)</b>를 누르세요. 보이지 않으면 <b>더 보기(…)</b> 또는 페이지 메뉴에서 공유를 찾으세요.</li><li><b>홈 화면에 추가</b>를 선택하세요.</li><li><b>웹 앱으로 열기</b>가 보이면 켠 뒤 <b>추가</b>를 누르세요.</li></>:<><li>Chrome 등 지원 브라우저에서 주소창의 설치 아이콘이나 메뉴를 여세요.</li><li><b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 선택하세요. 메뉴 이름은 브라우저마다 달라요.</li><li>브라우저 안내를 완료하고 추가된 잇닿 아이콘으로 열어 주세요.</li></>}
      </ol>
      <p className="mb-4 text-xs leading-5 text-sub">메뉴가 없으면 지원 브라우저에서 다시 시도해 주세요. 설치만으로 알림이 켜지지는 않아요. 앱에서 알림을 별도로 허용해야 해요.</p>
      <button type="button" onClick={onClose} className="min-h-12 w-full rounded-xl bg-primary font-bold text-white">확인했어요</button>
    </section>
  </div>;
}
