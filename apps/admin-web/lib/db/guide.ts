import { cache } from 'react';
import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';
import { todayKST } from '../date';
import { adminGuideLastDay, guideOpenOn } from '../guide-window';

// 지금 사업장에 베타 기간 사용 안내를 띄울지. 조회가 실패하면 안내만 빠지고 화면은 그대로 뜬다.
export const isGuidePeriod = cache(async (): Promise<boolean> => {
  try {
    const facilityId = await getCurrentFacilityId();
    const sb = adminClient();
    if (!sb || !facilityId) return false;
    const [{ data: facility }, { data: subs }] = await Promise.all([
      sb.from('facilities').select('is_demo, created_at').eq('id', facilityId).maybeSingle(),
      sb.from('facility_subscriptions').select('trial_ends_at').eq('facility_id', facilityId)
        .in('status', ['active', 'past_due', 'pending']).not('trial_ends_at', 'is', null)
        .order('trial_ends_at', { ascending: false }).limit(1),
    ]);
    if (!facility) return false;
    const lastDay = adminGuideLastDay({
      isDemo: Boolean((facility as { is_demo?: boolean | null }).is_demo),
      createdAt: (facility as { created_at?: string | null }).created_at ?? null,
      trialEndsAt: (subs?.[0] as { trial_ends_at?: string | null } | undefined)?.trial_ends_at ?? null,
    });
    return guideOpenOn(todayKST(), lastDay);
  } catch {
    return false;
  }
});
