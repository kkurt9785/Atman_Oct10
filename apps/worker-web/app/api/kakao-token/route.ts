import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { code, redirectUri } = await request.json();

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: process.env.NEXT_PUBLIC_KAKAO_REST_API_KEY!,
    code,
  });

  const res = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  const data = await res.json();

  if (data.error) {
    return NextResponse.json(
      {
        error: data.error_description,
        error_code: data.error_code ?? data.error,
        debug_redirect_uri: redirectUri,
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ id_token: data.id_token });
}
