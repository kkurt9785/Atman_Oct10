'use client';

import { useState } from 'react';
import { WorkforceActionForm } from '@/components/WorkforceActionForm';
import { CopyInviteButton } from './CopyInviteButton';

// 잇닿 채용으로 매칭된 워커를 직원 관리로 옮길 때도 본인이 초대를 수락해야 계정·계좌가 연결된다.
export function ConvertWorkerForm({ workerId, workerOrigin }: { workerId: string; workerOrigin: string }) {
  const [inviteUrl, setInviteUrl] = useState('');
  if (inviteUrl) return <div className="mt-3 rounded-xl border border-success/30 bg-success/5 p-3">
    <p className="text-[0.75rem] font-extrabold text-ink">직원 관리에 등록했어요 · 본인이 수락해야 연결돼요</p>
    <div className="mt-2"><CopyInviteButton url={inviteUrl} primary /></div>
  </div>;
  // 시간 칸을 3열에 넣으면 '오전 09:00'이 잘려서 2열 + 라벨, 버튼은 아래 전폭으로
  return <WorkforceActionForm kind="convert_worker" values={{ worker_id: workerId }} className="grid grid-cols-2 gap-2 mt-3" successMessage="직원 관리에 등록했어요."
    onSuccess={(raw) => { const token = (raw as { inviteToken?: string | null } | undefined)?.inviteToken; setInviteUrl(token ? `${workerOrigin}/workplace/join?token=${token}` : ''); }}>
    <label className="text-[0.75rem] text-sub">기본 출근<input name="default_start_time" type="time" defaultValue="09:00" className="mt-1 h-11 w-full rounded-lg border border-line px-2 text-[0.875rem] text-ink" /></label>
    <label className="text-[0.75rem] text-sub">기본 퇴근<input name="default_end_time" type="time" defaultValue="18:00" className="mt-1 h-11 w-full rounded-lg border border-line px-2 text-[0.875rem] text-ink" /></label>
    <button className="col-span-2 h-11 rounded-lg bg-primary/10 text-primary text-[0.8125rem] font-bold">직원 전환 초대</button>
  </WorkforceActionForm>;
}
