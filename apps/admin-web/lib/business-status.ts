import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkBusinessStatus, type BusinessStatusResult } from './nts';

// 직업안정법 제25조(2026-12-10 시행 개정) 구인자 확인 — 사업자등록 상태를 조회해 사업장 행에 적는다.
export async function refreshFacilityBusinessStatus(sb: SupabaseClient, facilityId: string, brn: string | null | undefined): Promise<BusinessStatusResult | null> {
  if (!brn) return null;
  const result = await checkBusinessStatus(brn);
  if (!result) return null;
  const { error } = await sb.from('facilities').update({
    business_status: result.status, business_status_detail: result.detail,
    business_status_checked_at: result.checkedAt, updated_at: result.checkedAt,
  }).eq('id', facilityId);
  if (error) throw new Error('사업자 조회 결과를 저장하지 못했어요. 잠시 후 다시 확인해 주세요.');
  return result;
}

// 월 1회 재조회 — 휴업·폐업으로 바뀐 사업장은 공고 등록이 막힌다. 하루 30곳씩.
export async function recheckStaleBusinessStatuses(sb: SupabaseClient, limit = 30): Promise<{ checked: number; changed: string[]; skipped?: string }> {
  if (!process.env.NTS_BUSINESS_API_KEY) return { checked: 0, changed: [], skipped: 'NTS_BUSINESS_API_KEY not set' };
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data, error } = await sb.from('facilities')
    .select('id,name,business_registration_number,business_status,business_status_checked_at')
    .eq('is_demo', false).eq('is_active', true).is('deleted_at', null)
    .not('business_registration_number', 'is', null)
    .or(`business_status_checked_at.is.null,business_status_checked_at.lt.${cutoff}`)
    .order('business_status_checked_at', { ascending: true, nullsFirst: true }).order('id')
    .limit(limit);
  if (error) throw new Error('사업자 재조회 목록을 불러오지 못했어요.');
  const changed: string[] = [];
  let checked = 0;
  for (const row of (data ?? []) as Array<{ id: string; name: string; business_registration_number: string | null; business_status: string | null }>) {
    const result = await refreshFacilityBusinessStatus(sb, row.id, row.business_registration_number);
    if (!result) continue;
    checked += 1;
    if (result.status !== 'active' && result.status !== (row.business_status ?? '')) changed.push(`${row.name}:${result.status}`);
  }
  return { checked, changed };
}
