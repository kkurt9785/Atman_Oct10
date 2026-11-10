import Link from 'next/link';
import { getShop } from '@/lib/db/shop';

// 근태 화면 넷(오늘·월별·휴가·인증)을 탭 띠 하나로 묶는다 — 화면마다 바로가기 버튼이 달라 원하는 화면을 찾아 두세 번 눌러야 했다(2026-11-10 근태 화면 정리).
// 주소는 그대로 두고 띠만 같이 쓴다. 초대 근무(긱) 사업장은 휴가가 없고 화면 구성이 달라 띠를 보여 주지 않는다.
const TABS = [
  { key: 'today', label: '오늘', href: '/timesheet' },
  { key: 'month', label: '월별', href: '/attendance-summary' },
  { key: 'leave', label: '휴가', href: '/leave' },
  { key: 'auth', label: '인증·QR', href: '/attendance-qr' },
] as const;

export async function AttendanceTabs({ active }: { active: (typeof TABS)[number]['key'] }) {
  const shop = await getShop();
  if (shop?.mode === 'gig') return null;
  return (
    <nav aria-label="근태 화면" className="sticky top-16 z-[9] -mx-4 bg-bg/95 px-4 py-2 backdrop-blur print:hidden">
      <div className="grid grid-cols-4 gap-1 rounded-2xl bg-white p-1 shadow-sm">
        {TABS.map((tab) => {
          const on = tab.key === active;
          return (
            <Link key={tab.key} href={tab.href} aria-current={on ? 'page' : undefined}
              className={`flex min-h-[44px] min-w-0 items-center justify-center rounded-xl px-1 text-label font-extrabold ${on ? 'bg-primary text-white' : 'text-sub active:bg-bg'}`}>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
