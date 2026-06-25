import { adminClient, ORG_ID } from '../supabase';
import { SHOP } from '../mock';

export type ShopInfo = {
  name: string;
  plan: 'bundle' | 'gig' | 'hr' | 'free';
  is5Plus: boolean;
  creditBalance: number;
};

export async function getShop(): Promise<ShopInfo> {
  const sb = adminClient();
  if (!sb || !ORG_ID) return { ...SHOP, creditBalance: 0 };

  const [facilityRes, creditRes] = await Promise.all([
    sb
      .from('facilities')
      .select('name, is_5plus, plan_code')
      .eq('id', ORG_ID)
      .single(),
    sb.rpc('org_credit_balance', { p_org_id: ORG_ID }),
  ]);

  const f = facilityRes.data;
  if (!f) return { ...SHOP, creditBalance: 0 };

  return {
    name: f.name,
    plan: (f.plan_code as ShopInfo['plan']) ?? 'free',
    is5Plus: f.is_5plus ?? false,
    creditBalance: (creditRes.data as number) ?? 0,
  };
}
