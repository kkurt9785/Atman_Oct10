'use client';

import { useState, useTransition } from 'react';
import { approveWorkerAction, rejectWorkerAction } from '@/lib/actions/workers';
import type { PendingWorker } from '@/lib/db/workers';

const ROLE_LABEL: Record<string, string> = { rn: '간호사 RN', na: '간호조무사 NA' };

export function WorkerApprovalCard({ worker }: { worker: PendingWorker }) {
  const [isPending, startTransition] = useTransition();
  const [photoOpen, setPhotoOpen] = useState(false);
  const [done, setDone] = useState<'approved' | 'rejected' | null>(null);
  const [arming, setArming] = useState<'approve' | 'reject' | null>(null);
  const [actionError, setActionError] = useState('');

  function run(kind: 'approve' | 'reject') {
    setActionError('');
    startTransition(async () => {
      try {
        if (kind === 'approve') { await approveWorkerAction(worker.id); setDone('approved'); }
        else { await rejectWorkerAction(worker.id); setDone('rejected'); }
      } catch {
        setActionError(kind === 'approve' ? '승인 처리에 실패했어요. 잠시 후 다시 시도해 주세요.' : '거절 처리에 실패했어요. 잠시 후 다시 시도해 주세요.');
      } finally {
        setArming(null);
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

          {/* 승인/거절 버튼 — 2단계 확인 */}
          <div className="flex flex-col gap-2 flex-shrink-0">
            {arming === null ? (
              <>
                <button
                  onClick={() => setArming('approve')}
                  disabled={isPending}
                  className="text-label font-bold px-4 py-2 rounded-xl bg-success/15 text-success active:opacity-70 disabled:opacity-40"
                >
                  승인
                </button>
                <button
                  onClick={() => setArming('reject')}
                  disabled={isPending}
                  className="text-label font-bold px-4 py-2 rounded-xl bg-line text-sub active:opacity-70 disabled:opacity-40"
                >
                  거절
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => run(arming)}
                  disabled={isPending}
                  className={`text-label font-bold px-4 py-2 rounded-xl active:opacity-70 disabled:opacity-40 ${arming === 'approve' ? 'bg-success text-white' : 'bg-red-50 text-red-600'}`}
                >
                  {isPending ? '처리 중' : arming === 'approve' ? `${worker.name}님 승인 확정` : `${worker.name}님 거절 확정`}
                </button>
                <button
                  onClick={() => setArming(null)}
                  disabled={isPending}
                  className="text-label font-bold px-4 py-2 rounded-xl border border-line text-sub"
                >
                  취소
                </button>
              </>
            )}
          </div>
        </div>
        {actionError && (
          <p role="alert" className="mt-2 rounded-xl bg-red-50 text-red-600 text-[13px] font-bold px-3 py-2">{actionError}</p>
        )}
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
