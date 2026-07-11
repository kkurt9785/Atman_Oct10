'use client';

import { useState, useTransition } from 'react';
import { approveWorkerAction, rejectWorkerAction } from '@/lib/actions/workers';
import type { PendingWorker } from '@/lib/db/workers';

const ROLE_LABEL: Record<string, string> = { rn: '간호사 RN', na: '간호조무사 NA' };

export function WorkerApprovalCard({ worker }: { worker: PendingWorker }) {
  const [isPending, startTransition] = useTransition();
  const [photoOpen, setPhotoOpen] = useState(false);
  const [done, setDone] = useState<'approved' | 'rejected' | null>(null);

  function handleApprove() {
    if (!confirm(`${worker.name}님을 승인할까요?`)) return;
    startTransition(async () => {
      try {
        await approveWorkerAction(worker.id);
        setDone('approved');
      } catch {
        alert('승인 처리에 실패했습니다. 새로고침 후 다시 시도해주세요.');
      }
    });
  }

  function handleReject() {
    if (!confirm(`${worker.name}님을 거절할까요?`)) return;
    startTransition(async () => {
      try {
        await rejectWorkerAction(worker.id);
        setDone('rejected');
      } catch {
        alert('거절 처리에 실패했습니다. 새로고침 후 다시 시도해주세요.');
      }
    });
  }

  if (done) {
    return (
      <div className="flex items-center justify-between px-5 py-4 opacity-50">
        <p className="text-body text-sub line-through">{worker.name}</p>
        <span className={`text-label font-bold px-3 py-1 rounded-full ${done === 'approved' ? 'bg-success/15 text-success' : 'bg-line text-sub'}`}>
          {done === 'approved' ? '승인됨' : '거절됨'}
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-body font-bold text-ink">{worker.name}</p>
            <p className="text-label text-sub">{ROLE_LABEL[worker.role]} · {worker.phone ?? '-'}</p>

            {/* 면허 정보 */}
            <div className="mt-2">
              {worker.licensePhotoUrl ? (
                <button
                  onClick={() => setPhotoOpen(true)}
                  className="text-label font-bold text-primary underline underline-offset-2"
                >
                  면허 사진 보기
                </button>
              ) : worker.licenseNumber ? (
                <p className="text-label text-sub">면허번호: 제{worker.licenseNumber}호</p>
              ) : (
                <p className="text-label text-warn">면허 정보 없음</p>
              )}
            </div>
          </div>

          {/* 승인/거절 버튼 */}
          <div className="flex flex-col gap-2 flex-shrink-0">
            <button
              onClick={handleApprove}
              disabled={isPending}
              className="text-label font-bold px-4 py-2 rounded-xl bg-success/15 text-success active:opacity-70 disabled:opacity-40"
            >
              {isPending ? '처리 중' : '승인'}
            </button>
            <button
              onClick={handleReject}
              disabled={isPending}
              className="text-label font-bold px-4 py-2 rounded-xl bg-line text-sub active:opacity-70 disabled:opacity-40"
            >
              {isPending ? '처리 중' : '거절'}
            </button>
          </div>
        </div>
      </div>

      {/* 면허 사진 풀스크린 */}
      {photoOpen && worker.licensePhotoUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPhotoOpen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={worker.licensePhotoUrl}
            alt="면허증"
            className="max-w-full max-h-full rounded-xl object-contain"
          />
        </div>
      )}
    </>
  );
}
