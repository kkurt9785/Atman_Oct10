import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase';
import { todayKST } from '@/lib/date';
import { recheckStaleBusinessStatuses } from '@/lib/business-status';
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

  // 4. 오늘자 데모 쇼케이스 재시드 (KST 08:30, 영업 전) — 병원·약국·요양병원 시연 공고 50·확정 50·지원 150·대타·채팅과
  //    긱 시연 사업장 정리(cleanup_gig_demo_facility)까지. DEMO_SHOWCASE_ENABLED=false 로 끌 수 있다(철수 때).
  //    2026-10-14 검토에서 한 번 꺼졌다가 되돌림: 15분 readiness 만으로는 3곳만 유지돼 나머지 49곳 공고가 만료 뒤 비어 갔다.
  let demo: unknown = null;
  if (process.env.DEMO_SHOWCASE_ENABLED !== 'false') {
    try {
      demo = await reviveDemoShowcase();
    } catch (error) {
      console.error('[cron/expire-shifts] demo revive failed', error);
      demo = { ok: false, error: String(error) };
    }
    // 재시드 직후 긱 페르소나 근무시간을 지금 기준으로(출근·퇴근 창 안) — 15분 크론과 같은 함수, 실패해도 만료 처리는 유지
    const { data: readiness, error: readinessError } = await sb.rpc('refresh_demo_worker_readiness');
    demo = { revive: demo, readiness: readinessError ? { ok: false, error: readinessError.message } : readiness };
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
