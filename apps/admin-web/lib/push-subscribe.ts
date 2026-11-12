'use client';

import { supabase } from './supabase-browser';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(b64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

export async function subscribeToAdminPush(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') return null;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) throw new Error('알림 설정이 준비되지 않았어요.');
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
  });
}

export async function getAdminPushSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const registration = await navigator.serviceWorker.getRegistration('/sw.js');
  return registration?.pushManager.getSubscription() ?? null;
}

export async function isAdminPushEnabled(): Promise<boolean> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  const subscription = await getAdminPushSubscription();
  if (!subscription) return false;
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error('다시 로그인한 뒤 알림 설정을 확인해 주세요.');
  const { data, error } = await supabase.from('push_subscriptions').select('id')
    .eq('worker_id', user.id).eq('endpoint', subscription.endpoint).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

// 로그아웃·시연 종료 직전에 부른다: 이 기기의 구독 행만 지워, 나간 계정(특히 공개 시연 계정)의 알림이 이 폰에 계속 오지 않게 한다.
// (11/12 알림 QA P0 — 발송기는 계정에 묶인 구독 전부로 보낸다.) 실패해도 로그아웃은 막지 않는다.
export async function forgetThisDevicePush(): Promise<void> {
  try {
    const sub = await getAdminPushSubscription();
    if (!sub) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('push_subscriptions').delete().eq('worker_id', user.id).eq('endpoint', sub.endpoint);
  } catch { /* 로그아웃이 먼저다 */ }
}
