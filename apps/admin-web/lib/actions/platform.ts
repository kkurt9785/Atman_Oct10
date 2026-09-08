'use server';

import { revalidatePath } from 'next/cache';
import { adminClient } from '../supabase';
import { getPlatformAdminSession } from '../platform-admin';
import { approveFacilityCore, rejectFacilityCore } from '../platform-approval';

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
    const result = await approveFacilityCore(sb, { id: session.user.id, email: session.user.email ?? null }, input);
    if (result.ok) { revalidatePath('/ops/facilities'); revalidatePath('/'); }
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '승인하지 못했어요.' };
  }
}

export async function rejectSelfRegisteredFacility(input: { facilityId: string; reason: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const { session, sb } = await requirePlatform();
    const result = await rejectFacilityCore(sb, { id: session.user.id, email: session.user.email ?? null }, input);
    if (result.ok) revalidatePath('/ops/facilities');
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
