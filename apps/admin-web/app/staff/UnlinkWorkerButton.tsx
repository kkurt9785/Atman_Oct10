'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { runWorkforceAction } from '@/lib/actions/clinic-workforce';
import { CopyInviteButton } from './CopyInviteButton';

// 초대 링크는 소지자 인증이라 다른 사람이 수락할 수 있다. 한 번에 연결을 끊고 새 일회용 초대를 손에 쥐어 준다.
export function UnlinkWorkerButton({ staffId, name, accountName, inviteUrlBase, align = 'end' }: {
  staffId: string; name: string; accountName: string | null; inviteUrlBase: string; align?: 'start' | 'end';
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  async function unlink() {
    const who = accountName && accountName !== name ? `${name}(계정 ${accountName})` : name;
    if (!window.confirm(`${who}님의 계정 연결을 해제할까요?\n전달받은 지급 계좌도 회수되고, 새 일회용 초대가 만들어져요. 근태·정산 기록은 남습니다.`)) return;
    setLoading(true); setError('');
    const data = new FormData(); data.set('staff_id', staffId);
    const result = await runWorkforceAction('unlink_worker', data);
    setLoading(false);
    if (!result.ok) { setError(result.error ?? '해제하지 못했어요.'); return; }
    const token = (result.data as { inviteToken?: string } | undefined)?.inviteToken;
    setInviteUrl(token ? `${inviteUrlBase}?token=${token}` : '');
    router.refresh();
  }
  if (inviteUrl) return <div className="mt-2 rounded-xl border border-warn/30 bg-warn/5 p-3">
    <p className="text-[12px] font-extrabold text-ink">연결을 해제했어요 · 본인에게 새 초대를 보내 주세요</p>
    <div className="mt-2"><CopyInviteButton url={inviteUrl} primary /></div>
  </div>;
  return <div className={`flex flex-col ${align === 'end' ? 'items-end' : 'items-start'}`}>
    <button type="button" onClick={() => void unlink()} disabled={loading} className="text-[11px] font-bold text-sub disabled:opacity-50">{loading ? '해제 중…' : '연결 해제·재초대'}</button>
    {error && <p role="alert" className="mt-1 text-[11px] font-bold text-red-600">{error}</p>}
  </div>;
}
