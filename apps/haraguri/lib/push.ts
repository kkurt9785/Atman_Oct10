'use client';
import { supabase } from './supabase';

// Web Push registration for this device. Delivery itself happens server-side (supabase/functions/push).
export type PushState = 'unsupported' | 'denied' | 'off' | 'on' | 'needs-install';

export function pushSupport(): PushState {
  if (typeof window === 'undefined') return 'unsupported';
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (ios && !standalone) return 'needs-install'; // iOS only delivers push to home-screen apps (16.4+)
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'off';
}

function toKey(base64url: string) {
  const padding = '='.repeat((4 - base64url.length % 4) % 4);
  const raw = atob((base64url + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

export async function currentSubscription() {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function enablePush(userId: string) {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) throw new Error('푸시 알림 설정(공개 키)이 아직 준비되지 않았어요.');
  if (!supabase) throw new Error('로그인 연결 설정을 확인해 주세요.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('알림 권한이 허용되지 않았어요. 브라우저 설정에서 HARAGURI 알림을 허용해 주세요.');
  const registration = await navigator.serviceWorker.ready;
  const sub = (await registration.pushManager.getSubscription()) ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) as BufferSource });
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('이 브라우저의 푸시 구독 정보를 읽지 못했어요.');
  const { error } = await supabase.from('hg_push_subscriptions').upsert({ user_id: userId, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, user_agent: navigator.userAgent.slice(0, 300), last_seen: new Date().toISOString() }, { onConflict: 'endpoint' });
  if (error) throw error;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  if (supabase) await supabase.from('hg_push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

// Keeps the server row fresh (and re-links it after a re-login) without prompting.
export async function syncPush(userId: string) {
  if (!supabase || pushSupport() !== 'off' || Notification.permission !== 'granted') return false;
  const sub = await currentSubscription();
  if (!sub) return false;
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
  await supabase.from('hg_push_subscriptions').upsert({ user_id: userId, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, user_agent: navigator.userAgent.slice(0, 300), last_seen: new Date().toISOString() }, { onConflict: 'endpoint' });
  return true;
}
