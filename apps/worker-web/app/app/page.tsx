import type { Metadata } from 'next';
import { AppInstallLanding } from '@/components/install/AppInstallLanding';

// 카톡·문자로 보내는 설치 링크: itdot.co.kr/app
export const metadata: Metadata = {
  title: '잇닿 근무자 앱 설치',
  // 직원(출퇴근·휴가·급여)과 일을 찾는 사람 둘 다에게 맞는 소개
  description: '눌러서 바로 설치해요. 출근하기·휴가·급여 확인부터 새 근무 알림까지 한 앱에서.',
  alternates: { canonical: 'https://itdot.co.kr/app' },
  openGraph: {
    title: '잇닿 근무자 앱',
    description: '눌러서 바로 설치해요',
    url: 'https://itdot.co.kr/app',
    type: 'website',
    images: [{ url: 'https://itdot.co.kr/og/install.png', width: 1200, height: 630, alt: '잇닿 근무자 앱 설치' }],
  },
};

export default function AppInstallPage() {
  return <AppInstallLanding />;
}
