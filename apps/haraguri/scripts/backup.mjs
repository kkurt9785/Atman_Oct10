// Monthly backup: every hg_* table as JSON plus every file in the private bucket, into ~/HARAGURI-backup/<date>/.
// Uses the service role key from .env.supabase-admin (never printed). Run:  node scripts/backup.mjs [dest]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const readEnv = f => Object.fromEntries(readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const cfg = { ...readEnv('../.env.local'), ...readEnv('../.env.supabase-admin') };
if (cfg.NEXT_PUBLIC_SUPABASE_URL !== 'https://rwyvqxkweqsoositvlht.supabase.co') throw new Error('Refusing to back up any non-HARAGURI project');
const admin = createClient(cfg.NEXT_PUBLIC_SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const stamp = new Date().toLocaleDateString('sv-SE');
const dest = process.argv[2] || join(homedir(), 'HARAGURI-backup', stamp);
mkdirSync(join(dest, 'files'), { recursive: true });

const tables = ['hg_families', 'hg_members', 'hg_invites', 'hg_entries', 'hg_receipts', 'hg_cards', 'hg_expenses', 'hg_comments', 'hg_attachments', 'hg_rooms', 'hg_recurring_expenses', 'hg_push_subscriptions', 'hg_ingest_tokens'];
const summary = { date: stamp, tables: {}, files: 0, bytes: 0, errors: [] };
for (const table of tables) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select('*').range(from, from + 999);
    if (error) { summary.errors.push(`${table}: ${error.message}`); break; }
    rows.push(...data);
    if (data.length < 1000) break;
  }
  writeFileSync(join(dest, `${table}.json`), JSON.stringify(rows, null, 1));
  summary.tables[table] = rows.length;
}

// Files live at <family>/<user>/<name>; list two levels deep and download each object.
const bucket = admin.storage.from('haraguri-files');
const { data: families } = await bucket.list('', { limit: 1000 });
for (const family of families ?? []) {
  const { data: users } = await bucket.list(family.name, { limit: 1000 });
  for (const user of users ?? []) {
    for (let offset = 0; ; offset += 1000) {
      const { data: files } = await bucket.list(`${family.name}/${user.name}`, { limit: 1000, offset });
      for (const file of files ?? []) {
        const path = `${family.name}/${user.name}/${file.name}`;
        const { data, error } = await bucket.download(path);
        if (error) { summary.errors.push(`${path}: ${error.message}`); continue; }
        mkdirSync(join(dest, 'files', family.name, user.name), { recursive: true });
        const buf = Buffer.from(await data.arrayBuffer());
        writeFileSync(join(dest, 'files', path), buf);
        summary.files++; summary.bytes += buf.length;
      }
      if (!files || files.length < 1000) break;
    }
  }
}
writeFileSync(join(dest, 'manifest.json'), JSON.stringify(summary, null, 2));
console.log(`backup → ${dest}`);
console.log(Object.entries(summary.tables).map(([t, n]) => `${t}: ${n}`).join(' · '));
console.log(`files: ${summary.files} (${(summary.bytes / 1048576).toFixed(1)} MB)${summary.errors.length ? ` · errors: ${summary.errors.length}` : ''}`);
if (summary.errors.length) { console.error(summary.errors.join('\n')); process.exitCode = 1; }
