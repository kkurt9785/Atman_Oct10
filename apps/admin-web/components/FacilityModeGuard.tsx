'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isGigOnlyPath, isMedicalOnlyPath, type FacilityMode } from '@/lib/facility-mode';

// 단기·행사 무료 베타 한 달이 지나면 열어 두는 화면: 이용 현황(문의)·설정·더보기, 그리고 이미 한 근무의 지급 정리.
const GIG_BETA_OPEN_PREFIXES = ['/membership', '/settings', '/more', '/gig-pay', '/privacy'];

// 긱워커 근무지를 보고 있을 때 병원·약국 전용 화면(모집·지원자·휴가·급여 등)에 주소로 들어오면 홈으로 보낸다.
// 탭에서 이미 빠져 있지만, 알림 링크·북마크·사업장 전환 직후에는 주소가 남아 있을 수 있다.
// 베타가 끝난 단기 현장은 위 화면 말고는 이용 현황으로 보낸다(근무 만들기·초대는 서버에서도 막는다).
export function FacilityModeGuard({ mode, gigBetaLocked = false }: { mode: FacilityMode | null; gigBetaLocked?: boolean }) {
  const path = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (mode === 'gig' && gigBetaLocked && !GIG_BETA_OPEN_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      router.replace('/membership');
      return;
    }
    if ((mode === 'gig' && isMedicalOnlyPath(path)) || (mode === 'medical' && isGigOnlyPath(path))) router.replace('/');
  }, [mode, gigBetaLocked, path, router]);
  return null;
}
