import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase';
import { requireFacilityAdmin } from '@/lib/facility';

export const dynamic = 'force-dynamic';

// 면허 사진 열람 — 관리자 재검증 후 5분짜리 signed URL로 리다이렉트.
// license_photo_url이 레거시 public URL이어도 경로를 추출해 처리한다.
export async function GET(req: NextRequest) {
  const session = await requireFacilityAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const src = req.nextUrl.searchParams.get('src');
  if (!src) return NextResponse.json({ error: 'src required' }, { status: 400 });

  // 레거시 public URL → 버킷 이후 경로만 추출
  const marker = '/license-photos/';
  const path = src.includes(marker) ? src.slice(src.indexOf(marker) + marker.length) : src;
  if (!path || path.includes('..')) return NextResponse.json({ error: 'invalid path' }, { status: 400 });

  const sb = adminClient();
  if (!sb) return NextResponse.json({ error: 'DB error' }, { status: 500 });

  const { data, error } = await sb.storage.from('license-photos').createSignedUrl(path, 60 * 5);
  if (error || !data?.signedUrl) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.redirect(data.signedUrl);
}
