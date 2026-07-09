import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';

export type ShopInfo = {
  name: string;
  plan: 'bundle' | 'gig' | 'hr' | 'free';
  is5Plus: boolean;
  creditBalance: number;
};

export async function getShop(): Promise<ShopInfo | null> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return null;

  const [facilityRes, creditRes] = await Promise.all([
    sb
      .from('facilities')
      .select('name, is_5plus, plan_code')
      .eq('id', facilityId)
      .single(),
    sb.rpc('org_credit_balance', { p_org_id: facilityId }),
  ]);

  const f = facilityRes.data;
  if (!f) return null;

  return {
    name: f.name,
    plan: (f.plan_code as ShopInfo['plan']) ?? 'free',
    is5Plus: f.is_5plus ?? false,
    creditBalance: (creditRes.data as number) ?? 0,
  };
}
