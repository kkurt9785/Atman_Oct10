'use server';
import { revalidatePath } from 'next/cache';
import { getPlatformAdminSession } from '@/lib/platform-admin';
import { adminClient } from '@/lib/supabase';

export async function reviewSafetyReport(id: string, status: string, note: string, hide: boolean) {
  const session = await getPlatformAdminSession();
  if (!session) return { error: '운영자 로그인이 필요해요.' };
  if (!/^[0-9a-f-]{36}$/i.test(id) || !['reviewing','resolved','dismissed'].includes(status) || note.length > 1000 || (hide && status !== 'resolved')) {
    return { error: '검토 결과를 확인해 주세요.' };
  }
  const sb = adminClient();
  if (!sb) return { error: '연결을 확인해 주세요.' };
  try {
    const { data, error } = await sb.rpc('review_safety_report', { p_id:id, p_status:status, p_note:note, p_actor:session.user.id, p_hide:hide });
    if (error || data !== true) return { error: '검토 결과를 저장하지 못했어요. 다시 시도해 주세요.' };
    revalidatePath('/ops/safety');
    return { error: null };
  } catch { return { error: '연결을 확인하고 다시 시도해 주세요.' }; }
}

// 직업안정법 대응 문서 3절 — 허위로 확인된 사업장은 '게재 중지': 공고 목록·공개 페이지에서 내리고 새 공고·공개 전환을 막는다(해제하면 되돌아온다)
export async function setFacilityPostingSuspension(facilityId: string, suspend: boolean, reason: string) {
  const session = await getPlatformAdminSession();
  if (!session) return { error: '운영자 로그인이 필요해요.' };
  if (!/^[0-9a-f-]{36}$/i.test(facilityId) || typeof suspend !== 'boolean' || typeof reason !== 'string' || reason.length > 300 || (suspend && !reason.trim())) {
    return { error: '중지 사유를 확인해 주세요.' };
  }
  const sb = adminClient();
  if (!sb) return { error: '연결을 확인해 주세요.' };
  try {
    const { data: before } = await sb.from('facilities').select('*').eq('id', facilityId).maybeSingle();
    if (!before) return { error: '사업장을 찾지 못했어요.' };
    const previous = { posting_suspended_at: before.posting_suspended_at ?? null, posting_suspended_reason: before.posting_suspended_reason ?? null };
    const after = suspend ? { posting_suspended_at: new Date().toISOString(), posting_suspended_reason: reason.trim() } : { posting_suspended_at: null, posting_suspended_reason: null };
    const { error } = await sb.from('facilities').update(after).eq('id', facilityId);
    if (error) return { error: '저장하지 못했어요. 마이그레이션 20261105170000 적용 여부를 확인해 주세요.' };
    // 처리 기록이 증빙(대응 문서 4절)이라 기록을 못 남기면 되돌린다
    const { error: auditError } = await sb.from('audit_logs').insert({
      actor_type: 'admin', actor_id: session.user.id, action: suspend ? 'facility.posting.suspend' : 'facility.posting.resume',
      entity_type: 'facility', entity_id: facilityId, before_data: previous, after_data: after,
    });
    if (auditError) {
      await sb.from('facilities').update(previous).eq('id', facilityId);
      return { error: '처리 기록을 남기지 못해 되돌렸어요. 다시 시도해 주세요.' };
    }
    revalidatePath('/ops/safety');
    return { error: null };
  } catch { return { error: '연결을 확인하고 다시 시도해 주세요.' }; }
}

// 직업안정법 §25 — 근무자가 접수한 공고·사업장 신고(허위·과장 등) 검토. 허위로 확인되면 위 '게재 중지'로 공고를 내린다.
export async function reviewJobPostingReport(id: string, status: string, note: string) {
  const session = await getPlatformAdminSession();
  if (!session) return { error: '운영자 로그인이 필요해요.' };
  if (!/^[0-9a-f-]{36}$/i.test(id) || !['reviewing','resolved','dismissed'].includes(status) || note.length > 1000) {
    return { error: '검토 결과를 확인해 주세요.' };
  }
  const sb = adminClient();
  if (!sb) return { error: '연결을 확인해 주세요.' };
  try {
    const { data, error } = await sb.rpc('review_job_posting_report', { p_id: id, p_status: status, p_note: note, p_actor: session.user.id });
    if (error || data !== true) return { error: '검토 결과를 저장하지 못했어요. 다시 시도해 주세요.' };
    revalidatePath('/ops/safety');
    return { error: null };
  } catch { return { error: '연결을 확인하고 다시 시도해 주세요.' }; }
}
