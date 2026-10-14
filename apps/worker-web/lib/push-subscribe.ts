'use client';

import { supabase } from '@/lib/supabase';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function preparePush(): Promise<{ subscription: PushSubscription; created: boolean } | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') return null;

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return null;

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return { subscription: existing, created: false };

  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) throw new Error('알림 설정이 준비되지 않았어요. 잠시 후 다시 시도해 주세요.');
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key).buffer as ArrayBuffer,
  });
  return { subscription, created: true };
}

export async function subscribeToPush(): Promise<PushSubscription | null> {
  return (await preparePush())?.subscription ?? null;
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe();
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  return reg?.pushManager.getSubscription() ?? null;
}

// 기기 구독만으로 서버 등록 성공을 추정하지 않는다. 조회 실패는 꺼짐과 구분한다.
export async function isShiftPushEnabled(): Promise<boolean> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  const subscription = await getExistingSubscription();
  if (!subscription) return false;
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error('다시 로그인한 뒤 알림 설정을 확인해 주세요.');
  const { data, error } = await supabase.from('push_subscriptions').select('id')
    .eq('worker_id', user.id).eq('endpoint', subscription.endpoint).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

// 이 기기에서 새 근무 알림 켜기 — 내 정보 토글과 홈 배너가 같이 쓴다.
// 구독 → push_subscriptions 저장. 실패 시 이번에 만든 구독만 되돌린다.
export type EnablePushResult = 'enabled' | 'denied' | 'unsupported';
export async function enableShiftPush(): Promise<EnablePushResult> {
  if (!('PushManager' in window) || !('serviceWorker' in navigator) || typeof Notification === 'undefined') return 'unsupported';
  // 권한 요청은 클릭 직후 실행해야 한다. 앞에 네트워크 await를 두지 않는다.
  const prepared = await preparePush();
  if (!prepared) return 'denied';
  const { subscription: sub, created } = prepared;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('다시 로그인한 뒤 알림을 켜 주세요.');
    const { error } = await supabase.from('push_subscriptions').upsert({
      worker_id: user.id, endpoint: sub.endpoint,
      subscription: sub.toJSON(),
    }, { onConflict: 'worker_id,endpoint' });
    if (error) throw error;
    return 'enabled';
  } catch (error) {
    if (created) await sub.unsubscribe().catch(() => undefined);
    throw error;
  }
}

// 이 기기의 endpoint만 제거한다. 구독을 찾지 못해도 다른 기기를 일괄 해제하지 않는다.
export async function disableShiftPush(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('다시 로그인한 뒤 알림을 변경해 주세요.');
  const sub = await getExistingSubscription();
  if (!sub) return;
  const { error } = await supabase.from('push_subscriptions').delete()
    .eq('worker_id', user.id).eq('endpoint', sub.endpoint);
  if (error) throw error;
  const removed = await sub.unsubscribe();
  if (!removed && (await getExistingSubscription())?.endpoint === sub.endpoint) {
    throw new Error('기기의 알림 구독을 해제하지 못했어요. 다시 시도해 주세요.');
  }
}
