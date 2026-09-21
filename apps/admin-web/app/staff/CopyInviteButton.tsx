'use client';

import { useState } from 'react';

export function CopyInviteButton({url,primary=false}:{url:string;primary?:boolean}){
  const [copied,setCopied]=useState(false);
  async function share(){
    if(navigator.share){
      try{
        await navigator.share({title:'잇닿 근무 초대',text:'근무 조건을 확인하고 출퇴근을 시작해 주세요.',url});
        return;
      }catch(error){
        if((error as DOMException)?.name==='AbortError')return;
      }
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(()=>setCopied(false),1500);
  }
  return <button type="button" onClick={share} className={primary?'flex h-11 w-full items-center justify-center rounded-xl bg-primary text-[13px] font-extrabold text-white':'text-[12px] font-bold text-primary'}>{copied?'초대 링크를 복사했어요':primary?'카카오·문자로 초대 보내기':'초대 보내기'}</button>;
}
