import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HARAGURI · 우리 가족의 하루',
  description: '일정, 할 일, 지출과 이야기를 함께 나누는 우리 가족 공간',
  appleWebApp: { capable: true, title: 'HARAGURI', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon.svg', apple: '/icons/apple-touch-icon.png' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#f7f6f2' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
