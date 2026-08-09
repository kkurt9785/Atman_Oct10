import { NextRequest, NextResponse } from 'next/server';
import { reviveDemoShowcase } from '@/lib/demo/revive-showcase';

// 데모 쇼케이스 온디맨드 재시드. 자동 스케줄은 expire-shifts 크론이 매일 KST 08:30 에
// 함께 수행하고, 이 route 는 급 시연 직전 즉시 재시드가 필요할 때 수동 호출용이다.
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/revive-demo
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await reviveDemoShowcase();
    console.log('[cron/revive-demo]', result.totals);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[cron/revive-demo]', error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
