import type { Metadata } from 'next';
import Link from 'next/link';
import {
  listPublicShifts, roleLabel, facilityLabel, formatDate, hhmm, shiftHours,
} from '@/lib/public-jobs';

// 로그인 없이 열리는 공개 공고 목록 — 검색 유입(워커 획득) 채널
export const revalidate = 300;

export const metadata: Metadata = {
  title: '간호사·간호조무사·약사 대타 공고 | 잇닿',
  description:
    '병원·요양병원·약국의 단기 근무와 대타 공고를 확인하고 앱에서 바로 지원하세요. 임금은 사업장이 직접 지급하며 중개 수수료가 없습니다.',
  alternates: { canonical: 'https://itdot.co.kr/jobs' },
  openGraph: {
    title: '간호사·간호조무사·약사 대타 공고 | 잇닿',
    description: '내 지역 병원·약국 단기 근무 공고를 한눈에.',
    url: 'https://itdot.co.kr/jobs',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export default async function PublicJobsPage() {
  const shifts = await listPublicShifts(60);
  const regions = [...new Set(shifts.map((s) => s.region).filter(Boolean))] as string[];

  return (
    <main className="min-h-screen bg-white px-5 pb-16 pt-10">
      <h1 className="text-[24px] font-extrabold leading-8 text-ink letter-tight">
        병원·약국 단기 근무 공고
      </h1>
      <p className="mt-2 text-[14px] leading-6 text-sub">
        간호사·간호조무사·약사·약국 사무직 공고입니다. 임금은 사업장이 직접 지급하고,
        잇닿은 중개 수수료를 받지 않습니다.
      </p>
      {regions.length > 0 && (
        <p className="mt-3 text-[12px] text-tertiary">모집 지역 · {regions.join(' · ')}</p>
      )}

      {shifts.length === 0 ? (
        <div className="mt-10 rounded-card bg-bg px-5 py-10 text-center">
          <p className="text-[15px] font-bold text-ink">지금은 모집 중인 공고가 없어요</p>
          <p className="mt-2 text-[13px] leading-5 text-sub">
            앱에 등록해두면 내 지역에 공고가 올라올 때 알림을 받을 수 있어요.
          </p>
          <Link
            href="/onboarding"
            className="mt-5 inline-flex h-11 items-center rounded-btn bg-primary px-5 text-[14px] font-bold text-white"
          >
            알림 받기
          </Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {shifts.map((s) => (
            <li key={s.id}>
              <Link
                href={`/jobs/${s.id}`}
                className="block rounded-card border border-line p-4 active:bg-bg"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-extrabold text-ink">{s.facility_name}</p>
                    <p className="mt-0.5 text-[12px] text-tertiary">
                      {facilityLabel(s.facility_type)}
                      {s.region ? ` · ${s.region}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-primary-light px-2.5 py-1 text-[11px] font-bold text-primary">
                    {roleLabel(s.required_role)}
                  </span>
                </div>
                <p className="mt-3 text-[14px] font-bold text-ink">
                  {formatDate(s.shift_date)} · {hhmm(s.start_time)}~{hhmm(s.end_time)}
                  <span className="ml-1 text-[12px] font-medium text-sub">
                    ({shiftHours(s.start_time, s.end_time)}시간)
                  </span>
                </p>
                <p className="mt-1 text-[14px] font-extrabold text-primary">
                  시급 {s.hourly_wage.toLocaleString('ko-KR')}원
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-10 rounded-card bg-bg p-5">
        <p className="text-[14px] font-bold text-ink">인력을 구하는 병원·약국이신가요?</p>
        <p className="mt-1 text-[13px] leading-5 text-sub">
          공고 등록부터 출퇴근 인증, 급여 자료 정리까지 한 번에 하실 수 있어요.
        </p>
        <Link
          href="/intro"
          className="mt-4 inline-flex h-11 items-center rounded-btn border border-primary/30 bg-white px-5 text-[14px] font-bold text-primary"
        >
          사업장 안내 보기
        </Link>
      </div>
    </main>
  );
}
