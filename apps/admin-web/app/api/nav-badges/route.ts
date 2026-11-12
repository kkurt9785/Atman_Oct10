import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import { getShop } from '@/lib/db/shop';
import { adminClient } from '@/lib/supabase';
import { countUnreadWorkroom } from '@/lib/nav-badges';
import { getGigOperationsBoard } from '@/lib/db/gig-operations';

export const dynamic = 'force-dynamic';

// 하단 탭 숫자: 대화(안 읽은 근무자 메시지)와 단기 근무지의 지급(지급할 사람 수).
// 실패하면 0 — 숫자가 없을 뿐 화면은 그대로다.
export async function GET() {
  const none = NextResponse.json({ chat: 0, pay: 0 }, { headers: { 'cache-control': 'no-store' } });
  const context = await getAdminContext().catch(() => null);
  if (!context) return none;
  const [shop, sb] = [await getShop().catch(() => null), adminClient()];
  if (!shop || !sb) return none;
  const canPay = shop.mode === 'gig' && context.canViewPayroll && ['owner', 'operator', 'super'].includes(context.accessRole);
  const [chat, pay] = await Promise.all([
    countUnreadWorkroom(sb, context.facilityId, context.user.id).catch(() => 0),
    canPay ? getGigOperationsBoard(context.user.id).then((board) => board.summary.pay).catch(() => 0) : Promise.resolve(0),
  ]);
  return NextResponse.json({ chat, pay }, { headers: { 'cache-control': 'no-store' } });
}
