import { NextRequest, NextResponse } from 'next/server';
import { adminClient, getUserFromBearer } from '@/lib/supabase';
import { setFacilityCookie } from '@/lib/facility';

export async function POST(req: NextRequest) {
  const user = await getUserFromBearer(req.headers);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = adminClient();
  if (!sb) return NextResponse.json({ error: 'DB error' }, { status: 500 });

  const { data: facility } = await sb
    .from('facilities')
    .select('id')
    .eq('admin_user_id', user.id)
    .maybeSingle();

  if (!facility) return NextResponse.json({ facilityId: null });

  await setFacilityCookie(facility.id);

  return NextResponse.json({ facilityId: facility.id });
}
