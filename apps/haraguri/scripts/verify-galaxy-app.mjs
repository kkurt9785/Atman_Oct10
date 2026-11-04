// Galaxy companion app (apps/haraguri-android) against the real HARAGURI backend, on a booted emulator or a USB device.
// Isolated temporary account; never prints pairing codes, tokens or keys.
// Flow: install APK → allow notification access → preset forwarded packages → open haraguri://pair?code=… (what the web app's
// '갤럭시 앱으로 연결' button does) → server sees the android-setup ping → post a card-approval notification via adb →
// server saves it as a 카페 expense → the same text 11 s later comes back as duplicate.
// Usage: node scripts/verify-galaxy-app.mjs [path/to/app-debug.apk]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const readEnv = file => Object.fromEntries(readFileSync(new URL(file, import.meta.url), 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const cfg = { ...readEnv('../.env.local'), ...readEnv('../.env.supabase-admin') };
assert.equal(cfg.NEXT_PUBLIC_SUPABASE_URL, 'https://rwyvqxkweqsoositvlht.supabase.co');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(cfg.NEXT_PUBLIC_SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, options);
const client = createClient(cfg.NEXT_PUBLIC_SUPABASE_URL, cfg.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const check = (r, step) => { if (r.error) throw new Error(`${step}: ${r.error.message}`); return r.data; };

const APK = process.argv[2] || new URL('../../haraguri-android/app/build/outputs/apk/debug/app-debug.apk', import.meta.url).pathname;
const PKG = 'app.haraguri.collect';
const ADB = process.env.ADB || `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(step, fn, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) { const v = await fn(); if (v) return v; await sleep(1000); }
  throw new Error(`${step}: timed out after ${timeoutMs / 1000}s`);
}

let userId, familyId;
const results = [];
const pass = (name, detail = '') => { results.push(`PASS ${name}${detail ? ` · ${detail}` : ''}`); console.log(results.at(-1)); };
try {
  assert.ok(adb('get-state') === 'device', 'no emulator/device attached (adb get-state)');
  const email = `haraguri-galaxy-${randomUUID()}@example.invalid`;
  userId = check(await admin.auth.admin.createUser({ email, email_confirm: true }), 'create temporary user').user.id;
  const magic = check(await admin.auth.admin.generateLink({ type: 'magiclink', email }), 'create temporary login');
  check(await client.auth.verifyOtp({ token_hash: magic.properties.hashed_token, type: 'magiclink' }), 'temporary login');
  familyId = check(await client.rpc('hg_create_family', { family_name: '갤럭시 앱 QA', member_name: '검증 사용자' }), 'create temporary family');
  const inbox = async via => (await admin.from('hg_inbox').select('via,app,status,summary,raw,received_at').eq('family_id', familyId).eq('via', via).order('received_at', { ascending: false })).data ?? [];

  // Install fresh, grant listener access, preset which packages are forwarded (adb posts notifications as com.android.shell).
  try { adb('uninstall', PKG); } catch { /* not installed */ }
  adb('install', '-r', APK); pass('apk installed');
  adb('shell', 'cmd', 'notification', 'allow_listener', `${PKG}/${PKG}.NotificationListener`);
  // Android 15 redacts notifications its OTP detector flags (a card's 4-digit suffix is enough) from listeners that lack
  // RECEIVE_SENSITIVE_NOTIFICATIONS. The grant is adb-only; a real phone needs it once over USB too.
  adb('shell', 'appops', 'set', '--uid', PKG, 'RECEIVE_SENSITIVE_NOTIFICATIONS', 'allow');
  adb('shell', 'am', 'force-stop', PKG);
  if (process.env.SMOKE !== '1') { // run-as only works on a debuggable build
    const prefs = join(tmpdir(), 'haraguri-prefs.xml');
    writeFileSync(prefs, `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n    <set name="packages">\n        <string>com.android.shell</string>\n    </set>\n</map>\n`);
    adb('push', prefs, '/data/local/tmp/haraguri-prefs.xml');
    // adb joins arguments with spaces, so the remote command must travel as one quoted string.
    adb('shell', `run-as ${PKG} sh -c 'mkdir -p shared_prefs && cp /data/local/tmp/haraguri-prefs.xml shared_prefs/haraguri.xml'`);
  }
  pass(process.env.SMOKE === '1' ? 'listener allowed' : 'listener allowed · packages preset');

  // Pairing: the code the web app would mint, handed over as the deep link the intent:// URL resolves to.
  const pairing = check(await client.rpc('hg_create_shortcut_pairing', { family: familyId }), 'mint pairing code');
  adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `haraguri://pair?code=${pairing.code}`, PKG);
  const status = await until('pairing claimed', async () => (await client.rpc('hg_shortcut_pairing_status', { pair_code: pairing.code })).data === 'claimed');
  assert.ok(status); pass('deep link pairing claimed');
  const setup = await until('android-setup ping', async () => (await inbox('android-setup'))[0]);
  assert.equal(setup.status, 'ignored'); assert.match(setup.summary, /연결 테스트/); pass('setup ping received', setup.summary);
  // SMOKE=1: a signed release build cannot take the run-as prefs injection below, so stop at a proven pairing.
  if (process.env.SMOKE === '1') { console.log('\nSMOKE PASS (install · pairing · setup ping)'); throw Object.assign(new Error('smoke-done'), { smoke: true }); }

  // A card-approval push, as a bank app would post it. Title = app-ish, body = the approval text.
  const body = '[신한카드(2987)승인] 김*한 - 승인금액: 4,500원(일시불) - 승인일시: 11/04 17:20 - 가맹점명: 스타벅스 수원역점';
  // Unique tags: re-posting an existing tag only updates that notification.
  const run = Date.now().toString(36);
  const postNote = tag => adb('shell', 'cmd', 'notification', 'post', '-t', '신한카드', `${tag}-${run}`, JSON.stringify(body));
  adb('logcat', '-c');
  postNote('hg1');
  const saved = await until('notification forwarded', async () => (await inbox('android')).find(r => r.status === 'saved'));
  assert.match(saved.summary, /4,500원/); assert.match(saved.summary, /스타벅스/); pass('approval push saved', saved.summary);
  const exp = check(await admin.from('hg_expenses').select('title,amount,category,source').eq('family_id', familyId), 'read expenses');
  assert.equal(exp.length, 1); assert.equal(exp[0].category, '카페'); assert.equal(Number(exp[0].amount), 4500);
  assert.equal(exp[0].source, 'push', 'ingest must mark Galaxy deliveries as push (source/fingerprint were silently dropped by a mid-line comment in 900bfac)');
  pass('expense row', `${exp[0].title} · ${exp[0].category} · ${exp[0].source}`);

  // The app drops an identical repost within 10 s; after that the server reports it as a duplicate.
  await sleep(11_000);
  postNote('hg2');
  const dup = await until('duplicate reported', async () => (await inbox('android')).find(r => r.status === 'duplicate'));
  pass('server duplicate', dup.summary);
  assert.equal((await inbox('android')).length, 2, 'exactly two deliveries (no app-side double send)');
  pass('no double send');

  const shot = join(tmpdir(), 'haraguri-galaxy.png');
  writeFileSync(shot, execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 20 * 1024 * 1024 }));
  console.log(`screenshot: ${shot}`);
  console.log('\nALL PASS');
} catch (e) {
  if (e.smoke) { /* finished early on purpose */ } else {
  console.error('\nFAIL', e.message);
  try { console.error(adb('logcat', '-d', '-s', 'HaraguriListener', 'AndroidRuntime').split('\n').slice(-12).join('\n')); } catch { /* no logcat */ }
  process.exitCode = 1;
  }
} finally {
  if (familyId) check(await admin.from('hg_families').delete().eq('id', familyId), 'clean temporary family');
  if (userId) check(await admin.auth.admin.deleteUser(userId), 'clean temporary user');
}
