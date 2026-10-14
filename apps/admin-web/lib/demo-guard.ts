import 'server-only';
import { adminClient } from './supabase';

// 시연 사업장은 영업 시연과 방문자가 같이 쓴다 — 사업장 정보·권한을 바꾸거나 근무자를 지우고 끊는 일은 저장하지 않는다.
// 공고 올리기·지원 확정·출퇴근 승인·근무 취소 같은 체험은 그대로 되고, 매일 아침 시연 데이터를 다시 채운다(lib/demo/revive-showcase.ts).
export const DEMO_BLOCKED_MESSAGE = '시연에서는 저장되지 않아요. 가입하고 내 사업장에서 써 보세요.';

// 확인할 수 없으면 시연으로 본다 — 민감 정보를 여는 쪽은 실패 시 닫아 둔다
export async function isDemoFacility(facilityId: string): Promise<boolean> {
  const sb = adminClient();
  if (!sb) return true;
  const { data, error } = await sb.from('facilities').select('is_demo').eq('id', facilityId).maybeSingle();
  if (error || !data) return true;
  return Boolean(data.is_demo);
}

export async function assertNotDemoFacility(facilityId: string) {
  const sb = adminClient();
  if (!sb) return;
  const { data } = await sb.from('facilities').select('is_demo').eq('id', facilityId).maybeSingle();
  if (data?.is_demo) throw new Error(DEMO_BLOCKED_MESSAGE);
}
