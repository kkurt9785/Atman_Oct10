import type { Metadata } from 'next';
import './globals.css';
import { ClientLayout } from '@/components/ClientLayout';

export const metadata: Metadata = {
  title: 'atman — 간호사를 위한 야간 시프트',
  description: '내 근처 야간 시프트를 간편하게. 지원부터 정산까지 자동으로.',
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
