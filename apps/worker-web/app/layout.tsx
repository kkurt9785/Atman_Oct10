import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ClientLayout } from '@/components/ClientLayout';

export const metadata: Metadata = {
  title: '잇닿 워커 — 일한 시간도, 받을 돈도 한눈에',
  description: '출근하기 한 번이면 근무시간이 기록되고 지급 내역까지 바로 확인해요. 병원·약국 근무 찾기도, 사장님이 초대한 근무도 한 앱에서.',
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
