import { supabase } from '@/lib/supabase';
import { CONSENT_VERSION } from '@/components/onboarding/Terms';

// 선택 동의(마케팅)와 철회 가능한 위치정보 동의의 현재 상태. 이력은 worker_consents 에 쌓이고 가장 최근 기록이 현재 상태다.
export type MyConsents = { marketing: boolean; location: boolean };

export async function getMyConsents(): Promise<MyConsents> {
  const { data, error } = await supabase.from('worker_consents')
    .select('consent_type, granted, granted_at')
    .in('consent_type', ['marketing', 'location_data'])
    .order('granted_at', { ascending: false });
  if (error) throw new Error('동의 상태를 확인하지 못했어요. 다시 시도해 주세요.');
  const rows = (data ?? []) as Array<{ consent_type: string; granted: boolean }>;
  const latest = (type: string) => rows.find((row) => row.consent_type === type)?.granted;
  return { marketing: latest('marketing') ?? false, location: latest('location_data') ?? false };
}

export async function setMyConsent(type: 'marketing' | 'location_data', granted: boolean): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.rpc('set_my_consent', { p_type: type, p_granted: granted, p_version: CONSENT_VERSION });
  if (error) return { ok: false, message: error.message.replace(/^.*?: /, '') || '동의 상태를 바꾸지 못했어요.' };
  return { ok: true };
}

// 위치를 쓰기 직전에 조회한다. 영구 캐시는 계정 전환·다른 기기의 철회를 놓친다.
export function isLocationAllowed(): Promise<boolean> {
  return getMyConsents().then((c) => c.location).catch(() => false);
}
