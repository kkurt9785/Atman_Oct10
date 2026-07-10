import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { code, redirectUri } = await request.json();

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: process.env.KAKAO_REST_API_KEY!,
    redirect_uri: redirectUri,
    code,
  });

  // 카카오 콘솔에서 Client Secret 활성화 시 필수
  if (process.env.KAKAO_CLIENT_SECRET) {
    params.set('client_secret', process.env.KAKAO_CLIENT_SECRET);
  }

  const res = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  const data = await res.json();

  if (data.error) {
    return NextResponse.json({ error: data.error_description }, { status: 400 });
  }

  return NextResponse.json({ id_token: data.id_token });
}
