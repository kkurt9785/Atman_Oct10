// Re-file collected rows by title for one family: node --experimental-strip-types scripts/mark-category.mts --family 지유네집 --title 카카오페이 --since 2026-11-03 --category 투자 [--apply]
// 투자 also flips kind to 'transfer' (excluded from spending); any other category flips a 투자 row back to 'expense'. Dry run by default.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const APP = '/Users/kihankim/atman/apps/haraguri';
const { createClient } = createRequire(`${APP}/package.json`)('@supabase/supabase-js');
const env = (f: string) => Object.fromEntries(readFileSync(`${APP}/${f}`, 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const cfg = { ...env('.env.local'), ...env('.env.supabase-admin') };
const db = createClient(cfg.NEXT_PUBLIC_SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const arg = (k: string, d = '') => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const apply = process.argv.includes('--apply');
const familyName = arg('family', '지유네집'), title = arg('title'), since = arg('since', '1970-01-01'), until = arg('until', '2999-12-31'), category = arg('category');
if (!title || !category) { console.error('usage: --title <contains> --category <name> [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--family name] [--apply]'); process.exit(2); }
const ok = (r: any, s: string) => { if (r.error) throw new Error(`${s}: ${r.error.message}`); return r.data; };
const fam = ok(await db.from('hg_families').select('id').eq('name', familyName).single(), 'family');
const rows = ok(await db.from('hg_expenses').select('id,title,category,kind,date,amount').eq('family_id', fam.id).gte('date', since).lte('date', until).ilike('title', `%${title}%`).order('date'), 'rows');
const patch = (e: any) => ({ category, ...(category === '투자' ? { kind: 'transfer' } : e.kind === 'transfer' && e.category === '투자' ? { kind: 'expense' } : {}) });
console.log(`${familyName} · "${title}" ${since}~${until} · ${rows.length}건`);
for (const e of rows) console.log(`  ${e.date} ${e.title} ${Number(e.amount).toLocaleString('ko-KR')}원 · ${e.category}/${e.kind ?? 'expense'} → ${JSON.stringify(patch(e))}`);
if (!apply) { console.log('(dry run — add --apply)'); process.exit(0); }
for (const e of rows) ok(await db.from('hg_expenses').update(patch(e)).eq('id', e.id), `update ${e.id}`);
console.log(`applied ${rows.length}`);
