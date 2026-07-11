import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import { nudgeNotificationDispatch } from '@/lib/notify-nudge';

export const dynamic = 'force-dynamic';

// 관리자가 채팅을 보낸 직후 워커 푸시 발송을 깨운다 (Hobby 일1회 cron 보완)
export async function POST() {
  const context = await getAdminContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  nudgeNotificationDispatch();
  return NextResponse.json({ ok: true });
}
