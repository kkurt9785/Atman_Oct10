import type webpush from 'web-push';
import { adminClient } from '@/lib/supabase';
import { sendWebPush } from '@/lib/push';

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

  for (const row of rows) {
    const { data: subscriptionRows, error: subscriptionError } = await sb
      .from('push_subscriptions').select('id,subscription')
      .eq('worker_id', row.worker_auth_user_id);
    const subscriptions = (subscriptionRows ?? []) as PushSubscriptionRow[];
    if (subscriptionError || subscriptions.length === 0) {
      await sb.rpc('complete_notification_outbox', {
        p_id: row.id, p_status: 'discarded',
        p_error: subscriptionError?.message ?? 'push subscription missing',
      });
      counters.discarded += 1;
      continue;
    }
    const results = await Promise.all(subscriptions.map(async (subscription) => ({
      subscriptionId: subscription.id,
      result: await sendWebPush(subscription.subscription, { title: row.title, body: row.body, data: row.data }),
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
      await sb.rpc('complete_notification_outbox', { p_id: row.id, p_status: 'sent', p_error: null });
      counters.sent += 1;
    } else if (expiredIds.length === results.length) {
      await sb.rpc('complete_notification_outbox', { p_id: row.id, p_status: 'discarded', p_error: 'push subscriptions expired' });
      counters.discarded += 1;
    } else {
      await sb.rpc('complete_notification_outbox', { p_id: row.id, p_status: 'failed', p_error: retryError ?? 'push delivery failed' });
      counters.failed += 1;
    }
  }
  return counters;
}
