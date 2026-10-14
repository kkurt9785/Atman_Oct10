import { getPendingApplications } from '@/lib/db/applications';
import { ApplicantCard } from './ApplicantCard';
import { CoverRequestCard } from './CoverRequestCard';
import { getActiveCoverRequests } from '@/lib/db/cover';

import Link from 'next/link';
import { formatDate, formatTime } from '@/lib/format';
import { OperationsFlow } from '@/components/OperationsFlow';
import { ROLE_FULL_LABEL } from '@/lib/constants';

const ROLE_LABEL = ROLE_FULL_LABEL;

export default async function ApplicationsPage({ searchParams }: { searchParams?: Promise<{ filter?: string }> }) {
  const [groups, covers] = await Promise.all([getPendingApplications(), getActiveCoverRequests()]);
  const coverToApprove = covers.filter((cover) => cover.status === 'claimed').length;
  const filter = (await searchParams)?.filter ?? 'all';
  const filteredGroups = groups.map((group) => ({
    ...group,
    applicants: group.applicants.filter((applicant) => filter === 'all'
      || (filter === 'needs_check' && applicant.credentialReviewStatus === 'pending_facility_check')
      || (filter === 'confirmed' && ['facility_confirmed', 'platform_verified'].includes(applicant.credentialReviewStatus))),
  })).filter((group) => group.applicants.length > 0);
  const total = filteredGroups.reduce((s, g) => s + g.applicants.length, 0);

  return (
    <main className="px-4 pb-6">
      <div className="px-1 mt-2 mb-4">
        <h1 className="text-display font-extrabold text-ink">지원 현황</h1>
        <p className="text-body text-sub mt-1">
          {total > 0 ? `대기 중 ${total}건` : '대기 중인 지원이 없어요'}
        </p>
      </div>
      <div className="mb-4"><OperationsFlow active="applications"/></div>

      {/* 대타 요청 — 확정된 워커가 못 나오게 됐을 때. 승인할 게 있으면 지원자보다 먼저 본다(근무가 이미 잡혀 있던 자리라 더 급하다) */}
      {covers.length > 0 && (
        <section id="cover" aria-labelledby="cover-heading" className="mb-6 scroll-mt-20">
          <div className="mb-3 flex items-end justify-between px-1">
            <h2 id="cover-heading" className="text-title font-extrabold text-ink">대타 요청</h2>
            <span className="text-label font-bold text-sub">{coverToApprove > 0 ? `승인 필요 ${coverToApprove}건` : `진행 중 ${covers.length}건`}</span>
          </div>
          <div className="flex flex-col gap-3">
            {covers.map((cover) => <CoverRequestCard key={cover.id} row={cover} />)}
          </div>
        </section>
      )}

      <nav aria-label="지원자 필터" className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {[['all', '전체'], ['needs_check', '자격 확인 필요'], ['confirmed', '자격 확인 완료']].map(([value, label]) => (
          <a key={value} href={`/applications${value === 'all' ? '' : `?filter=${value}`}`} className={`shrink-0 rounded-full px-3 py-2 text-[0.75rem] font-extrabold ${filter === value ? 'bg-ink text-white' : 'bg-bg text-sub'}`}>{label}</a>
        ))}
      </nav>

      {/* 지원이 아예 없을 때와, 필터 결과만 없을 때를 나눠 다음 행동을 안내한다 */}
      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <span className="text-5xl">📭</span>
          <p className="text-body font-bold text-ink">아직 지원이 없어요</p>
          <p className="text-label text-sub text-center">공고에서 함께 일했던 분께 직접 요청할 수도 있어요.</p>
          <Link href="/shifts" className="mt-2 flex min-h-12 items-center justify-center rounded-xl bg-primary px-6 text-label font-bold text-white">공고 보기</Link>
        </div>
      ) : filteredGroups.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <p className="text-body font-bold text-ink">이 조건에 맞는 지원자가 없어요</p>
          <Link href="/applications" className="text-label font-bold text-primary">전체 지원자 보기 →</Link>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {filteredGroups.map((group) => (
          <div key={group.shiftId} className="bg-white rounded-2xl overflow-hidden shadow-sm">
            {/* 시프트 헤더 */}
            <div className="px-5 py-4 border-b border-line">
              <div className="flex items-center justify-between">
                <span className="text-label font-bold text-primary">
                  {formatDate(group.shiftDate)}
                </span>
                <span className="text-label text-sub">
                  {group.applicants.length}명 지원
                </span>
              </div>
              <p className="text-body font-bold text-ink mt-1">
                {formatTime(group.startTime)} – {formatTime(group.endTime)}
                {group.endTime < group.startTime && ' (익일)'}
              </p>
              <p className="text-label text-sub mt-0.5">
                {group.department ? `${group.department} · ` : ''}{ROLE_LABEL[group.requiredRole] ?? group.requiredRole}
              </p>
            </div>

            {/* 지원자 목록 */}
            <div className="divide-y divide-line">
              {group.applicants.map((applicant) => (
                <ApplicantCard
                  key={applicant.applicationId}
                  applicant={applicant}
                  shiftId={group.shiftId}
                  estimatedPay={group.estimatedTotalPay}
                  shiftDate={group.shiftDate}
                  startTime={group.startTime}
                  endTime={group.endTime}
                  requiredRole={group.requiredRole}
                  disabled={group.shiftStatus !== 'open'}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
