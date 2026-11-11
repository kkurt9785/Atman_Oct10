'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { guideFirstKey, guideKey, workerGuideOpen } from '@/lib/guide-window';

export type GuideStep = { text: string; href?: string; cta?: string };

// 베타 기간 사용 안내 카드. 처음 본 날부터 14일 동안만 보이고, 닫으면 이 폰에서는 다시 안 뜬다.
export function BetaGuide({ id, title, steps, className = 'mt-4' }: { id: string; title: string; steps: GuideStep[]; className?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      const store = window.localStorage;
      const closed = store.getItem(guideKey(id)) === 'closed';
      const saved = Number(store.getItem(guideFirstKey(id)));
      const first = Number.isFinite(saved) && saved > 0 ? saved : null;
      if (first === null && !closed) store.setItem(guideFirstKey(id), String(Date.now()));
      setOpen(workerGuideOpen(Date.now(), first, closed));
    } catch { setOpen(true); }
  }, [id]);
  if (!open) return null;
  const close = () => {
    setOpen(false);
    try { window.localStorage.setItem(guideKey(id), 'closed'); } catch { /* 저장이 막힌 브라우저는 이번 화면에서만 닫는다 */ }
  };
  return <section aria-label="사용 안내" className={`${className} rounded-2xl border border-primary/20 bg-primary/5 p-4`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="text-[11px] font-bold text-primary">처음이세요? 이렇게 해요</p><h2 className="mt-0.5 text-[15px] font-extrabold leading-5 text-ink">{title}</h2></div>
      <button type="button" onClick={close} className="-mr-1 -mt-1 flex h-9 shrink-0 items-center rounded-lg px-2 text-[12px] font-bold text-sub active:bg-white">닫기</button>
    </div>
    <ol className="mt-3 space-y-2.5">
      {steps.map((step, index) => <li key={index} className="flex gap-2.5 text-[13px] leading-5 text-ink">
        <span aria-hidden="true" className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-extrabold text-white">{index + 1}</span>
        <span className="min-w-0 [overflow-wrap:anywhere]">{step.text}{step.href && step.cta && <> <Link href={step.href} className="whitespace-nowrap font-bold text-primary underline underline-offset-2">{step.cta} →</Link></>}</span>
      </li>)}
    </ol>
  </section>;
}
