#!/usr/bin/env bash
# One-time push setup. Reads keys from the gitignored .env.push / .env.supabase-admin and writes them where they belong:
#   1) Vercel env  NEXT_PUBLIC_VAPID_PUBLIC_KEY (browser needs the public key to subscribe)
#   2) Supabase Edge Function secrets  HOOK_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
#   3) Supabase Vault  haraguri_push_url, haraguri_push_secret (DB triggers read these; without them push stays off)
# Run from apps/haraguri:  bash scripts/setup-push-secrets.sh
set -euo pipefail
cd "$(dirname "$0")/.."
REF=rwyvqxkweqsoositvlht
[ -f .env.push ] || { echo "missing .env.push (generate with: npx web-push generate-vapid-keys)"; exit 1; }
set -a; . ./.env.push; . ./.env.supabase-admin; set +a

echo "1/4 Vercel env (public key only)"
for env in production preview development; do
  printf "%s" "$VAPID_PUBLIC_KEY" | vercel env add NEXT_PUBLIC_VAPID_PUBLIC_KEY "$env" --force >/dev/null && echo "  $env ok"
done
grep -q '^NEXT_PUBLIC_VAPID_PUBLIC_KEY=' .env.local || printf "\nNEXT_PUBLIC_VAPID_PUBLIC_KEY=%s\n" "$VAPID_PUBLIC_KEY" >> .env.local

echo "2/4 Edge Function secrets"
supabase secrets set --project-ref "$REF" HOOK_SECRET="$HOOK_SECRET" VAPID_PUBLIC_KEY="$VAPID_PUBLIC_KEY" VAPID_PRIVATE_KEY="$VAPID_PRIVATE_KEY" VAPID_SUBJECT="$VAPID_SUBJECT" >/dev/null && echo "  ok"

echo "3/4 Vault secrets (DB → function URL + shared secret)"
POOL=$(cat supabase/.temp/pooler-url)
DB_URL="${POOL/postgres.${REF}@/postgres.${REF}:${SUPABASE_DB_PASSWORD}@}"
PG_DIR="${PG_MODULE_DIR:-/private/tmp/claude-501/-Users-kihankim-gawcheon-gawcheon-frontend-application/b96b4700-cc77-4d26-ab3f-b9b69b2d2a39/scratchpad/pw}"
[ -d "$PG_DIR/node_modules/pg" ] || { PG_DIR=$(mktemp -d); (cd "$PG_DIR" && npm init -y >/dev/null && npm i --silent pg@8); }
DB_URL="$DB_URL" HOOK_SECRET="$HOOK_SECRET" FN_URL="https://${REF}.supabase.co/functions/v1/push" node -e '
const { Client } = require(process.env.PG_DIR + "/node_modules/pg");
(async () => {
  const c = new Client({ connectionString: process.env.DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const upsert = async (name, value) => {
    const { rows } = await c.query("select id from vault.secrets where name = $1", [name]);
    if (rows.length) await c.query("select vault.update_secret($1, $2)", [rows[0].id, value]);
    else await c.query("select vault.create_secret($1, $2)", [value, name]);
  };
  await upsert("haraguri_push_url", process.env.FN_URL);
  await upsert("haraguri_push_secret", process.env.HOOK_SECRET);
  const { rows } = await c.query("select name from vault.decrypted_secrets where name like $1 order by 1", ["haraguri_push_%"]);
  console.log("  vault:", rows.map(r => r.name).join(", "));
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
' PG_DIR="$PG_DIR"

echo "4/4 Smoke: call the function directly (expects {\"delivered\":0} or similar)"
curl -s -X POST "https://${REF}.supabase.co/functions/v1/push" -H "Content-Type: application/json" -H "x-haraguri-secret: ${HOOK_SECRET}" -d '{"kind":"daily"}'; echo
echo "done. Redeploy the web app once (vercel deploy --prod --yes) so the browser bundle includes the public key."
