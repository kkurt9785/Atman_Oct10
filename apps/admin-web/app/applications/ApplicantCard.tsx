'use client';
import { useState } from 'react';
import Link from 'next/link';
import { acceptApplication, rejectApplication } from './actions';
import type { Applicant } from '@/lib/db/applications';
import { estimatedFacilityCharge, recommendedTierForShortfall, won } from '@/lib/billing';

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
  estimatedPay,
  disabled,
}: {
  applicant: Applicant;
  shiftId: string;
  estimatedPay: number;
  disabled: boolean;
}) {
  const [loading, setLoading] = useState<'accept' | 'reject' | null>(null);
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);

  async function openAcceptConfirm() {
    setConfirmOpen(true);
    if (creditBalance != null) return;
    try {
      const res = await fetch('/api/billing/summary');
      const data = res.ok ? await res.json() : null;
      if (typeof data?.balance === 'number') setCreditBalance(data.balance);
    } catch {
      setCreditBalance(null);
    }
  }

  async function handleAccept() {
    setLoading('accept');
    try {
      await acceptApplication(applicant.applicationId, shiftId, applicant.workerId);
    } catch {
      alert('수락 처리에 실패했어요. 새로고침 후 다시 시도해주세요.');
    } finally {
      setLoading(null);
    }
  }

  async function handleReject() {
    setLoading('reject');
    try {
      await rejectApplication(applicant.applicationId);
    } catch {
      alert('거절 처리에 실패했어요. 새로고침 후 다시 시도해주세요.');
    } finally {
      setLoading(null);
    }
  }

  const hasProfile = applicant.experienceYears || applicant.lastWorkplace || applicant.departmentTags?.length;
  const hasLicense = applicant.licenseNumber || applicant.licensePhotoUrl;
  const estimatedCharge = estimatedFacilityCharge(estimatedPay);
  const projectedBalance = creditBalance == null ? null : creditBalance - estimatedCharge;
  const shortfall = projectedBalance == null ? 0 : Math.max(0, -projectedBalance);
  const recommendedTier = recommendedTierForShortfall(shortfall || estimatedCharge || 500000);

  return (
    <div className="py-4 px-5">
      {/* 상단: 이름 + 역할 + 거리 + 버튼 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-bg flex items-center justify-center text-xl flex-shrink-0">👤</div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[15px] font-bold text-ink">{applicant.name}</span>
              {applicant.isDemo && (
                <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                  데모
                </span>
              )}
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
            onClick={openAcceptConfirm}
            disabled={disabled || loading != null}
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
              <span className="text-[11px] text-sub w-12 flex-shrink-0">면허증</span>
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
              <span className="text-[11px] text-sub w-12 flex-shrink-0 pt-0.5">경력</span>
              <span className="text-[12px] text-ink">
                {[applicant.experienceYears, applicant.lastWorkplace].filter(Boolean).join(' · ')}
              </span>
            </div>
          )}

          {/* 부서 태그 */}
          {applicant.departmentTags && applicant.departmentTags.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-sub w-12 flex-shrink-0">부서</span>
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
        <p className="mt-2 ml-[52px] text-[12px] text-sub">프로필 카드 미등록</p>
      )}

      {confirmOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setConfirmOpen(false)} />
          <div className="fixed bottom-0 inset-x-0 mx-auto max-w-app bg-white rounded-t-3xl z-50 px-5 pt-6 pb-10">
            <div className="w-10 h-1 bg-line rounded-full mx-auto mb-5" />
            <p className="text-[20px] font-extrabold text-ink">매칭을 확정할까요?</p>
            <p className="text-[14px] text-sub mt-1">
              확정 후 워커에게 수락 알림이 전송됩니다.
            </p>

            <div className="bg-bg rounded-2xl p-4 mt-5 space-y-2">
              <div className="flex justify-between text-[13px]">
                <span className="text-sub">선택 워커</span>
                <span className="font-bold text-ink">{applicant.name}</span>
              </div>
              <div className="flex justify-between text-[13px]">
                <span className="text-sub">예상 임금</span>
                <span className="font-bold text-primary">{won(estimatedPay)}</span>
              </div>
              <div className="flex justify-between text-[13px]">
                <span className="text-sub">수수료 포함 예상 차감</span>
                <span className="font-bold text-ink">{won(estimatedCharge)}</span>
              </div>
              {creditBalance != null && (
                <>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-sub">현재 크레딧</span>
                    <span className="font-bold text-ink">{won(creditBalance)}</span>
                  </div>
                  <div className="flex justify-between text-[13px] pt-2 border-t border-line">
                    <span className="text-sub">확정 후 예상 잔액</span>
                    <span className={`font-extrabold ${shortfall > 0 ? 'text-warn' : 'text-ink'}`}>
                      {projectedBalance != null && projectedBalance < 0 ? '-' : ''}{won(projectedBalance ?? 0)}
                    </span>
                  </div>
                </>
              )}
            </div>

            {shortfall > 0 && (
              <div className="bg-warn/10 rounded-xl px-4 py-3 mt-4">
                <p className="text-[13px] font-bold text-warn">부족 예상 {won(shortfall)}</p>
                <p className="text-[12px] text-sub mt-0.5">
                  충전 후 확정하면 체크아웃 정산까지 끊기지 않아요.
                </p>
              </div>
            )}

            <div className="mt-5 flex flex-col gap-2">
              {shortfall > 0 ? (
                <Link
                  href={`/membership?amount=${recommendedTier.charge}`}
                  className="w-full h-14 bg-primary text-white text-[16px] font-extrabold rounded-2xl flex items-center justify-center"
                >
                  부족분 충전하고 확정하기
                </Link>
              ) : (
                <button
                  onClick={handleAccept}
                  disabled={loading != null}
                  className="w-full h-14 bg-primary text-white text-[16px] font-extrabold rounded-2xl disabled:opacity-50"
                >
                  {loading === 'accept' ? '확정 중...' : '매칭 확정하기'}
                </button>
              )}
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
