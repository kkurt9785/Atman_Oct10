// Integration checks against HARAGURI only; creates and removes isolated temporary fixtures.
// Never sends email. Never prints tokens, passwords, keys or signed URLs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';

const readEnv = file => Object.fromEntries(readFileSync(new URL(file, import.meta.url), 'utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const config = {...readEnv('../.env.local'),...readEnv('../.env.supabase-admin'),...(()=>{ try { return readEnv('../.env.push'); } catch { return {}; } })()};
const url = config.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(url,'https://rwyvqxkweqsoositvlht.supabase.co','Refusing to test any non-HARAGURI project');
const options = {auth:{persistSession:false,autoRefreshToken:false}};
const admin = createClient(url,config.SUPABASE_SERVICE_ROLE_KEY,options);
const client = () => createClient(url,config.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
const check = (r,step) => { if(r.error) throw new Error(`${step}: ${r.error.message}`);return r.data; };
const userIds=[],familyIds=[],uploads=[];
let browser;
try {
  const actors=[];
  for (const label of ['owner','member','outsider']) {
    const email=`haraguri-qa-${label}-${randomUUID()}@example.invalid`;
    const created=check(await admin.auth.admin.createUser({email,email_confirm:true}), 'create temporary user');
    userIds.push(created.user.id);
    const link=check(await admin.auth.admin.generateLink({type:'magiclink',email}), 'generate local verification token');
    const db=client();
    const session=check(await db.auth.verifyOtp({token_hash:link.properties.hashed_token,type:'magiclink'}), 'verify email token').session;
    actors.push({db,id:created.user.id,session,email});
  }
  const [owner,member,outsider]=actors;
  const family=check(await owner.db.rpc('hg_create_family',{family_name:'HARAGURI integration QA',member_name:'검증 소유자'}),'create family');
  familyIds.push(family);
  const outsiderFamily=check(await outsider.db.rpc('hg_create_family',{family_name:'HARAGURI isolated QA',member_name:'다른 가족'}),'create isolated family');
  familyIds.push(outsiderFamily);
  const code=check(await owner.db.rpc('hg_invite',{family}),'create invitation');
  assert.equal(check(await member.db.rpc('hg_join_family',{invite_code:code,member_name:'검증 가족'}),'join family'),family);
  assert.equal(check(await member.db.from('hg_members').select('*'),'read members').length,2);
  assert.equal(check(await outsider.db.from('hg_members').select('*'),'isolate members').length,1);
  console.log('PASS: email-token authentication, create family, invite and join. No emails sent.');

  const entry=check(await owner.db.from('hg_entries').insert({family_id:family,title:'실제 DB 반복 할 일 검증',body:'temporary integration fixture',date:'2026-10-26',repeat:'monthly',kind:'task',assignee:member.id}).select().single(),'create entry');
  const card=check(await owner.db.from('hg_cards').insert({family_id:family,name:'QA card',holder:'가족',budget:100000,credit_limit:500000}).select().single(),'create card');
  check(await member.db.from('hg_expenses').insert({family_id:family,card_id:card.id,title:'QA expense',amount:1234,date:'2026-10-26',category:'기타'}),'record expense');
  check(await member.db.from('hg_comments').insert({family_id:family,entry_id:entry.id,occurrence:'2026-10-26',body:'가족 댓글 동기화 검증'}),'create comment');
  check(await member.db.from('hg_receipts').insert({family_id:family,entry_id:entry.id,occurrence:'2026-10-26',state:'done'}),'complete task');
  assert.equal(check(await owner.db.from('hg_receipts').select('*').eq('occurrence','2026-11-26'),'separate occurrences').length,0);
  assert.equal(check(await outsider.db.from('hg_entries').select('*').eq('family_id',family),'cross-family read').length,0);
  const forbidden=await outsider.db.from('hg_entries').insert({family_id:family,title:'not allowed',date:'2026-10-26',kind:'task'});
  assert.ok(forbidden.error,'Outsider insert must fail');
  const forged=await owner.db.from('hg_receipts').insert({family_id:family,entry_id:entry.id,occurrence:'2026-10-26',state:'seen',user_id:member.id});
  assert.ok(forged.error,'Cannot acknowledge on behalf of another user');
  console.log('PASS: shared expenses/comments/completion; foreign-family reads/writes and forged acknowledgments blocked.');
  // Unread tracking: the member's comment stays unread for the owner until that room is marked read; counts are private to the person.
  const ownerUnread=check(await owner.db.rpc('hg_unread_summary',{target:owner.id}),'owner unread summary');
  assert.ok(ownerUnread.some(r=>r.entry_id===entry.id&&r.unread>=1&&r.latest_author==='검증 가족'),'Owner sees the member comment as unread with the author name');
  assert.deepEqual(check(await member.db.rpc('hg_unread_summary',{target:owner.id}),'peek at another person'),[]);
  check(await owner.db.rpc('hg_mark_read',{family,entry:entry.id,occ:'2026-10-26'}),'mark room read');
  assert.ok(!check(await owner.db.rpc('hg_unread_summary',{target:owner.id}),'after mark read').some(r=>r.entry_id===entry.id),'Marked room is no longer unread');
  assert.ok((await outsider.db.rpc('hg_mark_read',{family,entry:null,occ:null})).error,'Outsider cannot mark rooms read');
  console.log('PASS: unread counts per room, private to each person, cleared by mark-read; outsiders rejected.');
  // Replies stay in the family, reactions are members-only with a fixed emoji set, pins replace per room, read receipts are visible to the family.
  const original=check(await member.db.from('hg_comments').select('id').eq('body','가족 댓글 동기화 검증').single(),'find original comment');
  const reply=check(await owner.db.from('hg_comments').insert({family_id:family,entry_id:entry.id,occurrence:'2026-10-26',body:'답장 검증',reply_to:original.id}).select().single(),'reply');
  assert.equal(reply.reply_to,original.id);
  const foreignComment=check(await outsider.db.from('hg_comments').insert({family_id:outsiderFamily,entry_id:null,occurrence:null,body:'다른 가족 글'}).select().single(),'foreign comment');
  assert.ok((await owner.db.from('hg_comments').insert({family_id:family,entry_id:null,occurrence:null,body:'cross reply',reply_to:foreignComment.id})).error,'Reply must target a message of the same family');
  check(await member.db.from('hg_reactions').insert({family_id:family,comment_id:reply.id,emoji:'👍'}),'react');
  assert.equal(check(await owner.db.from('hg_reactions').select('emoji,user_id').eq('comment_id',reply.id),'owner sees the reaction').length,1);
  assert.ok((await outsider.db.from('hg_reactions').insert({family_id:family,comment_id:reply.id,emoji:'❤️'})).error,'Outsider cannot react');
  assert.ok((await member.db.from('hg_reactions').insert({family_id:family,comment_id:reply.id,emoji:'🍕'})).error,'Only the fixed emoji set is accepted');
  check(await member.db.rpc('hg_pin_message',{comment:reply.id}),'pin');
  assert.equal(check(await owner.db.from('hg_pins').select('comment_id').eq('family_id',family),'pin visible to the family').length,1);
  assert.ok((await outsider.db.rpc('hg_pin_message',{comment:reply.id})).error,'Outsider cannot pin');
  check(await owner.db.from('hg_pins').delete().eq('family_id',family).eq('comment_id',reply.id),'unpin');
  assert.ok(check(await member.db.from('hg_room_reads').select('user_id').eq('family_id',family),'family sees read receipts').some(r=>r.user_id===owner.id),'Member can see the owner read the room');
  console.log('PASS: in-family replies, member-only reactions with fixed emoji, pin/unpin, read receipts visible to the family.');
  check(await owner.db.from('hg_cards').update({owner_user_id:owner.id,performance_thresholds:[300000,500000],excluded_categories:['세금'],benefit_basis:'previous_month'}).eq('id',card.id),'set benefit rules');
  assert.equal(check(await outsider.db.from('hg_cards').update({budget:1}).eq('id',card.id).select(),'block outsider card update').length,0);
  assert.ok((await owner.db.from('hg_cards').update({owner_user_id:outsider.id}).eq('id',card.id)).error,'Card owner must belong to family');
  const expense=check(await member.db.from('hg_expenses').select('*').eq('card_id',card.id).single(),'find expense');
  check(await member.db.from('hg_expenses').update({qualifying_amount:1000,performance_month:'2026-09-01'}).eq('id',expense.id),'edit own performance');
  assert.equal(check(await owner.db.from('hg_expenses').update({qualifying_amount:0}).eq('id',expense.id).select(),'block editing other member expense').length,0);
  assert.ok((await member.db.from('hg_expenses').update({qualifying_amount:1235}).eq('id',expense.id)).error,'Reject excess qualifying amount');
  assert.ok((await member.db.from('hg_expenses').update({family_id:outsiderFamily}).eq('id',expense.id)).error,'Cannot move expense to other family');
  check(await owner.db.from('hg_expenses').insert({family_id:family,title:'QA transfer',amount:50000,date:'2026-10-26',category:'교육',payment_method:'bank_transfer'}),'record bank transfer');
  assert.ok((await owner.db.from('hg_expenses').insert({family_id:family,title:'invalid transfer',amount:50000,date:'2026-10-26',category:'교육',payment_method:'bank_transfer',card_id:card.id})).error,'Transfer must not carry a card');
  console.log('PASS: card rules, payment methods and expense edits persist; family isolation and amount constraints enforced.');
  // Income rows, family budgets, and the one-time 80%/100% budget alert rows written by the trigger.
  assert.ok((await member.db.from('hg_expenses').insert({family_id:family,title:'bad kind',amount:1,date:'2026-10-02',category:'기타',kind:'gift'})).error,'kind is constrained');
  check(await member.db.from('hg_expenses').insert({family_id:family,title:'OCR row',amount:4500,date:'2026-10-02',category:'식비',source:'ocr',fingerprint:'ocr:2026-10-02:4500:OCRrow'}),'screenshot import source');
  assert.ok((await member.db.from('hg_expenses').insert({family_id:family,title:'OCR row again',amount:4500,date:'2026-10-02',category:'식비',source:'ocr',fingerprint:'ocr:2026-10-02:4500:OCRrow'})).error,'same screenshot twice is rejected by the fingerprint index');
  assert.ok((await member.db.from('hg_expenses').insert({family_id:family,title:'bad source',amount:1,date:'2026-10-02',category:'기타',source:'scan'})).error,'source is constrained');
  check(await member.db.from('hg_expenses').insert({family_id:family,title:'QA income',amount:1000000,date:'2026-10-02',category:'월급',kind:'income',payment_method:'bank_transfer'}),'income row');
  check(await owner.db.from('hg_budgets').upsert({family_id:family,month:'2026-10-01',total:10,by_category:{'식비':5}},{onConflict:'family_id,month'}),'owner sets a tiny budget');
  assert.equal(check(await member.db.from('hg_budgets').select('total').eq('family_id',family),'member reads budget')[0].total,10);
  assert.ok((await outsider.db.from('hg_budgets').insert({family_id:family,month:'2026-11-01',total:1})).error,'Outsider cannot set budgets');
  check(await member.db.from('hg_expenses').insert({family_id:family,title:'budget breaker',amount:50000,date:'2026-10-03',category:'기타'}),'expense over budget');
  const alerts=check(await admin.from('hg_budget_alerts').select('level').eq('family_id',family).eq('month','2026-10-01'),'alert rows');
  assert.ok(alerts.some(a=>a.level===100),'Crossing the budget writes a level-100 alert row');
  check(await member.db.from('hg_expenses').insert({family_id:family,title:'budget breaker 2',amount:50000,date:'2026-10-04',category:'기타'}),'another expense');
  assert.equal(check(await admin.from('hg_budget_alerts').select('level').eq('family_id',family).eq('month','2026-10-01').eq('level',100),'alert stays single').length,1);
  check(await owner.db.from('hg_budgets').delete().eq('family_id',family).eq('month','2026-10-01'),'remove tiny budget');
  console.log('PASS: income kind, family budgets (members only), one-time budget alert rows from the trigger.');


  const purchase=check(await owner.db.from('hg_entries').insert({family_id:family,title:'QA 구매 대화',date:'2026-10-28',kind:'purchase',expected_amount:200000}).select().single(),'create purchase');
  const foreignEntry=check(await outsider.db.from('hg_entries').insert({family_id:outsiderFamily,title:'private',date:'2026-10-28',kind:'task'}).select().single(),'foreign entry');
  check(await member.db.from('hg_comments').insert({family_id:family,entry_id:null,occurrence:null,body:'기본방 가족 대화'}),'general chat');
  assert.equal(check(await outsider.db.from('hg_comments').select().eq('family_id',family),'private general chat').length,0);
  assert.ok((await member.db.from('hg_comments').insert({family_id:family,entry_id:null,occurrence:'2026-10-28',body:'invalid'})).error,'Reject half-specified room');
  assert.ok((await member.db.from('hg_comments').insert({family_id:family,entry_id:null,occurrence:null,shared_entry_id:foreignEntry.id,shared_occurrence:'2026-10-28',body:'invalid'})).error,'Cannot share foreign work');
  assert.ok((await member.db.from('hg_expenses').update({entry_id:foreignEntry.id,occurrence:'2026-10-28'}).eq('id',expense.id)).error,'Cannot link foreign work');
  check(await member.db.from('hg_expenses').update({entry_id:purchase.id,occurrence:'2026-10-28'}).eq('id',expense.id),'link existing expense');
  assert.equal(check(await member.db.from('hg_expenses').select().eq('id',expense.id),'no duplicate expense').length,1);
  check(await member.db.from('hg_entries').update({purchase_state:'decided'}).eq('id',purchase.id),'family purchase decision');
  assert.equal(check(await outsider.db.from('hg_entries').update({purchase_state:'purchased'}).eq('id',purchase.id).select(),'foreign decision denied').length,0);
  console.log('PASS: general/work rooms, purchase state, existing expense linking and cross-family link constraints.');

  const path=`${family}/${owner.id}/${randomUUID()}.txt`;
  check(await owner.db.storage.from('haraguri-files').upload(path,Buffer.from('HARAGURI private document QA'),{contentType:'text/plain'}),'upload private document');
  uploads.push(path);
  check(await owner.db.from('hg_attachments').insert({family_id:family,entry_id:entry.id,occurrence:'2026-10-26',path,name:'QA.txt'}),'link attachment');
  const file=check(await member.db.storage.from('haraguri-files').download(path),'download as family');
  assert.equal(await file.text(),'HARAGURI private document QA');
  assert.ok((await outsider.db.storage.from('haraguri-files').download(path)).error,'Other family cannot read attachment');
  assert.ok((await client().storage.from('haraguri-files').download(path)).error,'Anonymous cannot read attachment');
  assert.ok((await owner.db.from('hg_entries').delete().eq('id',entry.id)).error,'Prevent orphaned attachments');
  console.log('PASS: private upload, shared download, anonymous/other-family denial, attachment deletion guard.');

  const usage=check(await member.db.rpc('hg_storage_usage',{family}),'storage usage');
  const usageRow=Array.isArray(usage)?usage[0]:usage;
  assert.ok(Number(usageRow.files)>=1,'usage counts family attachments');
  assert.equal(Number(usageRow.limit_bytes),524288000,'default family quota is 500MB');
  check(await admin.from('hg_families').update({storage_limit:100}).eq('id',family),'shrink quota for the test');
  assert.ok((await owner.db.from('hg_attachments').insert({family_id:family,entry_id:null,occurrence:null,path:`${family}/${owner.id}/${randomUUID()}.txt`,name:'quota.txt',size:1000})).error,'quota trigger blocks an oversized attachment');
  check(await admin.from('hg_families').update({storage_limit:524288000}).eq('id',family),'restore quota');
  assert.equal(check(await outsider.db.rpc('hg_storage_usage',{family}),'foreign usage hidden').map?.(r=>Number(r.files))[0] ?? 0,0);
  check(await member.db.from('hg_entries').update({title:'실제 DB 반복 할 일 검증 (수정)',body:'edited by member'}).eq('id',entry.id),'member edits shared work');
  assert.ok((await member.db.from('hg_entries').update({date:'2026-10-27'}).eq('id',entry.id)).error,'date locked once records exist');
  assert.ok((await member.db.from('hg_entries').update({repeat:'none'}).eq('id',entry.id)).error,'repeat locked once records exist');
  const movable=check(await owner.db.from('hg_entries').insert({family_id:family,title:'QA 이동 가능 일정',date:'2026-10-28',kind:'event'}).select().single(),'create unrecorded work');
  check(await member.db.from('hg_entries').update({date:'2026-10-29',repeat:'yearly'}).eq('id',movable.id),'unrecorded work may move');
  assert.equal(check(await outsider.db.from('hg_entries').update({title:'x'}).eq('id',entry.id).select(),'foreign edit denied').length,0);
  console.log('PASS: storage usage per family; shared work edits; date/repeat locked after records; foreign edits denied.');

  const roomKey={entry_id:entry.id,occurrence:'2026-10-26'};
  assert.ok((await outsider.db.from('hg_rooms').upsert({family_id:family,...roomKey,closed_at:new Date().toISOString()})).error,'outsider cannot close a room');
  check(await member.db.from('hg_rooms').upsert({family_id:family,...roomKey,closed_at:new Date().toISOString(),closed_by:member.id},{onConflict:'entry_id,occurrence'}),'member closes room');
  assert.ok((await owner.db.from('hg_comments').insert({family_id:family,...roomKey,body:'blocked'})).error,'closed room rejects messages');
  assert.ok((await owner.db.from('hg_attachments').insert({family_id:family,...roomKey,path:`${family}/${owner.id}/${randomUUID()}.txt`,name:'blocked.txt'})).error,'closed room rejects files');
  check(await member.db.from('hg_comments').insert({family_id:family,entry_id:null,occurrence:null,body:'general chat still open'}),'general chat unaffected');
  check(await member.db.storage.from('haraguri-files').remove([path]),'member removes another member\'s file during cleanup');
  check(await member.db.from('hg_attachments').delete().eq('path',path),'member removes attachment row during cleanup');
  uploads.splice(uploads.indexOf(path),1);
  assert.equal(check(await owner.db.from('hg_attachments').select('id').eq('path',path),'attachment gone').length,0);
  check(await member.db.from('hg_rooms').update({closed_at:null,closed_by:null}).match(roomKey),'reopen room');
  check(await owner.db.from('hg_comments').insert({family_id:family,...roomKey,body:'reopened'}),'reopened room accepts messages');
  console.log('PASS: close/reopen rooms; closed rooms reject writes; family-wide cleanup of files; outsiders cannot close.');

  // Messages: edit/delete only your own.
  const mine=check(await owner.db.from('hg_comments').insert({family_id:family,entry_id:null,occurrence:null,body:'edit me'}).select().single(),'own message');
  assert.equal(check(await member.db.from('hg_comments').update({body:'hacked'}).eq('id',mine.id).select(),'other member cannot edit').length,0);
  check(await owner.db.from('hg_comments').update({body:'edited',edited_at:new Date().toISOString()}).eq('id',mine.id),'edit own message');
  assert.equal(check(await member.db.from('hg_comments').delete().eq('id',mine.id).select(),'other member cannot delete').length,0);
  check(await owner.db.from('hg_comments').delete().eq('id',mine.id),'delete own message');
  // Members: rename self, owner renames space, remove / leave, ownership transfer rules.
  check(await member.db.from('hg_members').update({display_name:'검증 가족2'}).eq('family_id',family).eq('user_id',member.id),'rename self');
  assert.equal(check(await member.db.from('hg_members').update({display_name:'x'}).eq('family_id',family).eq('user_id',owner.id).select(),'cannot rename others').length,0);
  assert.equal(check(await member.db.from('hg_families').update({name:'x'}).eq('id',family).select(),'member cannot rename space').length,0);
  check(await owner.db.from('hg_families').update({name:'HARAGURI integration QA 2'}).eq('id',family),'owner renames space');
  assert.ok((await member.db.rpc('hg_remove_member',{family,member:owner.id})).error,'non-owner cannot remove');
  assert.ok((await owner.db.rpc('hg_leave_family',{family})).error,'owner cannot leave while others remain');
  console.log('PASS: own-message edit/delete; rename rules; owner leave blocked while members remain.');
  // Family switches: owner turns settlement on, member reads it, member cannot change it. Card override columns are member-editable.
  check(await owner.db.from('hg_families').update({settings:{settlement:true}}).eq('id',family),'owner sets settings');
  assert.equal(check(await member.db.from('hg_families').select('settings').eq('id',family).single(),'member reads settings').settings.settlement,true);
  assert.equal(check(await member.db.from('hg_families').update({settings:{settlement:false}}).eq('id',family).select('id'),'member cannot change settings').length,0);
  check(await member.db.from('hg_cards').update({perf_override_month:'2026-10-01',perf_override_amount:250000,perf_override_date:'2026-10-20'}).eq('id',card.id),'card override');
  assert.equal(check(await owner.db.from('hg_cards').select('perf_override_amount').eq('id',card.id).single(),'override visible').perf_override_amount,250000);
  console.log('PASS: family settings (owner-only), card performance override columns.');

  // Recurring expenses generate once per month on their day (run the job as admin with today\'s KST day).
  const kstDay=Number(new Date(Date.now()+9*3600*1000).toISOString().slice(8,10));
  const rec=check(await member.db.from('hg_recurring_expenses').insert({family_id:family,title:'QA 구독',amount:9900,day_of_month:kstDay,category:'생활',payment_method:'cash'}).select().single(),'create recurring');
  const gen1=check(await admin.rpc('hg_generate_recurring_expenses'),'run recurring job');
  assert.ok(Number(gen1)>=1,'job generated at least one expense');
  assert.equal(check(await admin.rpc('hg_generate_recurring_expenses'),'run job again'),0,'job is idempotent per month');
  assert.equal(check(await member.db.from('hg_expenses').select('id,source,reviewed').eq('family_id',family).eq('title','QA 구독'),'generated expense').length,1);
  check(await member.db.from('hg_recurring_expenses').delete().eq('id',rec.id),'remove recurring rule');
  // Auto-collect: token → ingest function → expense awaiting review; duplicates ignored; incoming transfers skipped.
  const tok=check(await member.db.from('hg_ingest_tokens').insert({family_id:family,user_id:member.id}).select('token').single(),'create ingest token');
  // Pairing passes only an expiring code through the URL scheme; collection URLs stay out of it.
  const issuePair=async()=>check(await member.db.rpc('hg_create_shortcut_pairing',{family}),'issue shortcut pairing');
  const claimPair=async code=>{
    const r=await fetch(`${url}/functions/v1/shortcut-pair`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
    return {status:r.status,json:await r.json().catch(()=>({}))};
  };
  assert.ok((await outsider.db.rpc('hg_create_shortcut_pairing',{family})).error,'cannot pair another family');
  assert.ok((await member.db.from('hg_shortcut_pairings').select('*')).error,'pairing hashes are server-only');
  const pairing=await issuePair();
  assert.ok(/^[0-9a-f]{48}$/.test(pairing.code),'pairing code format');
  const retainedToken=check(await member.db.from('hg_ingest_tokens').select('token').eq('family_id',family).single(),'existing SMS token after pairing');
  assert.ok(retainedToken.token===tok.token,'issuing a pairing code preserves the SMS token');
  assert.ok((await member.db.rpc('hg_claim_shortcut_pairing',{pair_code:pairing.code})).error,'members cannot call the privileged claim RPC directly');
  assert.equal(check(await member.db.rpc('hg_shortcut_pairing_status',{pair_code:pairing.code}),'pending state'),'pending');
  assert.equal(check(await outsider.db.rpc('hg_shortcut_pairing_status',{pair_code:pairing.code}),'isolated state'),'missing');
  const claimed=await claimPair(pairing.code);
  assert.equal(check(await member.db.rpc('hg_shortcut_pairing_status',{pair_code:pairing.code}),'claimed state'),'claimed');
  assert.equal(claimed.status,200);
  assert.ok(claimed.json.collect_url===`${url}/functions/v1/ingest?token=${tok.token}`,'claim returns the existing collection address');
  assert.equal(claimed.json.token,tok.token,'v2 token retained');
  assert.equal(claimed.json.ingest_url,`${url}/functions/v1/ingest`);
  const setupPing=await fetch(claimed.json.ingest_url,{method:'POST',headers:{'Content-Type':'application/json','x-ingest-token':claimed.json.token},body:JSON.stringify({body:'하라구리 연결 테스트',via:'ios-notification-setup'})});
  assert.ok((await setupPing.json()).test,'paired shortcut can reach ingest without creating an expense');
  assert.equal((await claimPair(pairing.code)).status,410,'pairing code is single-use');
  assert.equal((await claimPair('invalid')).status,400,'malformed codes are rejected');
  const expiredPair=await issuePair();
  check(await admin.from('hg_shortcut_pairings').update({expires_at:new Date(Date.now()-60000).toISOString()}).eq('family_id',family).eq('user_id',member.id),'expire temporary pairing');
  assert.equal(check(await member.db.rpc('hg_shortcut_pairing_status',{pair_code:expiredPair.code}),'expired state'),'expired');
  assert.equal((await claimPair(expiredPair.code)).status,410,'expired code is rejected');
  const supersededPair=await issuePair();
  const newestPair=await issuePair();
  assert.equal((await claimPair(supersededPair.code)).status,410,'new code supersedes an unused code');
  const claims=await Promise.all([claimPair(newestPair.code),claimPair(newestPair.code)]);
  assert.deepEqual(claims.map(r=>r.status).sort(),[200,410],'only one concurrent claim succeeds');
  console.log('PASS: shortcut pairing preserves SMS token; family isolation; one-use, expiration, supersession and atomic concurrent claim; setup ping creates no expense.');
  const ingest=(body)=>fetch(`${url}/functions/v1/ingest?token=${tok.token}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:body})}).then(async r=>({status:r.status,json:await r.json().catch(()=>({}))}));
  const first=await ingest('[Web발신]\nKB국민카드 1234승인\n김*한\n48,300원 일시불\n10/27 11:21\nQA 동네마트\n누적1,234,567원');
  assert.equal(first.status,200,`ingest status ${first.status}`); assert.ok(first.json.saved,'ingest saved an expense');
  const dup=await ingest('[Web발신]\nKB국민카드 1234승인\n김*한\n48,300원 일시불\n10/27 11:21\nQA 동네마트\n누적1,234,567원');
  assert.ok(dup.json.duplicate,`duplicate message ignored (status ${dup.status} ${JSON.stringify(dup.json)})`);
  const income=await ingest('[Web발신] 우리은행 입금 1,000,000원 급여 잔액 2,000,000원');
  assert.equal(income.json.ignored,'incoming transfer');
  const benefit=await ingest('[Web발신]\n[신한카드] 마일리지 적립 기준 변경 안내\n공정위 기업결합 승인에 따른 변경입니다.\n적용 예시: 1,000원당 1.5마일 → 1,000원당 1.23마일');
  assert.equal(benefit.status,200); assert.equal(benefit.json.ignored,'benefit notice'); assert.equal(benefit.json.inbox,'ignored');
  const transfer=await ingest('[Web발신] 우리은행 10/27 11:30 출금 350,000원 QA 월세 잔액 1,200,000원');
  assert.ok(transfer.json.saved,'bank transfer saved');
  const pending=check(await member.db.from('hg_expenses').select('id,title,amount,payment_method,reviewed,source').eq('family_id',family).eq('reviewed',false).order('title'),'pending rows');
  assert.equal(pending.length,2); assert.equal(pending.find(p=>p.title==='QA 월세').payment_method,'bank_transfer'); assert.equal(pending.find(p=>p.title==='QA 동네마트').source,'sms');
  check(await member.db.from('hg_expenses').update({reviewed:true}).eq('id',pending[0].id),'confirm a pending row');
  // Learned rule applies to collected messages; a cancellation message links to (and nets out) the matching purchase.
  check(await member.db.from('hg_category_rules').upsert({family_id:family,keyword:'qa 동네마트',category:'쇼핑',scope:'personal'},{onConflict:'family_id,keyword'}),'teach rule');
  assert.ok((await outsider.db.from('hg_category_rules').insert({family_id:family,keyword:'x',category:'기타'})).error,'Outsider cannot teach rules');
  const ruled=await ingest('[Web발신]\nKB국민카드 1234승인\n김*한\n12,000원 일시불\n10/28 09:00\nQA 동네마트\n누적1,246,567원');
  assert.ok(ruled.json.saved,'rule-governed ingest saved');
  const ruledRow=check(await member.db.from('hg_expenses').select('category,scope').eq('id',ruled.json.saved).single(),'ruled row');
  assert.equal(ruledRow.category,'쇼핑'); assert.equal(ruledRow.scope,'personal');
  const cancel=await ingest('[Web발신]\nKB국민카드 1234승인취소\n김*한\n48,300원\n10/28 09:05\nQA 동네마트');
  assert.ok(cancel.json.saved,'cancellation saved');
  const cancelRow=check(await member.db.from('hg_expenses').select('amount,cancels').eq('id',cancel.json.saved).single(),'cancel row');
  assert.equal(cancelRow.amount,-48300); assert.equal(cancelRow.cancels,first.json.saved,'cancellation links to the original purchase');
  assert.equal(check(await member.db.from('hg_expenses').select('canceled_by').eq('id',first.json.saved).single(),'original marked').canceled_by,cancel.json.saved);
  // Ingest v2: a notification payload (title/body/app) saves as source 'push'; the same purchase as SMS is then a duplicate;
  // every delivery is kept in hg_inbox with its outcome, so unreadable text is never lost; members read/delete, outsiders see nothing.
  const post=(body)=>fetch(`${url}/functions/v1/ingest?token=${tok.token}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(async r=>({status:r.status,json:await r.json().catch(()=>({}))}));
  const beforeRewardPush=check(await member.db.from('hg_expenses').select('id').eq('family_id',family),'expenses before reward push').length;
  const rewardPush=await post({body:'30,000원 이상 결제 시 1,000원 캐시백을 드려요.',app:'토스',via:'ios-shortcut'});
  assert.equal(rewardPush.json.ignored,'benefit notice','app reward offers are also excluded');
  const quizPush=await post({body:'오늘도 퀴즈 맞히고 최대 10원 받아가세요.',via:'ios-notification'});
  assert.equal(quizPush.json.ignored,'benefit notice','a real-shaped quiz promotion is not an expense');
  for (const body of ['출석 티켓이 충전됐어요. (날씨 체크 알림)', '순금 복권 응모장 1장이 생겼어요\n오늘 응모하지 않으면 사라져요.', '포인트 도착 🎉\n1원 받았어요'.normalize('NFD'), '8원 받았어요'.normalize('NFD'), '부가세 예정고지 납부 기한이 3일 남았어요. (토스인컴 알림)']) {
    const notice=await post({body,via:'ios-notification'});
    assert.equal(notice.json.inbox,'ignored','observed engagement and decomposed point notices are ignored');
  }
  assert.equal(check(await member.db.from('hg_expenses').select('id').eq('family_id',family),'expenses after reward notices').length,beforeRewardPush,'reward notices never create an expense');
  const pushRes=await post({title:'신한카드',body:'승인 홍*동 4,500원 일시불 10/27 08:15 QA 스타벅스',app:'신한 SOL페이'});
  assert.ok(pushRes.json.saved,`notification payload saved (${JSON.stringify(pushRes.json)})`);
  const pushRow=check(await member.db.from('hg_expenses').select('source,title,amount').eq('id',pushRes.json.saved).single(),'push row');
  assert.equal(pushRow.source,'push'); assert.equal(pushRow.title,'QA 스타벅스'); assert.equal(pushRow.amount,4500);
  const smsTwin=await ingest('[Web발신] 신한카드 승인 홍*동 4,500원 일시불 10/27 08:15 QA 스타벅스 누적 100,000원');
  assert.ok(smsTwin.json.duplicate,'the same purchase arriving as SMS is a duplicate of the push');
  const junk=await ingest('QA 읽을 수 없는 알림 본문');
  assert.equal(junk.json.inbox,'unparsed','unreadable text is kept, not dropped');
  const empty=await post({body:''});
  assert.equal(empty.status,400,'empty delivery rejected'); assert.equal(empty.json.inbox,'unparsed','empty delivery still recorded');
  const ping=await post({text:'하라구리 연결 테스트',via:'test'});
  assert.ok(ping.json.test,'connection test answered');
  const inboxRows=check(await member.db.from('hg_inbox').select('status,via,raw,expense_id').eq('family_id',family),'inbox rows');
  assert.ok(inboxRows.some(r=>r.status==='saved'&&r.via==='ios-shortcut'&&r.expense_id===pushRes.json.saved),'push delivery recorded as saved from an iPhone shortcut');
  assert.ok(inboxRows.some(r=>r.status==='duplicate'),'duplicate delivery recorded');
  assert.ok(inboxRows.some(r=>r.status==='unparsed'&&r.raw==='QA 읽을 수 없는 알림 본문'),'unreadable text kept in the inbox');
  assert.ok(inboxRows.some(r=>r.status==='ignored'&&r.via==='test'),'connection test recorded');
  assert.ok(inboxRows.some(r=>r.status==='ignored'&&r.raw==='오늘도 퀴즈 맞히고 최대 10원 받아가세요.'&&r.expense_id===null),'quiz promotion retained without an expense');
  assert.equal(inboxRows.filter(r=>r.status==='ignored'&&r.expense_id===null&&/마일리지 적립 기준 변경 안내|캐시백을 드려요/.test(r.raw)).length,2,'both reward notices remain in the inbox without an expense');
  assert.equal((await outsider.db.from('hg_inbox').select('id').eq('family_id',family)).data.length,0,'inbox is private to the family');
  check(await member.db.from('hg_inbox').delete().eq('family_id',family).eq('status','unparsed'),'member clears an unreadable row');
  assert.equal(check(await member.db.from('hg_ingest_tokens').select('received').eq('token',tok.token).single(),'token counter').received,5);
  assert.ok((await outsider.db.from('hg_ingest_tokens').select('token').eq('family_id',family)).data.length===0,'tokens are private');
  for (const body of ['3원 적립','105원을 토스뱅크 아이 통장에 쏙! 넣어드렸어요.','69,900원에서 10,640원으로 내렸어요']) {
    assert.equal((await post({body,via:'ios-notification'})).json.inbox,'ignored','weekend non-payment regression');
  }
  assert.equal((await post({body:'[입금] 5,800원 9002-000-000*** 잔액 8,656원 11/02 04:45 간편결제할인',via:'ios-notification'})).json.ignored,'incoming transfer');
  const face=await post({title:'38,300원 결제',body:'페이스페이 (올바른POINT체크, 일시불) · QA 와플 베르비에',via:'ios-notification'});
  assert.ok(face.json.saved,'title-only amount makes a complete payment');
  const faceRow=check(await member.db.from('hg_expenses').select('title,amount,category').eq('id',face.json.saved).single(),'facepay row');
  assert.deepEqual(faceRow,{title:'QA 와플 베르비에',amount:38300,category:'식비'});
  const transferRecord=check(await owner.db.from('hg_expenses').insert({family_id:family,created_by:owner.id,title:'QA 본인 계좌 이동',amount:500000,date:'2026-11-01',category:'자금 이동',payment_method:'bank_transfer',kind:'transfer'}).select('id').single(),'internal transfer record');
  assert.ok(transferRecord.id,'internal transfer retains a ledger record');
  console.log('PASS: recurring generation idempotent; ingest token → parsed expense awaiting review; duplicate/incoming handling; bank transfer channel; learned rules and cancellation links; notification payload → push source, SMS twin deduped, inbox keeps every delivery.');
  // Envelopes, settlements, and the weekly digest endpoint.
  const env=check(await owner.db.from('hg_envelopes').insert({family_id:family,name:'QA 봉투',target:300000,due_month:'2027-06-01'}).select().single(),'envelope');
  check(await member.db.from('hg_envelope_entries').insert({family_id:family,envelope_id:env.id,amount:50000}),'member deposits');
  assert.ok((await outsider.db.from('hg_envelope_entries').insert({family_id:family,envelope_id:env.id,amount:1})).error,'Outsider cannot deposit');
  assert.equal(check(await owner.db.from('hg_envelope_entries').select('amount').eq('envelope_id',env.id),'entries visible').length,1);
  check(await member.db.from('hg_settlements').upsert({family_id:family,month:'2026-10-01'},{onConflict:'family_id,month'}),'mark settled');
  assert.equal(check(await owner.db.from('hg_settlements').select('month').eq('family_id',family),'settlement visible').length,1);
  assert.ok((await outsider.db.from('hg_settlements').select('month').eq('family_id',family)).data.length===0,'settlements private to the family');
  // The digest reaches real families, so ordinary integration checks must not send it.
  if (config.HOOK_SECRET && process.env.VERIFY_WEEKLY_DIGEST==='1') { const weekly=await fetch(`${url}/functions/v1/push`,{method:'POST',headers:{'Content-Type':'application/json','x-haraguri-secret':config.HOOK_SECRET},body:JSON.stringify({kind:'weekly'})}); assert.equal(weekly.status,200,'weekly digest endpoint'); console.log('PASS: explicitly requested weekly digest endpoint.'); }
  console.log('PASS: envelopes and deposits (members only), month settlement marks.');
  // Push preferences live on the device row and are private.
  const subRow=check(await member.db.from('hg_push_subscriptions').insert({user_id:member.id,endpoint:`https://example.invalid/push/${randomUUID()}`,p256dh:'p',auth:'a'}).select('id').single(),'register fake subscription');
  check(await member.db.from('hg_push_subscriptions').update({prefs:{messages:false,files:true,daily:true,eve:false,ingest:true},quiet_start:22,quiet_end:7}).eq('id',subRow.id),'save prefs');
  assert.equal(check(await owner.db.from('hg_push_subscriptions').select('id').eq('id',subRow.id),'subscriptions are private').length,0);
  check(await member.db.from('hg_push_subscriptions').delete().eq('id',subRow.id),'remove fake subscription');
  console.log('PASS: per-device push preferences and quiet hours; subscriptions private.');

  if (process.argv[2]) {
    const require=createRequire(import.meta.url);
    const {chromium}=require(process.argv[2]);
    browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(session=>localStorage.setItem('haraguri-auth',JSON.stringify(session)),owner.session);
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:3004');
    await page.getByRole('heading',{name:'우리의 하루를 함께.'}).waitFor();
    await page.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'일정·할 일'}).click();
    await page.getByLabel('조회 월').fill('2026-10');
    await page.getByRole('button',{name:/실제 DB 반복 할 일 검증/}).first().click();
    const dialog=page.getByRole('dialog');
    await dialog.locator('.chat-bubble:not(.pending)').filter({hasText:'가족 댓글 동기화 검증'}).waitFor();
    await dialog.getByLabel('메시지',{exact:true}).fill('브라우저 실제 저장 검증');
    await dialog.getByRole('button',{name:'보내기',exact:true}).click();
    await dialog.locator('.chat-bubble:not(.pending)').filter({hasText:'브라우저 실제 저장 검증'}).waitFor();
    assert.equal(check(await member.db.from('hg_comments').select('*').eq('body','브라우저 실제 저장 검증'),'read browser comment').length,1);
    const before=check(await owner.db.from('hg_attachments').select('id'),'attachments before browser upload').length;
    await dialog.locator('input[type=file]').setInputFiles({name:'browser-photo.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKXcAAAAASUVORK5CYII=','base64')});
    await dialog.getByRole('button',{name:/browser-photo.png/}).waitFor();
    assert.equal(check(await owner.db.from('hg_attachments').select('id'),'attachments after browser upload').length,before+1);
    await page.reload();
    await page.getByRole('heading',{name:'우리의 하루를 함께.'}).waitFor();
    await page.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'일정·할 일'}).click();
    await page.getByLabel('조회 월').fill('2026-10');
    await page.getByRole('button',{name:/실제 DB 반복 할 일 검증/}).first().click();
    await page.getByRole('dialog').locator('.chat-bubble:not(.pending)').filter({hasText:'브라우저 실제 저장 검증'}).waitFor();
    await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
    await page.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'가계부'}).click();
    await page.locator('details.fold').filter({hasText:'카드별 실적'}).locator(':scope > summary').click(); // card section is folded by default
    await page.getByRole('button',{name:'QA card 설정'}).click();
    await page.getByRole('dialog').locator('select[name=card_type]').selectOption('debit');
    await page.getByRole('dialog').getByRole('button',{name:'저장하기'}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(check(await owner.db.from('hg_cards').select('card_type').eq('id',card.id).single(),'browser card edit').card_type,'debit');
    await page.getByRole('button',{name:/^필터/}).click(); // filters are folded by default
    await page.getByRole('group',{name:'결제 수단 필터'}).getByRole('button',{name:'계좌이체',exact:true}).click();
    await page.getByText('QA transfer',{exact:true}).waitFor();
    assert.equal(await page.getByText('QA expense',{exact:true}).count(),0);
    await page.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'대화',exact:true}).click();
    const secondContext=await browser.newContext({viewport:{width:390,height:844}});
    const second=await secondContext.newPage();
    await second.addInitScript(session=>localStorage.setItem('haraguri-auth',JSON.stringify(session)),member.session);
    await second.goto(process.env.BASE_URL || 'http://127.0.0.1:3004');
    await second.getByRole('heading',{name:'우리의 하루를 함께.'}).waitFor();
    await second.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'대화',exact:true}).click();
    await page.getByText('실시간 연결됨',{exact:true}).waitFor();
    await second.getByText('실시간 연결됨',{exact:true}).waitFor();
    await page.getByLabel('메시지',{exact:true}).fill('실시간 기본방 전송');
    await page.getByRole('button',{name:'보내기',exact:true}).click();
    await second.locator('.chat-bubble:not(.pending)').filter({hasText:'실시간 기본방 전송'}).waitFor({timeout:8000});
    // The open, visible general chat marks itself read on the second browser (UI path of hg_mark_read), so the member's unread count drops to 0.
    await second.waitForFunction(()=>true);
    for (let i=0;i<10;i++){ const rows=check(await admin.from('hg_room_reads').select('user_id').eq('family_id',family).eq('user_id',member.id).is('entry_id',null),'member read row'); if(rows.length) break; await new Promise(r=>setTimeout(r,500)); }
    assert.equal(check(await admin.from('hg_room_reads').select('user_id').eq('family_id',family).eq('user_id',member.id).is('entry_id',null),'member read row after wait').length,1,'Visible general chat should be marked read automatically');
    assert.equal(check(await member.db.rpc('hg_unread_summary',{target:member.id}),'member unread after reading').filter(r=>r.entry_id===null).length,0);
    for(const activePage of [page,second]) {
      await activePage.getByRole('group',{name:'대화 종류'}).getByRole('button',{name:'일정·구매별 대화'}).click();
      await activePage.getByRole('button',{name:/QA 구매 대화/}).click();
      assert.equal(await activePage.getByRole('dialog').locator('.chat-bubble:not(.pending)').filter({hasText:'실시간 기본방 전송'}).count(),0);
    }
    await second.getByRole('dialog').getByLabel('메시지',{exact:true}).fill('구매방 실시간 답장');
    await second.getByRole('dialog').getByRole('button',{name:'보내기',exact:true}).click();
    await page.getByRole('dialog').locator('.chat-bubble:not(.pending)').filter({hasText:'구매방 실시간 답장'}).waitFor({timeout:8000});
    await page.getByRole('dialog').getByText('QA expense',{exact:true}).waitFor();
    await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
    await page.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'가족 설정'}).click();
    await page.locator('input[name=space_name]').fill('QA 친구 여행');
    await page.getByRole('button',{name:'모임 생성하기',exact:true}).click();
    await page.getByRole('heading',{name:'우리의 하루를 함께.'}).waitFor();
    const newFamily=check(await admin.from('hg_families').select().eq('owner_id',owner.id).eq('name','QA 친구 여행').single(),'find new space');
    familyIds.push(newFamily.id);
    assert.equal(await page.getByLabel('현재 모임',{exact:true}).inputValue(),newFamily.id);
    assert.equal(check(await member.db.from('hg_families').select().eq('id',newFamily.id),'uninvited member denied').length,0);
    await page.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'대화',exact:true}).click();
    await page.getByRole('group',{name:'대화 종류'}).getByRole('button',{name:'가족 기본 채팅',exact:true}).click();
    assert.equal(await page.locator('.chat-bubble:not(.pending)').filter({hasText:'실시간 기본방 전송'}).count(),0);
    await page.getByLabel('메시지',{exact:true}).fill('친구 모임 전용');
    await page.getByRole('button',{name:'보내기',exact:true}).click();
    await page.locator('.chat-bubble:not(.pending)').filter({hasText:'친구 모임 전용'}).waitFor();
    assert.equal(check(await member.db.from('hg_comments').select().eq('family_id',newFamily.id),'group chat isolation').length,0);
    await page.getByLabel('현재 모임',{exact:true}).selectOption(family);
    await page.locator('.chat-bubble:not(.pending)').filter({hasText:'실시간 기본방 전송'}).waitFor();
    assert.equal(await page.locator('.chat-bubble:not(.pending)').filter({hasText:'친구 모임 전용'}).count(),0);
    await page.reload();
    await page.getByRole('heading',{name:'우리의 하루를 함께.'}).waitFor();
    assert.equal(await page.getByLabel('현재 모임',{exact:true}).inputValue(),family);
    // Targeted invite: the owner registers the member's email (any case); the member sees it after login and joins without a code.
    check(await owner.db.from('hg_invite_targets').insert({family_id:newFamily.id,target:member.email.toUpperCase()}),'register invite target');
    assert.ok((await outsider.db.from('hg_invite_targets').insert({family_id:newFamily.id,target:outsider.email})).error,'Outsider cannot register invite targets for a family they are not in');
    assert.deepEqual(check(await outsider.db.rpc('hg_my_invites'),'outsider sees no invites'),[]);
    const mine=check(await member.db.rpc('hg_my_invites'),'member sees targeted invite');
    assert.equal(mine.length,1); assert.equal(mine[0].family_id,newFamily.id); assert.equal(mine[0].family_name,'QA 친구 여행'); assert.equal(mine[0].invited_by_name,'검증 소유자');
    assert.ok((await outsider.db.rpc('hg_accept_invite',{family:newFamily.id,member_name:'침입'})).error,'Outsider cannot accept an invite that is not theirs');
    assert.equal(check(await member.db.rpc('hg_accept_invite',{family:newFamily.id,member_name:'친구'}),'accept targeted invite'),newFamily.id);
    assert.equal(check(await owner.db.from('hg_invite_targets').select().eq('family_id',newFamily.id),'target consumed on join').length,0);
    assert.deepEqual(check(await member.db.rpc('hg_my_invites'),'no invites left'),[]);
    assert.ok((await member.db.rpc('hg_accept_invite',{family:newFamily.id,member_name:'친구'})).error,'Second accept is rejected');
    assert.equal(check(await member.db.from('hg_families').select(),'multiple memberships').length,2);
    console.log('PASS: targeted invite by email/nickname — visible only to the invitee, outsider blocked, consumed on join.');
    assert.equal(check(await outsider.db.from('hg_families').select(),'outsider remains isolated').length,1);
    console.log('PASS: create/switch/persist group spaces; uninvited members cannot read; one user joins multiple groups.');
    await secondContext.close();
    console.log('PASS: two authenticated browsers exchange real-time general/work messages without polling; linked expense visible.');
    assert.deepEqual(errors,[]);
    console.log('PASS: authenticated mobile browser, real comment/photo upload, persistence after reload.');
  }
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({path:'/tmp/haraguri-connected-failure.png'}).catch(()=>{});
    console.error('Browser state:', (await page.locator('body').innerText()).slice(-2500));
  }
  throw error;
} finally {
  await browser?.close();
  for (const family of familyIds) {
    const attachments=check(await admin.from('hg_attachments').select('path').eq('family_id',family),'find test attachments');
    const paths=[...new Set([...uploads.filter(p=>p.startsWith(family+'/')),...attachments.map(f=>f.path)])];
    if(paths.length) check(await admin.storage.from('haraguri-files').remove(paths),'remove test files');
    check(await admin.from('hg_attachments').delete().eq('family_id',family),'remove test file metadata');
    check(await admin.from('hg_families').delete().eq('id',family),'remove test family');
  }
  for (const id of userIds) check(await admin.auth.admin.deleteUser(id),'remove test user');
  console.log('Temporary verification families, users and files cleaned up.');
}
