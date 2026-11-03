import { parseCardMessage } from './cardsms';
import type { Card, Expense } from './model';

// Cards the phone has already reported (issuer / last four digits in the message) that the family never registered.
// Registering one makes every later payment attach by itself; until then card budgets, performance and benefits sit idle.
export type CardSuggestion = { key: string; name: string; card_type: 'credit' | 'debit'; issuer?: string; last4?: string; expenseIds: string[] };

// Strict version of matchCard: digits or issuer only, never "the family's only card".
function strictMatch(p: { issuer?: string; last4?: string }, cards: Card[]): string | null {
  const text = (c: Card) => `${c.name} ${c.holder} ${c.benefit_note ?? ''}`;
  if (p.last4) { const hits = cards.filter(c => text(c).includes(p.last4!)); if (hits.length === 1) return hits[0].id; }
  if (p.issuer) { const hits = cards.filter(c => text(c).includes(p.issuer!)); if (hits.length === 1) return hits[0].id; }
  return null;
}

export function suggestCards(expenses: Expense[], cards: Card[]): CardSuggestion[] {
  const out = new Map<string, CardSuggestion>();
  for (const e of expenses) {
    if (e.card_id || !e.raw_text || e.canceled_by || (e.kind ?? 'expense') !== 'expense') continue;
    const p = parseCardMessage(e.raw_text);
    if (!p || p.channel === 'bank_transfer' || (!p.issuer && !p.last4) || strictMatch(p, cards)) continue;
    const card_type: 'credit' | 'debit' = p.channel === 'debit' ? 'debit' : 'credit';
    const key = `${p.issuer ?? ''}|${p.last4 ?? ''}|${card_type}`;
    const name = `${p.issuer ?? ''}${card_type === 'debit' ? ' 체크' : ''}카드${p.last4 ? `(${p.last4})` : ''}`.trim();
    const s = out.get(key) ?? { key, name, card_type, issuer: p.issuer, last4: p.last4, expenseIds: [] };
    s.expenseIds.push(e.id); out.set(key, s);
  }
  return [...out.values()].sort((a, b) => b.expenseIds.length - a.expenseIds.length);
}
