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
  if (!sb) throw new Error('워크룸 연결을 확인해 주세요.');
  const { data, error } = await sb.from('facility_staff').select('id,name,worker_id')
    .eq('facility_id', context.facilityId).neq('status', 'ended').order('name');
  if (error) throw new Error('구성원 목록을 불러오지 못했어요. 다시 시도해 주세요.');
  const members=(data??[]).map((row)=>({id:row.id as string,name:row.name as string,workerLinked:Boolean(row.worker_id)}));
  const requested=(await searchParams).staff;
  const initialStaffId=members.some((member)=>member.id===requested&&member.workerLinked)?requested??'':'';
  return <WorkroomClient facilityId={context.facilityId} facilityName={shop.name} members={members} initialStaffId={initialStaffId}/>;
}
