import type { SupabaseClient } from '@supabase/supabase-js';
import { todayKST } from './date';

type PlanFeature = 'repeat_invite' | 'operations';
type UsageType = 'job_posting_slot' | 'active_worker';

type FacilityPlan = {
  code: string;
  name: string;
  features: Record<string, unknown>;
  includedAttendanceSlots: number;
  // 무료 체험 중이면 마지막 날(YYYY-MM-DD), 아니면 null
  trialEndsAt: string | null;
};

async function getFacilityPlan(sb: SupabaseClient, facilityId: string): Promise<FacilityPlan> {
  const { data: subscription, error: subscriptionError } = await sb
    .from('facility_subscriptions')
    .select('plan_code,trial_ends_at,service_plans(code,name,features,included_attendance_slots)')
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
  if (joined) return { code: joined.code, name: joined.name, features: joined.features ?? {}, includedAttendanceSlots: joined.included_attendance_slots ?? 0, trialEndsAt: ((subscription as any)?.trial_ends_at as string | null) ?? null };

  const { data: free, error: freeError } = await sb
    .from('service_plans')
    .select('code,name,features,included_attendance_slots')
    .eq('code', 'free')
    .eq('is_active', true)
    .single();
  if (freeError || !free) throw new Error('기본 요금제 정보를 확인하지 못했어요.');
  return { code: free.code, name: free.name, features: free.features ?? {}, includedAttendanceSlots: free.included_attendance_slots ?? 0, trialEndsAt: null };
}

// ── 단기·행사 무료 베타 기간 (2026-11-05 사용자 결정: 10명 · 한 달 뒤 기능 잠금) ──────────────
// 기간은 service_plans.features.beta_days(기본 30일), 시작은 구독 시작일. 이 규칙 이전에 시작한 현장은
// beta_lock_from(기본 2026-11-05)부터 센다 — 이미 쓰던 곳이 배포 즉시 잠기지 않게.
// 잠기면 근무 만들기·근무자 등록·초대는 막고, 기록은 보관하며 이미 한 근무의 지급 기록은 계속 할 수 있다.
// 시연 사업장은 잠그지 않는다. 유료로 넘어가면 plan_code 가 바뀌어 이 규칙에서 빠진다.
export const GIG_BETA_ENDED_MESSAGE = '단기·행사 무료 베타 한 달이 끝났어요. 기록은 그대로 보관돼요. 계속 쓰시려면 이용 현황에서 문의해 주세요.';
export type GigBetaStatus = { inBeta: boolean; locked: boolean; lockDate: string | null; lastDay: string | null; daysLeft: number | null };
const NOT_IN_BETA: GigBetaStatus = { inBeta: false, locked: false, lockDate: null, lastDay: null, daysLeft: null };
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function getGigBetaStatus(sb: SupabaseClient, facilityId: string): Promise<GigBetaStatus> {
  const [{ data: facility }, { data: subscription, error }] = await Promise.all([
    sb.from('facilities').select('is_demo').eq('id', facilityId).maybeSingle(),
    sb.from('facility_subscriptions').select('plan_code,current_period_start,created_at,service_plans(features)')
      .eq('facility_id', facilityId).in('status', ['active', 'past_due', 'pending'])
      .order('updated_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error) throw new Error('구독 정보를 확인하지 못했어요.');
  if (facility?.is_demo || subscription?.plan_code !== 'gigworker_trial') return NOT_IN_BETA;
  const joined = Array.isArray((subscription as any).service_plans) ? (subscription as any).service_plans[0] : (subscription as any).service_plans;
  const features = (joined?.features ?? {}) as Record<string, unknown>;
  const betaDays = Number(features.beta_days) > 0 ? Number(features.beta_days) : 30;
  const lockFrom = typeof features.beta_lock_from === 'string' ? features.beta_lock_from : '2026-11-05';
  const started = subscription.current_period_start ?? String(subscription.created_at ?? '').slice(0, 10);
  const start = started && started > lockFrom ? started : lockFrom;
  const lockDate = addDays(start, betaDays);
  const today = todayKST();
  const daysLeft = Math.max(0, Math.round((Date.parse(`${lockDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000));
  return { inBeta: true, locked: today >= lockDate, lockDate, lastDay: addDays(lockDate, -1), daysLeft };
}

export async function requireGigBetaActive(sb: SupabaseClient, facilityId: string): Promise<void> {
  if ((await getGigBetaStatus(sb, facilityId)).locked) throw new Error(GIG_BETA_ENDED_MESSAGE);
}

export async function getStaffCapacity(sb: SupabaseClient, facilityId: string) {
  const [plan, beta] = await Promise.all([getFacilityPlan(sb, facilityId), getGigBetaStatus(sb, facilityId)]);
  const { count, error } = await sb.from('facility_staff').select('id', { count: 'exact', head: true })
    .eq('facility_id', facilityId).neq('status', 'ended')
    // 종료일이 지난 단기 계약은 동시 관리 인원에서 제외한다. 기록과 정산은 그대로 남는다.
    .or(`contract_end.is.null,contract_end.gte.${todayKST()}`);
  if (error) throw new Error('직원 사용량을 확인하지 못했어요.');
  // 베타가 끝난 현장은 남은 자리가 없는 것으로 본다(일괄 초대도 같은 값을 쓴다).
  const remaining = beta.locked ? 0 : Math.max(0, plan.includedAttendanceSlots - (count ?? 0));
  // 체험이 끝나면 무료 요금제 한도로 돌아간다 — 그때 몇 명까지인지 미리 알려 주려고 같이 읽는다
  let limitAfterTrial: number | null = null;
  if (plan.trialEndsAt) {
    const { data: free } = await sb.from('service_plans').select('included_attendance_slots').eq('code', 'free').eq('is_active', true).maybeSingle();
    limitAfterTrial = typeof free?.included_attendance_slots === 'number' ? free.included_attendance_slots : null;
  }
  return { used: count ?? 0, limit: plan.includedAttendanceSlots, remaining, planName: plan.name, betaLocked: beta.locked, trialEndsAt: plan.trialEndsAt, limitAfterTrial };
}

export async function requireStaffCapacity(sb: SupabaseClient, facilityId: string): Promise<void> {
  const capacity=await getStaffCapacity(sb,facilityId);
  if(capacity.betaLocked)throw new Error(GIG_BETA_ENDED_MESSAGE);
  if(capacity.remaining>0)return;
  throw new Error(`${capacity.planName}은 관리 대상 ${capacity.limit}명까지 등록할 수 있어요. 초대 대기·미래 계약도 포함돼요. 종료된 계약을 확인하거나 이용 현황에서 문의해 주세요.`);
}

// 렌더 게이트용 — throw 없이 boolean만. CTA 노출 여부 판단에 사용.
export async function hasPlanFeature(
  sb: SupabaseClient,
  facilityId: string,
  feature: PlanFeature,
): Promise<boolean> {
  try {
    const plan = await getFacilityPlan(sb, facilityId);
    return plan.features[feature] === true;
  } catch {
    return false;
  }
}

export async function requirePlanFeature(
  sb: SupabaseClient,
  facilityId: string,
  feature: PlanFeature,
): Promise<void> {
  const plan = await getFacilityPlan(sb, facilityId);
  if (plan.features[feature] === true) return;
  const label = feature === 'repeat_invite' ? '인력풀 반복초대' : '운영 자동화';
  const required = feature === 'repeat_invite' ? 'Basic·Pharmacy 이상' : 'Pro·Pharmacy Plus 이상';
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
  const result = data as { allowed?: boolean; duplicate?: boolean; used?: number; limit?: number; plan_name?: string; addon_price?: number } | null;
  if (result?.allowed) return result.duplicate !== true;
  const label = usageType === 'job_posting_slot' ? '월 공고' : '인력풀 반복초대 대상';
  const addon = usageType === 'job_posting_slot' && Number(result?.addon_price ?? 0) > 0
    ? ' 요금제·청구에서 추가 공고 1건(9,900원, VAT 포함)을 구매할 수 있어요.' : '';
  throw new Error(`${result?.plan_name ?? '현재'} 요금제의 ${label} 한도(${result?.limit ?? 0})에 도달했어요.${addon}`);
}

export async function releasePlanUsage(sb: SupabaseClient, idempotencyKey: string): Promise<void> {
  await sb.from('service_usage_events').delete().eq('idempotency_key', idempotencyKey);
}
