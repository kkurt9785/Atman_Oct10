import type { Metadata } from 'next';
import { AppInstallLanding } from '@/components/install/AppInstallLanding';

// 카톡·문자로 보내는 설치 링크: itdot.co.kr/app
export const metadata: Metadata = {
  title: '잇닿 근무자 앱 설치',
  description: '눌러서 바로 설치해요. 새 근무 알림부터 출근하기·지급 확인까지 한 앱에서.',
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
