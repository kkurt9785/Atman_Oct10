// HARAGURI auto-collect endpoint. Phone automations (iOS 단축어, MacroDroid) POST a payment message here with a per-member token.
// The message is parsed server-side and saved as an expense awaiting review (reviewed=false). Duplicates are ignored by fingerprint.
//   POST /functions/v1/ingest?token=…   body: {"text": "..."} | text/plain | form field "text"   (or header x-ingest-token)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { describe, fingerprintOf, parseCardMessage, type ParsedCardMessage, matchRule } from '../_shared/cardsms.core.ts';

type Card = { id: string; name: string; holder: string; benefit_note: string | null; card_type: 'credit' | 'debit' | null };
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-ingest-token', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function matchCard(parsed: ParsedCardMessage, cards: Card[]): string | null {
  if (parsed.channel === 'bank_transfer') return null;
  const text = (c: Card) => `${c.name} ${c.holder} ${c.benefit_note ?? ''}`;
  const typed = cards.filter(c => parsed.channel === 'unknown' || (c.card_type ?? 'credit') === (parsed.channel === 'debit' ? 'debit' : 'credit'));
  const pool = typed.length ? typed : cards;
  if (parsed.last4) { const hits = pool.filter(c => text(c).includes(parsed.last4!)); if (hits.length === 1) return hits[0].id; }
  if (parsed.issuer) { const hits = pool.filter(c => text(c).includes(parsed.issuer!)); if (hits.length === 1) return hits[0].id; }
  return pool.length === 1 ? pool[0].id : null;
}

async function readText(req: Request): Promise<string> {
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('application/json')) { const b = await req.json().catch(() => ({})); return String(b.text ?? b.message ?? b.body ?? b.content ?? ''); }
  if (type.includes('form')) { const f = await req.formData().catch(() => null); return String(f?.get('text') ?? f?.get('message') ?? ''); }
  return await req.text();
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const token = new URL(req.url).searchParams.get('token') ?? req.headers.get('x-ingest-token');
  if (!token || token.length < 16) return json({ error: 'token required' }, 401);
  const { data: owner } = await admin.from('hg_ingest_tokens').select('family_id,user_id').eq('token', token).maybeSingle();
  if (!owner) return json({ error: 'unknown token' }, 404);

  const text = (await readText(req)).trim().slice(0, 2000);
  if (!text) return json({ error: 'empty text' }, 400);
  const parsed = parseCardMessage(text, new Date(Date.now() + 9 * 3600 * 1000)); // KST "today" for messages without a year
  await admin.from('hg_ingest_tokens').update({ last_used_at: new Date().toISOString() }).eq('token', token);
  if (!parsed) return json({ ignored: 'no amount found' });
  if (parsed.incoming) return json({ ignored: 'incoming transfer' });

  const [{ data: cards }, { data: rules }] = await Promise.all([
    admin.from('hg_cards').select('id,name,holder,benefit_note,card_type').eq('family_id', owner.family_id),
    admin.from('hg_category_rules').select('keyword,category,scope').eq('family_id', owner.family_id),
  ]);
  const rule = matchRule(parsed.merchant, rules as { keyword: string; category: string; scope: string | null }[] | null);
  // A cancellation message nets out the matching purchase (same amount, last 60 days, similar merchant or same card digits).
  let cancels: string | null = null;
  if (parsed.cancel) {
    const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const { data: cands } = await admin.from('hg_expenses').select('id,title,raw_text').eq('family_id', owner.family_id).eq('kind', 'expense').eq('amount', Math.abs(parsed.amount)).is('canceled_by', null).gte('date', since).order('date', { ascending: false }).limit(20);
    const norm = (v: string) => v.replace(/\s+/g, '').toLowerCase();
    const key = norm(parsed.merchant).slice(0, 4);
    const hit = (cands ?? []).find(c => (key && norm(c.title).includes(key)) || (parsed.last4 && c.raw_text?.includes(parsed.last4))) ?? (cands ?? [])[0] ?? null;
    cancels = hit?.id ?? null;
  }
  const cardId = matchCard(parsed, (cards ?? []) as Card[]);
  const payment = parsed.channel === 'bank_transfer' ? 'bank_transfer' : cardId ? 'card' : 'other';
  const row = {
    family_id: owner.family_id, created_by: owner.user_id, title: parsed.cancel ? `취소 · ${parsed.merchant}` : parsed.merchant, amount: parsed.amount, date: parsed.date, category: rule?.category ?? parsed.category,
    scope: rule?.scope ?? 'shared', cancels, payment_method: payment, card_id: cardId, source: 'sms', reviewed: false, raw_text: text, fingerprint: fingerprintOf(parsed),
  };
  const inserted = await admin.from('hg_expenses').insert(row).select('id').single();
  if (inserted.error) {
    if (inserted.error.code === '23505') return json({ duplicate: true, summary: describe(parsed) });
    return json({ error: inserted.error.message }, 500);
  }
  if (cancels) await admin.from('hg_expenses').update({ canceled_by: inserted.data.id }).eq('id', cancels);
  await admin.rpc('hg_bump_ingest', { tok: token }).then(() => undefined, () => undefined);
  // Tell the collector's own devices that something is waiting for review (best effort).
  const hook = Deno.env.get('HOOK_SECRET'); const base = Deno.env.get('SUPABASE_URL');
  if (hook && base) fetch(`${base}/functions/v1/push`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-haraguri-secret': hook }, body: JSON.stringify({ kind: 'ingest', user_id: owner.user_id, title: '가계부 자동 등록 · 확인해 주세요', body: describe(parsed), url: '/?tab=money&review=1' }) }).catch(() => undefined);
  return json({ saved: inserted.data.id, summary: describe(parsed), needs_card: payment === 'other' && parsed.channel !== 'bank_transfer' });
});
