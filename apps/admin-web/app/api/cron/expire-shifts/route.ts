import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase';
import { todayKST } from '@/lib/date';
import { recheckStaleBusinessStatuses } from '@/lib/business-status';

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

  // 시연 데이터 삭제·재시드는 자동 실행하지 않는다. 표시된 시연 공고의
  // 시간을 먼저 갱신해야 아래 일반 만료 처리에 의해 취소되지 않는다.
  let demo: unknown = null;
  if (process.env.DEMO_SHOWCASE_ENABLED !== 'false') {
    const {data,error}=await sb.rpc('refresh_demo_worker_readiness');
    if(error)return NextResponse.json({ok:false,error:'데모 준비 상태를 확인하지 못해 만료 처리를 중단했어요.'},{status:503});
    demo={ok:true,mode:'readiness',result:data};
  }

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

  // 5. 사업자 상태 월 1회 재조회(국세청) — 휴업·폐업이면 공고 등록이 막힌다
  let businessCheck: unknown = null;
  try { businessCheck = await recheckStaleBusinessStatuses(sb); } catch (error) { businessCheck = { ok: false, error: String(error) }; }

  const result = {
    ok: true,
    as_of: today,
    cancelled_shifts:     cancelled?.length ?? 0,
    expired_applications: expiredApps,
    demo,
    business_check: businessCheck,
  };
  console.log('[cron/expire-shifts]', result);
  return NextResponse.json(result);
}
