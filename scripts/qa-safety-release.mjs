// Read-only release diagnostics. Never print credentials, users, or messages.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {loadEnvConfig}=require('../apps/admin-web/node_modules/@next/env');
const {createClient}=require('../apps/admin-web/node_modules/@supabase/supabase-js');
loadEnvConfig(path.resolve('apps/admin-web'),false,{info(){},error(){}});
const env=process.env;
const url=env.SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL;
const sb=createClient(url,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const cleanup=await sb.rpc('account_storage_cleanup_health');
assert.equal(cleanup.error,null,'cleanup health RPC available');
assert.equal(cleanup.data.configured,true,'database cron secret configured');
assert.equal(cleanup.data.scheduled,true,'cleanup cron active');
assert.equal(cleanup.data.overdue,0,'no overdue cleanup jobs');
const reports=await sb.from('chat_safety_reports').select('id',{head:true,count:'exact'});
assert.equal(reports.error,null,'report table available');
const anon=createClient(url,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
for(const name of ['account_storage_cleanup_health','claim_account_storage_cleanup']){
 const result=await anon.rpc(name);assert.ok(result.error,`${name}: anonymous execution denied`);
}
const moderation=await anon.rpc('review_safety_report',{p_id:'00000000-0000-4000-8000-000000000000',p_status:'reviewing',p_note:'',p_actor:'00000000-0000-4000-8000-000000000000',p_hide:false});
assert.ok(moderation.error,'anonymous moderation denied');
console.log(JSON.stringify({readOnly:true,cleanup:cleanup.data,reportCount:reports.count,privilegedRpcAnonymousAccess:'denied',localOperatorAllowlistPresent:Boolean(env.PLATFORM_ADMIN_EMAILS?.trim()||env.PLATFORM_ADMIN_USER_IDS?.trim())}));
if(process.argv.includes('--sites')){
 for(const [address,expected] of [
  ['https://admin.itdot.co.kr/privacy',200],['https://admin.itdot.co.kr/login',200],
  ['https://itdot.co.kr/legal/privacy',200],['https://itdot.co.kr/account-deletion',200],
  ['https://admin.itdot.co.kr/api/cron/cleanup-account-storage',401],
 ]){
  const response=await fetch(address,{redirect:'manual'});assert.equal(response.status,expected,address);
  if(address.endsWith('/privacy'))assert.ok((await response.text()).includes('신고'));
  console.log(`PASS HTTP ${expected}: ${address}`);
 }
 const denied=await fetch('https://admin.itdot.co.kr/ops/safety');
 const body=await denied.text();
 // Next streams the layout with HTTP 200 before the async authorization check.
 assert.ok(denied.status===404||body.includes('NEXT_HTTP_ERROR_FALLBACK;404'));
 assert.ok(!body.includes('message_snapshot'));
 console.log('PASS unauthorized moderation route renders not-found; no report payload');
}
