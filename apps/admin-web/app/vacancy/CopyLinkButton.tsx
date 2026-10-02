'use client';
import { useState } from 'react';

export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      if (navigator.share) { await navigator.share({ title: '근무 공고', url }); return; }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* 공유 창을 닫은 경우 */ }
  }
  return (
    <button type="button" onClick={copy} className="shrink-0 rounded-xl bg-primary/10 px-3 py-2 text-[0.8125rem] font-bold text-primary">
      {copied ? '복사됐어요' : '링크 보내기'}
    </button>
  );
}
