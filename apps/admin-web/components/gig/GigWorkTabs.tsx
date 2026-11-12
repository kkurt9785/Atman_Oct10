import Link from 'next/link';

// 단기 근무지 '근무' 탭 안의 [근무 | 근무자] 전환(2026-11-12 탭 개편). 행사(근무 건)와 사람 목록을 한 탭에서 오간다.
export function GigWorkTabs({ active }: { active: 'work' | 'people' }) {
  const item = (key: 'work' | 'people', href: string, label: string) => <Link href={href} aria-current={active === key ? 'page' : undefined}
    className={`flex h-10 flex-1 items-center justify-center rounded-xl text-[0.875rem] font-extrabold ${active === key ? 'bg-white text-ink shadow-sm' : 'text-sub'}`}>{label}</Link>;
  return <nav aria-label="근무와 근무자" className="mt-3 flex gap-1 rounded-2xl bg-line/60 p-1">
    {item('work', '/gig-work', '근무')}
    {item('people', '/staff?view=contract&entry=gigworker', '근무자')}
  </nav>;
}
