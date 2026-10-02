import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { GigShell } from '@/components/gig/GigShell';

// /gig 는 잇닿 워커 안의 간편모드다. 페이지 제목과 테마만 다르게 쓰고,
// 설치 정체성(manifest·아이콘·appleWebApp)은 루트 레이아웃의 '잇닿 워커' 하나를 그대로 상속한다.
export const metadata: Metadata = {
  title: '긱워커 간편모드 · 잇닿 워커',
  description: '초대받은 근무를 연결하고 출근하기 버튼으로 출퇴근을 기록해요.',
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
