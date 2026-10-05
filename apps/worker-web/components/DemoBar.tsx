'use client';
import { useState } from 'react';
import { endDemoSession, type DemoKind } from '@/lib/demo-session';
import { KakaoGlyph } from '@/lib/kakao-login';
import { DemoEndSheet } from './DemoSignup';

// 시연 중에는 어느 화면에서든 바로 실제로 시작할 수 있게 — 하단 탭 위(설치 안내 자리)에 띄운다.
//   · 근무 찾기 시연: 바로 카카오 가입
//   · 초대 근무 시연: 초대 링크가 있어야 시작되므로 시트(받은 링크 붙여넣기 / 사장님께 요청)
export function DemoBar({ kind, aboveNav }: { kind: DemoKind; aboveNav: boolean }) {
  const [leaving, setLeaving] = useState(false);
  const [sheet, setSheet] = useState(false);
  function start() {
    if (kind === 'gig') { setSheet(true); return; }
    setLeaving(true);
    void endDemoSession();
  }
  return (
    <>
      <div role="region" aria-label="시연 안내"
        className={`fixed inset-x-3 z-40 mx-auto flex max-w-app items-center gap-2 rounded-2xl bg-ink px-3 py-2.5 text-white shadow-lg ${aboveNav ? 'bottom-[calc(64px+env(safe-area-inset-bottom))]' : 'bottom-[calc(12px+env(safe-area-inset-bottom))]'}`}>
        <span className="min-w-0 flex-1 leading-4">
          <span className="block text-[11px] font-bold text-white/60">지금은 시연 화면이에요</span>
          <span className="block text-[13px] font-extrabold">마음에 들면 바로 시작하세요</span>
        </span>
        <button type="button" disabled={leaving} onClick={start}
          className={`flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[13px] font-extrabold active:opacity-80 disabled:opacity-60 ${kind === 'gig' ? 'bg-primary text-white' : 'bg-kakao text-ink'}`}>
          {kind === 'gig' ? '실제로 시작' : <><KakaoGlyph />{leaving ? '여는 중...' : '가입하고 시작'}</>}
        </button>
      </div>
      {sheet && <DemoEndSheet kind={kind} onClose={() => setSheet(false)} />}
    </>
  );
}
