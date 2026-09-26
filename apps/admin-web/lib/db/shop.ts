import { cache } from 'react';
import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';
import { facilityModeOf, type FacilityMode } from '../facility-mode';

export type ShopInfo = {
  name: string;
  facilityType: string;
  // 병원·약국(medical)인지 긱워커 근무지(gig)인지. 화면 분기는 이 값만 본다 — lib/facility-mode.ts
  mode: FacilityMode;
  employeeCount: number | null;
  plan: 'bundle' | 'gig' | 'hr' | 'free' | 'gigworker_trial';
  is5Plus: boolean;
  isDemo: boolean;
  approvedAt: string | null;       // NULL = 셀프 등록 후 잇닿 승인 대기
  registrationSource: string;
  brnSubmitted: string | null;
  brnDocumentPath: string | null;
};

// 한 요청 안에서 레이아웃·페이지가 같이 부르므로 요청 단위로 캐시한다.
export const getShop = cache(async (): Promise<ShopInfo | null> => {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return null;

  const facilityRes = await sb
    .from('facilities')
    .select('name, facility_type, employee_count, is_5plus, plan_code, is_demo, approved_at, registration_source, brn_submitted, brn_document_path')
    .eq('id', facilityId)
    .single();

  const f = facilityRes.data;
  if (!f) return null;

  return {
    name: f.name,
    facilityType: f.facility_type,
    mode: facilityModeOf(f),
    employeeCount: f.employee_count ?? null,
    plan: (f.plan_code as ShopInfo['plan']) ?? 'free',
    is5Plus: f.is_5plus ?? false,
    isDemo: f.is_demo ?? false,
    approvedAt: f.approved_at ?? null,
    registrationSource: f.registration_source ?? 'invite',
    brnSubmitted: f.brn_submitted ?? null,
    brnDocumentPath: f.brn_document_path ?? null,
  };
});
