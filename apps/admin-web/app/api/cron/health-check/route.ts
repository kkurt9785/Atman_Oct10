import { NextRequest, NextResponse } from 'next/server';
import { runHealthCheck } from '@/lib/ops-health';

// 매일 09:00(KST) 자동 점검 — 시연 재시드(08:30) 다음에 돈다
function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const run = await runHealthCheck('cron');
    const problems = run.checks.filter((c) => c.level !== 'ok').map((c) => `${c.level}:${c.key}`);
    console.log('[cron/health-check]', run.status, problems);
    return NextResponse.json({ ok: true, status: run.status, problems });
  } catch (error) {
    console.error('[cron/health-check]', error);
    return NextResponse.json({ error: 'Health check failed' }, { status: 500 });
  }
}

export const POST = GET;
