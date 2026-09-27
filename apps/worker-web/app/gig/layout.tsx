import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { GigShell } from '@/components/gig/GigShell';

// 메타데이터는 서버가 최초 HTML에 직접 넣는다. 설치 가능 여부를 브라우저가 검사하기 전에
// 일반 잇닿 매니페스트가 노출되지 않아, /gig 는 항상 별도 '잇닿 GIG' 앱으로 설치된다.
export const metadata: Metadata = {
  title: '잇닿 GIG',
  description: '초대받은 근무를 연결하고 닿기로 출퇴근을 기록해요.',
  manifest: '/gig-manifest.json',
  icons: {
    icon: '/gig-icon-192.png',
    apple: '/gig-icon-180.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: '잇닿 GIG',
  },
};

export const viewport: Viewport = {
  themeColor: '#191F28',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function GigLayout({ children }: { children: ReactNode }) {
  return <GigShell>{children}</GigShell>;
}
