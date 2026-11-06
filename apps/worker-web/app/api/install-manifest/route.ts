import { NextResponse, type NextRequest } from 'next/server';
import { installManifest } from '@/lib/install-manifest';

// 초대 화면 전용 manifest — 홈 화면 앱이 그 초대에서 열리게 한다(lib/install-manifest.ts)
export function GET(request: NextRequest) {
  return NextResponse.json(installManifest(request.nextUrl.searchParams.get('start')), {
    headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}
