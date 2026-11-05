// Golden-set scoring for the two places HARAGURI turns text into money: card/bank notifications (push · SMS) and
// card-app screenshots read by OCR. Pure functions: golden.test.ts feeds the corpora in golden/*.json through the real
// parsers, scores every case field by field, and blocks any case that used to pass from failing again.
import type { ParsedCardMessage } from './cardsms.core';
import type { OcrRow } from './ocr';

export const MESSAGE_FIELDS = ['amount', 'merchant', 'date', 'time', 'issuer', 'last4', 'cancel', 'installment', 'category', 'channel', 'incoming'] as const;
export type MessageField = (typeof MESSAGE_FIELDS)[number];
export type MessageExpect = Partial<Pick<ParsedCardMessage, MessageField>>;
/** One notification as the ingest function sees it. `expect: null` means "not a payment — must not be saved". */
export type MessageCase = { id: string; kind: string; note?: string; now: string; app?: string; nfd?: boolean; text: string; expect: MessageExpect | null };
export type ScreenRow = Pick<OcrRow, 'date' | 'merchant' | 'amount' | 'cancel'>;
/** OCR text of one 이용내역 screenshot and the rows a person would import from it. */
export type ScreenCase = { id: string; app: string; note?: string; now: string; text: string; expect: ScreenRow[] };

export type Tally = Record<string, { right: number; total: number }>;
export type CaseResult = { id: string; corpus: 'messages' | 'screens'; pass: boolean; misses: string[]; local?: boolean };

const norm = (v: unknown) => (typeof v === 'string' ? v.normalize('NFC').replace(/\s+/g, ' ').trim() : v);
const show = (v: unknown) => (v === undefined ? '없음' : v === null ? 'null' : typeof v === 'string' ? `'${v}'` : String(v));
const bump = (tally: Tally, field: string, ok: boolean) => {
  const t = (tally[field] ??= { right: 0, total: 0 });
  t.total += 1; if (ok) t.right += 1;
};

/** Score one notification. Only the fields written in `expect` are checked, so a case can pin just what matters. */
export function scoreMessage(c: MessageCase, parsed: ParsedCardMessage | null, tally: Tally): CaseResult {
  const misses: string[] = [];
  if (c.expect === null) {
    bump(tally, 'reject', parsed === null);
    if (parsed) misses.push(`거래가 아닌데 ${parsed.amount}원 '${parsed.merchant}'(으)로 저장됨`);
    return { id: c.id, corpus: 'messages', pass: misses.length === 0, misses };
  }
  bump(tally, 'detect', parsed !== null);
  if (!parsed) misses.push('거래를 읽지 못함');
  for (const field of MESSAGE_FIELDS) {
    if (!(field in c.expect)) continue;
    const want = norm(c.expect[field]);
    const got = parsed ? norm(parsed[field]) : undefined;
    const ok = parsed !== null && got === want;
    bump(tally, field, ok);
    if (parsed && !ok) misses.push(`${field}: ${show(got)} → 정답 ${show(want)}`);
  }
  return { id: c.id, corpus: 'messages', pass: misses.length === 0, misses };
}

/**
 * Score one screenshot. Expected rows are matched to parsed rows by amount (and date when it agrees), then
 * date/merchant/cancel are compared. Rows nobody expected count against the case: an imported 잔액 or 결제예정 line is a bug.
 */
export function scoreScreen(c: ScreenCase, parsed: OcrRow[], tally: Tally): CaseResult {
  const misses: string[] = [];
  const used = new Set<number>();
  for (const want of c.expect) {
    let at = parsed.findIndex((r, i) => !used.has(i) && r.amount === want.amount && r.date === want.date);
    if (at < 0) at = parsed.findIndex((r, i) => !used.has(i) && r.amount === want.amount);
    bump(tally, 'row', at >= 0);
    if (at < 0) { misses.push(`못 찾은 줄: ${want.date} '${want.merchant}' ${want.amount}원`); continue; }
    used.add(at);
    const got = parsed[at];
    for (const field of ['date', 'merchant', 'cancel'] as const) {
      const ok = norm(got[field]) === norm(want[field]);
      bump(tally, field, ok);
      if (!ok) misses.push(`${want.amount}원 ${field}: ${show(norm(got[field]))} → 정답 ${show(norm(want[field]))}`);
    }
  }
  parsed.forEach((r, i) => {
    if (used.has(i)) return;
    bump(tally, 'extra', false);
    misses.push(`없어야 할 줄: ${r.date} '${r.merchant}' ${r.amount}원 ← "${r.raw}"`);
  });
  return { id: c.id, corpus: 'screens', pass: misses.length === 0, misses };
}

export const percent = (t: { right: number; total: number }) => (t.total ? Math.round((t.right / t.total) * 1000) / 10 : 100);
/** 'extra' (rows nobody expected) is a count, everything else a percentage. */
const figure = (field: string, t: { right: number; total: number }) => (field === 'extra' ? t.total : percent(t));
const label = (field: string, value: number) => (field === 'extra' ? `없어야 할 줄 ${value}건` : `${field} ${value}%`);

export type Baseline = { updated: string; passed: { messages: string[]; screens: string[] }; accuracy: Record<string, Record<string, number>> };

/** Cases that passed in the baseline but fail now. New cases never count as regressions until the baseline is updated. */
export function regressions(results: CaseResult[], baseline: Baseline | null): CaseResult[] {
  if (!baseline) return [];
  const before = new Set([...baseline.passed.messages.map(id => `messages:${id}`), ...baseline.passed.screens.map(id => `screens:${id}`)]);
  return results.filter(r => !r.local && !r.pass && before.has(`${r.corpus}:${r.id}`));
}

export function toBaseline(results: CaseResult[], tallies: Record<'messages' | 'screens', Tally>, updated: string): Baseline {
  const passed = (corpus: 'messages' | 'screens') => results.filter(r => r.corpus === corpus && r.pass && !r.local).map(r => r.id).sort();
  const accuracy = Object.fromEntries(Object.entries(tallies).map(([k, t]) => [k, Object.fromEntries(Object.entries(t).map(([f, v]) => [f, figure(f, v)]))]));
  return { updated, passed: { messages: passed('messages'), screens: passed('screens') }, accuracy };
}

/** Plain-text report for `npm run golden`: per-field accuracy, then every failing case with what went wrong. */
export function formatReport(results: CaseResult[], tallies: Record<'messages' | 'screens', Tally>, baseline: Baseline | null): string {
  const lines: string[] = [];
  const known = baseline ? new Set([...baseline.passed.messages.map(id => `messages:${id}`), ...baseline.passed.screens.map(id => `screens:${id}`)]) : null;
  for (const corpus of ['messages', 'screens'] as const) {
    const rs = results.filter(r => r.corpus === corpus);
    const pass = rs.filter(r => r.pass).length;
    lines.push(`■ ${corpus === 'messages' ? '알림·문자' : '이용내역 캡처'}: ${pass}/${rs.length} 통과${rs.some(r => r.local) ? ` (로컬 실데이터 ${rs.filter(r => r.local).length}건 포함)` : ''}`);
    const fields = Object.entries(tallies[corpus]).map(([f, t]) => {
      const was = baseline?.accuracy[corpus]?.[f];
      const now = figure(f, t);
      return `${label(f, now)}${was !== undefined && was !== now ? `(기준 ${f === 'extra' ? `${was}건` : `${was}%`})` : ''}`;
    });
    lines.push(`  항목별 정확도: ${fields.join(' · ')}`);
    for (const r of rs.filter(x => !x.pass)) {
      const tag = r.local ? '[로컬]' : known && known.has(`${corpus}:${r.id}`) ? '[회귀!]' : '[알려진 실패]';
      lines.push(`  ${tag} ${r.id}`);
      for (const m of r.misses) lines.push(`      - ${m}`);
    }
  }
  return lines.join('\n');
}
