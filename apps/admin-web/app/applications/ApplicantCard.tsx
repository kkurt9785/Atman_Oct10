'use client';
import { useState } from 'react';
import { acceptApplication, rejectApplication } from './actions';
import type { Applicant } from '@/lib/db/applications';

const ROLE_LABEL: Record<string, string> = { rn: 'RN', na: 'NA' };
const ROLE_COLOR: Record<string, string> = {
  rn: 'bg-primary/10 text-primary',
  na: 'bg-teal-50 text-teal-600',
};

function km(m: number | null) {
  if (m == null) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`;
}

export function ApplicantCard({
  applicant,
  shiftId,
  disabled,
}: {
  applicant: Applicant;
  shiftId: string;
  disabled: boolean;
}) {
  const [loading, setLoading] = useState<'accept' | 'reject' | null>(null);

  async function handleAccept() {
    setLoading('accept');
    await acceptApplication(applicant.applicationId, shiftId, applicant.workerId);
    setLoading(null);
  }

  async function handleReject() {
    setLoading('reject');
    await rejectApplication(applicant.applicationId);
    setLoading(null);
  }

  return (
    <div className="flex items-center justify-between py-4 px-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-bg flex items-center justify-center text-xl">👤</div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-body font-bold text-ink">{applicant.name}</span>
            <span className={`text-label font-bold px-2 py-0.5 rounded-full ${ROLE_COLOR[applicant.role] ?? 'bg-line text-sub'}`}>
              {ROLE_LABEL[applicant.role] ?? applicant.role}
            </span>
            {applicant.verificationStatus === 'approved' && (
              <span className="text-label text-success font-semibold">✓인증</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {applicant.distanceMeters != null && (
              <span className="text-label text-sub">{km(applicant.distanceMeters)}</span>
            )}
            {applicant.matchScore != null && (
              <span className="text-label text-sub">매칭 {Math.round(applicant.matchScore)}점</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleReject}
          disabled={disabled || loading != null}
          className="h-9 px-4 rounded-lg border border-line text-sub text-label font-semibold disabled:opacity-40 active:bg-bg"
        >
          {loading === 'reject' ? '...' : '거절'}
        </button>
        <button
          onClick={handleAccept}
          disabled={disabled || loading != null}
          className="h-9 px-4 rounded-lg bg-primary text-white text-label font-semibold disabled:opacity-40 active:opacity-80"
        >
          {loading === 'accept' ? '...' : '수락'}
        </button>
      </div>
    </div>
  );
}
