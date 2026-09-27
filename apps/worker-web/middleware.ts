import { NextRequest, NextResponse } from 'next/server';

// 긱워커 홍보용 주소 gig.itdot.co.kr → itdot.co.kr/gig
// 앱 세션(로컬 스토리지)과 카카오 리다이렉트는 itdot.co.kr 한 곳에만 있으므로, 서브도메인은 입구 역할만 하고 본 도메인으로 넘긴다.
export function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? '';
  if (host.startsWith('gig.')) {
    const url = new URL(request.url);
    const target = new URL(`https://${host.slice(4)}`);
    target.pathname = url.pathname === '/' ? '/gig' : url.pathname;
    target.search = url.search;
    return NextResponse.redirect(target, 308);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/|api/|.*\\..*).*)'],
};
