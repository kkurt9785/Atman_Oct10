import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';

export type ShopInfo = {
  name: string;
  facilityType: string;
  employeeCount: number | null;
  plan: 'bundle' | 'gig' | 'hr' | 'free';
  is5Plus: boolean;
  isDemo: boolean;
  approvedAt: string | null;       // NULL = 셀프 등록 후 잇닿 승인 대기
  registrationSource: string;
};

export async function getShop(): Promise<ShopInfo | null> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return null;

  const facilityRes = await sb
    .from('facilities')
    .select('name, facility_type, employee_count, is_5plus, plan_code, is_demo, approved_at, registration_source')
    .eq('id', facilityId)
    .single();

  const f = facilityRes.data;
  if (!f) return null;

  return {
    name: f.name,
    facilityType: f.facility_type,
    employeeCount: f.employee_count ?? null,
    plan: (f.plan_code as ShopInfo['plan']) ?? 'free',
    is5Plus: f.is_5plus ?? false,
    isDemo: f.is_demo ?? false,
    approvedAt: f.approved_at ?? null,
    registrationSource: f.registration_source ?? 'invite',
  };
}
