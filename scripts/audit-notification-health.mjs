// Read-only production diagnostics. Prints aggregate counts, never identities,
// message contents, subscription endpoints, keys, or raw provider errors.
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { loadEnvConfig } = require('../apps/admin-web/node_modules/@next/env');
const { createClient } = require('../apps/admin-web/node_modules/@supabase/supabase-js');
loadEnvConfig(path.resolve('apps/admin-web'), false, { info() {}, error() {} });
const env = process.env;
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Local server configuration unavailable');
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const since = new Date(Date.now() - 7 * 86400000).toISOString();
const { data, error, count } = await sb.from('notification_outbox').select('status,attempts,created_at,last_error,event_type', { count: 'exact' }).gte('created_at', since).order('created_at', { ascending: false }).limit(1000);
if(error)throw new Error(`Outbox read failed (${error.code || 'unknown'})`);
const byStatus = {}, byEvent = {}, failures = {};
for(const row of data || []) {
  byStatus[row.status] = (byStatus[row.status] || 0) + 1;
  byEvent[row.event_type] = (byEvent[row.event_type] || 0) + 1;
  const msg = row.last_error || '';
  const category = !msg ? null : /subscription.*missing/i.test(msg) ? 'no_subscription' : /expired|410|404/i.test(msg) ? 'expired' : /VAPID/i.test(msg) ? 'vapid_configuration' : /partial delivery/i.test(msg) ? 'partial_delivery' : 'other_error';
  if(category)failures[category] = (failures[category] || 0) + 1;
}
const subscriptions = await sb.from('push_subscriptions').select('id', { count: 'exact', head: true });
const queued = await sb.from('notification_outbox').select('id', { count: 'exact', head: true }).in('status', ['pending','failed','processing']);
const exhausted = await sb.from('notification_outbox').select('id', { count: 'exact', head: true }).in('status', ['pending','failed','processing']).gte('attempts',8);
console.log(JSON.stringify({ readOnly: true, localConfigOnly: { vapidPublicPresent: !!env.VAPID_PUBLIC_KEY, vapidPrivatePresent: !!env.VAPID_PRIVATE_KEY, vapidSubjectPresent: !!env.VAPID_SUBJECT, publicKeyMatchesAdminClient: !!env.VAPID_PUBLIC_KEY && env.VAPID_PUBLIC_KEY === env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, cronSecretPresent: !!env.CRON_SECRET }, last7Days: { total: count, sampled: data?.length, byStatus, byEvent, failures }, subscriptionCount: subscriptions.error ? 'read_failed' : subscriptions.count, queuedCount: queued.error ? 'read_failed' : queued.count, exhaustedCount: exhausted.error ? 'read_failed' : exhausted.count }, null, 2));
