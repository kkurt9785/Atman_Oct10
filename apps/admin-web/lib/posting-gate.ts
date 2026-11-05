import type { SupabaseClient } from '@supabase/supabase-js';

// 직업안정법 §25(2026-12-10 시행) — 신원을 확인할 수 없는 사업장의 구인광고(공개 공고)는 게재하지 않는다.
// 공개 공고를 만들거나 공개로 바꾸는 모든 경로(일반 등록·조건 복사·반복 생성·7일 공백·추천 승인·노쇼 대체·결원 공개)가
// 이 판정 하나를 쓴다. 2026-11-05 QA 전에는 일반 등록에만 있어 나머지 5경로로 우회됐다.
export type PostingFacility = { approved_at: string | null; registration_source: string | null; business_status: string | null };

export function publicPostingBlockReason(facility: PostingFacility | null): string | null {
  if (!facility) return '사업장 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.';
  // 셀프 등록 사업장은 잇닿 확인(approved_at) 전까지 공고를 열지 않는다 — 초대코드 사업장은 등록 시점에 이미 확인됨
  if (facility.approved_at == null && String(facility.registration_source ?? '').startsWith('self_')) {
    return '사업장 확인이 끝나면 공고를 등록할 수 있어요. 보통 1영업일 안에 완료돼요.';
  }
  // 국세청 조회가 휴업·폐업이거나, 등록번호가 국세청에 없는(unknown) 사업장은 공고를 열지 않는다. 미조회(null)는 운영자 서류 확인으로 갈음.
  const status = String(facility.business_status ?? '');
  if (status === 'closed' || status === 'suspended') {
    return '국세청 조회에서 사업자 상태가 휴업·폐업으로 확인돼 공고를 올릴 수 없어요. 바뀌었다면 사업자 서류를 다시 제출해 주세요.';
  }
  if (status === 'unknown') {
    return '국세청에서 사업자등록번호를 확인하지 못해 공고를 올릴 수 없어요. 설정 › 사업자 서류에서 등록번호와 등록증을 다시 제출해 주세요.';
  }
  return null;
}

export async function loadPublicPostingBlock(sb: SupabaseClient, facilityId: string): Promise<string | null> {
  const { data, error } = await sb.from('facilities')
    .select('approved_at, registration_source, business_status').eq('id', facilityId).maybeSingle();
  if (error) return '사업장 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.';
  return publicPostingBlockReason(data as PostingFacility | null);
}

// 시작 시각이 이미 지난 근무는 공고로 열지 않는다 — 근무자는 지원할 수 없는데(apply_to_shift 거부) 알림만 간다
export function shiftStartPassed(shiftDate: string, startTime: string, now = Date.now()): boolean {
  const startMs = Date.parse(`${shiftDate}T${startTime.slice(0, 5)}:00+09:00`);
  return Number.isFinite(startMs) && startMs <= now;
}
