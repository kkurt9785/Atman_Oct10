'use client';
import { useState } from 'react';
import { endDemoSession, leaveDemoToStart } from '@/lib/demo-session';
import { KakaoGlyph } from '@/lib/kakao-login';

// 시연에서 나가는 자리는 로그아웃이 아니라 가입으로 잇는다.
// 시연 계정은 여러 사람이 같이 써서 동의 변경·탈퇴는 DB에서도 막혀 있다(20261005100000).

function SignupButton({ label = '시연 끝내고 가입하기' }: { label?: string }) {
  const [leaving, setLeaving] = useState(false);
  return (
    <button type="button" disabled={leaving} onClick={() => { setLeaving(true); void endDemoSession(); }}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-btn bg-kakao text-[15px] font-extrabold text-ink active:opacity-80 disabled:opacity-60">
      <KakaoGlyph />{leaving ? '여는 중...' : label}
    </button>
  );
}

// 내 정보 맨 아래 — 시연 계정이면 개인정보(동의·탈퇴)와 로그아웃 대신 보여 준다
export function DemoSignupCard() {
  return (
    <section className="mt-4 rounded-2xl bg-ink p-5 text-white">
      <p className="text-[11px] font-extrabold text-white/60">지금은 시연 화면이에요</p>
      <p className="mt-1 text-[17px] font-extrabold leading-snug">마음에 드셨다면 내 계정으로 시작하세요</p>
      <p className="mt-1.5 text-[12px] leading-5 text-white/70">카카오로 바로 가입돼요. 시연 계정은 여러 분이 같이 써서 알림 동의 변경·탈퇴는 할 수 없어요.</p>
      <div className="mt-4"><SignupButton /></div>
    </section>
  );
}

// 시연 중 나가려 할 때(초대 확인 화면 뒤로가기 등) — 가입 / 다른 시연 / 계속 둘러보기
export function DemoEndSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="demo-end-title" onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl bg-white px-6 pb-[calc(20px+env(safe-area-inset-bottom))] pt-6">
        <p className="text-[12px] font-extrabold text-primary">시연 중</p>
        <h2 id="demo-end-title" className="mt-1 text-[20px] font-extrabold text-ink">시연을 끝낼까요?</h2>
        <p className="mt-2 text-[14px] leading-6 text-sub">가입하면 사장님이 보낸 초대를 내 계정으로 연결하고, 출근하기·지급 확인을 바로 쓸 수 있어요.</p>
        <div className="mt-5"><SignupButton /></div>
        <button type="button" onClick={() => void leaveDemoToStart()} className="mt-2 h-11 w-full rounded-btn border border-line text-[14px] font-bold text-ink">다른 시연 보기</button>
        <button type="button" onClick={onClose} className="mt-1 h-11 w-full text-[14px] font-bold text-sub">계속 둘러보기</button>
      </div>
    </div>
  );
}
