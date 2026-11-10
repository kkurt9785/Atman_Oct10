'use client';
import { useEffect, useState } from 'react';
import { loadWorkerShellContext, WORKER_MODE_CHANGED_EVENT } from '@/lib/worker-mode';

// 직원으로 연결된 사람인가(= '내 직장' 얼굴을 보여 줄까).
//   null  아직 모름 — 화면은 근무 찾기 쪽 문구를 미리 그리지 않는다(직원에게 구직 카드가 번쩍였다 사라지지 않게)
//   false 직원 연결 없음(비로그인 포함) — 지금까지와 똑같이 보인다
//   true  직원 연결 있음
// 판정은 lib/worker-mode.ts 의 셸 컨텍스트 하나에서만 한다(15초 캐시라 화면마다 다시 묻지 않는다).
export function useStaffFirst(): boolean | null {
  const [staffFirst, setStaffFirst] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void loadWorkerShellContext()
        .then((context) => { if (alive) setStaffFirst(Boolean(context?.staffFirst)); })
        // 판정을 못 하면 기존 화면 그대로 — 근무 찾기를 숨기는 쪽으로 틀리지 않는다
        .catch(() => { if (alive) setStaffFirst(false); });
    };
    load();
    // 초대 수락 직후(연결이 막 생긴 때)와 모드 전환 때 다시 본다
    window.addEventListener('atman:workplace-linked', load);
    window.addEventListener(WORKER_MODE_CHANGED_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener('atman:workplace-linked', load);
      window.removeEventListener(WORKER_MODE_CHANGED_EVENT, load);
    };
  }, []);
  return staffFirst;
}
