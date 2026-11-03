// HARAGURI auto-collect endpoint. Phone automations (iOS 단축어, MacroDroid) POST a payment message here with a per-member token.
// The message is parsed server-side and saved as an expense awaiting review (reviewed=false). Duplicates are ignored by fingerprint.
//   POST /functions/v1/ingest?token=…   body: {"text": "..."} or {"title","subtitle","body","app","via"} | text/plain | form field "text"   (or header x-ingest-token)
//   Every delivery is recorded in hg_inbox with its outcome (saved / duplicate / ignored / unparsed).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { describe, fingerprintOf, parseCardMessage, type ParsedCardMessage, matchRule, nonTransactionReason, selfTransferWallet } from '../_shared/cardsms.core.ts';

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

type Payload = { text: string; via: string; app: string; structured: boolean };
async function readText(req: Request): Promise<Payload> {
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    // v2: notification triggers send title/subtitle/body separately; v1 senders send one text.
    const parts = [b.title, b.subtitle, b.body].filter(v => typeof v === 'string' && v.trim()).map(v => String(v).trim());
    const text = parts.length ? parts.join('\n') : String(b.text ?? b.message ?? b.content ?? '');
    return { text, via: String(b.via ?? ''), app: String(b.app ?? ''), structured: parts.length > 0 };
  }
  if (type.includes('form')) { const f = await req.formData().catch(() => null); return { text: String(f?.get('text') ?? f?.get('message') ?? ''), via: String(f?.get('via') ?? ''), app: String(f?.get('app') ?? ''), structured: false }; }
  return { text: await req.text(), via: req.headers.get('x-haraguri-via') ?? '', app: '', structured: false };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const token = new URL(req.url).searchParams.get('token') ?? req.headers.get('x-ingest-token');
  if (!token || token.length < 16) return json({ error: 'token required' }, 401);
  const { data: owner } = await admin.from('hg_ingest_tokens').select('family_id,user_id').eq('token', token).maybeSingle();
  if (!owner) return json({ error: 'unknown token' }, 404);

  const payload = await readText(req);
  const text = payload.text.trim().slice(0, 2000);
  // Only the iOS notification trigger sends title/body separately, so structured input without a label means an iPhone Shortcut.
  const via = (payload.via || (payload.structured ? 'ios-shortcut' : '')).slice(0, 40), app = payload.app.slice(0, 120);
  const inbox = async (status: 'saved' | 'duplicate' | 'ignored' | 'unparsed', summary: string, expense_id: string | null = null) => {
    const result = await admin.from('hg_inbox').insert({ family_id: owner.family_id, user_id: owner.user_id, via, app, raw: text, status, summary: summary.slice(0, 200), expense_id });
    if (result.error) throw new Error('Unable to record notification delivery');
  };
  await admin.from('hg_ingest_tokens').update({ last_used_at: new Date().toISOString() }).eq('token', token);
  // An empty delivery still gets an inbox row: it proves the phone automation fired but passed nothing (e.g. a trigger not wired to the body field).
  if (!text) { await inbox('unparsed', '빈 전달 · 자동화는 실행됐지만 내용이 비어 있음'); return json({ error: 'empty text', inbox: 'unparsed' }, 400); }
  if (via === 'test' || /하라구리 연결 테스트/.test(text)) { await inbox('ignored', '연결 테스트 ✓'); return json({ test: true, inbox: 'ignored' }); }
  // The source app name helps name the card company when the push body itself does not (e.g. 토스·카카오페이 pushes).
  // Source label below: 'Web발신' marks a real SMS even when the shared shortcut sends it as {body}; other structured input is an app push.
  const paymentText = app ? `${app} ${text}` : text;
  const ignoreReason = nonTransactionReason(paymentText);
  if (ignoreReason) { await inbox('ignored', ignoreReason); return json({ ignored: 'benefit notice', inbox: 'ignored' }); }
  const parsed = parseCardMessage(paymentText, new Date(Date.now() + 9 * 3600 * 1000)); // KST "today" for messages without a year
  if (!parsed) {
    // Marketing pushes that quote no money at all are noise, not parser failures; 'unparsed' stays reserved for texts with an amount we failed to read.
    const quotesMoney = /\d[\d,]*\s*원|₩|KRW/i.test(text);
    await inbox(quotesMoney ? 'unparsed' : 'ignored', quotesMoney ? '금액을 찾지 못함' : '금액 없는 알림');
    return json({ ignored: 'no amount found', inbox: quotesMoney ? 'unparsed' : 'ignored' });
  }
  if (parsed.incoming) { await inbox('ignored', '입금 알림'); return json({ ignored: 'incoming transfer', inbox: 'ignored' }); }

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
    const hit = (cands ?? []).find(c => (key && norm(c.title).includes(key)) || (parsed.last4 && c.raw_text?.includes(parsed.last4))) ?? null;
    cancels = hit?.id ?? null;
  }
  const cardId = matchCard(parsed, (cards ?? []) as Card[]);
  const payment = parsed.channel === 'bank_transfer' ? 'bank_transfer' : cardId ? 'card' : 'other';
  // Topping up the family's own pay wallet (토스 김기한) is a transfer between pockets; it still lands in review so it can be corrected.
  const wallet = selfTransferWallet(text);
  const row = {
    family_id: owner.family_id, created_by: owner.user_id, title: parsed.cancel ? `취소 · ${parsed.merchant}` : wallet ? `${wallet} 충전` : parsed.merchant, amount: parsed.amount, date: parsed.date, category: rule?.category ?? parsed.category,
    kind: wallet ? 'transfer' : 'expense', scope: rule?.scope ?? 'shared', cancels, payment_method: payment, card_id: cardId, source: /Web발신/i.test(text) ? 'sms' : payload.structured || /notif|push|android/i.test(via) ? 'push' : 'sms', reviewed: false, raw_text: text, fingerprint: fingerprintOf(parsed),
  };
  const inserted = await admin.from('hg_expenses').insert(row).select('id').single();
  if (inserted.error) {
    if (inserted.error.code === '23505') { await inbox('duplicate', describe(parsed)); return json({ duplicate: true, summary: describe(parsed) }); }
    await inbox('unparsed', `저장 실패: ${inserted.error.message}`.slice(0, 200));
    return json({ error: inserted.error.message }, 500);
  }
  await inbox('saved', describe(parsed), inserted.data.id);
  if (cancels) await admin.from('hg_expenses').update({ canceled_by: inserted.data.id }).eq('id', cancels);
  await admin.rpc('hg_bump_ingest', { tok: token }).then(() => undefined, () => undefined);
  // Tell the collector's own devices that something is waiting for review (best effort).
  const hook = Deno.env.get('HOOK_SECRET'); const base = Deno.env.get('SUPABASE_URL');
  if (hook && base) fetch(`${base}/functions/v1/push`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-haraguri-secret': hook }, body: JSON.stringify({ kind: 'ingest', user_id: owner.user_id, title: '가계부 자동 등록 · 확인해 주세요', body: describe(parsed), url: '/?tab=money&review=1' }) }).catch(() => undefined);
  return json({ saved: inserted.data.id, summary: describe(parsed), needs_card: payment === 'other' && parsed.channel !== 'bank_transfer' });
});
