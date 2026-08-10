import Link from 'next/link';
import { Card } from '@/components/ui';
import { getAdminContext } from '@/lib/admin-auth';
import { MANAGE_SECTIONS, visibleManageItems } from '@/lib/manage-menu';

const SECTION_ICONS = {
  operations: <><path d="M4 7h10M17 7h3M4 12h3M10 12h10M4 17h8M15 17h5"/><circle cx="15.5" cy="7" r="1.5"/><circle cx="8.5" cy="12" r="1.5"/><circle cx="13.5" cy="17" r="1.5"/></>,
  billing: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/></>,
  account: <><path d="M4 20V8l8-4 8 4v12"/><path d="M8 20v-7h8v7M9 9h.01M12 9h.01M15 9h.01"/></>,
};

export default async function MorePage(){
  const context=await getAdminContext();
  const sections=MANAGE_SECTIONS.filter(section=>visibleManageItems(section,context?.canViewPayroll===true).length>0);
  return <main className="px-4"><div className="px-1 mt-2 mb-5"><p className="text-label font-bold text-primary">사업장 관리</p><h1 className="mt-1 text-display font-extrabold text-ink">무엇을 관리할까요?</h1><p className="mt-2 text-body text-sub">자주 쓰는 업무는 하단 메뉴에서, 세부 설정은 여기에서 관리해요.</p></div>
    <div className="space-y-3">{sections.map(section=><Link key={section.slug} href={`/more/${section.slug}`} className="block active:opacity-80"><Card className="flex items-center gap-4 p-5"><div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{SECTION_ICONS[section.icon]}</svg></div><div className="min-w-0 flex-1"><p className="text-label font-bold text-primary">{section.eyebrow}</p><h2 className="mt-0.5 text-[18px] font-extrabold text-ink">{section.title}</h2><p className="mt-1 text-label leading-5 text-sub">{section.description}</p></div><span className="text-sub">›</span></Card></Link>)}</div>
  </main>;
}
