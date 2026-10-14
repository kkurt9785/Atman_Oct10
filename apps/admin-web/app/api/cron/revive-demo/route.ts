import { NextRequest, NextResponse } from 'next/server';
import { reviveDemoShowcase } from '@/lib/demo/revive-showcase';

// 파괴적 재시드는 자동 호출하지 않는다. 담당자가 시연 중인 사람이 없음을
// 확인한 후 POST { confirmReset: 'RESET_DEMO_DATA' }로 명시적으로 요청한다.
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({error:'전체 초기화는 명시적 확인이 있는 POST 요청으로만 실행할 수 있어요.'},{status:405,headers:{Allow:'POST'}});
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if(process.env.DEMO_SHOWCASE_ENABLED==='false')return NextResponse.json({error:'데모 기능이 비활성화되어 있어요.'},{status:403});
  const body=await req.json().catch(()=>null);
  if(body?.confirmReset!=='RESET_DEMO_DATA')return NextResponse.json({error:'진행 중인 시연이 없는지 확인하고 초기화를 명시적으로 요청해 주세요.'},{status:400});

  try {
    const result = await reviveDemoShowcase();
    console.log('[cron/revive-demo]', result.totals);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[cron/revive-demo]', error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
