// Integration checks against HARAGURI only; creates and removes isolated temporary fixtures.
// Never sends email. Never prints tokens, passwords, keys or signed URLs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';

const readEnv = file => Object.fromEntries(readFileSync(new URL(file, import.meta.url), 'utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const config = {...readEnv('../.env.local'),...readEnv('../.env.supabase-admin')};
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
    actors.push({db,id:created.user.id,session});
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
    await dialog.locator('.chat-bubble').filter({hasText:'가족 댓글 동기화 검증'}).waitFor();
    await dialog.getByLabel('메시지',{exact:true}).fill('브라우저 실제 저장 검증');
    await dialog.getByRole('button',{name:'보내기',exact:true}).click();
    await dialog.locator('.chat-bubble').filter({hasText:'브라우저 실제 저장 검증'}).waitFor();
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
    await page.getByRole('dialog').locator('.chat-bubble').filter({hasText:'브라우저 실제 저장 검증'}).waitFor();
    await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
    await page.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'가계부'}).click();
    await page.getByRole('button',{name:'QA card 설정'}).click();
    await page.getByRole('dialog').locator('select[name=card_type]').selectOption('debit');
    await page.getByRole('dialog').getByRole('button',{name:'저장하기'}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(check(await owner.db.from('hg_cards').select('card_type').eq('id',card.id).single(),'browser card edit').card_type,'debit');
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
    await second.locator('.chat-bubble').filter({hasText:'실시간 기본방 전송'}).waitFor({timeout:8000});
    for(const activePage of [page,second]) {
      await activePage.getByRole('group',{name:'대화 종류'}).getByRole('button',{name:'일정·구매별 대화'}).click();
      await activePage.getByRole('button',{name:/QA 구매 대화/}).click();
      assert.equal(await activePage.getByRole('dialog').locator('.chat-bubble').filter({hasText:'실시간 기본방 전송'}).count(),0);
    }
    await second.getByRole('dialog').getByLabel('메시지',{exact:true}).fill('구매방 실시간 답장');
    await second.getByRole('dialog').getByRole('button',{name:'보내기',exact:true}).click();
    await page.getByRole('dialog').locator('.chat-bubble').filter({hasText:'구매방 실시간 답장'}).waitFor({timeout:8000});
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
    assert.equal(await page.locator('.chat-bubble').filter({hasText:'실시간 기본방 전송'}).count(),0);
    await page.getByLabel('메시지',{exact:true}).fill('친구 모임 전용');
    await page.getByRole('button',{name:'보내기',exact:true}).click();
    await page.locator('.chat-bubble').filter({hasText:'친구 모임 전용'}).waitFor();
    assert.equal(check(await member.db.from('hg_comments').select().eq('family_id',newFamily.id),'group chat isolation').length,0);
    await page.getByLabel('현재 모임',{exact:true}).selectOption(family);
    await page.locator('.chat-bubble').filter({hasText:'실시간 기본방 전송'}).waitFor();
    assert.equal(await page.locator('.chat-bubble').filter({hasText:'친구 모임 전용'}).count(),0);
    await page.reload();
    await page.getByRole('heading',{name:'우리의 하루를 함께.'}).waitFor();
    assert.equal(await page.getByLabel('현재 모임',{exact:true}).inputValue(),family);
    const secondCode=check(await owner.db.rpc('hg_invite',{family:newFamily.id}),'invite second space');
    check(await member.db.rpc('hg_join_family',{invite_code:secondCode,member_name:'친구'}),'join second space');
    assert.equal(check(await member.db.from('hg_families').select(),'multiple memberships').length,2);
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
