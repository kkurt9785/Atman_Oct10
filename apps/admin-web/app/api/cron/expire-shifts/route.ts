import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase';
import { todayKST } from '@/lib/date';
import { reviveDemoShowcase } from '@/lib/demo/revive-showcase';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Vercel Cron 인증
  const secret = process.env.CRON_SECRET;
  const auth   = req.headers.get('authorization');
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });
  }
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = adminClient();
  if (!sb) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });

  const today = todayKST();

  // 1. 날짜 지난 open 시프트 → cancelled
  const { data: cancelled } = await sb
    .from('shifts')
    .update({ status: 'cancelled' })
    .eq('status', 'open')
    .lt('shift_date', today)
    .select('id');

  // 2. 날짜 지난 shifts ID 목록 조회 (matched 포함 — 지원 만료 처리용)
  const { data: oldShifts } = await sb
    .from('shifts')
    .select('id')
    .lt('shift_date', today);

  const oldIds = (oldShifts ?? []).map((s: { id: string }) => s.id);

  // 3. 해당 시프트에 applied 상태 지원 → expired
  //    (accepted는 건드리지 않음 — 노쇼 처리는 어드민 재량)
  let expiredApps = 0;
  if (oldIds.length > 0) {
    const { data: updated } = await sb
      .from('shift_applications')
      .update({ status: 'expired' })
      .eq('status', 'applied')
      .in('shift_id', oldIds)
      .select('id');
    expiredApps = updated?.length ?? 0;
  }

  // 4. 지난 데모 정리 직후 오늘자 데모 쇼케이스 재시드 (KST 08:30 실행).
  //    DEMO_SHOWCASE_ENABLED=false 로 끌 수 있다 (실제 운영 전환 시).
  let demo: unknown = null;
  if (process.env.DEMO_SHOWCASE_ENABLED !== 'false') {
    try {
      demo = await reviveDemoShowcase();
    } catch (error) {
      console.error('[cron/expire-shifts] demo revive failed', error);
      demo = { ok: false, error: String(error) };
    }
  }

  const result = {
    ok: true,
    as_of: today,
    cancelled_shifts:     cancelled?.length ?? 0,
    expired_applications: expiredApps,
    demo,
  };
  console.log('[cron/expire-shifts]', result);
  return NextResponse.json(result);
}
