// HARAGURI push sender. Invoked by pg_net from DB triggers (new message/file) and by pg_cron (daily reminder).
// Secrets: HOOK_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (supabase secrets set). SUPABASE_* are injected.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

type Subscription = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
type Entry = { id: string; family_id: string; title: string; date: string; kind: string; repeat: 'none' | 'monthly' | 'yearly' };

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

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

async function send(subs: Subscription[], payload: Record<string, unknown>) {
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

async function subscriptionsFor(userIds: string[]) {
  if (!userIds.length) return [] as Subscription[];
  const { data } = await admin.from('hg_push_subscriptions').select('id,user_id,endpoint,p256dh,auth').in('user_id', userIds);
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
  return send(await subscriptionsFor(recipients), { title: `${room} · ${family?.name ?? 'HARAGURI'}`, body: `${author}: ${text}`.slice(0, 180), url, tag: `room-${p.entry_id ?? 'general'}` });
}

async function onDaily() {
  const today = ymd(kst());
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
    const due = (entries as Entry[] ?? []).flatMap(e => { const d = occurrence(e, month); return d && d <= today && !done.has(`${e.id}|${d}`) ? [{ e, d }] : []; });
    const todayItems = due.filter(x => x.d === today);
    const overdue = due.length - todayItems.length;
    if (!due.length) continue;
    const titles = (todayItems.length ? todayItems : due).slice(0, 3).map(x => x.e.title).join(', ');
    const body = `${todayItems.length ? `오늘 ${todayItems.length}개: ${titles}` : `밀린 일 ${overdue}개: ${titles}`}${todayItems.length && overdue ? ` · 밀린 일 ${overdue}개` : ''}`;
    const result = await send(await subscriptionsFor((members ?? []).map(m => m.user_id)), { title: `${family.name} · 오늘 챙길 일`, body: body.slice(0, 180), url: '/?tab=alerts', tag: 'daily' });
    total += result.delivered;
  }
  return { delivered: total };
}

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('method', { status: 405 });
  if (req.headers.get('x-haraguri-secret') !== Deno.env.get('HOOK_SECRET')) return new Response('forbidden', { status: 403 });
  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return new Response('bad json', { status: 400 }); }
  try {
    const result = payload.kind === 'daily' ? await onDaily() : (payload.kind === 'comment' || payload.kind === 'file') ? await onMessage(payload as Parameters<typeof onMessage>[0]) : { ignored: true };
    return Response.json(result);
  } catch (e) {
    console.error('push failed', e);
    return new Response('error', { status: 500 });
  }
});
