import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext, getAdminSession, setFacilityContextCookie } from '@/lib/admin-auth';
import { listAccessibleFacilities } from '@/lib/facility';

export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilities = await listAccessibleFacilities();
  const context = await getAdminContext();

  return NextResponse.json({
    facilities,
    currentFacilityId: context?.facilityId ?? null,
  });
}

export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { facilityId?: string };
  if (!body.facilityId) {
    return NextResponse.json({ error: 'facilityId required' }, { status: 400 });
  }

  const facilities = await listAccessibleFacilities();
  const allowed = facilities.some((facility) => facility.id === body.facilityId);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await setFacilityContextCookie(body.facilityId, session.user.id);
  return NextResponse.json({ facilityId: body.facilityId });
}
