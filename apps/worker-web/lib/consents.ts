import { supabase } from '@/lib/supabase';
import { CONSENT_VERSION } from '@/components/onboarding/Terms';

// 선택 동의(마케팅)와 철회 가능한 위치정보 동의의 현재 상태. 이력은 worker_consents 에 쌓이고 가장 최근 기록이 현재 상태다.
export type MyConsents = { marketing: boolean; location: boolean };

export async function getMyConsents(): Promise<MyConsents> {
  const { data } = await supabase.from('worker_consents')
    .select('consent_type, granted, granted_at')
    .in('consent_type', ['marketing', 'location_data'])
    .order('granted_at', { ascending: false });
  const rows = (data ?? []) as Array<{ consent_type: string; granted: boolean }>;
  const latest = (type: string) => rows.find((row) => row.consent_type === type)?.granted;
  // 위치정보는 가입 때 필수 동의라 기록이 없으면 동의 상태로 본다
  return { marketing: latest('marketing') ?? false, location: latest('location_data') ?? true };
}

export async function setMyConsent(type: 'marketing' | 'location_data', granted: boolean): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.rpc('set_my_consent', { p_type: type, p_granted: granted, p_version: CONSENT_VERSION });
  if (error) return { ok: false, message: error.message.replace(/^.*?: /, '') || '동의 상태를 바꾸지 못했어요.' };
  locationAllowed = null;
  return { ok: true };
}

// 위치를 쓰기 직전에 확인한다(출퇴근·현재 위치 공고). 화면마다 다시 묻지 않도록 한 번만 읽는다.
let locationAllowed: Promise<boolean> | null = null;
export function isLocationAllowed(): Promise<boolean> {
  if (!locationAllowed) locationAllowed = getMyConsents().then((c) => c.location).catch(() => true);
  return locationAllowed;
}
