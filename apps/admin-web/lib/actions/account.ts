'use server';

import { clearAdminCookies, requireAdminContext, requireAdminSession } from '@/lib/admin-auth';
import { adminClient, userClient } from '@/lib/supabase';
import { assertNotDemoFacility } from '@/lib/demo-guard';

type Result = { ok: boolean; error?: string };
const clean = (message: string) => message.replace(/^.*?: /, '');

// 사업장 닫기(폐업·이용 종료) — 소유자·super 만. 공고·초대 취소, 직원 연결 종료, 비활성. 근태·지급 기록은 남는다.
export async function closeFacilityAction(input: { reason?: string }): Promise<Result> {
  try {
    const context = await requireAdminContext(['owner', 'super']);
    await assertNotDemoFacility(context.facilityId);
    const sb = userClient(context.accessToken);
    if (!sb) return { ok: false, error: '서버 설정을 확인해 주세요.' };
    const { data, error } = await sb.rpc('close_my_facility', { p_facility_id: context.facilityId, p_reason: input.reason?.trim() || null });
    if (error) return { ok: false, error: clean(error.message) };
    if (data?.ok !== true) return { ok: false, error: '종료 결과를 확인하지 못했어요. 새로고침 후 사업장 상태를 확인해 주세요.' };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '사업장을 닫지 못했어요.' };
  }
}

// 관리자 계정 탈퇴 — 운영 중인 사업장이 없을 때만. DB 정리 뒤 auth 계정을 지우고 세션 쿠키를 비운다.
export async function withdrawAdminAccountAction(): Promise<Result> {
  try {
    const session = await requireAdminSession();
    const sb = userClient(session.accessToken);
    if (!sb) return { ok: false, error: '서버 설정을 확인해 주세요.' };
    // Check configuration before removing memberships. Keep the session on failure
    // so an interrupted auth deletion can be retried with the same user identity.
    const admin = adminClient();
    if (!admin) return { ok: false, error: '지금은 탈퇴를 처리할 수 없어요. 잠시 후 다시 시도해 주세요.' };
    const { data, error } = await sb.rpc('withdraw_my_admin_account');
    if (error) return { ok: false, error: clean(error.message) };
    if (data?.ok !== true || typeof data?.keepAuth !== 'boolean') {
      return { ok: false, error: '탈퇴 결과를 확인하지 못했어요. 다시 시도해 주세요.' };
    }
    const keepAuth = data.keepAuth;
    if (!keepAuth) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(session.user.id);
      if (deleteError) {
        return { ok: false, error: '관리자 연결은 정리됐지만 계정 삭제가 완료되지 않았어요. 다시 탈퇴를 눌러 마무리해 주세요.' };
      }
    }
    await clearAdminCookies();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '탈퇴하지 못했어요.' };
  }
}
