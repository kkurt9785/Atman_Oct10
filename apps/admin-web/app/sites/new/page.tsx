import { requireAdminSession } from '@/lib/admin-auth';
import { NewSiteForm } from './NewSiteForm';
import { getShop } from '@/lib/db/shop';
import { isGigworkerFacility } from '@/lib/facility-mode';

export default async function NewSitePage() {
  await requireAdminSession();
  const shop = await getShop();
  // 사업장이 없거나 단기·행사 근태 사업장이면 기존 긱 온보딩 문구 그대로
  return <NewSiteForm medical={Boolean(shop) && !isGigworkerFacility(shop)} />;
}
