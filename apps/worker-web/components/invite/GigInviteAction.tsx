'use client';
import { useState } from 'react';
import { InviteLinkPaste } from '@/components/invite/InviteLinkPaste';
import { openDemoSession, useDemoSession } from '@/lib/demo-session';

// 초대 근무가 아직 없을 때 빈 화면의 다음 행동(오늘·대화·근태 탭 공통).
//   · 내 계정: 사장님이 보낸 초대 링크를 한 번에 붙여 넣는다
//   · 초대 근무 시연: 초대 확인 화면을 다시 연다(시연 입구와 같은 흐름 — 처음 상태로 돌아온다)
//   · 근무 찾기 시연 계정: 실제 초대는 받을 수 없으니 아무것도 띄우지 않는다
export function GigInviteAction() {
  const demo = useDemoSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (demo === null || demo === 'medical') return null;

  if (demo === 'gig') {
    return (
      <div className="mt-4">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              window.location.assign(await openDemoSession('gig'));
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : '초대 확인 화면을 열지 못했어요.');
              setBusy(false);
            }
          }}
          className="h-12 w-full rounded-xl bg-primary text-[14px] font-extrabold text-white disabled:opacity-60"
        >
          {busy ? '여는 중…' : '초대 확인 화면 열기'}
        </button>
        {error && <p role="alert" className="mt-2 text-[12px] font-bold text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-4 text-left">
      <InviteLinkPaste trigger="받은 초대 링크 붙여넣기" triggerClassName="h-12 w-full rounded-xl bg-primary text-[14px] font-extrabold text-white" />
    </div>
  );
}
