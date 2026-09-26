import { isGigworkerFacility } from '@/lib/facility-mode';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession, setAdminSessionCookie, setFacilityContextCookie } from '@/lib/admin-auth';
import { adminClient, bearerToken } from '@/lib/supabase';
import { listAccessibleFacilities } from '@/lib/facility';

const GIGWORKER_DEMO_ADMIN = 'sales-demo-1@demo.atman.co.kr';
const GIGWORKER_DEMO_BRN = 'DEMO-GIGWORKER-2026';

// 긱워커 시연 근무지(팝업스토어 데모)에 대한 시연 관리자의 접근 권한을 보장한다.
// 운영 DB 에서 이 접근 행이 사라진 적이 있어 '긱워커 근태 시연'이 W여성병원으로 떨어졌다. 시연은 반복돼야 하므로 매번 여기서 되살린다.
async function ensureGigworkerDemoAccess(userId: string) {
  const sb = adminClient();
  if (!sb) return;
  const { data: facility } = await sb.from('facilities').select('id')
    .eq('business_registration_number', GIGWORKER_DEMO_BRN).eq('is_demo', true).eq('is_active', true).is('deleted_at', null).maybeSingle();
  if (!facility?.id) return;
  await sb.from('facility_admin_access')
    .upsert({ user_id: userId, facility_id: facility.id, access_role: 'super', can_view_payroll: true }, { onConflict: 'user_id,facility_id' });
}

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

  const body = await req.json().catch(() => ({})) as { facilityId?: string; demoKind?: string };
  const wantsGigworkerDemo = body.demoKind === 'gigworker' && session.user.email === GIGWORKER_DEMO_ADMIN;
  if (wantsGigworkerDemo) await ensureGigworkerDemoAccess(session.user.id);
  const facilities = await listAccessibleFacilities();
  const gigworkerDemoTarget = wantsGigworkerDemo
    ? facilities.find((facility) => isGigworkerFacility(facility) && facility.is_demo === true)
    : undefined;
  const demoTarget = gigworkerDemoTarget ?? (session.user.email==='sales-demo-1@demo.atman.co.kr'
    ? facilities.find((facility)=>facility.name==='W여성병원'&&facility.is_demo===true)
    : session.user.email==='sales-demo-2@demo.atman.co.kr'
      ? facilities.find((facility)=>facility.facility_type==='pharmacy'&&facility.is_demo===true)
      : session.user.email==='sales-demo-3@demo.atman.co.kr'
        ? facilities.find((facility)=>facility.facility_type==='care_hospital'&&facility.is_demo===true)
        : undefined);
  const facilityId = body.facilityId
    ?? (demoTarget?.id as string | undefined)
    ?? (facilities[0]?.id as string | undefined)
    ?? null;

  if (!facilityId) return NextResponse.json({ facilityId: null });
  if (!facilities.some((facility) => facility.id === facilityId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await setFacilityContextCookie(facilityId, session.user.id);
  return NextResponse.json({ facilityId });
}
