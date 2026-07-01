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
  const [licenseOpen, setLicenseOpen] = useState(false);

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

  const hasProfile = applicant.experienceYears || applicant.lastWorkplace || applicant.departmentTags?.length;
  const hasLicense = applicant.licenseNumber || applicant.licensePhotoUrl;

  return (
    <div className="py-4 px-5">
      {/* 상단: 이름 + 역할 + 거리 + 버튼 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-bg flex items-center justify-center text-xl flex-shrink-0">👤</div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[15px] font-bold text-ink">{applicant.name}</span>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${ROLE_COLOR[applicant.role] ?? 'bg-line text-sub'}`}>
                {ROLE_LABEL[applicant.role] ?? applicant.role}
              </span>
              {applicant.verificationStatus === 'approved' && (
                <span className="text-[11px] text-success font-semibold">✓인증</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {applicant.distanceMeters != null && (
                <span className="text-[12px] text-sub">{km(applicant.distanceMeters)}</span>
              )}
              {applicant.matchScore != null && (
                <span className="text-[12px] text-sub">매칭 {Math.round(applicant.matchScore)}점</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2 flex-shrink-0 ml-2">
          <button
            onClick={handleReject}
            disabled={disabled || loading != null}
            className="h-9 px-4 rounded-lg border border-line text-sub text-[13px] font-semibold disabled:opacity-40 active:bg-bg"
          >
            {loading === 'reject' ? '...' : '거절'}
          </button>
          <button
            onClick={handleAccept}
            disabled={disabled || loading != null}
            className="h-9 px-4 rounded-lg bg-primary text-white text-[13px] font-semibold disabled:opacity-40 active:opacity-80"
          >
            {loading === 'accept' ? '...' : '수락'}
          </button>
        </div>
      </div>

      {/* 프로필 정보 */}
      {hasProfile && (
        <div className="mt-3 ml-[52px] flex flex-col gap-1.5">
          {/* 면허증 */}
          {hasLicense && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-tertiary w-12 flex-shrink-0">면허증</span>
              {applicant.licensePhotoUrl ? (
                <>
                  <button
                    onClick={() => setLicenseOpen(true)}
                    className="text-[12px] font-semibold text-primary underline"
                  >
                    사진 보기 →
                  </button>
                  {licenseOpen && (
                    <div
                      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
                      onClick={() => setLicenseOpen(false)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={applicant.licensePhotoUrl}
                        alt="면허증"
                        className="max-w-full max-h-[80vh] rounded-xl object-contain"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  )}
                </>
              ) : (
                <span className="text-[12px] font-semibold text-ink">{applicant.licenseNumber}</span>
              )}
            </div>
          )}

          {/* 경력 + 최근 근무지 */}
          {(applicant.experienceYears || applicant.lastWorkplace) && (
            <div className="flex items-start gap-2">
              <span className="text-[11px] text-tertiary w-12 flex-shrink-0 pt-0.5">경력</span>
              <span className="text-[12px] text-ink">
                {[applicant.experienceYears, applicant.lastWorkplace].filter(Boolean).join(' · ')}
              </span>
            </div>
          )}

          {/* 부서 태그 */}
          {applicant.departmentTags && applicant.departmentTags.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-tertiary w-12 flex-shrink-0">부서</span>
              <div className="flex flex-wrap gap-1">
                {applicant.departmentTags.map((tag) => (
                  <span key={tag} className="text-[11px] font-semibold bg-bg text-sub px-2 py-0.5 rounded-full">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 프로필 미등록 안내 */}
      {!hasProfile && (
        <p className="mt-2 ml-[52px] text-[12px] text-tertiary">프로필 카드 미등록</p>
      )}
    </div>
  );
}
