// Golden-set gate (2026-11-05). Every case in golden/messages.json and golden/screens.json goes through the same parsing
// the product uses, and any case recorded as passing in golden/baseline.json must keep passing.
//   npm run golden          → accuracy report + every failing case
//   npm run golden:update   → accept the current results as the new baseline (after fixing or adding cases)
// Real notifications copied from the 수집함 can be dropped into golden/local/*.json ({ "messages": [...], "screens": [...] });
// they are gitignored, show up in the report, and never block the test.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { nonTransactionReason, parseCardMessage } from './cardsms.core';
import { parseOcrText } from './ocr';
import {
  MESSAGE_FIELDS, formatReport, regressions, scoreMessage, scoreScreen, toBaseline,
  type Baseline, type CaseResult, type MessageCase, type ScreenCase, type Tally,
} from './golden';

const dir = new URL('../golden/', import.meta.url);
const readJson = <T,>(url: URL): T => JSON.parse(readFileSync(url, 'utf8')) as T;
const committed = {
  messages: readJson<{ cases: MessageCase[] }>(new URL('messages.json', dir)).cases,
  screens: readJson<{ cases: ScreenCase[] }>(new URL('screens.json', dir)).cases,
};
const baselineUrl = new URL('baseline.json', dir);
const baseline = existsSync(baselineUrl) ? readJson<Baseline>(baselineUrl) : null;

function localCases() {
  const out = { messages: [] as MessageCase[], screens: [] as ScreenCase[] };
  const localDir = new URL('local/', dir);
  if (!existsSync(localDir)) return out;
  for (const name of readdirSync(localDir).filter(n => n.endsWith('.json'))) {
    const file = readJson<{ messages?: MessageCase[]; screens?: ScreenCase[] }>(new URL(name, localDir));
    out.messages.push(...(file.messages ?? []));
    out.screens.push(...(file.screens ?? []));
  }
  return out;
}

/** Same order as supabase/functions/ingest: app name in front, benefit/ad notices dropped before parsing. */
export function ingestParse(c: MessageCase) {
  const body = c.nfd ? c.text.normalize('NFD') : c.text;
  const text = c.app ? `${c.app} ${body}` : body;
  return nonTransactionReason(text) ? null : parseCardMessage(text, new Date(c.now));
}

function runAll() {
  const tallies: Record<'messages' | 'screens', Tally> = { messages: {}, screens: {} };
  const scratch: Tally = {}; // local cases are reported but kept out of the committed accuracy figures
  const local = localCases();
  const results: CaseResult[] = [
    ...committed.messages.map(c => scoreMessage(c, ingestParse(c), tallies.messages)),
    ...local.messages.map(c => ({ ...scoreMessage(c, ingestParse(c), scratch), local: true })),
    ...committed.screens.map(c => scoreScreen(c, parseOcrText(c.text, new Date(c.now)), tallies.screens)),
    ...local.screens.map(c => ({ ...scoreScreen(c, parseOcrText(c.text, new Date(c.now)), scratch), local: true })),
  ];
  return { results, tallies };
}

describe('golden set: notifications and 이용내역 screenshots', () => {
  const { results, tallies } = runAll();

  it('has well-formed cases with unique ids', () => {
    for (const [name, cases] of Object.entries(committed)) {
      const ids = cases.map(c => c.id);
      expect(new Set(ids).size, `${name}: duplicate id`).toBe(ids.length);
      for (const c of cases) expect(Number.isNaN(new Date(c.now).getTime()), `${c.id}: bad now`).toBe(false);
    }
    for (const c of committed.messages) {
      if (c.expect === null) continue;
      for (const key of Object.keys(c.expect)) expect(MESSAGE_FIELDS as readonly string[], `${c.id}: unknown field ${key}`).toContain(key);
    }
    for (const c of committed.screens) expect(c.expect.length, `${c.id}: no expected rows`).toBeGreaterThan(0);
  });

  it('keeps every case that passed in the baseline passing', () => {
    const broken = regressions(results, baseline);
    if (process.env.GOLDEN_UPDATE) {
      writeFileSync(baselineUrl, JSON.stringify(toBaseline(results, tallies, new Date().toISOString().slice(0, 10)), null, 2) + '\n');
    }
    if (process.env.GOLDEN_REPORT || broken.length) console.log(`\n${formatReport(results, tallies, baseline)}\n`);
    if (!baseline && !process.env.GOLDEN_UPDATE) console.log('golden/baseline.json 이 없습니다. npm run golden:update 로 기준을 만드세요.');
    expect(broken.map(r => `${r.corpus}/${r.id}: ${r.misses.join(' · ')}`)).toEqual([]);
  });
});
