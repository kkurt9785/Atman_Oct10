// Inspect browser bundles without printing configured secrets.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const secretNames = /^(SUPABASE_SERVICE_ROLE_KEY|VAPID_PRIVATE_KEY|CRON_SECRET|TOSS_SECRET_KEY|NTS_BUSINESS_API_KEY|.*ENCRYPTION_KEY|DATABASE_URL)$/;
let inspected = 0;
let configured = 0;
const findings = [];

async function filesIn(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await filesIn(target));
    else if (/\.(js|map|json)$/.test(item.name)) files.push(target);
  }
  return files;
}

for (const app of ['admin-web', 'worker-web']) {
  const root = path.resolve('apps', app);
  const env = await readFile(path.join(root, '.env.local'), 'utf8').catch(() => '');
  const secrets = env.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (!match || !secretNames.test(match[1])) return [];
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    return value.length >= 12 ? [{ name: match[1], value }] : [];
  });
  configured += secrets.length;
  for (const file of await filesIn(path.join(root, '.next', 'static'))) {
    inspected += 1;
    const source = await readFile(file, 'utf8');
    for (const secret of secrets) {
      if (source.includes(secret.value)) findings.push({ file: path.relative(process.cwd(), file), key: secret.name });
    }
    for (const token of source.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
      try {
        if (JSON.parse(Buffer.from(token[1], 'base64url').toString()).role === 'service_role') {
          findings.push({ file: path.relative(process.cwd(), file), key: 'service_role JWT' });
        }
      } catch { /* Not every matching string is a JWT. */ }
    }
  }
}
console.log(JSON.stringify({ browserFilesInspected: inspected, configuredSecretValuesChecked: configured, findings }));
if (findings.length) process.exitCode = 1;
