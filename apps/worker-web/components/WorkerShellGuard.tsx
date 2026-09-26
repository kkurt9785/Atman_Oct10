'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { loadWorkerShellContext, rememberWorkerShell, type WorkerShell } from '@/lib/worker-mode';

// 셸 경계 가드. 의료 워커 셸에 긱워커만 쓰는 사람이 오면 /gig 로, 긱 셸에 긱 근무지가 없는 의료 워커가 오면 /home 으로 보낸다.
// 로그인 전이면 아무것도 하지 않는다 — 로그인 유도는 각 화면이 한다.
// 통과한 셸은 "마지막으로 쓴 셸"로 기억해, 두 제품을 다 쓰는 사람이 앱을 다시 열 때 같은 셸로 돌아오게 한다.
export function WorkerShellGuard({ shell }: { shell: WorkerShell }) {
  const path = usePathname();

  useEffect(() => {
    let active = true;
    void (async () => {
      const context = await loadWorkerShellContext().catch(() => null);
      if (!active || !context) return;
      if (shell === 'medical' && context.hasGig && !context.hasMedical) {
        // QR 스캔(/workplace?attendanceToken=)·알림 링크의 쿼리는 그대로 넘긴다
        window.location.replace(`/gig${window.location.search}`);
        return;
      }
      if (shell === 'gig' && !context.hasGig && context.hasMedical) {
        window.location.replace('/home');
        return;
      }
      // 긱 근무지가 아직 없고 의료 근거도 없는 사람은 /gig 의 "초대가 없어요" 안내를 그대로 본다.
      rememberWorkerShell(shell);
    })();
    return () => { active = false; };
  }, [shell, path]);

  return null;
}
