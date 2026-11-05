// Re-label pay-wallet withdrawals ("[출금] 토스 이름") already saved by the old rule, which called every surname-like name a top-up:
// sent to a family member's own name -> '토스 이체 · 이름' (transfer, 자금 이동); sent to anyone else -> '토스 송금 · 이름' (expense).
// Usage: node --experimental-strip-types scripts/relabel-wallet-transfers.mts [--family 지유네집] [--since 2026-10-30] [--apply]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { walletTransfer } from '../lib/cardsms.core.ts';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const { createClient } = createRequire(`${APP}/package.json`)('@supabase/supabase-js');
const env = (f: string) => Object.fromEntries(readFileSync(`${APP}/${f}`, 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const cfg = { ...env('.env.local'), ...env('.env.supabase-admin') };
const db = createClient(cfg.NEXT_PUBLIC_SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const apply = process.argv.includes('--apply');
const ok = <T,>(r: { data: T | null; error: { message: string } | null }, what: string): T => { if (r.error || r.data == null) throw new Error(`${what}: ${r.error?.message ?? 'no data'}`); return r.data; };

const fam = ok(await db.from('hg_families').select('id').eq('name', arg('--family', '지유네집')).single(), 'family') as { id: string };
const members = ok(await db.from('hg_members').select('user_id,display_name').eq('family_id', fam.id), 'members') as { user_id: string; display_name: string }[];
const ownNames: string[] = [];
for (const m of members) {
  const { data } = await db.auth.admin.getUserById(m.user_id);
  const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
  for (const v of [m.display_name, meta.name, meta.full_name, meta.preferred_username, meta.nickname]) if (typeof v === 'string') ownNames.push(v);
}
console.log('own names:', [...new Set(ownNames)].join(', '));

const rows = ok(await db.from('hg_expenses').select('id,date,amount,title,kind,category,raw_text').eq('family_id', fam.id).like('raw_text', '%[출금]%').gte('date', arg('--since', '2026-10-30')).order('date'), 'rows') as { id: string; date: string; amount: number; title: string; kind: string; category: string; raw_text: string | null }[];
let n = 0;
for (const r of rows) {
  const w = walletTransfer(r.raw_text ?? '', ownNames);
  if (!w) continue;
  const patch = { title: `${w.wallet} ${w.own ? '이체' : '송금'} · ${w.to}`, kind: w.own ? 'transfer' : 'expense', category: w.own ? '자금 이동' : r.category === '자금 이동' ? '기타' : r.category };
  const same = patch.title === r.title && patch.kind === r.kind && patch.category === r.category;
  console.log(same ? '  =' : '  →', r.date, String(r.amount).padStart(7), `${r.title} / ${r.kind} / ${r.category}`, same ? '' : `=> ${patch.title} / ${patch.kind} / ${patch.category}`);
  if (same) continue;
  n++;
  if (apply) { const { error } = await db.from('hg_expenses').update(patch).eq('id', r.id); if (error) console.log('   update failed', error.message); }
}
console.log(apply ? `applied ${n}` : `dry run: ${n} would change (add --apply)`);
