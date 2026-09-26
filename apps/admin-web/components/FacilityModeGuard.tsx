'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isMedicalOnlyPath, type FacilityMode } from '@/lib/facility-mode';

// 긱워커 근무지를 보고 있을 때 병원·약국 전용 화면(모집·지원자·휴가·급여 등)에 주소로 들어오면 홈으로 보낸다.
// 탭에서 이미 빠져 있지만, 알림 링크·북마크·사업장 전환 직후에는 주소가 남아 있을 수 있다.
export function FacilityModeGuard({ mode }: { mode: FacilityMode | null }) {
  const path = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (mode === 'gig' && isMedicalOnlyPath(path)) router.replace('/');
  }, [mode, path, router]);
  return null;
}
