import { NextRequest, NextResponse } from 'next/server';
import { adminClient, getUserFromBearer } from '@/lib/supabase';
import { getCurrentFacilityId, setFacilityCookie } from '@/lib/facility';

export async function GET(req: NextRequest) {
  const user = await getUserFromBearer(req.headers);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = adminClient();
  if (!sb) return NextResponse.json({ error: 'DB error' }, { status: 500 });

  const [{ data: owned }, { data: delegated }] = await Promise.all([
    sb
      .from('facilities')
      .select('id, name, facility_type, address_text')
      .eq('admin_user_id', user.id)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name'),
    sb
      .from('facility_admin_access')
      .select('access_role, facilities ( id, name, facility_type, address_text )')
      .eq('user_id', user.id)
      .order('access_role'),
  ]);

  const map = new Map<string, unknown>();
  for (const f of owned ?? []) map.set(f.id, { ...f, access_role: 'owner' });
  for (const row of (delegated ?? []) as Array<{ access_role: string; facilities: unknown }>) {
    const f = row.facilities as { id?: string } | null;
    if (f?.id) map.set(f.id, { ...f, access_role: row.access_role });
  }

  const currentFacilityId = await getCurrentFacilityId();

  return NextResponse.json({
    facilities: Array.from(map.values()),
    currentFacilityId: currentFacilityId && map.has(currentFacilityId) ? currentFacilityId : null,
  });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromBearer(req.headers);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { facilityId } = await req.json();
  if (!facilityId) return NextResponse.json({ error: 'facilityId required' }, { status: 400 });

  const sb = adminClient();
  if (!sb) return NextResponse.json({ error: 'DB error' }, { status: 500 });

  const [{ data: owned }, { data: delegated }] = await Promise.all([
    sb.from('facilities').select('id').eq('id', facilityId).eq('admin_user_id', user.id).maybeSingle(),
    sb.from('facility_admin_access').select('facility_id').eq('user_id', user.id).eq('facility_id', facilityId).maybeSingle(),
  ]);

  if (!owned && !delegated) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await setFacilityCookie(facilityId, user.id);
  return NextResponse.json({ facilityId });
}
