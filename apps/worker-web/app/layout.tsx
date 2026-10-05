import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ClientLayout } from '@/components/ClientLayout';

export const metadata: Metadata = {
  title: '잇닿 워커 — 내가 일 찾는 시대는 끝. 한 번 등록으로 원하는 일은 바로',
  description: '내가 일 찾는 시대는 끝. 한 번 등록으로 원하는 일은 바로. 시급 계산도 어렵지 않아요 — 출근·퇴근만 누르면 일한 시간과 금액이 바로 나와요.',
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
