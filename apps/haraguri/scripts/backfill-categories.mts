// Backfill for 지유네집: re-read collected rows with the current parser so titles/categories match it (dry run unless --apply).
// Only rows the parser produced (source push/sms) and whose current title is still the parser's old guess or whose category is 기타/식비.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { guessCategory, matchRule, parseCardMessage } from '/Users/kihankim/atman/apps/haraguri/lib/cardsms.core.ts';
const APP = '/Users/kihankim/atman/apps/haraguri';
const { createClient } = createRequire(`${APP}/package.json`)('@supabase/supabase-js');
const env = (f: string) => Object.fromEntries(readFileSync(`${APP}/${f}`, 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const cfg = { ...env('.env.local'), ...env('.env.supabase-admin') };
const db = createClient(cfg.NEXT_PUBLIC_SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const apply = process.argv.includes('--apply');
const ok = (r: any, s: string) => { if (r.error) throw new Error(`${s}: ${r.error.message}`); return r.data; };
const fam = ok(await db.from('hg_families').select('id').eq('name', '지유네집').single(), 'family');
const rules = ok(await db.from('hg_category_rules').select('id,keyword,category').eq('family_id', fam.id), 'rules');
const rows = ok(await db.from('hg_expenses').select('id,title,category,kind,source,raw_text,date,amount,reviewed').eq('family_id', fam.id).order('date'), 'expenses');
const COFFEE = /카페|커피|coffee|cafe|스타벅스|투썸|빽다방|바나프레소|메가커피|컴포즈|이디야|할리스|폴바셋|텐퍼센트|파스쿠찌|공차|던킨|배스킨|설빙|베이커리|빵|파리바게뜨|뚜레쥬르|와플|디저트|케이크|도넛|마카롱|빙수/i;
const plan: { id: string; from: string; to: { title?: string; category?: string } }[] = [];
for (const e of rows) {
  if ((e.kind ?? 'expense') !== 'expense' || !['push', 'sms'].includes(e.source ?? '') || !e.raw_text) continue;
  const p = parseCardMessage(e.raw_text, new Date(`${e.date}T12:00:00`));
  const to: { title?: string; category?: string } = {};
  // Title: replace parser leftovers (phone numbers, 'WON뱅킹 입', bare bank words) with the merchant the parser reads now.
  if (p && p.merchant !== e.title && (/^[\d\-*]+$/.test(e.title) || /^(WON뱅킹 입|MG|계좌이체)$/.test(e.title))) to.title = p.merchant;
  const title = to.title ?? e.title;
  const rule = matchRule(title, rules as { keyword: string; category: string }[]);
  const guess = rule?.category ?? guessCategory(title);
  // Category: only rows the family never filed deliberately (still unreviewed, or left in 기타) and coffee rows that sat in 식비 before 카페 existed.
  if (guess !== e.category && (e.reviewed === false || e.category === '기타' || (e.category === '식비' && COFFEE.test(title)))) to.category = guess;
  if (Object.keys(to).length) plan.push({ id: e.id, from: `${e.title} · ${e.category}`, to });
}
console.log(`rows ${rows.length} · changes ${plan.length}`);
for (const c of plan) console.log(`  ${c.from}  →  ${[c.to.title && `제목 ${c.to.title}`, c.to.category && `분류 ${c.to.category}`].filter(Boolean).join(' · ')}`);
const coffeeRules = rules.filter((r: any) => COFFEE.test(r.keyword) && r.category !== '카페');
console.log('rules → 카페:', coffeeRules.map((r: any) => `${r.keyword}(${r.category})`));
if (!apply) { console.log('(dry run)'); process.exit(0); }
for (const c of plan) ok(await db.from('hg_expenses').update(c.to).eq('id', c.id), `update ${c.id}`);
for (const r of coffeeRules) ok(await db.from('hg_category_rules').update({ category: '카페' }).eq('id', r.id), `rule ${r.keyword}`);
console.log(`applied ${plan.length} rows, ${coffeeRules.length} rules`);
