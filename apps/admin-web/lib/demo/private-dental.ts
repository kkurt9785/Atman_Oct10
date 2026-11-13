// 영업용 비공개 치과 시연 '광교본치과의원' (2026-11-13, supabase/migrations/20261113120000_private_dental_demo.sql)
// 공개 시연 버튼에는 없고 숨은 링크(/login?demo=dental&key=…)로만 들어간다. 키는 서버 환경변수 DEMO_DENTAL_LINK_KEY 에만 있고,
// 바꾸면 이전 링크는 바로 막힌다. 실제 치과 이름이라 사업장 검색에서도 빠져 있다(DEMO-PRIVATE-*).
import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { adminClient } from '@/lib/supabase';

export const DENTAL_DEMO_EMAIL = 'sales-dental@demo.atman.co.kr';
export const DENTAL_DEMO_BRN = 'DEMO-PRIVATE-DENTAL-GWANGGYO';
export const DENTAL_DEMO_NAME = '광교본치과의원';

// 링크 키 확인 — 길이가 짧거나 설정이 없으면 항상 거부
export function isValidDentalDemoKey(key: unknown): boolean {
  const expected = process.env.DEMO_DENTAL_LINK_KEY ?? '';
  if (expected.length < 24 || typeof key !== 'string' || key.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(key), Buffer.from(expected));
}

async function dentalFacilityId(): Promise<string | null> {
  const sb = adminClient();
  if (!sb) return null;
  const { data } = await sb.from('facilities').select('id')
    .eq('business_registration_number', DENTAL_DEMO_BRN).eq('is_demo', true).eq('is_active', true).is('deleted_at', null).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

// 이 계정이 치과 시연 사업장을 볼 수 있게(급여 포함) — 첫 로그인·매번 로그인 때 보장한다
export async function ensureDentalDemoAccess(userId: string): Promise<boolean> {
  const sb = adminClient();
  const facilityId = await dentalFacilityId();
  if (!sb || !facilityId) return false;
  await sb.from('profiles').upsert({ id: userId, role: 'admin', onboarding_done: true }, { onConflict: 'id' });
  const { error } = await sb.from('facility_admin_access')
    .upsert({ user_id: userId, facility_id: facilityId, access_role: 'super', can_view_payroll: true }, { onConflict: 'user_id,facility_id' });
  return !error;
}

// 시연 원장 계정이 없으면 만들고, 있으면 비밀번호를 시연 공용 값으로 맞춘다(공개 시연 계정과 같은 DEMO_ACCOUNT_PASSWORD).
export async function ensureDentalDemoAccount(): Promise<string | null> {
  const sb = adminClient();
  const password = process.env.DEMO_ACCOUNT_PASSWORD;
  if (!sb || !password || password.length < 24) return null;
  let userId: string | null = null;
  for (let page = 1; page <= 20 && !userId; page += 1) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return null;
    userId = data.users.find((user) => user.email?.toLowerCase() === DENTAL_DEMO_EMAIL)?.id ?? null;
    if (data.users.length < 1000) break;
  }
  if (userId) {
    const { error } = await sb.auth.admin.updateUserById(userId, { password, email_confirm: true });
    if (error) return null;
  } else {
    const { data, error } = await sb.auth.admin.createUser({
      email: DENTAL_DEMO_EMAIL, password, email_confirm: true,
      user_metadata: { profile_nickname: `${DENTAL_DEMO_NAME} 원장` },
    });
    if (error || !data.user) return null;
    userId = data.user.id;
  }
  return (await ensureDentalDemoAccess(userId)) ? userId : null;
}
