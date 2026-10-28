#!/usr/bin/env node
// HARAGURI Mac relay: forwards new payment SMS from the Mac Messages database (iPhone "문자 메시지 전달") and payment pushes from
// iPhone notifications mirrored to the Mac notification center (iOS 18 + macOS 15 "iPhone 알림 허용") to the collect address.
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

async function post(url, text, via = 'mac-relay-sms', app = '') {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, via, app }) });
  const body = await r.text().catch(() => '');
  return { status: r.status, body: body.slice(0, 200) };
}

const NOTIF_DB = join(HOME, 'Library/Group Containers/group.com.apple.usernoted/db2/db');
// Notification payloads are binary plists; macOS ships python3 with plistlib, so decode a batch there (title/subtitle/body only).
export function decodePlists(hexes) {
  if (!hexes.length) return [];
  const py = `import sys,json,plistlib,binascii
out=[]
for line in sys.stdin:
    h=line.strip()
    if not h: continue
    try:
        p=plistlib.loads(binascii.unhexlify(h))
        req=p.get('req',{}) if isinstance(p,dict) else {}
        out.append({'title':str(req.get('titl','') or ''),'subtitle':str(req.get('subt','') or ''),'body':str(req.get('body','') or '')})
    except Exception as e:
        out.append({'title':'','subtitle':'','body':'','err':str(e)[:60]})
print(json.dumps(out,ensure_ascii=False))`;
  const out = execFileSync('/usr/bin/python3', ['-c', py], { input: hexes.join('\n'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}
// Payment pushes from card apps (mirrored from the iPhone) are forwarded exactly like SMS. First run only remembers the newest id.
async function scanNotifications(config, state, status) {
  if (!existsSync(NOTIF_DB)) { status.notif = { available: false, reason: 'no notification db' }; return 0; }
  let rows;
  try {
    if (!state.lastNotifId) {
      const newest = Number(query(NOTIF_DB, 'select coalesce(max(rec_id), 0) as m from record')[0]?.m) || 0;
      state.lastNotifId = newest; status.notif = { available: true, newestId: newest, apps: [] };
      log(`알림 첫 실행: 기존 알림은 건너뛰고 지금부터 감시해요 (기준 #${newest}).`);
      return 0;
    }
    rows = query(NOTIF_DB, `select r.rec_id as id, a.identifier as app, hex(r.data) as data from record r join app a on a.app_id = r.app_id where r.rec_id > ${Number(state.lastNotifId) || 0} order by r.rec_id asc limit 200`);
  } catch (e) { status.notif = { available: false, reason: String(e.message || e).slice(0, 120) }; return 0; }
  const apps = new Set(status.notif?.apps ?? []);
  try {
    const top = query(NOTIF_DB, 'select a.identifier as app, count(*) as n, max(r.rec_id) as last from record r join app a on a.app_id = r.app_id group by a.identifier order by last desc limit 15');
    const eco = query(NOTIF_DB, "select hex(r.data) as data from record r join app a on a.app_id = r.app_id where a.identifier = 'com.apple.ecosystem.notifications' order by r.rec_id desc limit 3");
    const ecoDecoded = eco.length ? decodePlists(eco.map(r => r.data)).map(d => ({ title: (d.title || '').slice(0, 12), subtitle: (d.subtitle || '').slice(0, 12), bodyChars: (d.body || '').length })) : [];
    // Content-free look at the newest KakaoTalk(Mac) notifications: card companies can send approval alerts as 알림톡, which land here.
    const kakao = query(NOTIF_DB, "select hex(r.data) as data from record r join app a on a.app_id = r.app_id where a.identifier = 'com.kakao.kakaotalkmac' order by r.rec_id desc limit 8");
    const kakaoDecoded = kakao.length ? decodePlists(kakao.map(r => r.data)).map(d => { const t = [d.title, d.subtitle, d.body].filter(Boolean).join(' '); return { titleChars: (d.title || '').length, bodyChars: (d.body || '').length, payment: PAYMENT.test(t) && AMOUNT.test(t), preview: (d.body || '').length > 0 }; }) : [];
    status.notif = { ...(status.notif || {}), topApps: top, ecosystemRecent: ecoDecoded, kakaoRecent: kakaoDecoded };
  } catch (e) { status.notif = { ...(status.notif || {}), diagError: String(e.message || e).slice(0, 100) }; }
  if (!rows.length) { status.notif = { ...(status.notif || {}), available: true, lastScan: new Date().toISOString() }; return 0; }
  const decoded = decodePlists(rows.map(r => r.data));
  let sent = 0;
  const recent = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], d = decoded[i] || {};
    apps.add(r.app);
    const text = [d.title, d.subtitle, d.body].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const isPayment = PAYMENT.test(text) && AMOUNT.test(text);
    recent.push({ id: r.id, app: r.app, chars: text.length, payment: isPayment });
    if (isPayment) {
      if (flag('--dry-run')) { log(`[dry-run][알림 ${r.app}] ${text.slice(0, 80)}`); sent++; }
      else {
        try { const res = await post(config.ingestUrl, text, 'mac-relay-notif', r.app); log(`${res.status} [알림 ${r.app}] ${text.slice(0, 40)} → ${res.body}`); if (res.status >= 500) break; sent++; }
        catch (e) { log(`알림 전송 실패(다음에 재시도): ${e.message}`); break; }
      }
    }
    state.lastNotifId = r.id;
  }
  status.notif = { available: true, newestId: state.lastNotifId, apps: [...apps].slice(-30), recent: recent.slice(-10), lastScan: new Date().toISOString() };
  return sent;
}

async function main() {
  if (flag('--selftest')) {
    const text = '승인 1,000원 동네마트';
    const header = Buffer.from('04 0b 73 74 72 65 61 6d 74 79 70 65 64 81 e8 03 84 01 40 84 84 84 12 4e 53 41 74 74 72 69 62 75 74 65 64 53 74 72 69 6e 67 00 84 84 08 4e 53 4f 62 6a 65 63 74 00 85 92 84 84 84 08 4e 53 53 74 72 69 6e 67 01 94 84 01 2b'.replace(/ /g, ''), 'hex');
    const short = Buffer.concat([header, Buffer.from([Buffer.byteLength(text)]), Buffer.from(text), Buffer.from([0x86])]);
    const long = Buffer.concat([header, Buffer.from([0x81, Buffer.byteLength(text) & 0xff, Buffer.byteLength(text) >> 8]), Buffer.from(text), Buffer.from([0x86])]);
    const a = decodeAttributedBody(short.toString('hex')), b = decodeAttributedBody(long.toString('hex'));
    let plistOk = false;
    try { const hex = execFileSync('/usr/bin/python3', ['-c', "import plistlib,binascii;print(binascii.hexlify(plistlib.dumps({'req':{'titl':'신한카드','body':'승인 1,000원 테스트'}},fmt=plistlib.FMT_BINARY)).decode())"], { encoding: 'utf8' }).trim(); const d = decodePlists([hex])[0]; plistOk = d.title === '신한카드' && d.body === '승인 1,000원 테스트'; } catch (e) { console.log('plist selftest error', e.message); }
    const ok = a === text && b === text && plistOk;
    console.log(ok ? 'selftest ok' : `selftest FAILED: ${JSON.stringify([a, b, plistOk])}`);
    process.exit(ok ? 0 : 1);
  }
  const config = { db: join(HOME, 'Library/Messages/chat.db'), lookbackDays: 2, ...readJson(CONFIG, {}) };
  if (opt('--url')) config.ingestUrl = opt('--url');
  if (opt('--db')) config.db = opt('--db');
  if (!config.ingestUrl) { console.error('수집 주소가 없어요. install.sh "<수집 주소>" 로 설치하거나 --url 로 넘겨 주세요.'); process.exit(2); }
  if (!existsSync(config.db)) { console.error(`메시지 DB가 없어요: ${config.db}`); process.exit(2); }
  const state = readJson(STATE, { lastRowId: 0 });
  const read = sql => {
    try { return query(config.db, sql); } catch (e) {
      const msg = String(e.message || e);
      log(`DB 읽기 실패: ${msg.includes('unable to open') || msg.includes('authorization') ? '전체 디스크 접근 권한이 필요해요 (시스템 설정 → 개인정보 보호 및 보안 → 전체 디스크 접근 → HaraguriRelay 켜기)' : msg}`);
      process.exit(1);
    }
  };
  if (!state.lastRowId) {
    // First run: start from the newest message instead of replaying the whole history 500 rows at a time.
    const newest = Number(read('select coalesce(max(ROWID), 0) as m from message')[0]?.m) || 0;
    if (!flag('--dry-run')) writeFileSync(STATE, JSON.stringify({ lastRowId: newest }));
    log(`첫 실행: 기존 메시지는 건너뛰고 지금부터 감시해요 (기준 #${newest}).`);
    return;
  }
  // Sync health for diagnosis without Full Disk Access: when did the last iPhone SMS / any message reach this Mac?
  const toIso = d => d ? new Date(((d > 10000000000 ? d / 1e9 : d) + 978307200) * 1000).toISOString() : null;
  const newest = read(`select max(case when service='SMS' then date end) as sms, max(date) as any from message where is_from_me=0`)[0] || {};
  const STATUS = join(DIR, 'status.json');
  const previous = readJson(STATUS, {});
  const status = { at: new Date().toISOString(), lastRowId: state.lastRowId, newestSms: toIso(newest.sms), newestMessage: toIso(newest.any), lastPass: previous.lastPass, notif: previous.notif };
  const writeStatus = () => writeFileSync(STATUS, JSON.stringify(status));
  writeStatus();
  // date is ns since 2001-01-01 on current macOS; older DBs used seconds.
  const rows = read(`select m.ROWID as rowid, m.text as text, hex(m.attributedBody) as body, m.is_from_me as from_me, m.service as service,
      case when m.date > 10000000000 then m.date/1000000000 else m.date end + 978307200 as unix, h.id as sender
      from message m left join handle h on h.ROWID = m.handle_id where m.ROWID > ${Number(state.lastRowId) || 0} order by m.ROWID asc limit 500`);
  const cutoff = Date.now() / 1000 - config.lookbackDays * 86400;
  let sent = 0, skipped = 0, last = Number(state.lastRowId) || 0;
  const seen = []; // content-free trace of what each row looked like, for diagnosing decode/filter problems
  for (const row of rows) {
    const text = (row.text || decodeAttributedBody(row.body) || '').trim();
    const isPayment = !row.from_me && PAYMENT.test(text) && AMOUNT.test(text) && row.unix >= cutoff;
    seen.push({ rowid: row.rowid, service: row.service, fromMe: !!row.from_me, chars: text.length, hasText: !!row.text, hasBody: !!row.body, keyword: PAYMENT.test(text), amount: AMOUNT.test(text), payment: isPayment, ageMin: Math.round((Date.now() / 1000 - row.unix) / 60) });
    if (isPayment) {
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
  const notifSent = await scanNotifications(config, state, status);
  if (!flag('--dry-run')) { state.lastRowId = last; writeFileSync(STATE, JSON.stringify(state)); }
  if (rows.length) status.lastPass = { at: status.at, sent, skipped, rows: seen.slice(-10) };
  writeStatus();
  if (sent || notifSent || flag('--verbose')) log(`처리: 문자 전송 ${sent}건 · 건너뜀 ${skipped}건 · 알림 전송 ${notifSent}건`);
}
main().catch(e => { log(`오류: ${e.message}`); process.exit(1); });
