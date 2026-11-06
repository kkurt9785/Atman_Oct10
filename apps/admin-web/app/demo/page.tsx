import type { Metadata } from 'next';
import { DemoLanding, type DemoKind } from './DemoLanding';

// 시연 링크(관리자 로그인 화면 '시연 링크 보내기'): 영상 → 관리자 앱 설치 → 설치 없이 시연. 로그인 없이 열린다(components/Shell 공개 경로).
type DemoSearchParams = Promise<{ kind?: string | string[] }>;

function parseKind(value: unknown): DemoKind {
  const kind = String(Array.isArray(value) ? value[0] ?? '' : value ?? '').trim().toLowerCase();
  return kind === 'gigworker' ? 'gigworker' : 'hospital';
}

export async function generateMetadata({ searchParams }: { searchParams: DemoSearchParams }): Promise<Metadata> {
  const gig = parseKind((await searchParams).kind) === 'gigworker';
  const url = gig ? 'https://admin.itdot.co.kr/demo?kind=gigworker' : 'https://admin.itdot.co.kr/demo';
  const title = gig ? '잇닿 단기·행사 근무 관리' : '잇닿 관리자 앱';
  const description = gig
    ? '근무자 초대부터 출퇴근·지급 기록까지. 1분 영상으로 보고 관리자 앱을 바로 설치하세요.'
    : '공고부터 출퇴근·급여 확인까지. 1분 영상으로 보고 관리자 앱을 바로 설치하세요.';
  return {
    title: `${title} — 영상 보고 바로 설치`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description: '영상 보고 바로 설치해요',
      url,
      type: 'website',
      images: [{ url: 'https://admin.itdot.co.kr/og/demo.png', width: 1200, height: 630, alt: '잇닿 관리자 앱 — 영상 보고 바로 설치' }],
    },
    robots: { index: false, follow: false },
  };
}

export default async function DemoPage({ searchParams }: { searchParams: DemoSearchParams }) {
  const kind = parseKind((await searchParams).kind);
  return <DemoLanding key={kind} kind={kind} />;
}
