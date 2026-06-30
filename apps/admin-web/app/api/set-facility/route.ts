import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase';
import { FACILITY_COOKIE } from '@/lib/constants';
import { cookies } from 'next/headers';

export async function POST(req: NextRequest) {
  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const sb = adminClient();
  if (!sb) return NextResponse.json({ error: 'DB error' }, { status: 500 });

  const { data: facility } = await sb
    .from('facilities')
    .select('id')
    .eq('admin_user_id', userId)
    .maybeSingle();

  if (!facility) return NextResponse.json({ facilityId: null });

  const jar = await cookies();
  jar.set(FACILITY_COOKIE, facility.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });

  return NextResponse.json({ facilityId: facility.id });
}
