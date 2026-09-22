import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/admin-auth';
import { adminClient } from '@/lib/supabase';
import { getShop } from '@/lib/db/shop';
import { WorkroomClient } from './WorkroomClient';

export default async function WorkroomPage() {
  const [context, shop] = await Promise.all([getAdminContext(), getShop()]);
  if (!context) redirect('/login');
  if (!shop) redirect('/setup/claim-facility');
  const sb = adminClient();
  const { count } = sb ? await sb.from('facility_staff').select('id', { count: 'exact', head: true })
    .eq('facility_id', context.facilityId).neq('status', 'ended').not('worker_id', 'is', null) : { count: 0 };
  return <WorkroomClient facilityId={context.facilityId} facilityName={shop.name} memberCount={count ?? 0}/>;
}
