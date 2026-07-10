import './globals.css';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { Shell } from '@/components/Shell';

export const metadata: Metadata = {
  title: '잇닿 사장님',
  description: '직원·근태·급여를 한 번에',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '잇닿 사장님',
  },
};

export const viewport: Viewport = {
  themeColor: '#191F28',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

const noFlash = `try{if(localStorage.getItem('bigText')==='1')document.documentElement.classList.add('big-text')}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <head><script dangerouslySetInnerHTML={{ __html: noFlash }} /></head>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
