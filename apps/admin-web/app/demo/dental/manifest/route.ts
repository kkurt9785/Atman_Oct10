import { NextRequest, NextResponse } from 'next/server';
import { isValidDentalDemoKey } from '@/lib/demo/private-dental';
import base from '@/public/manifest.json';

// 치과 시연 링크 전용 설치 정보. 시작 주소에 링크 키를 넣어 설치한 앱이 곧장 치과 시연으로 열리게 한다.
// id 를 따로 둬 일반 '잇닿 관리자' 설치와 섞이지 않게 한다(안드로이드는 id 로 앱을 구분한다).
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key') ?? '';
  if (!isValidDentalDemoKey(key)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const manifest = {
    ...base,
    id: '/demo/dental',
    name: '잇닿 관리자 — 치과 시연',
    short_name: '잇닿 관리자',
    start_url: `/demo/dental?key=${encodeURIComponent(key)}`,
    scope: '/',
  };
  return new NextResponse(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
  });
}
