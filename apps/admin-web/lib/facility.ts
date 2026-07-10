'use server';
import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { adminClient, getUserFromToken } from './supabase';
import { FACILITY_COOKIE } from './constants';
import { grantOnboardingCredit } from './credits';

function cookieSecret(): string | null {
  return process.env.FACILITY_COOKIE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
}

// 쿠키 v2: facilityId.userId.exp 통째 서명 — 사용자 바인딩 + 만료 포함
function signPayload(payload: string): string | null {
  const secret = cookieSecret();
  if (!secret) return null;
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

type FacilitySession = { facilityId: string; userId: string };

function verifyFacilityCookie(value: string | undefined): FacilitySession | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 4) return null; // 구버전(2파트) 쿠키 무효 → 재선택 유도
  const [facilityId, userId, exp, signature] = parts;

  const expected = signPayload(`${facilityId}.${userId}.${exp}`);
  if (!expected) return null;

  const actualBuffer = new Uint8Array(Buffer.from(signature));
  const expectedBuffer = new Uint8Array(Buffer.from(expected));
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  if (Number(exp) < Date.now()) return null;
  return { facilityId, userId };
}

export async function getCurrentFacilityId(): Promise<string | null> {
  const jar = await cookies();
  return verifyFacilityCookie(jar.get(FACILITY_COOKIE)?.value)?.facilityId ?? null;
}

/**
 * 뮤테이션 전용 — 서명 쿠키만 믿지 않고 매번 DB에서
 * ① admin 프로필인지 ② 아직 이 시설의 관리 권한이 있는지 재검증한다.
 */
export async function requireFacilityAdmin(): Promise<FacilitySession | null> {
  const jar = await cookies();
  const session = verifyFacilityCookie(jar.get(FACILITY_COOKIE)?.value);
  if (!session) return null;

  const sb = adminClient();
  if (!sb) return null;

  const [{ data: profile }, { data: owned }, { data: delegated }] = await Promise.all([
    sb.from('profiles').select('role').eq('id', session.userId).maybeSingle(),
    sb.from('facilities').select('id').eq('id', session.facilityId).eq('admin_user_id', session.userId).is('deleted_at', null).maybeSingle(),
    sb.from('facility_admin_access').select('facility_id').eq('user_id', session.userId).eq('facility_id', session.facilityId).maybeSingle(),
  ]);

  if (profile?.role !== 'admin') return null;
  if (!owned && !delegated) return null;
  return session;
}

export async function setFacilityCookie(facilityId: string, userId: string): Promise<void> {
  const jar = await cookies();
  const exp = String(Date.now() + 1000 * 60 * 60 * 24 * 30); // 30일
  const signature = signPayload(`${facilityId}.${userId}.${exp}`);
  if (!signature) throw new Error('FACILITY_COOKIE_SECRET is not configured');
  jar.set(FACILITY_COOKIE, `${facilityId}.${userId}.${exp}.${signature}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });
}

export async function claimFacility(facilityId: string, accessToken: string, inviteCode: string): Promise<{ ok: boolean; error?: string }> {
  const sb = adminClient();
  if (!sb) return { ok: false, error: '서버 오류' };
  const user = await getUserFromToken(accessToken);
  if (!user) return { ok: false, error: '로그인이 필요해요' };

  const { data: existing } = await sb
    .from('facilities')
    .select('id, admin_user_id, invite_code')
    .eq('id', facilityId)
    .single();

  if (!existing) return { ok: false, error: '병원을 찾을 수 없어요' };
  if (existing.admin_user_id && existing.admin_user_id !== user.id) {
    return { ok: false, error: '이미 다른 계정에서 연결된 병원이에요' };
  }
  if (!existing.invite_code || existing.invite_code.toUpperCase() !== inviteCode.trim().toUpperCase()) {
    return { ok: false, error: '초대 코드가 올바르지 않아요' };
  }

  const { error } = await sb
    .from('facilities')
    .update({ admin_user_id: user.id })
    .eq('id', facilityId);

  if (error) return { ok: false, error: '연결 실패' };

  await setFacilityCookie(facilityId, user.id);
  await grantOnboardingCredit(sb, facilityId, 'onboard_signup');
  return { ok: true };
}

export async function searchFacilities(query: string) {
  const sb = adminClient();
  if (!sb) return [];

  const { data } = await sb
    .from('facilities')
    .select('id, name, facility_type, address_text, admin_user_id')
    .ilike('name', `%${query}%`)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('name')
    .limit(20);

  return data ?? [];
}
