'use server';

import { revalidatePath } from 'next/cache';
import { cache } from 'react';
import { adminClient, userClient } from './supabase';
import {
  getAdminContext,
  getAdminSession,
  getFacilityAccessRole,
  requireAdminSession,
  setFacilityContextCookie,
} from './admin-auth';

export const getCurrentFacilityId=cache(async (): Promise<string | null> => {
  return (await getAdminContext())?.facilityId ?? null;
});

export async function setFacilityCookie(facilityId: string): Promise<void> {
  const session = await requireAdminSession();
  const accessRole = await getFacilityAccessRole(session.user.id, facilityId);
  if (!accessRole) throw new Error('이 사업장에 대한 권한이 없습니다.');
  await setFacilityContextCookie(facilityId, session.user.id);
}

export async function claimFacility(
  facilityId: string,
  inviteCode: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireAdminSession();
    const sb = userClient(session.accessToken);
    if (!sb) return { ok: false, error: '서버 설정 오류' };

    const { data, error } = await sb.rpc('claim_facility_secure', {
      p_facility_id: facilityId,
      p_invite_code: inviteCode.trim(),
    });

    if (error || !data) {
      return { ok: false, error: error?.message ?? '사업장 연결에 실패했어요.' };
    }

    await setFacilityContextCookie(facilityId, session.user.id);
    revalidatePath('/');
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '사업장 연결에 실패했어요.',
    };
  }
}

export async function searchFacilities(query: string) {
  const session = await getAdminSession();
  if (!session || query.trim().length < 2) return [];

  const sb = userClient(session.accessToken);
  if (!sb) return [];

  const { data, error } = await sb.rpc('search_claimable_facilities', {
    p_query: query.trim(),
  });
  if (error) throw new Error('사업장 검색에 실패했어요.');
  return data ?? [];
}

export async function requestFacilityRegistration(input: {
  facilityType: string;
  facilityName: string;
  addressText: string;
  contactName: string;
  contactPhone: string;
  note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireAdminSession();
    const sb = userClient(session.accessToken);
    if (!sb) return { ok: false, error: '서버 설정 오류' };
    const { error } = await sb.rpc('submit_facility_registration_request', {
      p_facility_type: input.facilityType,
      p_facility_name: input.facilityName,
      p_address_text: input.addressText,
      p_contact_name: input.contactName,
      p_contact_phone: input.contactPhone,
      p_note: input.note || null,
    });
    if (error) return { ok: false, error: error.message.replace(/^.*?: /, '') };
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '등록 요청을 접수하지 못했어요.',
    };
  }
}

export async function listAccessibleFacilities() {
  const session = await getAdminSession();
  const sb = adminClient();
  if (!session || !sb) return [];

  const [{ data: owned }, { data: delegated }] = await Promise.all([
    sb
      .from('facilities')
      .select('id, name, facility_type, address_text, is_demo')
      .eq('admin_user_id', session.user.id)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name'),
    sb
      .from('facility_admin_access')
      .select('access_role, facilities ( id, name, facility_type, address_text, is_demo, is_active, deleted_at )')
      .eq('user_id', session.user.id)
      .order('access_role'),
  ]);

  const map = new Map<string, Record<string, unknown>>();
  for (const facility of owned ?? []) {
    map.set(facility.id, { ...facility, access_role: 'owner' });
  }

  for (const rawRow of delegated ?? []) {
    const row = rawRow as unknown as {
      access_role: string;
      facilities: Record<string, unknown> | Array<Record<string, unknown>> | null;
    };
    const facility = Array.isArray(row.facilities) ? row.facilities[0] : row.facilities;
    if (
      typeof facility?.id === 'string' &&
      facility.is_active === true &&
      facility.deleted_at == null
    ) {
      map.set(facility.id, { ...facility, access_role: row.access_role });
    }
  }

  return Array.from(map.values());
}
