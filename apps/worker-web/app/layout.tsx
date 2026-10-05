import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ClientLayout } from '@/components/ClientLayout';

export const metadata: Metadata = {
  title: '잇닿 워커 — 찾지 않아도 일이 닿고, 묻지 않아도 입금이 보여요',
  description: '병원·약국 근무는 한 번 등록하면 일하고 싶은 곳 가까운 새 근무를 알림으로, 사장님이 초대한 근무는 링크 한 번으로. 출근·퇴근만 누르면 일한 시간은 알아서 기록되고 입금까지 바로 확인해요.',
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
