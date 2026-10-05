import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ClientLayout } from '@/components/ClientLayout';

export const metadata: Metadata = {
  title: '잇닿 워커 — 근무는 찾기 쉽게, 기록은 확실하게',
  description: '근처 병원·약국 공고를 찾아 지원하고, 초대받은 근무는 출근하기 한 번으로. 근무시간과 지급 내역까지 한 앱에 남아요.',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '잇닿 워커',
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#1B64DA',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-bg min-h-screen flex justify-center">
        <div className="w-full max-w-app min-h-screen bg-white relative overflow-x-hidden">
          <ClientLayout>{children}</ClientLayout>
        </div>
      </body>
    </html>
  );
}
