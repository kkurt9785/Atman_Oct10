import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card } from '@/components/ui';
import { getAdminContext } from '@/lib/admin-auth';
import { MANAGE_SECTIONS, visibleManageItems } from '@/lib/manage-menu';
import { ManageBackLink } from '@/components/ManageBackLink';

export default async function ManageSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section: slug } = await params;
  const section = MANAGE_SECTIONS.find((item) => item.slug === slug);
  if (!section || section.href) notFound();
  const context = await getAdminContext();
  const items = visibleManageItems(section, context?.canViewPayroll === true);

  return <main className="px-4">
    <div className="mt-2 mb-5 px-1">
      <ManageBackLink href="/more" label="관리" />
      <p className="mt-5 text-label font-bold text-primary">{section.eyebrow}</p>
      <h1 className="mt-1 text-display font-extrabold text-ink">{section.title}</h1>
      <p className="mt-2 text-body leading-6 text-sub">{section.description}</p>
    </div>
    <Card className="divide-y divide-line p-0">
      {items.map((item) => <Link key={item.href} href={item.href} className="flex items-center justify-between px-5 py-4 active:bg-bg">
        <div className="min-w-0"><p className="text-body font-bold text-ink">{item.label}</p><p className="mt-1 text-label leading-5 text-sub">{item.description}</p></div><span className="ml-4 text-sub">›</span>
      </Link>)}
    </Card>
  </main>;
}
