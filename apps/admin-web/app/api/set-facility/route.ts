import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession, setAdminSessionCookie, setFacilityContextCookie } from '@/lib/admin-auth';
import { bearerToken } from '@/lib/supabase';
import { listAccessibleFacilities } from '@/lib/facility';

export async function POST(req: NextRequest) {
  const bearer = bearerToken(req.headers);
  if (bearer) {
    try {
      await setAdminSessionCookie(bearer);
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { facilityId?: string };
  const facilities = await listAccessibleFacilities();
  const facilityId = body.facilityId ?? (facilities[0]?.id as string | undefined) ?? null;

  if (!facilityId) return NextResponse.json({ facilityId: null });
  if (!facilities.some((facility) => facility.id === facilityId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await setFacilityContextCookie(facilityId, session.user.id);
  return NextResponse.json({ facilityId });
}
