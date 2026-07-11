
import { NextRequest, NextResponse } from 'next/server';
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

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return !!secret && request.headers.get('authorization') === `Bearer ${secret}`;
}

async function dispatch(limit = 25) {
  const sb = adminClient();
  if (!sb) throw new Error('DB unavailable');

  const { data, error } = await sb.rpc('claim_notification_outbox', { p_limit: limit });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as OutboxRow[];

  const counters = { claimed: rows.length, sent: 0, failed: 0, discarded: 0 };
  for (const row of rows) {
    const { data: subscriptionRow, error: subscriptionError } = await sb
      .from('push_subscriptions')
      .select('subscription')
      .eq('worker_id', row.worker_auth_user_id)
      .maybeSingle();

    if (subscriptionError || !subscriptionRow?.subscription) {
      await sb.rpc('complete_notification_outbox', {
        p_id: row.id,
        p_status: 'discarded',
        p_error: subscriptionError?.message ?? 'push subscription missing',
      });
      counters.discarded += 1;
      continue;
    }

    const result = await sendWebPush(
      subscriptionRow.subscription as webpush.PushSubscription,
      { title: row.title, body: row.body, data: row.data },
    );

    if (result.ok) {
      await sb.rpc('complete_notification_outbox', {
        p_id: row.id,
        p_status: 'sent',
        p_error: null,
      });
      counters.sent += 1;
    } else if (result.expired) {
      await sb.from('push_subscriptions').delete().eq('worker_id', row.worker_auth_user_id);
      await sb.rpc('complete_notification_outbox', {
        p_id: row.id,
        p_status: 'discarded',
        p_error: result.error,
      });
      counters.discarded += 1;
    } else {
      await sb.rpc('complete_notification_outbox', {
        p_id: row.id,
        p_status: 'failed',
        p_error: result.error,
      });
      counters.failed += 1;
    }
  }
  return counters;
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return NextResponse.json({ ok: true, ...(await dispatch()) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Dispatch failed' },
      { status: 500 },
    );
  }
}

export const POST = GET;
