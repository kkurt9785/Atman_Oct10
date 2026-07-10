import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHmac, randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

const TTL_SECONDS = 60;

// 체크인 QR 토큰 발급 — HMAC 서명 + 60초 TTL + 1회용 nonce.
// service_role을 쓰지 않는다: 사용자 JWT + RLS로 본인 지원 건만 조회된다.
export async function POST(req: NextRequest) {
  const secret = process.env.QR_SECRET;
  if (!secret) return NextResponse.json({ error: 'QR_SECRET not configured' }, { status: 500 });

  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { applicationId } = (await req.json().catch(() => ({}))) as { applicationId?: string };
  if (!applicationId) return NextResponse.json({ error: 'applicationId required' }, { status: 400 });

  // 사용자 JWT를 그대로 쓰는 클라이언트 → RLS가 본인 소유만 통과시킴
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } }
  );

  const { data: app } = await sb
    .from('shift_applications')
    .select('id, status')
    .eq('id', applicationId)
    .maybeSingle();

  if (!app) return NextResponse.json({ error: '지원 내역을 찾을 수 없어요' }, { status: 404 });
  if (app.status !== 'accepted' && app.status !== 'completed') {
    return NextResponse.json({ error: '수락된 시프트가 아니에요' }, { status: 403 });
  }

  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const nonce = randomUUID();
  const payload = `${applicationId}.${exp}.${nonce}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');

  return NextResponse.json({ token: `aqr1.${payload}.${sig}`, ttl: TTL_SECONDS });
}
