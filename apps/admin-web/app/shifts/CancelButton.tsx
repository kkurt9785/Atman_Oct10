'use client';
import { useTransition } from 'react';
import { cancelShiftAction } from '@/lib/actions/shifts';

export function CancelButton({ shiftId }: { shiftId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleCancel() {
    if (!confirm('이 시프트를 취소할까요?\n지원한 워커에게 알림이 갑니다.')) return;
    startTransition(() => cancelShiftAction(shiftId));
  }

  return (
    <button
      onClick={handleCancel}
      disabled={isPending}
      className="text-[12px] font-bold px-3 py-1.5 rounded-full border border-line text-sub active:bg-bg disabled:opacity-40"
    >
      {isPending ? '취소 중...' : '취소하기'}
    </button>
  );
}
