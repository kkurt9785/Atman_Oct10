'use client';
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { rememberWorkerShell } from '@/lib/worker-mode';
import { parseInviteToken } from '@/lib/invite-link';

// 초대 링크 열기 — 키보드 없이 복사해 둔 링크를 한 번에 붙여 넣는다.
// 클립보드를 못 읽거나(권한·카카오톡 브라우저) 링크가 없을 때만 직접 붙여 넣는 칸을 연다. 칸은 자동으로 키보드를 띄우지 않는다.
export function InviteLinkPaste({ trigger, triggerClassName, beforeOpen }: { trigger: ReactNode; triggerClassName: string; beforeOpen?: () => Promise<void> }) {
  const router = useRouter();
  const [manual, setManual] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  async function open(text: string, fromClipboard: boolean) {
    const token = parseInviteToken(text);
    if (!token) {
      setManual(true);
      setError(fromClipboard
        ? '복사된 초대 링크가 없어요. 사장님이 보낸 링크를 길게 눌러 복사한 뒤 다시 누르거나, 아래 칸에 붙여 넣어 주세요.'
        : '사장님이 보낸 초대 링크 전체를 붙여 넣어 주세요.');
      return;
    }
    const target = `/gig/join?token=${encodeURIComponent(token)}`;
    if (beforeOpen) {
      // 시연 계정에서 내린 뒤 새로 연다 — 실제 초대는 내 계정으로 받는다
      await beforeOpen();
      rememberWorkerShell('gig');
      window.location.assign(target);
      return;
    }
    rememberWorkerShell('gig');
    router.push(target);
  }

  async function pasteFromClipboard() {
    setError('');
    try {
      await open(await navigator.clipboard.readText(), true);
    } catch {
      setManual(true);
      setError('아래 칸을 길게 눌러 초대 링크를 붙여 넣어 주세요.');
    }
  }

  return (
    <div>
      <button type="button" onClick={() => void pasteFromClipboard()} className={triggerClassName}>{trigger}</button>
      {manual && <div className="mt-2 flex gap-2">
        <input value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void open(value, false); }}
          placeholder="여기를 길게 눌러 붙여넣기" aria-label="초대 링크" inputMode="url"
          className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-[14px] outline-none focus:border-primary" />
        <button type="button" onClick={() => void open(value, false)} className="h-12 shrink-0 rounded-xl bg-primary px-4 text-[14px] font-extrabold text-white">열기</button>
      </div>}
      {error && <p role="alert" className="mt-2 text-[12px] font-bold leading-5 text-red-600">{error}</p>}
    </div>
  );
}
