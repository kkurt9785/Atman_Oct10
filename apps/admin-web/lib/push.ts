import webpush from 'web-push';

let initialized = false;

function init() {
  if (initialized) return;
  const subject = process.env.VAPID_SUBJECT;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !pub || !priv) return;
  webpush.setVapidDetails(subject, pub, priv);
  initialized = true;
}

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export async function sendWebPush(
  subscription: webpush.PushSubscription,
  payload: PushPayload
): Promise<void> {
  init();
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
  } catch (err: unknown) {
    const code = (err as { statusCode?: number }).statusCode;
    if (code === 410 || code === 404) return; // 만료된 구독 — 무시
    console.error('[push] 발송 실패', err);
  }
}
