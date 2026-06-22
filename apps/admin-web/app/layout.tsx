import './globals.css';
import type { ReactNode } from 'react';
import { BottomNav } from '@/components/BottomNav';
import { TextSizeToggle } from '@/components/TextSizeToggle';

export const metadata = { title: '잇닿 사장님', description: '직원·근태·급여를 한 번에' };

// 새로고침 시 큰글씨 상태 깜빡임 방지 (paint 전 클래스 적용)
const noFlash = `try{if(localStorage.getItem('bigText')==='1')document.documentElement.classList.add('big-text')}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <head><script dangerouslySetInnerHTML={{ __html: noFlash }} /></head>
      <body>
        <div className="mx-auto max-w-app min-h-screen bg-bg pb-24">
          <header className="sticky top-0 z-10 flex items-center justify-between px-5 h-14 bg-bg/90 backdrop-blur">
            <span className="text-title font-extrabold text-primary">잇닿</span>
            <TextSizeToggle />
          </header>
          {children}
        </div>
        <BottomNav />
      </body>
    </html>
  );
}
