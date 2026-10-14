import type webpush from 'web-push';
import { adminClient } from './supabase';
import { sendWebPush } from './push';

type OutboxRow = {
  id: string;
  worker_auth_user_id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
};

type PushSubscriptionRow = {
  id: string;
  subscription: webpush.PushSubscription;
};

export async function dispatchPendingNotifications(limit = 25) {
  const sb = adminClient();
  if (!sb) throw new Error('DB unavailable');
  const { data, error } = await sb.rpc('claim_notification_outbox', { p_limit: limit });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as OutboxRow[];
  const counters = { claimed: rows.length, sent: 0, failed: 0, discarded: 0 };
  async function complete(id: string, status: 'sent' | 'failed' | 'discarded', error: string | null) {
    const result = await sb!.rpc('complete_notification_outbox', { p_id: id, p_status: status, p_error: error });
    if (result.error) throw new Error(`알림 처리 상태를 저장하지 못했어요: ${result.error.message}`);
    counters[status] += 1;
  }

  for (const row of rows) {
    const { data: subscriptionRows, error: subscriptionError } = await sb
      .from('push_subscriptions').select('id,subscription')
      .eq('worker_id', row.worker_auth_user_id);
    const subscriptions = (subscriptionRows ?? []) as PushSubscriptionRow[];
    if (subscriptionError) {
      await complete(row.id, 'failed', subscriptionError.message);
      continue;
    }
    if (subscriptions.length === 0) {
      await complete(row.id, 'discarded', 'push subscription missing');
      continue;
    }
    const results = await Promise.all(subscriptions.map(async (subscription) => ({
      subscriptionId: subscription.id,
      result: await sendWebPush(subscription.subscription, { title: row.title, body: row.body, data: { ...row.data, notificationId: row.id } }),
    })));
    const expiredIds: string[] = [];
    let delivered = false;
    let retryError: string | null = null;
    for (const { subscriptionId, result } of results) {
      if (result.ok) {
        delivered = true;
      } else if (result.expired) {
        expiredIds.push(subscriptionId);
      } else {
        retryError ??= result.error;
      }
    }
    if (expiredIds.length) await sb.from('push_subscriptions').delete().in('id', expiredIds);
    if (delivered) {
      await complete(row.id, 'sent', retryError ? `partial delivery: ${retryError}` : null);
    } else if (expiredIds.length === results.length) {
      await complete(row.id, 'discarded', 'push subscriptions expired');
    } else {
      await complete(row.id, 'failed', retryError ?? 'push delivery failed');
    }
  }
  return counters;
}
