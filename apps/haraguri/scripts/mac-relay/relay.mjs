#!/usr/bin/env node
// HARAGURI Mac relay: forwards new payment SMS from the Mac Messages database (iPhone "문자 메시지 전달") to the collect address.
// One pass per run; HaraguriRelay.app (built by install.sh) runs it every 30 seconds. State: ~/.haraguri-relay/.
// Reading ~/Library/Messages/chat.db needs Full Disk Access for the app that launches this script.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const DIR = join(HOME, '.haraguri-relay');
const CONFIG = join(DIR, 'config.json');
const STATE = join(DIR, 'state.json');
const LOG = join(DIR, 'relay.log');
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const PAYMENT = /(승인|출금|결제|취소|이체|송금)/;
const AMOUNT = /(\d{1,3}(?:,\d{3})+|\d+)\s*원|₩\s*[\d,]+|KRW\s*[\d,]+/;

function log(line) { mkdirSync(DIR, { recursive: true }); appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); if (flag('--verbose') || flag('--dry-run')) console.log(line); }
function readJson(path, fallback) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; } }

// Newer macOS stores the body in `attributedBody` (typedstream). The text sits after "NSString" + '+' + length.
export function decodeAttributedBody(hex) {
  if (!hex) return '';
  const buf = Buffer.from(hex, 'hex');
  const marker = buf.indexOf(Buffer.from('NSString'));
  if (marker < 0) return '';
  let i = buf.indexOf(0x2b, marker); // '+'
  if (i < 0) return '';
  i += 1;
  let length = buf[i];
  if (length === 0x81) { length = buf.readUInt16LE(i + 1); i += 3; } else i += 1;
  return buf.subarray(i, i + length).toString('utf8').replace(/\u0000/g, '').trim();
}

function query(db, sql) {
  const out = execFileSync('/usr/bin/sqlite3', ['-json', '-readonly', db, sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.trim() ? JSON.parse(out) : [];
}

async function post(url, text) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, via: 'mac-relay' }) });
  const body = await r.text().catch(() => '');
  return { status: r.status, body: body.slice(0, 200) };
}

async function main() {
  if (flag('--selftest')) {
    const text = '승인 1,000원 동네마트';
    const header = Buffer.from('04 0b 73 74 72 65 61 6d 74 79 70 65 64 81 e8 03 84 01 40 84 84 84 12 4e 53 41 74 74 72 69 62 75 74 65 64 53 74 72 69 6e 67 00 84 84 08 4e 53 4f 62 6a 65 63 74 00 85 92 84 84 84 08 4e 53 53 74 72 69 6e 67 01 94 84 01 2b'.replace(/ /g, ''), 'hex');
    const short = Buffer.concat([header, Buffer.from([Buffer.byteLength(text)]), Buffer.from(text), Buffer.from([0x86])]);
    const long = Buffer.concat([header, Buffer.from([0x81, Buffer.byteLength(text) & 0xff, Buffer.byteLength(text) >> 8]), Buffer.from(text), Buffer.from([0x86])]);
    const a = decodeAttributedBody(short.toString('hex')), b = decodeAttributedBody(long.toString('hex'));
    const ok = a === text && b === text;
    console.log(ok ? 'selftest ok' : `selftest FAILED: ${JSON.stringify([a, b])}`);
    process.exit(ok ? 0 : 1);
  }
  const config = { db: join(HOME, 'Library/Messages/chat.db'), lookbackDays: 2, ...readJson(CONFIG, {}) };
  if (opt('--url')) config.ingestUrl = opt('--url');
  if (opt('--db')) config.db = opt('--db');
  if (!config.ingestUrl) { console.error('수집 주소가 없어요. install.sh "<수집 주소>" 로 설치하거나 --url 로 넘겨 주세요.'); process.exit(2); }
  if (!existsSync(config.db)) { console.error(`메시지 DB가 없어요: ${config.db}`); process.exit(2); }
  const state = readJson(STATE, { lastRowId: 0 });
  let rows;
  try {
    // date is ns since 2001-01-01 on current macOS; older DBs used seconds.
    rows = query(config.db, `select m.ROWID as rowid, m.text as text, hex(m.attributedBody) as body, m.is_from_me as from_me,
      case when m.date > 10000000000 then m.date/1000000000 else m.date end + 978307200 as unix, h.id as sender
      from message m left join handle h on h.ROWID = m.handle_id where m.ROWID > ${Number(state.lastRowId) || 0} order by m.ROWID asc limit 500`);
  } catch (e) {
    const msg = String(e.message || e);
    log(`DB 읽기 실패: ${msg.includes('unable to open') || msg.includes('authorization') ? '전체 디스크 접근 권한이 필요해요 (시스템 설정 → 개인정보 보호 및 보안 → 전체 디스크 접근 → HaraguriRelay 켜기)' : msg}`);
    process.exit(1);
  }
  if (!rows.length) { if (flag('--verbose')) log('새 메시지 없음'); return; }
  const first = !state.lastRowId;
  const cutoff = Date.now() / 1000 - config.lookbackDays * 86400;
  let sent = 0, skipped = 0, last = Number(state.lastRowId) || 0;
  for (const row of rows) {
    const text = (row.text || decodeAttributedBody(row.body) || '').trim();
    const isPayment = !row.from_me && PAYMENT.test(text) && AMOUNT.test(text) && row.unix >= cutoff;
    if (!first && isPayment) {
      if (flag('--dry-run')) { log(`[dry-run] ${row.sender ?? '?'}: ${text.replace(/\s+/g, ' ').slice(0, 80)}`); sent++; }
      else {
        try {
          const r = await post(config.ingestUrl, text);
          log(`${r.status} ${row.sender ?? '?'} ${text.replace(/\s+/g, ' ').slice(0, 40)} → ${r.body}`);
          if (r.status >= 500) break; // server trouble: stop before advancing so this row is retried next pass
          sent++;
        } catch (e) { log(`전송 실패(다음에 재시도): ${e.message}`); break; }
      }
    } else skipped++;
    last = row.rowid;
  }
  if (first) log(`첫 실행: 기존 메시지 ${rows.length}건은 건너뛰고 지금부터 감시해요.`);
  if (!flag('--dry-run')) { state.lastRowId = last; writeFileSync(STATE, JSON.stringify(state)); }
  if (sent || flag('--verbose')) log(`처리: 전송 ${sent}건 · 건너뜀 ${skipped}건`);
}
main().catch(e => { log(`오류: ${e.message}`); process.exit(1); });
