'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { GIGWORKER_DEMO_EMAIL, setGigworkerModePreference } from '@/lib/worker-mode';

// 시연 계정은 한 번 로그인하면 폰에 남는다. 긱워커 시연 뒤에 병원·약국 화면을 보려던 사람이
// "구직 기능이 사라졌다"고 느끼지 않도록, 시연 중에는 다른 쪽 시연으로 바로 넘어가는 띠를 보여 준다.
export function DemoSwitchBanner({ shell }: { shell: 'gig' | 'medical' }) {
  const [isDemo, setIsDemo] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      const email = data.user?.email?.toLowerCase() ?? '';
      setIsDemo(shell === 'gig' ? email === GIGWORKER_DEMO_EMAIL : email.endsWith('@demo.atman.co.kr') && email !== GIGWORKER_DEMO_EMAIL);
    });
  }, [shell]);

  if (!isDemo) return null;

  async function switchDemo() {
    setBusy(true);
    await supabase.auth.signOut().catch(() => undefined);
    setGigworkerModePreference(false);
    window.location.href = shell === 'gig' ? '/demo' : '/gig/demo';
  }

  return (
    <div className="sticky top-0 z-30 flex items-center justify-between gap-2 bg-ink px-4 py-2 text-[12px] text-white">
      <span className="font-bold">{shell === 'gig' ? '긱워커 시연 중' : '병원·약국 워커 시연 중'}</span>
      <button type="button" onClick={switchDemo} disabled={busy} className="shrink-0 font-extrabold text-[#8FB8FF] disabled:opacity-60">
        {busy ? '바꾸는 중…' : shell === 'gig' ? '병원·약국 시연 보기 →' : '긱워커 시연 보기 →'}
      </button>
    </div>
  );
}
