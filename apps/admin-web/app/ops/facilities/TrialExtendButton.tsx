'use client';

import { useState, useTransition } from 'react';
import { extendFacilityTrialAction } from '@/lib/actions/platform';

// 체험 30일 연장 — 실수로 누르지 않게 한 번 더 확인한다.
export function TrialExtendButton({ facilityId, name }: { facilityId: string; name: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function extend() {
    if (!window.confirm(`${name}의 무료 체험을 30일 연장할까요?`)) return;
    setMessage(null);
    startTransition(async () => {
      const r = await extendFacilityTrialAction({ facilityId });
      setMessage(r.ok ? `${r.trialEndsAt}까지` : r.error ?? '연장하지 못했어요.');
    });
  }

  return (
    <span className="flex flex-col items-end">
      <button type="button" disabled={isPending} onClick={extend} className="rounded-xl bg-bg px-3 py-2 text-[0.8125rem] font-bold text-ink disabled:opacity-60">{isPending ? '연장 중…' : '30일 연장'}</button>
      {message && <span role="status" className="mt-0.5 max-w-[9rem] text-right text-[0.6875rem] text-sub">{message}</span>}
    </span>
  );
}
