// HARAGURI push sender. Invoked by pg_net from DB triggers (new message/file) and by pg_cron (daily/eve/unread reminders).
// Secrets: HOOK_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (supabase secrets set). SUPABASE_* are injected.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

type Prefs = { messages?: boolean; files?: boolean; daily?: boolean; eve?: boolean; ingest?: boolean; unread?: boolean };
type UnreadRow = { family_id: string; family_name: string; entry_id: string | null; occurrence: string | null; room_title: string; unread: number; latest_at: string; latest_body: string | null; latest_author: string | null };
type Subscription = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; prefs: Prefs | null; quiet_start: number | null; quiet_end: number | null };
type Kind = keyof Prefs;
type Entry = { id: string; family_id: string; title: string; date: string; kind: string; repeat: 'none' | 'monthly' | 'yearly' };

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
// VAPID keys arrive via `supabase secrets set`; until then the function answers 503 instead of failing to boot.
function configured() {
  const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY'), secret = Deno.env.get('HOOK_SECRET');
  if (!pub || !priv || !secret) return false;
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com', pub, priv);
  return true;
}

const kst = (d = new Date()) => new Date(d.getTime() + 9 * 3600 * 1000);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
function daysInMonth(month: string) { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
// Same rule as the app: a monthly/yearly item on the 31st falls on the last day of shorter months.
function occurrence(entry: Entry, month: string): string | null {
  if (entry.date.slice(0, 7) > month) return null;
  if (entry.repeat === 'none') return entry.date.startsWith(month) ? entry.date : null;
  if (entry.repeat === 'yearly' && entry.date.slice(5, 7) !== month.slice(5, 7)) return null;
  const day = Math.min(Number(entry.date.slice(8)), daysInMonth(month));
  return `${month}-${String(day).padStart(2, '0')}`;
}

// Quiet hours are per device in KST; a window like 22→7 wraps midnight.
function inQuietHours(s: Subscription, hour: number) {
  if (s.quiet_start == null || s.quiet_end == null || s.quiet_start === s.quiet_end) return false;
  return s.quiet_start < s.quiet_end ? hour >= s.quiet_start && hour < s.quiet_end : hour >= s.quiet_start || hour < s.quiet_end;
}
async function send(allSubs: Subscription[], payload: Record<string, unknown>, kind: Kind) {
  const hour = kst().getUTCHours();
  const subs = allSubs.filter(s => (s.prefs?.[kind] ?? true) && !inQuietHours(s, hour));
  let delivered = 0;
  const gone: string[] = [];
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 });
      delivered++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) gone.push(s.id); // the browser dropped this subscription
    }
  }));
  if (gone.length) await admin.from('hg_push_subscriptions').delete().in('id', gone);
  return { delivered, removed: gone.length };
}

// Unread rooms for one person (same RPC the app uses); the total rides along as the icon badge count.
async function unreadFor(userId: string) {
  const { data } = await admin.rpc('hg_unread_summary', { target: userId });
  return (data ?? []) as UnreadRow[];
}
const unreadTotal = (rows: UnreadRow[]) => rows.reduce((s, r) => s + r.unread, 0);

async function subscriptionsFor(userIds: string[]) {
  if (!userIds.length) return [] as Subscription[];
  const { data } = await admin.from('hg_push_subscriptions').select('id,user_id,endpoint,p256dh,auth,prefs,quiet_start,quiet_end').in('user_id', userIds);
  return (data ?? []) as Subscription[];
}

async function onMessage(p: { kind: 'comment' | 'file'; family_id: string; entry_id: string | null; occurrence: string | null; author_id: string; body?: string; name?: string }) {
  const [{ data: members }, { data: family }] = await Promise.all([
    admin.from('hg_members').select('user_id,display_name').eq('family_id', p.family_id),
    admin.from('hg_families').select('name').eq('id', p.family_id).single(),
  ]);
  const author = members?.find(m => m.user_id === p.author_id)?.display_name ?? '가족';
  const recipients = (members ?? []).filter(m => m.user_id !== p.author_id).map(m => m.user_id);
  let room = '가족 기본 채팅';
  if (p.entry_id) { const { data: entry } = await admin.from('hg_entries').select('title').eq('id', p.entry_id).single(); room = entry?.title ?? '우리집 일'; }
  const text = p.kind === 'file' ? `사진·문서를 올렸어요: ${p.name ?? ''}` : (p.body ?? '');
  const url = p.entry_id ? `/?open=${p.entry_id}:${p.occurrence}` : '/?tab=chat';
  const payload = { title: `${room} · ${family?.name ?? 'HARAGURI'}`, body: `${author}: ${text}`.slice(0, 180), url, tag: `room-${p.entry_id ?? 'general'}` };
  let delivered = 0, removed = 0;
  for (const uid of recipients) { // one payload per recipient so each device gets its own unread badge count
    const r = await send(await subscriptionsFor([uid]), { ...payload, badgeCount: unreadTotal(await unreadFor(uid)) }, p.kind === 'file' ? 'files' : 'messages');
    delivered += r.delivered; removed += r.removed;
  }
  return { delivered, removed };
}

// kind 'daily' (08:00): today's items + overdue. kind 'eve' (20:00): a look at tomorrow.
async function onDaily(kind: 'daily' | 'eve' = 'daily') {
  const base = kst(); if (kind === 'eve') base.setUTCDate(base.getUTCDate() + 1);
  const today = ymd(base);
  const month = today.slice(0, 7);
  const { data: families } = await admin.from('hg_families').select('id,name');
  let total = 0;
  for (const family of families ?? []) {
    const [{ data: entries }, { data: receipts }, { data: members }] = await Promise.all([
      admin.from('hg_entries').select('id,family_id,title,date,kind,repeat').eq('family_id', family.id),
      admin.from('hg_receipts').select('entry_id,occurrence,state').eq('family_id', family.id).eq('state', 'done'),
      admin.from('hg_members').select('user_id').eq('family_id', family.id),
    ]);
    const done = new Set((receipts ?? []).map(r => `${r.entry_id}|${r.occurrence}`));
    const due = (entries as Entry[] ?? []).flatMap(e => { const d = occurrence(e, month); return d && (kind === 'eve' ? d === today : d <= today) && !done.has(`${e.id}|${d}`) ? [{ e, d }] : []; });
    const todayItems = due.filter(x => x.d === today);
    const overdue = due.length - todayItems.length;
    if (!due.length) continue;
    const titles = (todayItems.length ? todayItems : due).slice(0, 3).map(x => x.e.title).join(', ');
    const body = kind === 'eve' ? `내일 ${todayItems.length}개: ${titles}` : `${todayItems.length ? `오늘 ${todayItems.length}개: ${titles}` : `밀린 일 ${overdue}개: ${titles}`}${todayItems.length && overdue ? ` · 밀린 일 ${overdue}개` : ''}`;
    const result = await send(await subscriptionsFor((members ?? []).map(m => m.user_id)), { title: `${family.name} · ${kind === 'eve' ? '내일 챙길 일' : '오늘 챙길 일'}`, body: body.slice(0, 180), url: '/?tab=alerts', tag: kind }, kind);
    total += result.delivered;
  }
  return { delivered: total };
}

// kind 'unread' (hourly): messages left unread for 2h+ get one more nudge, at most every 6h, only when something new arrived since the last nudge.
async function onUnread() {
  const { data: subs } = await admin.from('hg_push_subscriptions').select('user_id');
  const users = [...new Set((subs ?? []).map(s => s.user_id as string))];
  const { data: states } = await admin.from('hg_unread_reminders').select('user_id,reminded_at,latest_seen').in('user_id', users.length ? users : ['00000000-0000-0000-0000-000000000000']);
  const now = Date.now(), twoHours = 2 * 3600 * 1000, sixHours = 6 * 3600 * 1000;
  let delivered = 0, considered = 0;
  for (const uid of users) {
    const rows = await unreadFor(uid);
    const pending = rows.filter(r => now - new Date(r.latest_at).getTime() >= twoHours);
    if (!pending.length) continue;
    const newest = pending.map(r => r.latest_at).sort().at(-1)!;
    const state = states?.find(s => s.user_id === uid);
    if (state && (new Date(state.latest_seen) >= new Date(newest) || now - new Date(state.reminded_at).getTime() < sixHours)) continue;
    considered++;
    const total = unreadTotal(pending), top = pending[0];
    const url = top.entry_id ? `/?open=${top.entry_id}:${top.occurrence}` : '/?tab=chat';
    const r = await send(await subscriptionsFor([uid]), { title: `안 읽은 메시지 ${total}개 · ${top.family_name}`, body: `${top.room_title} · ${top.latest_author ?? '가족'}: ${top.latest_body ?? ''}`.slice(0, 180), url, tag: 'unread', badgeCount: unreadTotal(rows) }, 'unread');
    delivered += r.delivered;
    await admin.from('hg_unread_reminders').upsert({ user_id: uid, reminded_at: new Date(now).toISOString(), latest_seen: newest });
  }
  return { delivered, considered };
}

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('method', { status: 405 });
  if (!configured()) return new Response('push not configured', { status: 503 });
  if (req.headers.get('x-haraguri-secret') !== Deno.env.get('HOOK_SECRET')) return new Response('forbidden', { status: 403 });
  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return new Response('bad json', { status: 400 }); }
  try {
    const result = payload.kind === 'daily' ? await onDaily('daily')
      : payload.kind === 'eve' ? await onDaily('eve')
      : payload.kind === 'unread' ? await onUnread()
      : payload.kind === 'ingest' ? await send(await subscriptionsFor([String(payload.user_id)]), { title: String(payload.title ?? 'HARAGURI'), body: String(payload.body ?? ''), url: String(payload.url ?? '/'), tag: 'ingest' }, 'ingest')
      : (payload.kind === 'comment' || payload.kind === 'file') ? await onMessage(payload as Parameters<typeof onMessage>[0]) : { ignored: true };
    return Response.json(result);
  } catch (e) {
    console.error('push failed', e);
    return new Response('error', { status: 500 });
  }
});
