import './globals.css';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { Shell } from '@/components/Shell';
import { getShop } from '@/lib/db/shop';
import { getAdminContext } from '@/lib/admin-auth';

// Admin pages depend on authenticated, facility-scoped data and must never be prerendered.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '잇닿 관리자 — 사업장 운영',
  description: '결원 대응부터 출퇴근·급여까지, 전화·엑셀 없이 버튼 몇 번으로 끝내요.',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '잇닿 관리자',
  },
};

export const viewport: Viewport = {
  themeColor: '#191F28',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

const noFlash = `try{if(localStorage.getItem('bigText')==='1')document.documentElement.classList.add('big-text')}catch(e){}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  // 현재 사업장의 모드(병원·약국 / 긱워커 근무지)를 한 번만 계산해 탭·가드에 내려준다. 로그인 전이면 null.
  const shop = await getShop().catch(() => null);
  const context = await getAdminContext().catch(()=>null);
  return (
    <html lang="ko">
      <head><script dangerouslySetInnerHTML={{ __html: noFlash }} /></head>
      <body>
        <Shell facilityMode={shop?.mode ?? null} initialFacility={shop&&context?{id:context.facilityId,name:shop.name,facility_type:shop.facilityType,registration_source:shop.registrationSource,address_text:'',access_role:context.accessRole}:null}>{children}</Shell>
      </body>
    </html>
  );
}
