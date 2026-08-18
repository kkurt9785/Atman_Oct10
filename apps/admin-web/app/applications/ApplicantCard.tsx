'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { acceptApplication, rejectApplication } from './actions';
import type { Applicant } from '@/lib/db/applications';
import { won } from '@/lib/format';

const ROLE_LABEL: Record<string, string> = { rn: 'RN', na: 'NA', pharmacist: '약사', pharmacy_staff: '약국 전산·사무직' };
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
  estimatedPay,
  disabled,
}: {
  applicant: Applicant;
  shiftId: string;
  estimatedPay: number;
  disabled: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<'accept' | 'reject' | null>(null);
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [credentialConfirmed, setCredentialConfirmed] = useState(false);
  const [actionError, setActionError] = useState('');

  function openAcceptConfirm() {
    setCredentialConfirmed(alreadyConfirmed);
    setActionError('');
    setConfirmOpen(true);
  }

  async function handleAccept() {
    setLoading('accept');
    setActionError('');
    try {
      const result = await acceptApplication(applicant.applicationId, shiftId, applicant.workerId, credentialConfirmed);
      if (!result.ok) {
        setActionError(result.message);
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '수락 처리에 실패했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(null);
    }
  }

  async function handleReject() {
    setLoading('reject');
    setActionError('');
    try {
      await rejectApplication(applicant.applicationId);
      router.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '거절 처리에 실패했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(null);
    }
  }

  const hasLicense = applicant.licenseNumber || applicant.licensePhotoUrl;
  const hasProfile = hasLicense || applicant.experienceYears || applicant.lastWorkplace || applicant.departmentTags?.length;
  // 서버가 기록한 검토 상태를 우선 신뢰한다. 다른 관리자가 이미 확인했다면 재확인을 요구하지 않는다
  // (중복 확인은 감사로그를 중복 생성한다).
  const alreadyConfirmed = applicant.credentialReviewStatus === 'facility_confirmed'
    || applicant.credentialReviewStatus === 'platform_verified';
  const needsFacilityCredentialCheck = (applicant.role === 'rn' || applicant.role === 'na' || applicant.role === 'pharmacist')
    && applicant.verificationStatus !== 'approved'
    && !alreadyConfirmed;

  return (
    <div className="py-4 px-5">
      {actionError && (
        <p role="alert" className="mb-2 rounded-xl bg-red-50 text-red-600 text-[13px] font-bold px-3 py-2">{actionError}</p>
      )}
      {/* 상단: 이름 + 역할 + 거리 + 버튼 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-bg flex items-center justify-center text-xl flex-shrink-0">👤</div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[15px] font-bold text-ink">{applicant.name}</span>
              {applicant.isDemo && (
                <span className="text-[12px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                  데모
                </span>
              )}
              <span className={`text-[13px] font-bold px-2 py-0.5 rounded-full ${ROLE_COLOR[applicant.role] ?? 'bg-line text-sub'}`}>
                {ROLE_LABEL[applicant.role] ?? applicant.role}
              </span>
              {applicant.verificationStatus === 'approved' && (
                <span className="text-[13px] text-success font-semibold">✓인증</span>
              )}
              {needsFacilityCredentialCheck && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[12px] font-bold text-amber-700">사업장 확인 필요</span>}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {applicant.distanceMeters != null && (
                <span className="text-[12px] text-sub">{km(applicant.distanceMeters)}</span>
              )}
              {applicant.matchScore != null && (
                <span className="text-[12px] text-sub">적합도 {Math.round(applicant.matchScore)}점</span>
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
            onClick={openAcceptConfirm}
            disabled={disabled || loading != null}
            aria-label={`${applicant.name} 지원 수락`}
            data-demo-target="accept-application"
            className="h-9 px-4 rounded-lg bg-primary text-white text-[13px] font-semibold disabled:opacity-40 active:opacity-80"
          >
            수락
          </button>
        </div>
      </div>

      {/* 프로필 정보 */}
      {hasProfile && (
        <div className="mt-3 ml-[52px] flex flex-col gap-1.5">
          {/* 면허증 */}
          {hasLicense && (
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-sub w-12 flex-shrink-0">면허증</span>
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
              <span className="text-[13px] text-sub w-12 flex-shrink-0 pt-0.5">경력</span>
              <span className="text-[12px] text-ink">
                {[applicant.experienceYears, applicant.lastWorkplace].filter(Boolean).join(' · ')}
              </span>
            </div>
          )}

          {/* 부서 태그 */}
          {applicant.departmentTags && applicant.departmentTags.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-sub w-12 flex-shrink-0">부서</span>
              <div className="flex flex-wrap gap-1">
                {applicant.departmentTags.map((tag) => (
                  <span key={tag} className="text-[13px] font-semibold bg-bg text-sub px-2 py-0.5 rounded-full">
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
        <p className="mt-2 ml-[52px] text-[12px] text-sub">프로필 카드 미등록</p>
      )}

      {confirmOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setConfirmOpen(false)} />
          <div className="fixed bottom-0 inset-x-0 mx-auto max-w-app bg-white rounded-t-3xl z-50 px-5 pt-6 pb-10">
            <div className="w-10 h-1 bg-line rounded-full mx-auto mb-5" />
            <p className="text-[20px] font-extrabold text-ink">채용을 확정할까요?</p>
            <p className="text-[14px] text-sub mt-1">
              확정 후 워커에게 수락 알림이 전송됩니다.
            </p>

            <div className="bg-bg rounded-2xl p-4 mt-5 space-y-2">
              <div className="flex justify-between text-[13px]">
                <span className="text-sub">선택 워커</span>
                <span className="font-bold text-ink">{applicant.name}</span>
              </div>
              <div className="flex justify-between text-[13px]">
                <span className="text-sub">사업장 직접 지급 예상액</span>
                <span className="font-bold text-primary">{won(estimatedPay)}</span>
              </div>
            </div>
            <p className="text-[12px] text-sub mt-3">잇닿 이용료는 이 임금과 별도로 월 SaaS 청구서에 반영됩니다.</p>

            {needsFacilityCredentialCheck && (
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <input type="checkbox" checked={credentialConfirmed} onChange={(event) => setCredentialConfirmed(event.target.checked)} className="mt-0.5 h-5 w-5 accent-primary" />
                <span><b className="block text-[14px] text-ink">면접·채용 과정에서 자격을 확인했습니다</b><span className="mt-1 block text-[12px] leading-5 text-sub">원본, 공식 조회 또는 병원 내부 절차로 확인한 뒤 체크해 주세요. 확인한 관리자와 시간은 감사 기록에 남습니다.</span></span>
              </label>
            )}

            <div className="mt-5 flex flex-col gap-2">
                {needsFacilityCredentialCheck && !credentialConfirmed && (
                  <p id="credential-gate-help" className="text-[12px] font-medium text-amber-700">자격을 확인하고 위 항목에 체크해야 채용을 확정할 수 있어요.</p>
                )}
                <button
                  onClick={handleAccept}
                  aria-describedby={needsFacilityCredentialCheck && !credentialConfirmed ? 'credential-gate-help' : undefined}
                  disabled={loading != null || (needsFacilityCredentialCheck && !credentialConfirmed)}
                  className="w-full h-14 bg-primary text-white text-[16px] font-extrabold rounded-2xl disabled:opacity-50"
                >
                  {loading === 'accept' ? '확정 중...' : '채용 확정하기'}
                </button>
              <button
                onClick={() => setConfirmOpen(false)}
                className="w-full h-12 text-[14px] font-semibold text-sub"
              >
                닫기
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
