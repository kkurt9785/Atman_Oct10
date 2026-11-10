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

const ROLE_LABEL: Record<string, string> = { rn: '간호사', na: '간호조무사', dental_hygienist: '치과위생사', pharmacist: '약사', pharmacy_staff: '약국 전산·사무직', any: '직군 무관' };
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
    vacancy.unavailableReason ? Promise.resolve([]) : getVacancyCandidates(vacancy),
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
        {/* 미출근 대체는 원래 시작이 이미 지났다 — 이동 시간을 두고 지금부터 연다(원래 시각이면 요청·수락·지원이 모두 거부됨) */}
        {vacancy.originalStartTime && !vacancy.shiftId && !vacancy.unavailableReason && <p className="mt-2 rounded-xl bg-bg px-3 py-2 text-[0.75rem] leading-5 text-sub">원래 {vacancy.originalStartTime} 시작 근무예요. 이동 시간 30분을 두고 {vacancy.startTime}부터 원래 종료({vacancy.endTime})까지 열어요. 예상 지급액도 이 시간으로 계산해요.</p>}
      </div>

      {!filled && (vacancy.applicantCount ?? 0) > 0 && (
        <Link href="/applications" className="mb-4 flex min-h-11 items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-card">
          <span className="text-label font-bold text-ink">지원자 {vacancy.applicantCount}명이 확정을 기다려요</span>
          <b className="shrink-0 text-label text-primary">지원자 보기 →</b>
        </Link>
      )}
      {params.error && <p role="alert" className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-label font-bold text-red-700">{params.error}</p>}
      {params.sent !== undefined && !filled && (
        <p role="status" className="mb-4 rounded-2xl bg-success/10 px-4 py-3 text-label font-bold text-success">
          {sent > 0 ? `${sent}명에게 요청을 보냈어요. 먼저 수락한 분으로 바로 확정돼요.` : params.public ? '공개 공고로 올렸어요.' : '새로 보낸 요청이 없어요.'}
          {skipped > 0 && <span className="block font-medium text-sub">{skipped}명은 이미 요청했거나 조건이 바뀌어 빠졌어요.</span>}
        </p>
      )}

      {vacancy.unavailableReason && !filled ? (
        <div className="rounded-2xl bg-white p-5 shadow-card">
          <p className="text-body font-bold text-ink">{vacancy.unavailableReason}</p>
          <Link href="/timesheet" className="mt-4 flex min-h-11 items-center justify-center rounded-xl bg-bg text-label font-bold text-ink">근태 보기</Link>
        </div>
      ) : filled ? (
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
            workDate={vacancy.date}
            defaultDescription={vacancy.description}
            isPublic={vacancy.audience === 'public'}
            poolLocked={!poolAllowed}
          />
        </>
      )}
    </main>
  );
}
