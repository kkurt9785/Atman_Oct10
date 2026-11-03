import { categories, learnKeyword } from './finance';
import { guessCategory, matchRule } from './cardsms.core';
import type { CategoryRule, Expense } from './model';

// One-tap classification for collected payments: three likely categories per row, and "same merchant" grouping so
// one tap settles every open row from that shop (11/3 audit: 16 of 24 auto rows sat in 기타 behind a 4-tap edit modal).
const AUTO = ['push', 'sms', 'ocr'];
const spend = (x: Expense) => (x.kind ?? 'expense') === 'expense' && !x.canceled_by;
const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const countBy = (values: string[]) => [...values.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);

export function sameMerchant(a: Expense, b: Expense) {
  const k = learnKeyword(a.title);
  return k.length >= 2 && norm(b.title).includes(k);
}

// Reviewed rows the parser left in 기타: already "confirmed" but still unreadable in reports.
export function unclassifiedExpenses(all: Expense[]) {
  return all.filter(x => spend(x) && x.reviewed !== false && x.category === '기타' && AUTO.includes(x.source ?? ''));
}

// Rows a chosen category should also settle: open or still-기타 rows from the same merchant.
export function sameMerchantTargets(e: Expense, all: Expense[]) {
  return all.filter(x => x.id !== e.id && spend(x) && sameMerchant(e, x) && (x.reviewed === false || (x.category === '기타' && AUTO.includes(x.source ?? ''))));
}

export function suggestCategories(e: Expense, all: Expense[], rules: CategoryRule[], n = 3): string[] {
  const out: string[] = [];
  const add = (c?: string | null) => { if (c && c !== '기타' && categories.includes(c) && !out.includes(c)) out.push(c); };
  if (e.category !== '기타') add(e.category);                       // what the parser or a person already chose
  add(matchRule(e.title, rules)?.category);                          // a rule the family taught
  const peers = all.filter(x => x.id !== e.id && spend(x) && x.category !== '기타' && sameMerchant(e, x));
  for (const [c] of countBy(peers.map(x => x.category))) add(c);     // how this merchant was filed before
  add(guessCategory(e.title));                                       // merchant-word heuristics
  for (const [c] of countBy(all.filter(x => spend(x) && x.category !== '기타').map(x => x.category))) { if (out.length >= n) break; add(c); }
  for (const c of ['식비', '생활', '쇼핑', '교통']) { if (out.length >= n) break; add(c); }
  return out.slice(0, n);
}
