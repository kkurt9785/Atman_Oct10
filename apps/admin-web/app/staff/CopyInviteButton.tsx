'use client';

import { useState } from 'react';
import { QrCanvas } from '@/components/QrCanvas';

export function CopyInviteButton({url,primary=false}:{url:string;primary?:boolean}){
  const [copied,setCopied]=useState(false);
  const [qrOpen,setQrOpen]=useState(false);
  async function share(){
    if(navigator.share){
      try{
        await navigator.share({title:'잇닿 긱워커 근무 초대',text:'카카오로 로그인해 근무 조건을 확인하고 출퇴근을 시작해 주세요.',url});
        return;
      }catch(error){
        if((error as DOMException)?.name==='AbortError')return;
      }
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(()=>setCopied(false),1500);
  }
  return <div className={primary?'grid grid-cols-2 gap-2':'flex items-center gap-3'}>
    <button type="button" onClick={share} className={primary?'flex h-11 items-center justify-center rounded-xl bg-primary px-3 text-[13px] font-extrabold text-white':'text-[12px] font-bold text-primary'}>{copied?'링크 복사됨':primary?'가입 링크 보내기':'링크 보내기'}</button>
    <button type="button" onClick={()=>setQrOpen(true)} className={primary?'flex h-11 items-center justify-center rounded-xl border border-primary/30 bg-white px-3 text-[13px] font-extrabold text-primary':'text-[12px] font-bold text-sub'}>QR 보여주기</button>
    {qrOpen&&<div role="dialog" aria-modal="true" aria-label="워크룸 가입 QR" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5" onClick={()=>setQrOpen(false)}>
      <section className="w-full max-w-[340px] rounded-3xl bg-white p-5 text-center shadow-xl" onClick={event=>event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 text-left"><div><p className="text-[12px] font-bold text-primary">전화번호 없이 현장 가입</p><h2 className="mt-1 text-[20px] font-extrabold text-ink">이 QR을 스캔해 주세요</h2></div><button type="button" onClick={()=>setQrOpen(false)} aria-label="닫기" className="flex h-10 w-10 items-center justify-center rounded-full bg-bg text-[20px] text-sub">×</button></div>
        <div className="mt-5 rounded-2xl bg-bg p-4"><QrCanvas value={url} size={244} label="잇닿 근무자 가입 QR"/></div>
        <p className="mt-4 text-[12px] leading-5 text-sub">근무자가 카카오로 가입하면 사업장과 워크룸에 바로 연결됩니다. 관리자와 워커가 서로 전화번호를 저장할 필요가 없어요.</p>
        <button type="button" onClick={share} className="mt-4 h-11 w-full rounded-xl bg-ink text-[13px] font-extrabold text-white">QR 대신 링크 보내기</button>
      </section>
    </div>}
  </div>;
}
