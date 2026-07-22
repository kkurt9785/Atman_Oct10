import type { SupabaseClient } from '@supabase/supabase-js';
import { todayKST } from './date';

type PlanFeature = 'repeat_invite' | 'operations';
type UsageType = 'job_posting_slot' | 'active_worker';

type FacilityPlan = {
  code: string;
  name: string;
  features: Record<string, unknown>;
};

async function getFacilityPlan(sb: SupabaseClient, facilityId: string): Promise<FacilityPlan> {
  const { data: subscription, error: subscriptionError } = await sb
    .from('facility_subscriptions')
    .select('plan_code,trial_ends_at,service_plans(code,name,features)')
    .eq('facility_id', facilityId)
    .in('status', ['active', 'past_due', 'pending'])
    .or(`trial_ends_at.is.null,trial_ends_at.gte.${todayKST()}`)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subscriptionError) throw new Error('구독 정보를 확인하지 못했어요.');

  const joined = Array.isArray((subscription as any)?.service_plans)
    ? (subscription as any).service_plans[0]
    : (subscription as any)?.service_plans;
  if (joined) return { code: joined.code, name: joined.name, features: joined.features ?? {} };

  const { data: free, error: freeError } = await sb
    .from('service_plans')
    .select('code,name,features')
    .eq('code', 'free')
    .eq('is_active', true)
    .single();
  if (freeError || !free) throw new Error('기본 요금제 정보를 확인하지 못했어요.');
  return { code: free.code, name: free.name, features: free.features ?? {} };
}

export async function requirePlanFeature(
  sb: SupabaseClient,
  facilityId: string,
  feature: PlanFeature,
): Promise<void> {
  const plan = await getFacilityPlan(sb, facilityId);
  if (plan.features[feature] === true) return;
  const label = feature === 'repeat_invite' ? '인력풀 반복초대' : '운영 자동화';
  const required = feature === 'repeat_invite' ? 'Basic 이상' : 'Pro 이상';
  throw new Error(`${label} 기능은 ${required} 요금제에서 이용할 수 있어요. 현재 플랜: ${plan.name}`);
}

export async function consumePlanUsage(
  sb: SupabaseClient,
  facilityId: string,
  usageType: UsageType,
  quantity: number,
  idempotencyKey: string,
): Promise<boolean> {
  const { data, error } = await sb.rpc('consume_service_plan_usage', {
    p_facility_id: facilityId,
    p_usage_type: usageType,
    p_quantity: quantity,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw new Error('요금제 사용량을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
  const result = data as { allowed?: boolean; duplicate?: boolean; used?: number; limit?: number; plan_name?: string } | null;
  if (result?.allowed) return result.duplicate !== true;
  const label = usageType === 'job_posting_slot' ? '월 공고' : '인력풀 반복초대 대상';
  throw new Error(`${result?.plan_name ?? '현재'} 요금제의 ${label} 한도(${result?.limit ?? 0})에 도달했어요.`);
}

export async function releasePlanUsage(sb: SupabaseClient, idempotencyKey: string): Promise<void> {
  await sb.from('service_usage_events').delete().eq('idempotency_key', idempotencyKey);
}
