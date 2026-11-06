import type { ReactNode } from 'react';
import type { BrowserInfo } from '@/lib/in-app-browser';
import type { InstallStep, InstallStepIcon } from '@/lib/install-steps';

export { installStepsFor } from '@/lib/install-steps';

// 홈 화면에 추가하는 단계를 그 브라우저의 실제 버튼 모양으로 보여 준다. 어떤 단계인지는 lib/install-steps.ts 가 정한다.

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const ICONS: Record<InstallStepIcon, ReactNode> = {
  more: <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true"><circle cx="12" cy="12" r="9.5" {...stroke} /><circle cx="7.6" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="16.4" cy="12" r="1.3" fill="currentColor" /></svg>,
  share: <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true"><path d="M8 9H6.5A1.5 1.5 0 0 0 5 10.5v8A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 17.5 9H16" {...stroke} /><path d="M12 14V3.5M8.5 7 12 3.5 15.5 7" {...stroke} /></svg>,
  add: <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" {...stroke} /><path d="M12 8.5v7M8.5 12h7" {...stroke} /></svg>,
  done: <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" {...stroke} /></svg>,
  kebab: <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true"><circle cx="12" cy="5.5" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="18.5" r="1.6" fill="currentColor" /></svg>,
  menu: <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" {...stroke} /></svg>,
  install: <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" {...stroke} /><path d="M12 7.5v7M9.2 11.8 12 14.6l2.8-2.8" {...stroke} /></svg>,
};

export function InstallSteps({ steps, className = '' }: { steps: InstallStep[]; className?: string }) {
  return (
    <ol className={`space-y-1.5 ${className}`} aria-label="홈 화면에 추가하는 순서">
      {steps.map((step, index) => (
        <li key={step.title} className="flex min-h-12 items-center gap-3 rounded-2xl bg-bg px-3 py-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-extrabold text-white">{index + 1}</span>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-primary shadow-card">{ICONS[step.icon]}</span>
          <span className="min-w-0">
            <span className="block text-[15px] font-extrabold leading-5 text-ink">{step.title}</span>
            {step.hint && <span className="mt-0.5 block text-[12px] leading-4 text-sub">{step.hint}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}


/** 눌러야 할 자리 그림 띠 — 그림이 있는 단계만, 옆으로 넘겨 본다(첫 화면에 단계 목록이 남게 높이를 낮게) */
export function InstallGallery({ steps, className = '' }: { steps: InstallStep[]; className?: string }) {
  const pictured = steps.map((step, index) => ({ step, index })).filter(({ step }) => step.image);
  if (pictured.length === 0) return null;
  return (
    <div className={`-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`} aria-label="눌러야 할 자리 그림">
      {pictured.map(({ step, index }) => (
        <figure key={step.title} className="w-[78%] shrink-0 snap-start overflow-hidden rounded-2xl border border-line bg-white">
          <img src={step.image!.src} alt={step.image!.alt} width={680} height={300} loading="lazy" decoding="async" className="block aspect-[680/300] w-full object-cover" />
          <figcaption className="flex items-center gap-2 px-3 py-1.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-extrabold text-white">{index + 1}</span>
            <span className="truncate text-[12px] font-bold text-ink">{step.title}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/** 사파리 아래 막대의 눌러야 할 버튼 쪽을 가리키는 화살표(iOS 26 이상은 오른쪽 ⋯, 그 전은 가운데 공유) */
export function SafariToolbarPointer({ info }: { info: BrowserInfo }) {
  if (!info.safari || info.safariMajor === null) return null;
  const modern = info.safariMajor >= 26;
  return (
    <div aria-hidden="true" className={`pointer-events-none fixed bottom-[calc(6px+env(safe-area-inset-bottom))] z-40 flex flex-col items-center ${modern ? 'right-4' : 'left-1/2 -translate-x-1/2'}`}>
      <span className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-extrabold text-white">{modern ? '⋯ 여기' : '공유 여기'}</span>
      <span className="mt-0.5 animate-bounce text-[22px] leading-none text-ink">↓</span>
    </div>
  );
}
