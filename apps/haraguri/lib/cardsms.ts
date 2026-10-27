import type { Card } from './model';
import { categories } from './finance';
import { ParsedCardMessage, guessCategory as coreGuess, parseCardMessage as coreParse } from './cardsms.core';
export { describe, detectChannel, fingerprintOf } from './cardsms.core';
export type { ParsedCardMessage, Channel } from './cardsms.core';

export function guessCategory(merchant: string) {
  const label = coreGuess(merchant);
  return categories.includes(label) ? label : '기타';
}
export function parseCardMessage(raw: string, now = new Date()): ParsedCardMessage | null {
  const parsed = coreParse(raw, now);
  return parsed ? { ...parsed, category: guessCategory(parsed.merchant) } : null;
}

// Pick the family card the message belongs to: last four digits → issuer name → card type → the only card.
export function matchCard(parsed: ParsedCardMessage, cards: Card[]): string | null {
  if (parsed.channel === 'bank_transfer') return null;
  const text = (c: Card) => `${c.name} ${c.holder} ${c.benefit_note ?? ''}`;
  const typed = cards.filter(c => parsed.channel === 'unknown' || (c.card_type ?? 'credit') === (parsed.channel === 'debit' ? 'debit' : 'credit'));
  const pool = typed.length ? typed : cards;
  if (parsed.last4) { const hits = pool.filter(c => text(c).includes(parsed.last4!)); if (hits.length === 1) return hits[0].id; }
  if (parsed.issuer) { const hits = pool.filter(c => text(c).includes(parsed.issuer!)); if (hits.length === 1) return hits[0].id; }
  return pool.length === 1 ? pool[0].id : null;
}
