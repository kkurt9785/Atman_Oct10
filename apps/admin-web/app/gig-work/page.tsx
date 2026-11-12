import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getShop } from '@/lib/db/shop';
import { getAdminContext } from '@/lib/admin-auth';
import { listGigProjects } from '@/lib/db/gig-projects';
import { todayKST } from '@/lib/date';
import { GigProjectCards } from '@/components/gig/GigProjectCards';
import { GigWorkTabs } from '@/components/gig/GigWorkTabs';

// 단기 근무지 '근무' 탭(2026-11-12 탭 개편): 행사·근무 건 목록과 만들기. 사람 목록은 위 전환의 '근무자'.
// 병원·약국의 단기 근무 건은 직원 관리(계약·단기)에서 본다.
export default async function GigWorkIndexPage() {
  const [shop, context] = await Promise.all([getShop(), getAdminContext()]);
  if (!context) redirect('/login');
  if (shop?.mode !== 'gig') redirect('/staff?view=contract');
  const projects = await listGigProjects();
  const visible = context.canViewPayroll ? projects : projects.map((project) => ({ ...project, payRate: null }));
  return <main className="px-4 pb-32">
    <div className="mt-2 px-1">
      <p className="text-label font-bold text-primary">{shop.name}</p>
      <h1 className="text-display font-extrabold text-ink">근무</h1>
    </div>
    <GigWorkTabs active="work" />
    <Link href="/gig-work/new" className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-ink text-[0.9375rem] font-extrabold text-white active:opacity-85">＋ 근무 만들기</Link>
    <section className="mt-5">
      <div className="px-1"><p className="text-[0.6875rem] font-bold text-primary">근무 건</p><h2 className="mt-0.5 text-[1.1875rem] font-extrabold text-ink">진행·예정 근무 {visible.length}건</h2></div>
      <GigProjectCards projects={visible} today={todayKST()} />
    </section>
  </main>;
}
