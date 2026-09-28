import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/admin-auth';
import { adminClient } from '@/lib/supabase';
import { getShop } from '@/lib/db/shop';
import { WorkroomClient } from './WorkroomClient';

export default async function WorkroomPage({ searchParams }: { searchParams: Promise<{ staff?: string }> }) {
  const [context, shop] = await Promise.all([getAdminContext(), getShop()]);
  if (!context) redirect('/login');
  if (!shop) redirect('/setup/claim-facility');
  const sb = adminClient();
  const { data } = sb ? await sb.from('facility_staff').select('id,name,worker_id')
    .eq('facility_id', context.facilityId).neq('status', 'ended').order('name') : { data: [] };
  const members=(data??[]).map((row)=>({id:row.id as string,name:row.name as string,workerLinked:Boolean(row.worker_id)}));
  const requested=(await searchParams).staff;
  const initialStaffId=members.some((member)=>member.id===requested&&member.workerLinked)?requested??'':'';
  return <WorkroomClient facilityId={context.facilityId} facilityName={shop.name} members={members} initialStaffId={initialStaffId}/>;
}
