'use client';
import { useState, useTransition } from 'react';
import { cancelShiftAction } from '@/lib/actions/shifts';

// 브라우저 confirm 대신 2단계 버튼 — 브랜드 톤 유지 + 오터치 방지
export function CancelButton({ shiftId, matched = false }: { shiftId: string; matched?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [arming, setArming] = useState(false);
  const [message, setMessage] = useState('');

  if (!arming) {
    return (
      <button
        onClick={() => { setMessage(''); setArming(true); }}
        className="text-[0.75rem] font-bold px-3 py-1.5 rounded-full border border-line text-sub active:bg-bg"
      >
        취소하기
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
      <span className="text-[0.75rem] text-warn font-bold">{matched ? '확정된 근무자의 근무도 취소되고 알림이 가요' : '지원자에게 알림이 가요'}</span>
      <button
        onClick={() => startTransition(async () => {
          const result = await cancelShiftAction(shiftId);
          if (result && !result.ok) setMessage(result.message);
        })}
        disabled={isPending}
        className="text-[0.75rem] font-bold px-3 py-1.5 rounded-full bg-red-50 text-red-600 disabled:opacity-40"
      >
        {isPending ? '취소 중...' : '취소 확정'}
      </button>
      <button
        onClick={() => setArming(false)}
        disabled={isPending}
        className="text-[0.75rem] font-bold px-2.5 py-1.5 rounded-full border border-line text-sub"
      >
        닫기
      </button>
      {message && <span role="alert" className="w-full text-right text-[0.75rem] font-bold text-red-600">{message}</span>}
    </span>
  );
}
