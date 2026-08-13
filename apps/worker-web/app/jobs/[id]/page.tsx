import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getPublicShift, roleLabel, facilityLabel, formatDate, hhmm, shiftHours,
} from '@/lib/public-jobs';

export const revalidate = 300;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const shift = await getPublicShift(id);
  if (!shift) return { title: '공고를 찾을 수 없어요 | 잇닿' };

  const title = `${shift.region ? `${shift.region} ` : ''}${roleLabel(shift.required_role)} 대타 — ${formatDate(shift.shift_date)} | 잇닿`;
  const description = `${shift.facility_name}(${facilityLabel(shift.facility_type)}) ${formatDate(shift.shift_date)} ${hhmm(shift.start_time)}~${hhmm(shift.end_time)} 근무, 시급 ${shift.hourly_wage.toLocaleString('ko-KR')}원. 임금은 사업장 직접 지급, 중개 수수료 없음.`;
  return {
    title,
    description,
    alternates: { canonical: `https://itdot.co.kr/jobs/${id}` },
    openGraph: { title, description, url: `https://itdot.co.kr/jobs/${id}`, type: 'article' },
  };
}

export default async function PublicJobDetail({ params }: Props) {
  const { id } = await params;
  const shift = await getPublicShift(id);
  if (!shift) notFound();

  const hours = shiftHours(shift.start_time, shift.end_time);
  const pay = shift.estimated_total_pay ?? Math.round(shift.hourly_wage * hours);

  // 구글 구인정보 리치결과용 구조화 데이터
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: `${roleLabel(shift.required_role)} 단기 근무`,
    description:
      shift.description ??
      `${shift.facility_name} ${formatDate(shift.shift_date)} ${hhmm(shift.start_time)}~${hhmm(shift.end_time)} 근무`,
    datePosted: new Date().toISOString().slice(0, 10),
    validThrough: `${shift.shift_date}T23:59:59+09:00`,
    employmentType: 'PART_TIME',
    hiringOrganization: {
      '@type': 'Organization',
      name: shift.facility_name,
    },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: shift.region ?? '대한민국',
        addressCountry: 'KR',
      },
    },
    baseSalary: {
      '@type': 'MonetaryAmount',
      currency: 'KRW',
      value: { '@type': 'QuantitativeValue', value: shift.hourly_wage, unitText: 'HOUR' },
    },
  };

  return (
    <main className="min-h-screen bg-white px-5 pb-24 pt-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Link href="/jobs" className="text-[13px] font-bold text-sub">
        ← 공고 목록
      </Link>

      <span className="mt-5 inline-block rounded-full bg-primary-light px-3 py-1 text-[12px] font-bold text-primary">
        {roleLabel(shift.required_role)}
      </span>
      <h1 className="mt-3 text-[22px] font-extrabold leading-7 text-ink letter-tight">
        {shift.facility_name}
      </h1>
      <p className="mt-1 text-[13px] text-tertiary">
        {facilityLabel(shift.facility_type)}
        {shift.region ? ` · ${shift.region}` : ''}
        {shift.department ? ` · ${shift.department}` : ''}
      </p>

      <dl className="mt-6 divide-y divide-line rounded-card border border-line">
        <div className="flex items-center justify-between px-4 py-3">
          <dt className="text-[13px] text-sub">근무일</dt>
          <dd className="text-[14px] font-bold text-ink">{formatDate(shift.shift_date)}</dd>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <dt className="text-[13px] text-sub">근무시간</dt>
          <dd className="text-[14px] font-bold text-ink">
            {hhmm(shift.start_time)}~{hhmm(shift.end_time)} ({hours}시간)
          </dd>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <dt className="text-[13px] text-sub">시급</dt>
          <dd className="text-[14px] font-extrabold text-primary">
            {shift.hourly_wage.toLocaleString('ko-KR')}원
          </dd>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <dt className="text-[13px] text-sub">예상 급여</dt>
          <dd className="text-[14px] font-bold text-ink">{pay.toLocaleString('ko-KR')}원</dd>
        </div>
      </dl>

      {(shift.description || shift.notes) && (
        <section className="mt-6">
          <h2 className="text-[15px] font-bold text-ink">근무 내용</h2>
          <p className="mt-2 whitespace-pre-line text-[14px] leading-6 text-sub">
            {shift.description ?? shift.notes}
          </p>
        </section>
      )}

      <p className="mt-6 rounded-card bg-bg p-4 text-[12px] leading-5 text-sub">
        임금은 사업장이 근무자에게 직접 지급하며, 잇닿은 채용 성사에 연동된 수수료를 받지
        않습니다. 지원 여부와 채용은 사업장이 직접 결정합니다.
      </p>

      <div className="fixed inset-x-0 bottom-0 mx-auto max-w-app border-t border-line bg-white px-5 py-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <Link
          href={`/onboarding?next=${encodeURIComponent(`/shifts?highlight=${shift.id}`)}`}
          className="flex h-12 items-center justify-center rounded-btn bg-primary text-[15px] font-extrabold text-white"
        >
          앱에서 지원하기
        </Link>
      </div>
    </main>
  );
}
