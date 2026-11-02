import { createClient } from 'npm:@supabase/supabase-js@2';

const base = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(base, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405);
  const body = await req.json().catch(() => null);
  const code = body?.code;
  if (typeof code !== 'string' || !/^[0-9a-f]{48}$/.test(code)) return reply({ error: '연결 버튼을 다시 눌러 주세요.' }, 400);
  const { data, error } = await admin.rpc('hg_claim_shortcut_pairing', { pair_code: code });
  if (error) return reply({ error: '연결하지 못했어요. 잠시 후 다시 시도해 주세요.' }, 500);
  if (!data?.token) return reply({ error: '연결 코드가 만료됐어요. 하라구리에서 연결 버튼을 다시 눌러 주세요.' }, 410);
  return reply({ collect_url: `${base}/functions/v1/ingest?token=${data.token}`, version: 1 });
});
