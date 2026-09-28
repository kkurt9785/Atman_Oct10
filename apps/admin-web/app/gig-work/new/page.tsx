import { redirect } from 'next/navigation';
import { getShop } from '@/lib/db/shop';
import { ManageBackLink } from '@/components/ManageBackLink';
import { GigProjectForm } from '@/components/gig/GigProjectForm';

// 근무 건 만들기. 만들면 상세로 넘어가 사람을 넣는다.
export default async function NewGigProjectPage() {
  const shop = await getShop();
  if (!shop) redirect('/setup/claim-facility');
  return <main className="px-4 pb-28">
    <ManageBackLink href={shop.mode === 'gig' ? '/' : '/staff?view=contract'} label={shop.mode === 'gig' ? '운영' : '직원 관리'} />
    <div className="mt-3 mb-5 px-1"><p className="text-label font-bold text-primary">{shop.name}</p><h1 className="text-display font-extrabold text-ink">새 근무 만들기</h1><p className="mt-1 text-label leading-5 text-sub">행사나 반복 근무를 먼저 만들고, 다음 화면에서 여러 명을 한 번에 넣어요. 시급은 이 근무 공통이에요.</p></div>
    <div className="rounded-2xl bg-white p-5 shadow-card"><GigProjectForm mode="create" /></div>
  </main>;
}
