'use server';

import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';
import { cache } from 'react';
import { adminClient, getUserFromToken, userClient } from './supabase';
import { FACILITY_COOKIE } from './constants';

const ADMIN_SESSION_COOKIE = 'atman_admin_session';
const ADMIN_SESSION_MAX_AGE_SECONDS = 55 * 60;
const FACILITY_CONTEXT_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 원장이 며칠 뒤 열어도 사업장 선택이 유지되도록

export type AdminAccessRole = 'owner' | 'operator' | 'sales' | 'super';

export type AdminSession = {
  accessToken: string;
  user: User;
};

export type AdminContext = AdminSession & {
  facilityId: string;
  accessRole: AdminAccessRole;
  canViewPayroll: boolean;
};

type FacilityCookiePayload = {
  facilityId: string;
  userId: string;
  exp: number;
};

function cookieSecret(): string {
  const secret = process.env.FACILITY_COOKIE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('FACILITY_COOKIE_SECRET must be configured with at least 32 characters');
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac('sha256', cookieSecret()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function encodeFacilityCookie(payload: FacilityCookiePayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

function decodeFacilityCookie(value: string | undefined): FacilityCookiePayload | null {
  if (!value) return null;
  const [body, signature] = value.split('.');
  if (!body || !signature || !safeEqual(sign(body), signature)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as FacilityCookiePayload;
    if (!payload.facilityId || !payload.userId || !Number.isFinite(payload.exp)) return null;
    if (Date.now() >= payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// 카카오로 처음 온 계정은 handle_new_user가 role 없이 프로필만 만든다.
// 관리자 앱에 들어온 '아직 아무 역할도 없는' 계정은 여기서 admin으로 승격한다(셀프 등록 진입점).
// 이미 worker인 계정은 승격하지 않는다 — 워커 온보딩은 role을 worker로 덮어쓰므로 반대 방향은 자연히 해결된다.
async function isAdminUser(accessToken: string, userId: string): Promise<boolean> {
  const sb = userClient(accessToken);
  if (!sb) return false;
  const { data, error } = await sb
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (error) return false;
  if (data?.role === 'admin') return true;
  if (data?.role) return false; // 'worker' 등
  const service = adminClient();
  if (!service) return false;
  const { error: promoteError } = await service
    .from('profiles')
    .upsert({ id: userId, role: 'admin', onboarding_done: true, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (promoteError) { console.error('[admin-auth] promote failed', promoteError.message); return false; }
  return true;
}

// 사업장 쿠키가 없거나 만료됐을 때 쓰는 기본 사업장: 소유 사업장 → 위임받은 사업장 순.
export const resolveDefaultFacilityId = cache(async (userId: string): Promise<string | null> => {
  const sb = adminClient();
  if (!sb) return null;
  const { data: owned } = await sb.from('facilities').select('id').eq('admin_user_id', userId).eq('is_active', true).is('deleted_at', null).order('created_at').limit(1).maybeSingle();
  if (owned?.id) return owned.id as string;
  const { data: delegated } = await sb.from('facility_admin_access').select('facility_id, facilities!inner(is_active, deleted_at)').eq('user_id', userId).eq('facilities.is_active', true).is('facilities.deleted_at', null).order('created_at').limit(1).maybeSingle();
  return (delegated?.facility_id as string | undefined) ?? null;
});

export async function setAdminSessionCookie(accessToken: string): Promise<AdminSession> {
  const user = await getUserFromToken(accessToken);
  if (!user || !(await isAdminUser(accessToken, user.id))) {
    throw new Error('관리자 계정이 아닙니다.');
  }

  const jar = await cookies();
  jar.set(ADMIN_SESSION_COOKIE, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
    path: '/',
  });
  return { accessToken, user };
}

export async function clearAdminCookies(): Promise<void> {
  const jar = await cookies();
  jar.delete(ADMIN_SESSION_COOKIE);
  jar.delete(FACILITY_COOKIE);
}

export const getAdminSession=cache(async (): Promise<AdminSession | null> => {
  const jar = await cookies();
  const accessToken = jar.get(ADMIN_SESSION_COOKIE)?.value;
  if (!accessToken) return null;

  const user = await getUserFromToken(accessToken);
  if (!user || !(await isAdminUser(accessToken, user.id))) return null;
  return { accessToken, user };
});

export async function setFacilityContextCookie(
  facilityId: string,
  userId: string,
): Promise<void> {
  const jar = await cookies();
  const value = encodeFacilityCookie({
    facilityId,
    userId,
    exp: Date.now() + FACILITY_CONTEXT_MAX_AGE_SECONDS * 1000,
  });
  jar.set(FACILITY_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: FACILITY_CONTEXT_MAX_AGE_SECONDS,
    path: '/',
  });
}

export type FacilityAccessInfo = {
  role: AdminAccessRole;
  canViewPayroll: boolean;
};

export const getFacilityAccessInfo=cache(async (
  userId: string,
  facilityId: string,
): Promise<FacilityAccessInfo | null> => {
  const sb = adminClient();
  if (!sb) return null;

  const [{ data: owned }, { data: delegated }] = await Promise.all([
    sb
      .from('facilities')
      .select('id')
      .eq('id', facilityId)
      .eq('admin_user_id', userId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle(),
    sb
      .from('facility_admin_access')
      .select('access_role, can_view_payroll')
      .eq('user_id', userId)
      .eq('facility_id', facilityId)
      .maybeSingle(),
  ]);

  // 소유자(원장)는 항상 급여 열람 가능. 위임 관리자는 토글 값을 따른다.
  if (owned) return { role: 'owner', canViewPayroll: true };
  const role = delegated?.access_role;
  if (role !== 'operator' && role !== 'sales' && role !== 'super') return null;
  return { role, canViewPayroll: delegated?.can_view_payroll === true };
});

export const getFacilityAccessRole=cache(async (
  userId: string,
  facilityId: string,
): Promise<AdminAccessRole | null> => {
  const info = await getFacilityAccessInfo(userId, facilityId);
  return info?.role ?? null;
});

export const getAdminContext=cache(async (): Promise<AdminContext | null> => {
  const session = await getAdminSession();
  if (!session) return null;

  const jar = await cookies();
  const payload = decodeFacilityCookie(jar.get(FACILITY_COOKIE)?.value);
  // 쿠키가 없거나 만료됐으면(다음날 재접속 등) 소유 사업장으로 폴백 — 서버 컴포넌트에선 쿠키를 다시 못 쓰므로 계산만 한다
  const facilityId = payload && payload.userId === session.user.id
    ? payload.facilityId
    : await resolveDefaultFacilityId(session.user.id);
  if (!facilityId) return null;

  const access = await getFacilityAccessInfo(session.user.id, facilityId);
  if (!access) return null;

  return {
    ...session,
    facilityId,
    accessRole: access.role,
    canViewPayroll: access.canViewPayroll,
  };
});

export async function requireAdminSession(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) throw new Error('관리자 로그인이 필요합니다.');
  return session;
}

export async function requireAdminContext(
  allowedRoles: AdminAccessRole[] = ['owner', 'operator', 'sales', 'super'],
): Promise<AdminContext> {
  const context = await getAdminContext();
  if (!context || !allowedRoles.includes(context.accessRole)) {
    throw new Error('이 사업장에 대한 권한이 없습니다.');
  }
  return context;
}
