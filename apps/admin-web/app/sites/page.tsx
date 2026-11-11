import Link from 'next/link';
import { listAccessibleFacilities } from '@/lib/facility';
import { requireAdminSession } from '@/lib/admin-auth';
import { facilityKindBadge, isGigworkerFacility } from '@/lib/facility-mode';
import { getShop } from '@/lib/db/shop';
import { SiteOperationsSummary } from '@/components/SiteOperationsSummary';

export default async function SitesPage() {
  const session=await requireAdminSession();
  const [sites,shop] = await Promise.all([listAccessibleFacilities(),getShop()]);
  // 병원·약국 관리자에게 '행사장·작업장'·'긱 미정산' 같은 단기·행사 문구가 보였다(2026-11-05 QA) — 지금 사업장 종류에 맞춰 쓴다
  const gig=isGigworkerFacility(shop);
  return <main className="mx-auto max-w-xl px-4 py-6"><h1 className="text-2xl font-extrabold">사업장·현장 관리</h1><p className="mt-2 text-sm leading-6 text-sub">{gig?'행사장·팝업·작업장을 각각 등록하세요. 현장별 직원·일정·근태·지급 내역과 출퇴근 기준점은 서로 분리돼요. 직접 등록 인력의 출근 확인·근무 중·승인 대기와 미정산 근무를 모아 봐요. 공고 근무와 직원 월 급여는 각 현장에서 따로 확인해 주세요.':'사업장과 단기 근무 현장을 여기서 추가하고 전환해요. 현장마다 직원·일정·근태·지급 내역과 출퇴근 기준점이 따로 관리돼요. 출근 확인·근무 중·퇴근 승인 대기와 미정산 단기 근무를 모아 봐요. 공고 근무와 직원 월 급여는 각 사업장에서 확인해 주세요.'}</p><Link href="/sites/new" className="my-5 flex min-h-12 items-center justify-center rounded-xl bg-primary p-3 font-bold text-white">+ 단기 근무 현장 추가</Link><ul className="space-y-3">{sites.map(site=><li key={String(site.id)} className="rounded-2xl border border-line bg-white p-4"><p className="font-bold">{String(site.name)}</p><p className="mt-1 text-xs text-primary">{facilityKindBadge(site).label} · {site.access_role==='owner'?'소유 현장':'연결된 현장'}</p><p className="mt-2 break-words text-sm text-sub">{String(site.address_text??'지도 지정 현장')}</p><SiteOperationsSummary userId={session.user.id} facilityId={String(site.id)} gig={isGigworkerFacility(site)}/></li>)}</ul><p className="mt-4 text-xs leading-5 text-sub">{gig?'같은 근무자가 여러 현장에서 일하면 각 현장에서 따로 초대·배정하세요. 무료 베타의 인원 제한과 설정은 현장별로 적용돼요. 종료한 현장의 기록은 지우지 않고 보관해요.':'같은 근무자가 여러 현장에서 일하면 현장마다 따로 초대·배정해 주세요. 단기 근무 현장의 무료 베타 인원 제한과 설정은 현장별로 적용돼요. 종료한 현장의 기록은 지우지 않고 보관해요.'}</p></main>;
}
