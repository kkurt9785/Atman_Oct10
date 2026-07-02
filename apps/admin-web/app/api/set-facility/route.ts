import { NextRequest, NextResponse } from 'next/server';
import { adminClient, getUserFromBearer } from '@/lib/supabase';
import { setFacilityCookie } from '@/lib/facility';

export async function POST(req: NextRequest) {
  const user = await getUserFromBearer(req.headers);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { facilityId?: string };

  const sb = adminClient();
  if (!sb) return NextResponse.json({ error: 'DB error' }, { status: 500 });

  if (body.facilityId) {
    const [{ data: owned }, { data: delegated }] = await Promise.all([
      sb.from('facilities').select('id').eq('id', body.facilityId).eq('admin_user_id', user.id).maybeSingle(),
      sb.from('facility_admin_access').select('facility_id').eq('user_id', user.id).eq('facility_id', body.facilityId).maybeSingle(),
    ]);
    if (!owned && !delegated) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    await setFacilityCookie(body.facilityId);
    return NextResponse.json({ facilityId: body.facilityId });
  }

  const [{ data: owned }, { data: delegated }] = await Promise.all([
    sb
      .from('facilities')
      .select('id')
      .eq('admin_user_id', user.id)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name')
      .limit(1)
      .maybeSingle(),
    sb
      .from('facility_admin_access')
      .select('facility_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle(),
  ]);

  const facilityId = owned?.id ?? delegated?.facility_id ?? null;
  if (!facilityId) return NextResponse.json({ facilityId: null });

  await setFacilityCookie(facilityId);

  return NextResponse.json({ facilityId });
}
