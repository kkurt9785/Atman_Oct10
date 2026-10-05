'use client';
import { useState } from 'react';
import { endDemoSession, leaveDemo, leaveDemoToStart, type DemoKind } from '@/lib/demo-session';
import { KakaoGlyph } from '@/lib/kakao-login';
import { InviteLinkPaste } from '@/components/invite/InviteLinkPaste';

// 시연에서 나가는 자리는 로그아웃이 아니라 실제 시작으로 잇는다.
//   · 근무 찾기 시연 → 카카오로 바로 가입(직군·지역 등록 → 근처 근무 알림)
//   · 초대 근무 시연 → 실제 초대는 사장님 링크로만 시작한다. 받은 링크 붙여넣기 / 링크가 없으면 사장님께 보낼 요청 문구
//     (가입부터 하면 직군(간호사·약사 등)을 고르는 근무 찾기 가입으로 가서 단기 알바는 막힌다)
// 시연 계정은 여러 사람이 같이 써서 동의 변경·탈퇴·실제 초대 수락은 DB에서도 막혀 있다(20261005100000, 20261005110000).

const OWNER_REQUEST = '사장님, 출퇴근 기록을 잇닿 앱으로 하고 싶어요. 관리자 앱(admin.itdot.co.kr)에서 저를 근무자로 초대해 주시면 링크로 바로 연결할게요.';

function SignupButton({ label = '시연 끝내고 가입하기' }: { label?: string }) {
  const [leaving, setLeaving] = useState(false);
  return (
    <button type="button" disabled={leaving} onClick={() => { setLeaving(true); void endDemoSession(); }}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-btn bg-kakao text-[15px] font-extrabold text-ink active:opacity-80 disabled:opacity-60">
      <KakaoGlyph />{leaving ? '여는 중...' : label}
    </button>
  );
}

// 초대 근무 시연에서 실제로 시작하는 길
function GigStartOptions() {
  const [copied, setCopied] = useState(false);
  async function copyRequest() {
    try { await navigator.clipboard.writeText(OWNER_REQUEST); setCopied(true); } catch { setCopied(false); }
  }
  return (
    <div>
      <InviteLinkPaste beforeOpen={leaveDemo}
        triggerClassName="h-12 w-full rounded-btn bg-primary text-[15px] font-extrabold text-white active:opacity-80"
        trigger="받은 초대 링크 붙여넣기" />
      <div className="mt-3 rounded-xl bg-bg p-3">
        <p className="text-[12px] font-bold text-ink">아직 초대 링크가 없다면</p>
        <p className="mt-0.5 text-[12px] leading-5 text-sub">사장님께 아래 문구를 보내 주세요. 사장님이 초대하면 링크가 와요.</p>
        <button type="button" onClick={() => void copyRequest()} className="mt-2 h-10 w-full rounded-lg border border-line bg-white text-[13px] font-extrabold text-ink active:bg-bg">
          {copied ? '복사했어요 · 카톡으로 보내 주세요' : '사장님께 보낼 문구 복사'}
        </button>
      </div>
      <button type="button" onClick={() => void endDemoSession()} className="mt-2 h-10 w-full text-[12px] font-bold text-sub">
        병원·약국 근무를 찾는다면 <span className="text-primary">근무 찾기로 가입 →</span>
      </button>
    </div>
  );
}

// 내 정보 맨 아래 — 시연 계정이면 개인정보(동의·탈퇴)와 로그아웃 대신 보여 준다
export function DemoSignupCard({ kind }: { kind: DemoKind }) {
  if (kind === 'gig') {
    return (
      <section className="mt-4 rounded-2xl border border-primary/20 bg-white p-5 shadow-sm">
        <p className="text-[11px] font-extrabold text-primary">지금은 시연 화면이에요</p>
        <p className="mt-1 text-[17px] font-extrabold leading-snug text-ink">초대 근무는 사장님 링크로 시작해요</p>
        <p className="mt-1.5 text-[12px] leading-5 text-sub">받은 링크를 열면 카카오로 가입하고 바로 연결돼요. 시연 계정은 여러 분이 같이 써서 알림 동의 변경·탈퇴는 할 수 없어요.</p>
        <div className="mt-4"><GigStartOptions /></div>
      </section>
    );
  }
  return (
    <section className="mt-4 rounded-2xl bg-ink p-5 text-white">
      <p className="text-[11px] font-extrabold text-white/60">지금은 시연 화면이에요</p>
      <p className="mt-1 text-[17px] font-extrabold leading-snug">마음에 드셨다면 내 계정으로 시작하세요</p>
      <p className="mt-1.5 text-[12px] leading-5 text-white/70">카카오로 가입하고 직군·지역만 고르면 근처 새 근무를 알림으로 받아요. 시연 계정은 여러 분이 같이 써서 알림 동의 변경·탈퇴는 할 수 없어요.</p>
      <div className="mt-4"><SignupButton /></div>
    </section>
  );
}

// 시연 중 나가려 할 때(초대 확인 화면 뒤로가기, 하단 띠의 '실제로 시작') — 실제 시작 / 다른 시연 / 계속 둘러보기
export function DemoEndSheet({ kind, onClose }: { kind: DemoKind; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="demo-end-title" onClick={(event) => event.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white px-6 pb-[calc(20px+env(safe-area-inset-bottom))] pt-6">
        <p className="text-[12px] font-extrabold text-primary">시연 중</p>
        <h2 id="demo-end-title" className="mt-1 text-[20px] font-extrabold text-ink">{kind === 'gig' ? '실제로 시작해 볼까요?' : '시연을 끝낼까요?'}</h2>
        <p className="mt-2 text-[14px] leading-6 text-sub">{kind === 'gig'
          ? '초대 근무는 사장님이 보낸 초대 링크로 시작해요. 링크를 열면 카카오로 가입하고 출근하기·지급 확인을 내 계정으로 써요.'
          : '카카오로 가입하고 직군·지역만 고르면, 근처에 새 근무가 열릴 때 알림으로 받아요.'}</p>
        <div className="mt-5">{kind === 'gig' ? <GigStartOptions /> : <SignupButton />}</div>
        <button type="button" onClick={() => void leaveDemoToStart()} className="mt-2 h-11 w-full rounded-btn border border-line text-[14px] font-bold text-ink">다른 시연 보기</button>
        <button type="button" onClick={onClose} className="mt-1 h-11 w-full text-[14px] font-bold text-sub">계속 둘러보기</button>
      </div>
    </div>
  );
}
