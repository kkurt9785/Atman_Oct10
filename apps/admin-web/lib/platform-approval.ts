import type { SupabaseClient } from '@supabase/supabase-js';

// 승인/반려 핵심 로직. 서버 액션(lib/actions/platform.ts)과 QA 스크립트가 같은 함수를 쓴다.
// sb는 service-role 클라이언트, actor는 운영자(잇닿) 계정.
export type Actor = { id: string; email: string | null; name?: string | null };
export type Result = { ok: boolean; error?: string };

export function normalizeBrn(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 10) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

async function notify(sb: SupabaseClient, userId: string | null, eventType: string, dedupeKey: string, title: string, body: string, data: Record<string, unknown>) {
  if (!userId) return;
  const { error } = await sb.from('notification_outbox').insert({ worker_auth_user_id: userId, event_type: eventType, dedupe_key: dedupeKey, title, body, data });
  if (error) console.error('[platform] notify failed', eventType, error.message);
}

export async function approveFacilityCore(sb: SupabaseClient, actor: Actor, input: { facilityId: string; brn: string }): Promise<Result> {
  const brn = normalizeBrn(input.brn);
  if (!brn) return { ok: false, error: '사업자등록번호는 숫자 10자리예요.' };
  const { data: before } = await sb.from('facilities').select('id, name, approved_at, business_registration_number, admin_user_id, registration_source, deleted_at')
    .eq('id', input.facilityId).maybeSingle();
  if (!before || before.deleted_at) return { ok: false, error: '사업장을 찾을 수 없어요.' };
  if (!String(before.registration_source).startsWith('self_')) return { ok: false, error: '셀프 등록 사업장이 아니에요.' };
  if (before.approved_at) return { ok: false, error: '이미 승인된 사업장이에요.' };
  const { data: dupe } = await sb.from('facilities').select('id, name').eq('business_registration_number', brn).neq('id', input.facilityId).is('deleted_at', null).maybeSingle();
  if (dupe) return { ok: false, error: `같은 사업자등록번호가 "${dupe.name}"에 이미 있어요.` };

  const now = new Date().toISOString();
  const { error } = await sb.from('facilities')
    .update({ business_registration_number: brn, approved_at: now, updated_at: now })
    .eq('id', input.facilityId).is('approved_at', null);
  if (error) return { ok: false, error: error.message };

  await sb.from('audit_logs').insert({
    actor_type: 'admin', actor_id: actor.id, action: 'facility.self_registration.approve',
    entity_type: 'facility', entity_id: input.facilityId,
    before_data: { business_registration_number: before.business_registration_number, approved_at: null },
    after_data: { business_registration_number: brn, approved_at: now, approved_by_email: actor.email, approved_by: actor.email ?? actor.name ?? actor.id },
  });
  await notify(sb, before.admin_user_id, 'facility.approved', `facility.approved:${input.facilityId}`,
    '사업장 확인이 끝났어요', `${before.name} 확인이 완료됐어요. 이제 공고를 올릴 수 있어요.`, { facility_id: input.facilityId, url: '/' });
  return { ok: true };
}

// 반려: 소프트 삭제 + 소유자 해제(admin_user_id UNIQUE라 해제해야 같은 관리자가 다시 등록할 수 있다)
export async function rejectFacilityCore(sb: SupabaseClient, actor: Actor, input: { facilityId: string; reason: string }): Promise<Result> {
  const reason = input.reason.trim().slice(0, 300);
  if (reason.length < 2) return { ok: false, error: '반려 사유를 적어 주세요. 등록한 분에게 그대로 전달돼요.' };
  const { data: before } = await sb.from('facilities').select('id, name, approved_at, admin_user_id, registration_source, deleted_at, address_text, hira_ykiho')
    .eq('id', input.facilityId).maybeSingle();
  if (!before || before.deleted_at) return { ok: false, error: '사업장을 찾을 수 없어요.' };
  if (!String(before.registration_source).startsWith('self_')) return { ok: false, error: '셀프 등록 사업장이 아니에요.' };
  if (before.approved_at) return { ok: false, error: '이미 승인된 사업장은 여기서 반려할 수 없어요.' };

  const now = new Date().toISOString();
  const { error } = await sb.from('facilities')
    .update({ is_active: false, deleted_at: now, admin_user_id: null, updated_at: now })
    .eq('id', input.facilityId).is('approved_at', null);
  if (error) return { ok: false, error: error.message };

  await sb.from('audit_logs').insert({
    actor_type: 'admin', actor_id: actor.id, action: 'facility.self_registration.reject',
    entity_type: 'facility', entity_id: input.facilityId,
    before_data: { name: before.name, admin_user_id: before.admin_user_id, address_text: before.address_text, hira_ykiho: before.hira_ykiho },
    after_data: { reason, rejected_by_email: actor.email, rejected_by: actor.email ?? actor.name ?? actor.id, deleted_at: now },
  });
  await notify(sb, before.admin_user_id, 'facility.rejected', `facility.rejected:${input.facilityId}`,
    '사업장 등록을 확인하지 못했어요', `${before.name}: ${reason}`, { facility_id: input.facilityId, url: '/setup/claim-facility' });
  return { ok: true };
}
