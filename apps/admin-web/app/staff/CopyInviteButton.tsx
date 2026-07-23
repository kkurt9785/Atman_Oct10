'use client';

import { useState } from 'react';

export function CopyInviteButton({url}:{url:string}){
  const [copied,setCopied]=useState(false);
  async function copy(){
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(()=>setCopied(false),1500);
  }
  return <button type="button" onClick={copy} className="text-[12px] font-bold text-primary">{copied?'초대 링크 복사됨':'직원 초대 링크 복사'}</button>;
}
