import Link from 'next/link';
import { listAccessibleFacilities } from '@/lib/facility';
import { requireAdminSession } from '@/lib/admin-auth';
import { facilityKindBadge } from '@/lib/facility-mode';

export default async function SitesPage() {
  await requireAdminSession();
  const sites = await listAccessibleFacilities();
  return <main className="mx-auto max-w-xl px-4 py-6"><h1 className="text-2xl font-extrabold">사업장·현장 관리</h1><p className="mt-2 text-sm leading-6 text-sub">행사장·팝업·작업장을 각각 등록하세요. 현장별 직원·일정·근태·지급 내역과 출퇴근 기준점은 서로 분리돼요. 위 현장 선택에서 전환할 수 있어요.</p><Link href="/sites/new" className="my-5 flex min-h-12 items-center justify-center rounded-xl bg-primary p-3 font-bold text-white">+ 단기 근무 현장 추가</Link><ul className="space-y-3">{sites.map(site=><li key={String(site.id)} className="rounded-2xl border border-line bg-white p-4"><p className="font-bold">{String(site.name)}</p><p className="mt-1 text-xs text-primary">{facilityKindBadge(site).label} · {site.access_role==='owner'?'소유 현장':'연결된 현장'}</p><p className="mt-2 break-words text-sm text-sub">{String(site.address_text??'지도 지정 현장')}</p></li>)}</ul><p className="mt-4 text-xs leading-5 text-sub">같은 근로자가 여러 현장에서 일하면 각 현장에서 별도로 초대·배정하세요. 무료 베타의 인원 제한과 설정은 현장별로 적용됩니다. 종료한 현장의 기록은 삭제하지 않고 보관하세요.</p></main>;
}
