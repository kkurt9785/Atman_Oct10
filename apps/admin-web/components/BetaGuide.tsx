'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { GUIDE_KEY_PREFIX, guideKey } from '@/lib/guide-window';

export type GuideStep = { text: string; href?: string; cta?: string; done?: boolean };

// 베타 기간 사용 안내 카드. 보일지 말지(기간)는 서버가 정해서 그릴 때만 넣는다 — lib/db/guide.ts
// 닫으면 이 폰에서는 그 화면에 다시 안 뜬다. 단계가 모두 끝나면(done) 스스로 사라진다.
export function BetaGuide({ id, title, steps, note, className = 'mb-4' }: { id: string; title: string; steps: GuideStep[]; note?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try { setOpen(window.localStorage.getItem(guideKey(id)) !== 'closed'); } catch { setOpen(true); }
  }, [id]);
  if (!open || steps.every((step) => step.done)) return null;
  const close = () => {
    setOpen(false);
    try { window.localStorage.setItem(guideKey(id), 'closed'); } catch { /* 저장이 막힌 브라우저는 이번 화면에서만 닫는다 */ }
  };
  return <section aria-label="사용 안내" className={`${className} rounded-2xl border border-primary/20 bg-primary/5 p-4 print:hidden`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="text-[0.6875rem] font-bold text-primary">처음이세요? 이렇게 해요</p><h2 className="mt-0.5 text-[0.9375rem] font-extrabold leading-5 text-ink">{title}</h2></div>
      <button type="button" onClick={close} className="-mr-1 -mt-1 flex h-9 shrink-0 items-center rounded-lg px-2 text-[0.75rem] font-bold text-sub active:bg-white">닫기</button>
    </div>
    <ol className="mt-3 space-y-2.5">
      {steps.map((step, index) => <li key={index} className="flex gap-2.5 text-[0.8125rem] leading-5">
        <span aria-hidden="true" className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-extrabold text-white ${step.done ? 'bg-success' : 'bg-primary'}`}>{step.done ? '✓' : index + 1}</span>
        <span className={`min-w-0 [overflow-wrap:anywhere] ${step.done ? 'text-sub' : 'text-ink'}`}>{step.done && <span className="sr-only">완료: </span>}{step.text}{step.href && step.cta && !step.done && <> <Link href={step.href} className="whitespace-nowrap font-bold text-primary underline underline-offset-2">{step.cta} →</Link></>}</span>
      </li>)}
    </ol>
    {note && <p className="mt-3 text-[0.6875rem] leading-4 text-sub">{note}</p>}
  </section>;
}

// 설정의 "사용 안내 다시 보기" — 이 폰에서 닫아 둔 안내를 모두 다시 켠다.
export function GuideResetButton() {
  const [done, setDone] = useState(false);
  const reset = () => {
    try {
      const keys: string[] = [];
      for (let i = 0; i < window.localStorage.length; i += 1) { const key = window.localStorage.key(i); if (key?.startsWith(GUIDE_KEY_PREFIX)) keys.push(key); }
      keys.forEach((key) => window.localStorage.removeItem(key));
    } catch { /* 저장이 막힌 브라우저는 닫아 둔 기록도 없다 */ }
    setDone(true);
  };
  return <div className="rounded-2xl border border-line bg-white p-4">
    <p className="text-[0.875rem] font-extrabold text-ink">사용 안내</p>
    <p className="mt-1 text-[0.75rem] leading-5 text-sub">처음 쓰는 화면 위에 뜨는 안내예요. 닫아 둔 안내를 다시 볼 수 있어요.</p>
    <button type="button" onClick={reset} className="mt-3 h-10 rounded-xl border border-line px-4 text-[0.8125rem] font-bold text-ink active:bg-bg">사용 안내 다시 보기</button>
    {done && <p role="status" className="mt-2 text-[0.75rem] font-bold text-success">다시 켰어요. 홈·직원 관리·출퇴근 인증 화면에서 보여요.</p>}
  </div>;
}
