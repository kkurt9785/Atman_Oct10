import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/admin-auth';
import { adminClient } from '@/lib/supabase';
import { getShop } from '@/lib/db/shop';
import { loadUnreadWorkroom } from '@/lib/nav-badges';
import { WorkroomClient } from './WorkroomClient';

export default async function WorkroomPage({ searchParams }: { searchParams: Promise<{ staff?: string }> }) {
  const [context, shop] = await Promise.all([getAdminContext(), getShop()]);
  if (!context) redirect('/login');
  if (!shop) redirect('/setup/claim-facility');
  const sb = adminClient();
  if (!sb) throw new Error('대화방 연결을 확인해 주세요.');
  const { data, error } = await sb.from('facility_staff').select('id,name,worker_id')
    .eq('facility_id', context.facilityId).neq('status', 'ended').order('name');
  if (error) throw new Error('구성원 목록을 불러오지 못했어요. 다시 시도해 주세요.');
  const members=(data??[]).map((row)=>({id:row.id as string,name:row.name as string,workerLinked:Boolean(row.worker_id)}));
  // 사람 칩에 안 읽은 수를 보여 준다 — 하단 탭 숫자와 같은 계산(실패하면 숫자만 안 보인다)
  const unread=await loadUnreadWorkroom(sb,context.facilityId,context.user.id).catch(()=>({room:0,staff:{} as Record<string,number>,total:0}));
  const requested=(await searchParams).staff;
  // 주소에 사람이 없으면, 전체 공지방에 새 글이 없고 안 읽은 1:1 대화가 있을 때 그 대화부터 연다 — '대화 2'를 보고 들어왔는데 전체 공지가 열려 어디 있는지 몰랐다(11/12 운영 QA)
  const firstUnread=unread.room>0?undefined:members.find((member)=>member.workerLinked&&(unread.staff[member.id]??0)>0)?.id;
  const initialStaffId=members.some((member)=>member.id===requested&&member.workerLinked)?requested??'':firstUnread??'';
  return <WorkroomClient facilityId={context.facilityId} facilityName={shop.name} members={members} initialStaffId={initialStaffId} applicantChats={shop.mode!=='gig'} initialUnread={{room:unread.room,staff:unread.staff}}/>;
}
