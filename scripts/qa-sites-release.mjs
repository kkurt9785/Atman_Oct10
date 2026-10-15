// Public demo login + read-only policy/metadata checks. Never records attendance or creates a site.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url),{loadEnvConfig}=require('../apps/worker-web/node_modules/@next/env'),{createClient}=require('../apps/worker-web/node_modules/@supabase/supabase-js');
loadEnvConfig(path.resolve('apps/worker-web'),false,{info(){},error(){}});
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const anon=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
const denied=await anon.rpc('get_my_attendance_policy',{p_target_type:'staff',p_target_id:'00000000-0000-0000-0000-000000000000'});assert.ok(denied.error);
const response=await fetch('https://itdot.co.kr/api/demo-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'worker-demo-1@demo.atman.co.kr'})});
assert.ok(response.ok,'public demo login');const session=await response.json();assert.ok(session.accessToken);
const worker=createClient(url,anonKey,{global:{headers:{Authorization:`Bearer ${session.accessToken}`}},auth:{persistSession:false,autoRefreshToken:false}});
const linked=await worker.from('facility_staff').select('id,facility_id').eq('status','active').limit(1);assert.equal(linked.error,null);assert.ok(linked.data.length,'demo has active staff assignment');
const target=linked.data[0];const policy=await worker.rpc('get_my_attendance_policy',{p_target_type:'staff',p_target_id:target.id});assert.equal(policy.error,null);assert.equal(policy.data.facilityId,target.facility_id);assert.ok(['gps','gps_or_qr','gps_qr','qr','network','admin'].includes(policy.data.mode));
const missing=await worker.rpc('get_my_attendance_policy',{p_target_type:'staff',p_target_id:'00000000-0000-0000-0000-000000000000'});assert.ok(missing.error);
console.log('PASS production policy: anonymous denied, own assigned site policy returned, unassigned target denied; no attendance/site writes');
