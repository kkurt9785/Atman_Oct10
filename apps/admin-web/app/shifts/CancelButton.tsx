'use client';
import { useState, useTransition } from 'react';
import { cancelShiftAction } from '@/lib/actions/shifts';

// 브라우저 confirm 대신 2단계 버튼 — 브랜드 톤 유지 + 오터치 방지
export function CancelButton({ shiftId }: { shiftId: string }) {
  const [isPending, startTransition] = useTransition();
  const [arming, setArming] = useState(false);

  if (!arming) {
    return (
      <button
        onClick={() => setArming(true)}
        className="text-[12px] font-bold px-3 py-1.5 rounded-full border border-line text-sub active:bg-bg"
      >
        취소하기
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[12px] text-warn font-bold">워커에게 알림이 가요</span>
      <button
        onClick={() => startTransition(() => cancelShiftAction(shiftId))}
        disabled={isPending}
        className="text-[12px] font-bold px-3 py-1.5 rounded-full bg-red-50 text-red-600 disabled:opacity-40"
      >
        {isPending ? '취소 중...' : '취소 확정'}
      </button>
      <button
        onClick={() => setArming(false)}
        disabled={isPending}
        className="text-[12px] font-bold px-2.5 py-1.5 rounded-full border border-line text-sub"
      >
        닫기
      </button>
    </span>
  );
}
