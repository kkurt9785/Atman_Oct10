'use client';

import { useState } from 'react';
import { QrCanvas } from '@/components/QrCanvas';

export function CopyInviteButton({url,primary=false}:{url:string;primary?:boolean}){
  const [copied,setCopied]=useState(false);
  const [qrOpen,setQrOpen]=useState(false);
  // PC 카카오톡처럼 공유 시트가 없는 곳에선 링크만 붙으면 받는 사람이 무슨 링크인지 몰라서, 안내 문구와 링크를 함께 복사한다
  // 같은 링크에서 수락과 잇닿 근무자 앱 설치까지 된다(카카오톡에서 열면 사파리·크롬으로 바로 넘어간다)
  const message='[잇닿] 근무 초대가 왔어요. 링크를 눌러 근무 조건을 확인하고 수락해 주세요. 잇닿 근무자 앱도 같은 링크에서 바로 설치할 수 있어요.';
  async function share(){
    if(navigator.share){
      try{
        await navigator.share({title:'잇닿 근무 초대',text:message,url});
        return;
      }catch(error){
        if((error as DOMException)?.name==='AbortError')return;
      }
    }
    await navigator.clipboard.writeText(`${message}\n${url}`);
    setCopied(true);
    window.setTimeout(()=>setCopied(false),1500);
  }
  return <div className={primary?'grid grid-cols-2 gap-2':'flex items-center gap-3'}>
    <button type="button" onClick={share} className={primary?'flex h-11 items-center justify-center rounded-xl bg-primary px-3 text-[0.8125rem] font-extrabold text-white':'inline-flex min-h-10 items-center text-[0.75rem] font-bold text-primary'}>{copied?'초대 문구 복사됨 · 카톡에 붙여넣기':primary?'카카오·메시지로 초대':'초대 보내기'}</button>
    <button type="button" onClick={()=>setQrOpen(true)} className={primary?'flex h-11 items-center justify-center rounded-xl border border-primary/30 bg-white px-3 text-[0.8125rem] font-extrabold text-primary':'inline-flex min-h-10 items-center text-[0.75rem] font-bold text-sub'}>현장 QR</button>
    {qrOpen&&<div role="dialog" aria-modal="true" aria-label="근무 초대 QR" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5" onClick={()=>setQrOpen(false)}>
      <section className="w-full max-w-[340px] rounded-3xl bg-white p-5 text-center shadow-xl" onClick={event=>event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 text-left"><div><p className="text-[0.75rem] font-bold text-primary">전화번호 없이 직접 수락</p><h2 className="mt-1 text-[1.25rem] font-extrabold text-ink">이 일회용 QR을 스캔해 주세요</h2></div><button type="button" onClick={()=>setQrOpen(false)} aria-label="닫기" className="flex h-10 w-10 items-center justify-center rounded-full bg-bg text-[1.25rem] text-sub">×</button></div>
        <div className="mt-5 rounded-2xl bg-bg p-4"><QrCanvas value={url} size={244} label="잇닿 근무자 가입 QR"/></div>
        <p className="mt-4 text-[0.75rem] leading-5 text-sub">앱 설치 없이 브라우저에서 조건을 확인할 수 있어요. 카카오 로그인 후 근무자가 직접 수락해야 사업장과 워크룸에 연결돼요.</p>
        <button type="button" onClick={share} className="mt-4 h-11 w-full rounded-xl bg-ink text-[0.8125rem] font-extrabold text-white">QR 대신 링크 보내기</button>
      </section>
    </div>}
  </div>;
}
