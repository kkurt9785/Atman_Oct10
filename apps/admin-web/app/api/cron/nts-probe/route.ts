import { NextRequest, NextResponse } from 'next/server';
import { probeBusinessStatus, serviceKeyShape } from '@/lib/nts';

export const dynamic = 'force-dynamic';

// 국세청 사업자 조회 키 진단 전용 — DB 쓰기·운영자 알림 없음, CRON_SECRET 보호.
// 키 값은 돌려주지 않고 형태(길이·base64 여부)와 국세청 응답 결과만 돌려준다. 키를 새로 넣은 뒤 활성화를 기다릴 때 반복 호출용.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const keyShape = serviceKeyShape(process.env.NTS_BUSINESS_API_KEY);
  const probe = await probeBusinessStatus(process.env.NTS_PROBE_BRN ?? '4814401177');
  return NextResponse.json(probe.ok
    ? { configured: keyShape.length > 0, keyShape, ok: true, status: probe.result.status, detail: probe.result.detail }
    : { configured: keyShape.length > 0, keyShape, ok: false, reason: probe.reason });
}
