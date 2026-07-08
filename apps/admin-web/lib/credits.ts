import type { SupabaseClient } from '@supabase/supabase-js';

export const ONBOARDING_CREDITS = {
  onboard_signup:       30_000,  // 가입 완료
  onboard_profile:      20_000,  // 프로필 입력
  onboard_first_shift:  50_000,  // 첫 시프트 등록
} as const;

export type OnboardKind = keyof typeof ONBOARDING_CREDITS;

/**
 * 온보딩 크레딧을 한 번만 지급한다.
 * 이미 해당 kind가 credit_ledger에 있으면 무시.
 */
export async function grantOnboardingCredit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: SupabaseClient<any>,
  orgId: string,
  kind: OnboardKind,
): Promise<void> {
  const { count } = await sb
    .from('credit_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('kind', kind);

  if (count && count > 0) return;

  await sb.from('credit_ledger').insert({
    org_id:     orgId,
    delta:      ONBOARDING_CREDITS[kind],
    kind,
    ref:        'onboarding',
    expires_at: null,
  });
}
