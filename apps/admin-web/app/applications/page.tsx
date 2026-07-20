import { getPendingApplications } from '@/lib/db/applications';
import { ApplicantCard } from './ApplicantCard';

import { formatDate, formatTime } from '@/lib/format';

const ROLE_LABEL: Record<string, string> = { rn: 'RN 간호사', na: 'NA 간호조무사', any: '무관' };

export default async function ApplicationsPage() {
  const groups = await getPendingApplications();
  const total = groups.reduce((s, g) => s + g.applicants.length, 0);

  return (
    <main className="px-4 pb-6">
      <div className="px-1 mt-2 mb-4">
        <h1 className="text-display font-extrabold text-ink">지원 현황</h1>
        <p className="text-body text-sub mt-1">
          {total > 0 ? `대기 중 ${total}건` : '대기 중인 지원이 없습니다'}
        </p>
      </div>

      {groups.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span className="text-5xl">📭</span>
          <p className="text-body text-sub">아직 지원이 없어요</p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {groups.map((group) => (
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
