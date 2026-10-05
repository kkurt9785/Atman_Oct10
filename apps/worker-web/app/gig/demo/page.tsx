'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { rememberWorkerShell } from '@/lib/worker-mode';
import { BrandMark, Wordmark } from '@/components/brand/BrandMark';
import { InstallAppButton } from '@/components/InstallAppButton';

// 긱워커 시연 전용 입구: itdot.co.kr/gig/demo
// 버튼 하나로 의료 이력이 없는 긱 전용 시연 계정에 로그인하고, 팝업스토어 데모 근무지의 초대를 초기화해 초대 확인 화면으로 간다.
// 관리자 앱 '긱워커 근태 시연'과 같은 근무지·같은 초대라 두 기기 시연이 그대로 이어진다. 몇 번을 눌러도 처음 상태로 돌아온다.
// 노출은 NEXT_PUBLIC_ENABLE_DEMO_LOGIN 으로만 막는다 (주소를 아는 사람만 온다).

const ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === '1';

export default function GigDemoPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function start() {
    setError('');
    setLoading(true);
    try {
      // 다른 계정으로 로그인돼 있어도 시연 계정으로 바꿔 탄다
      await supabase.auth.signOut().catch(() => undefined);
      const response = await fetch('/api/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'GIG2026' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.accessToken || !payload.refreshToken || !payload.gigInviteToken) {
        throw new Error(payload.error ?? '시연 계정을 열지 못했어요.');
      }
      const { error: sessionError } = await supabase.auth.setSession({ access_token: payload.accessToken, refresh_token: payload.refreshToken });
      if (sessionError) throw sessionError;
      window.localStorage.setItem('atman_demo_panel', '1');
      rememberWorkerShell('gig');
      router.replace(`/gig/join?token=${encodeURIComponent(payload.gigInviteToken)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '시연 계정을 열지 못했어요.');
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-white px-6 pb-10 pt-16 text-ink">
      <div className="mx-auto flex min-h-[calc(100vh-104px)] max-w-md flex-col">
        <div className="flex items-center justify-between">
          <Wordmark size={20} />
          <span className="rounded-full bg-ink px-3 py-1 text-[10px] font-extrabold tracking-[0.14em] text-white">DEMO</span>
        </div>

        <div className="mt-14 flex flex-col items-center text-center">
          <BrandMark size={64} />
          <h1 className="mt-5 text-[26px] font-extrabold leading-tight tracking-[-0.8px] text-ink">초대 근무 시연</h1>
          <p className="mt-2 text-[14px] leading-6 text-sub">사장님이 보낸 초대 링크로 시작하는 근무예요.<br />시연용 근무자로 팝업스토어 초대부터 시작해요.</p>
        </div>

        <ol className="mt-6 space-y-2 rounded-2xl bg-bg p-4 text-[13px] leading-5 text-sub">
          <li><b className="text-primary">1.</b> 아래 버튼 → 초대 확인 화면에서 <b className="text-ink">초대 수락</b></li>
          <li><b className="text-primary">2.</b> 오늘 근무 화면에서 <b className="text-ink">출근하기</b>를 길게 눌러 출근</li>
          <li><b className="text-primary">3.</b> 관리자 앱(긱워커 근태 시연)에서 출근·대화가 바로 반영되는지 확인</li>
          <li className="text-tertiary">다시 누르면 언제든 처음 상태(초대 대기)로 돌아와요.</li>
        </ol>

        <section className="mt-5" aria-labelledby="gig-demo-video-title">
          <p id="gig-demo-video-title" className="text-[12px] font-extrabold text-sub">먼저 영상으로 보기 · 약 1분</p>
          <div className="mt-2 overflow-hidden rounded-2xl border border-line bg-black">
            <video className="block aspect-[9/16] w-full bg-black" controls playsInline preload="metadata" poster="/demo/itdot-gig-demo-poster.jpg" aria-label="잇닿 초대 근무 시연 영상">
              <source src="/demo/itdot-gig-demo.mp4" type="video/mp4" />
              브라우저가 동영상 재생을 지원하지 않습니다.
            </video>
          </div>
        </section>

        <div className="flex-grow" />

        {ENABLED ? (
          <button type="button" onClick={() => void start()} disabled={loading} className="flex h-14 w-full items-center justify-center rounded-btn bg-primary text-[16px] font-extrabold text-white shadow-btn disabled:opacity-60">
            {loading ? '시연 계정 준비 중...' : '시연 계정으로 시작'}
          </button>
        ) : (
          <p className="rounded-2xl bg-bg p-4 text-center text-[13px] text-sub">이 배포에서는 시연 로그인이 꺼져 있어요.</p>
        )}
        {error && <p role="alert" className="mt-3 text-center text-[12px] font-bold text-red-600">{error}</p>}
        <div className="mt-2"><InstallAppButton label="잇닿 워커 앱 설치" /></div>
        <p className="mt-2 text-center text-[11px] leading-4 text-tertiary">근무 찾기와 초대 근무 모두 잇닿 워커 앱 하나로 써요.</p>
        <Link href="/demo" className="mt-3 flex h-10 items-center justify-center text-[13px] font-bold text-sub">다른 시연 보기</Link>
      </div>
    </main>
  );
}
