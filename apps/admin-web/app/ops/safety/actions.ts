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

// 직업안정법 §25 — 근무자가 접수한 공고·사업장 신고(허위·과장 등) 검토. 조치(공고 내리기·사업장 비활성)는 기존 운영 화면에서.
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
