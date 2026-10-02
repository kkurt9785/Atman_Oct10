import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ManageBackLink } from '@/components/ManageBackLink';
import { getAdminContext } from '@/lib/admin-auth';
import { adminClient } from '@/lib/supabase';
import { hasPlanFeature } from '@/lib/billing-gates';
import { getVacancyCandidates, parseVacancySource, resolveVacancy } from '@/lib/db/vacancy';
import { VacancyForm } from './VacancyForm';
import { CopyLinkButton } from './CopyLinkButton';

export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<string, string> = { rn: '간호사', na: '간호조무사', pharmacist: '약사', pharmacy_staff: '약국 전산·사무직', any: '직군 무관' };
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

function dateLabel(date: string) {
  const weekday = WEEKDAY[new Date(`${date}T12:00:00+09:00`).getUTCDay()];
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일(${weekday})`;
}

export default async function VacancyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const source = parseVacancySource(params);
  if (!source) redirect('/operations');
  const context = await getAdminContext();
  if (!context) redirect('/login');
  const vacancy = await resolveVacancy(source);
  const sb = adminClient();

  if (!vacancy) {
    return (
      <main className="px-4 pb-28">
        <ManageBackLink href="/operations" label="운영" />
        <p className="mt-6 rounded-2xl bg-white p-6 text-center text-body text-sub shadow-card">결원 정보를 찾지 못했어요. 이미 처리됐거나 기준이 바뀌었을 수 있어요.</p>
      </main>
    );
  }

  const [candidates, poolAllowed] = await Promise.all([
    getVacancyCandidates(vacancy),
    sb ? hasPlanFeature(sb, context.facilityId, 'repeat_invite') : Promise.resolve(false),
  ]);
  const filled = vacancy.shiftStatus && vacancy.shiftStatus !== 'open';
  const workerOrigin = process.env.NEXT_PUBLIC_WORKER_WEB_URL ?? (process.env.NODE_ENV === 'production' ? 'https://itdot.co.kr' : 'http://localhost:3003');
  const sent = Number(params.sent ?? 0);
  const skipped = Number(params.skipped ?? 0);

  return (
    <main className="px-4 pb-28">
      <ManageBackLink href="/operations" label="운영" />
      <div className="mt-2 mb-5 px-1">
        <p className="text-label font-bold text-primary">결원 채우기</p>
        <h1 className="mt-1 text-display font-extrabold text-ink">{dateLabel(vacancy.date)} {vacancy.startTime}~{vacancy.endTime}</h1>
        <p className="mt-1 text-body text-sub">{vacancy.department ? `${vacancy.department} · ` : ''}{ROLE_LABEL[vacancy.role] ?? vacancy.role} 1명 · {vacancy.cause}</p>
      </div>

      {params.error && <p role="alert" className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-label font-bold text-red-700">{params.error}</p>}
      {params.sent !== undefined && !filled && (
        <p role="status" className="mb-4 rounded-2xl bg-success/10 px-4 py-3 text-label font-bold text-success">
          {sent > 0 ? `${sent}명에게 요청을 보냈어요. 먼저 수락한 분으로 바로 확정돼요.` : params.public ? '공개 공고로 올렸어요.' : '새로 보낸 요청이 없어요.'}
          {skipped > 0 && <span className="block font-medium text-sub">{skipped}명은 이미 요청했거나 조건이 바뀌어 빠졌어요.</span>}
        </p>
      )}

      {filled ? (
        <div className="rounded-2xl bg-white p-5 shadow-card">
          <p className="text-title font-extrabold text-success">{vacancy.matchedName ? `${vacancy.matchedName}님으로 확정됐어요` : '이 근무는 이미 처리됐어요'}</p>
          <p className="mt-1 text-label text-sub">확정된 근무는 근태 화면에서 출근을 확인할 수 있어요.</p>
          <Link href="/timesheet" className="mt-4 flex min-h-11 items-center justify-center rounded-xl bg-bg text-label font-bold text-ink">근태 보기</Link>
        </div>
      ) : (
        <>
          {vacancy.audience === 'public' && vacancy.shiftId && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-card">
              <div className="min-w-0"><p className="text-label font-bold text-ink">공개 공고로 열려 있어요</p><p className="mt-0.5 text-[0.75rem] text-sub">외부 근무자에게 링크를 보내면 바로 지원할 수 있어요.</p></div>
              <CopyLinkButton url={`${workerOrigin}/jobs/${vacancy.shiftId}`} />
            </div>
          )}
          <VacancyForm
            key={JSON.stringify(params)}
            source={vacancy.shiftId ? { mode: 'shift', shiftId: vacancy.shiftId } : source}
            candidates={candidates}
            needsShift={!vacancy.shiftId}
            defaultWage={vacancy.hourlyWage}
            defaultDescription={vacancy.description}
            isPublic={vacancy.audience === 'public'}
            poolLocked={!poolAllowed}
          />
        </>
      )}
    </main>
  );
}
