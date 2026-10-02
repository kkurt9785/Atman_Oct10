import { getPendingApplications } from '@/lib/db/applications';
import { ApplicantCard } from './ApplicantCard';
import { CoverRequestCard } from './CoverRequestCard';
import { getActiveCoverRequests } from '@/lib/db/cover';

import { formatDate, formatTime } from '@/lib/format';
import { OperationsFlow } from '@/components/OperationsFlow';

const ROLE_LABEL: Record<string, string> = { rn: 'RN 간호사', na: 'NA 간호조무사', pharmacist: '약사', pharmacy_staff: '약국 전산·사무직', any: '무관' };

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
          {total > 0 ? `대기 중 ${total}건` : '대기 중인 지원이 없습니다'}
        </p>
      </div>
      <OperationsFlow active="applications"/>

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
        {[['all', '전체'], ['needs_check', '확인 필요'], ['confirmed', '확인 완료']].map(([value, label]) => (
          <a key={value} href={`/applications${value === 'all' ? '' : `?filter=${value}`}`} className={`shrink-0 rounded-full px-3 py-2 text-[0.75rem] font-extrabold ${filter === value ? 'bg-ink text-white' : 'bg-bg text-sub'}`}>{label}</a>
        ))}
      </nav>

      {total > 0 && (
        <div className="mb-4 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
          <p className="text-[0.8125rem] font-extrabold text-ink">수락하면 운영 흐름에 바로 연결돼요</p>
          <p className="mt-1 text-[0.75rem] leading-5 text-sub">확정 인력은 직원 관리와 해당 시프트 근태에 반영되고, 근무 완료 후 공고 시급 기준으로 급여 검토까지 이어집니다.</p>
          <div className="mt-2 flex items-center gap-1 text-[0.6875rem] font-bold text-primary" aria-label="수락 이후 처리 흐름">
            <span>지원 수락</span><span aria-hidden>→</span><span>근태</span><span aria-hidden>→</span><span>급여 검토</span>
          </div>
        </div>
      )}

      {groups.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span className="text-5xl">📭</span>
          <p className="text-body text-sub">아직 지원이 없어요</p>
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
