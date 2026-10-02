'use server';

import { revalidatePath } from 'next/cache';
import { adminClient } from '../supabase';
import { getPlatformAdminSession } from '../platform-admin';
import { approveFacilityCore, rejectFacilityCore } from '../platform-approval';
import { nudgeNotificationDispatch } from '../notify-nudge';
import { todayKST } from '../date';
import { runHealthCheck } from '../ops-health';

export type SelfRegisteredFacility = {
  id: string; name: string; facility_type: string; address_text: string | null; contact_phone: string | null;
  hira_ykiho: string | null; hira_cl_cd: string | null; registration_source: string; business_registration_number: string;
  approved_at: string | null; is_active: boolean; created_at: string;
  admin_user_id: string | null; admin_email: string | null; lng: number | null; lat: number | null;
  brn_submitted: string | null; brn_document_path: string | null;
  documentUrl?: string | null; // 서버에서 서명한 열람 URL(10분)
};

export type RegistrationRequest = {
  id: string; facility_type: string; facility_name: string; address_text: string; contact_name: string; contact_phone: string;
  note: string | null; status: string; created_at: string; requested_by: string;
};

async function requirePlatform() {
  const session = await getPlatformAdminSession();
  if (!session) throw new Error('잇닿 운영자만 사용할 수 있어요.');
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  return { session, sb };
}

export async function listSelfRegisteredFacilities(pendingOnly = true): Promise<SelfRegisteredFacility[]> {
  const { sb } = await requirePlatform();
  const { data, error } = await sb.rpc('platform_list_self_registered_facilities', { p_pending_only: pendingOnly });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SelfRegisteredFacility[];
  // 등록증은 비공개 버킷 — 운영자 화면에서만 10분짜리 서명 URL로 연다
  await Promise.all(rows.map(async (row) => {
    if (!row.brn_document_path) { row.documentUrl = null; return; }
    const { data: signed } = await sb.storage.from('facility-documents').createSignedUrl(row.brn_document_path, 600);
    row.documentUrl = signed?.signedUrl ?? null;
  }));
  return rows;
}

export type TrialFollowUp = {
  facilityId: string; name: string; planName: string; trialEndsAt: string; daysLeft: number; expired: boolean;
  contactPhone: string | null; adminEmail: string | null;
  staffCount: number; shiftCount: number; acceptedCount: number;
};

// 체험 종료 임박(7일 이내)·종료 직후(14일 이내) 실사업장. 연결된 관리자가 있는 곳만 — 연락할 사람이 있어야 한다.
// 고객에게 자동 알림은 보내지 않고, 운영자가 사용 신호를 보고 직접 연락한다.
export async function listTrialFollowUps(): Promise<TrialFollowUp[]> {
  const { sb } = await requirePlatform();
  const today = todayKST();
  const shift = (days: number) => todayKST(new Date(Date.now() + days * 86_400_000));
  const { data, error } = await sb.from('facility_subscriptions')
    .select('status,trial_ends_at,service_plans(name),facilities!inner(id,name,contact_phone,admin_user_id,is_demo,deleted_at)')
    .not('trial_ends_at', 'is', null)
    .is('trial_converted_at', null)
    .in('status', ['active', 'past_due', 'pending', 'expired'])
    .gte('trial_ends_at', shift(-14))
    .lte('trial_ends_at', shift(7))
    .eq('facilities.is_demo', false)
    .is('facilities.deleted_at', null)
    .not('facilities.admin_user_id', 'is', null)
    .order('trial_ends_at', { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as any[];
  // 같은 사업장에 만료 행과 새 체험 행이 함께 있으면 최근 것 하나만
  const byFacility = new Map<string, any>();
  for (const row of rows) {
    const f = Array.isArray(row.facilities) ? row.facilities[0] : row.facilities;
    if (!f) continue;
    const prev = byFacility.get(f.id);
    if (!prev || row.trial_ends_at > prev.trial_ends_at) byFacility.set(f.id, { ...row, facility: f });
  }
  // 이미 다른 활성 구독(새 체험·유료)으로 넘어간 만료 행은 제외
  const expiredIds = [...byFacility.values()].filter((r) => r.status === 'expired').map((r) => r.facility.id);
  if (expiredIds.length) {
    const { data: current } = await sb.from('facility_subscriptions').select('facility_id')
      .in('facility_id', expiredIds).in('status', ['active', 'past_due', 'pending']);
    for (const c of current ?? []) byFacility.delete(c.facility_id);
  }

  const todayMs = Date.parse(`${today}T00:00:00+09:00`);
  const result = await Promise.all([...byFacility.values()].map(async (r): Promise<TrialFollowUp> => {
    const fid = r.facility.id as string;
    const [staff, shifts, accepted, admin] = await Promise.all([
      sb.from('facility_staff').select('id', { count: 'exact', head: true }).eq('facility_id', fid).neq('status', 'ended'),
      sb.from('shifts').select('id', { count: 'exact', head: true }).eq('facility_id', fid),
      sb.from('shift_applications').select('id,shifts!inner(facility_id)', { count: 'exact', head: true })
        .eq('shifts.facility_id', fid).eq('status', 'accepted'),
      sb.auth.admin.getUserById(r.facility.admin_user_id),
    ]);
    const plan = Array.isArray(r.service_plans) ? r.service_plans[0] : r.service_plans;
    const daysLeft = Math.round((Date.parse(`${r.trial_ends_at}T00:00:00+09:00`) - todayMs) / 86_400_000);
    return {
      facilityId: fid, name: r.facility.name, planName: plan?.name ?? r.status,
      trialEndsAt: r.trial_ends_at, daysLeft, expired: r.status === 'expired' || daysLeft < 0,
      contactPhone: r.facility.contact_phone ?? null, adminEmail: admin.data?.user?.email ?? null,
      staffCount: staff.count ?? 0, shiftCount: shifts.count ?? 0, acceptedCount: accepted.count ?? 0,
    };
  }));
  // 임박한 것 먼저, 그다음 막 끝난 것
  return result.sort((a, b) => (a.expired === b.expired ? (a.expired ? b.daysLeft - a.daysLeft : a.daysLeft - b.daysLeft) : a.expired ? 1 : -1));
}

export async function listRegistrationRequests(): Promise<RegistrationRequest[]> {
  const { sb } = await requirePlatform();
  const { data, error } = await sb.from('facility_registration_requests')
    .select('id, facility_type, facility_name, address_text, contact_name, contact_phone, note, status, created_at, requested_by')
    .in('status', ['pending', 'reviewing']).order('created_at', { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as RegistrationRequest[];
}

export async function approveSelfRegisteredFacility(input: { facilityId: string; brn: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const { session, sb } = await requirePlatform();
    const result = await approveFacilityCore(sb, { id: session.user.id, email: session.user.email ?? null, name: (session.user.user_metadata?.name as string | undefined) ?? null }, input);
    if (result.ok) { revalidatePath('/ops/facilities'); revalidatePath('/'); await nudgeNotificationDispatch(); }
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '승인하지 못했어요.' };
  }
}

export async function rejectSelfRegisteredFacility(input: { facilityId: string; reason: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const { session, sb } = await requirePlatform();
    const result = await rejectFacilityCore(sb, { id: session.user.id, email: session.user.email ?? null, name: (session.user.user_metadata?.name as string | undefined) ?? null }, input);
    if (result.ok) { revalidatePath('/ops/facilities'); await nudgeNotificationDispatch(); }
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '반려하지 못했어요.' };
  }
}

export async function setRegistrationRequestStatus(input: { requestId: string; status: 'reviewing' | 'approved' | 'rejected' | 'duplicate' }): Promise<{ ok: boolean; error?: string }> {
  try {
    const { session, sb } = await requirePlatform();
    const { error } = await sb.from('facility_registration_requests')
      .update({ status: input.status, reviewed_by: session.user.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', input.requestId);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/ops/facilities');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '처리하지 못했어요.' };
  }
}

// 운영자 화면 '지금 점검' — 매일 09:00 자동 점검과 같은 절차
export async function runHealthCheckNowAction(): Promise<void> {
  await requirePlatform();
  await runHealthCheck('manual');
  revalidatePath('/ops/facilities');
}
