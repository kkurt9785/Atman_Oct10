import './globals.css';
import type { ReactNode } from 'react';
import { Shell } from '@/components/Shell';

export const metadata = { title: '잇닿 사장님', description: '직원·근태·급여를 한 번에' };

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
