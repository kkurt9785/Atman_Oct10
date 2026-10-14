'use client';

import { supabase } from '@/lib/supabase';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return null;

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key).buffer as ArrayBuffer,
  });
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

// 이 기기에서 새 근무 알림 켜기 — 내 정보 토글과 홈 배너가 같이 쓴다.
// 구독 → push_subscriptions 저장. 저장에 실패하면 구독을 되돌리고 오류를 던진다.
export type EnablePushResult = 'enabled' | 'denied' | 'unsupported';
export async function enableShiftPush(): Promise<EnablePushResult> {
  if (!('PushManager' in window)) return 'unsupported';
  const sub = await subscribeToPush();
  if (!sub) return 'denied';
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { error } = await supabase.from('push_subscriptions').upsert({
      worker_id: user.id, endpoint: sub.endpoint,
      subscription: sub.toJSON(),
    }, { onConflict: 'worker_id,endpoint' });
    if (error) {
      await unsubscribeFromPush().catch(() => undefined);
      throw error;
    }
  }
  return 'enabled';
}
