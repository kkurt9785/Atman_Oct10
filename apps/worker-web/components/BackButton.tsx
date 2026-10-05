'use client';
import { useRouter } from 'next/navigation';
import { previousPath } from '@/lib/nav-history';

// 홈 화면에 설치한 앱에는 브라우저 뒤로가기가 없다 — 하위 화면은 이 버튼으로 돌아간다.
//   · 바로 앞 화면이 상위 화면(href)이면 history.back (안드로이드 뒤로가기와 같은 결과)
//   · 알림·링크로 바로 열려 앞 화면이 없으면 상위 화면(href)으로
//   · anyPrevious: 여러 곳에서 들어오는 화면(약관 등)은 앞 화면이 무엇이든 그리로, 새 탭이면 탭을 닫는다
export function BackButton({ href, label, anyPrevious = false, onClick, tone = 'sub' }: {
  href: string; label?: string; anyPrevious?: boolean; onClick?: () => void | Promise<void>; tone?: 'sub' | 'light';
}) {
  const router = useRouter();
  function go() {
    if (onClick) { void onClick(); return; }
    const prev = previousPath();
    if (prev && (anyPrevious || prev === href.split('?')[0]) && window.history.length > 1) { router.back(); return; }
    if (anyPrevious && !prev && window.history.length === 1) window.close();
    router.replace(href);
  }
  return (
    <button type="button" onClick={go} aria-label={label ? `${label}(으)로 돌아가기` : '뒤로'}
      className={`-ml-1 inline-flex h-9 items-center gap-1 px-1 text-[14px] font-bold active:opacity-60 ${tone === 'light' ? 'text-white/80' : 'text-sub'}`}>
      <span aria-hidden="true" className="text-[18px] leading-none">←</span>{label}
    </button>
  );
}
