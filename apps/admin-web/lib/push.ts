
import webpush from 'web-push';

let initialized = false;

function init(): boolean {
  if (initialized) return true;
  const subject = process.env.VAPID_SUBJECT;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  initialized = true;
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export type PushResult =
  | { ok: true }
  | { ok: false; expired: boolean; error: string };

export async function sendWebPush(
  subscription: webpush.PushSubscription,
  payload: PushPayload,
): Promise<PushResult> {
  if (!init()) {
    return { ok: false, expired: false, error: 'VAPID 환경변수가 설정되지 않았어요.' };
  }

  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 60 * 60 });
    return { ok: true };
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    const expired = statusCode === 404 || statusCode === 410;
    const message = error instanceof Error ? error.message : '웹푸시 발송에 실패했어요.';
    if (!expired) console.error('[push] 발송 실패', error);
    return { ok: false, expired, error: message };
  }
}
