import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';

export type MembershipInfo = {
  tierCode: string;
  tierName: string;
  monthlyFee: number;
  earnRate: number;
  paybackThreshold: number;
  consecutiveCycles: number;
  periodEnd: string;
  creditBalance: number;
  recentCredits: CreditRow[];
} | null;

export type CreditRow = {
  id: string;
  delta: number;
  kind: string;
  note: string | null;
  createdAt: string;
};

export type TierInfo = {
  code: string;
  name: string;
  monthlyFee: number;
  earnRate: number;
  paybackThreshold: number;
  grantsPlanCode: string | null;
};

export async function getMembership(): Promise<MembershipInfo> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return null;

  const [memRes, creditRes, histRes] = await Promise.all([
    sb
      .from('memberships')
      .select(`
        tier_code, consecutive_cycles, current_period_end, status,
        membership_tiers ( name, monthly_fee, earn_rate, payback_threshold )
      `)
      .eq('org_id', facilityId)
      .eq('status', 'active')
      .maybeSingle(),
    sb.rpc('org_credit_balance', { p_org_id: facilityId }),
    sb
      .from('credit_ledger')
      .select('id, delta, kind, note, created_at')
      .eq('org_id', facilityId)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const mem = memRes.data as any;
  if (!mem) return null;

  const tier = mem.membership_tiers;
  return {
    tierCode: mem.tier_code,
    tierName: tier?.name ?? mem.tier_code,
    monthlyFee: tier?.monthly_fee ?? 0,
    earnRate: tier?.earn_rate ?? 0,
    paybackThreshold: tier?.payback_threshold ?? 0,
    consecutiveCycles: mem.consecutive_cycles,
    periodEnd: mem.current_period_end,
    creditBalance: (creditRes.data as number) ?? 0,
    recentCredits: ((histRes.data as any[]) ?? []).map((r) => ({
      id: r.id,
      delta: r.delta,
      kind: r.kind,
      note: r.note,
      createdAt: r.created_at,
    })),
  };
}

export async function getAllTiers(): Promise<TierInfo[]> {
  const sb = adminClient();
  if (!sb) return [];

  const { data } = await sb
    .from('membership_tiers')
    .select('code, name, monthly_fee, earn_rate, payback_threshold, grants_plan_code')
    .order('sort_order');

  return ((data as any[]) ?? []).map((r) => ({
    code: r.code,
    name: r.name,
    monthlyFee: r.monthly_fee,
    earnRate: r.earn_rate,
    paybackThreshold: r.payback_threshold,
    grantsPlanCode: r.grants_plan_code,
  }));
}
