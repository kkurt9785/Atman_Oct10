// Actual chat/workroom components with isolated services: no backend writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.argv[2]||'playwright-core');
const {build}=require('../apps/worker-web/node_modules/esbuild');
const directory=await mkdtemp(path.join(tmpdir(),'itdot-remaining-ui-'));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 for(const appName of ['worker-web','admin-web']){
  const app=path.resolve('apps',appName),admin=appName==='admin-web';
  const bundle=await build({stdin:{contents:`
    import React from 'react';import{createRoot}from'react-dom/client';
    import{MatchChatView}from'./components/safety/MatchChatView';
    ${admin?"import{WorkroomClient}from'./app/workroom/WorkroomClient';":''}
    window.calls=[];window.historyFailure=false;window.room='first';
    const message={id:'00000000-0000-4000-8000-000000000001',sender_type:'${admin?'worker':'facility'}',sender_id:'peer',sender_user_id:'peer',sender_name:'상대방',body:'긴 메시지 '+ '가'.repeat(160),created_at:'2026-10-14T01:00:00Z',metadata:{},staff_id:null,facility_id:'facility',message_type:'message'};
    const client={auth:{getUser:async()=>({data:{user:{id:'me'}},error:null}),getSession:async()=>({data:{session:null}})},
      from:()=>{const q={then:resolve=>Promise.resolve(window.historyFailure?{error:{message:'offline'},data:null}:{data:[message],error:null}).then(resolve)};for(const k of ['select','eq','is','or','lt','order','limit'])q[k]=()=>q;return q;},
      rpc:async(name,args)=>{if(name==='chat_is_open')return{data:true,error:null};if(name==='get_workroom_check_status')return{data:[],error:null};if(name.startsWith('mark_'))return{data:null,error:null};return new Promise((resolve,reject)=>window.calls.push({name,args,resolve,reject}));},
      channel:()=>{const channel={on:()=>channel,subscribe:()=>channel};return channel;},removeChannel:async()=>{}};
    window.client=client;
    const root=createRoot(document.getElementById('root'));let version=0;
    window.mount=(kind='chat')=>{window.calls=[];root.render(${admin?"kind==='workroom'?<WorkroomClient key={++version} facilityId='facility' facilityName='검증 사업장' members={[{id:'staff',name:'근무자',workerLinked:true}]} initialStaffId=''/>:":''}<MatchChatView key={++version} client={client} applicationId='application' variant='${admin?'admin':'worker'}' title='검증 대화' subtitle='안전한 대화'/>);};window.mount();
  `,loader:'tsx',resolveDir:app},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'isolated',setup(b){
    b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'qa'}));
    b.onResolve({filter:/^@\/lib\/supabase(-browser)?$/},()=>({path:'supabase',namespace:'qa'}));
    b.onLoad({filter:/.*/,namespace:'qa'},args=>({resolveDir:app,contents:args.path==='link'?"import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}":"export const supabase=new Proxy({}, {get:(_,key)=>window.client[key]});"}));
  }}]});
  const cssDir=path.join(app,'.next/static/css');
  const css=(await Promise.all((await readdir(cssDir)).filter(f=>f.endsWith('.css')).map(f=>readFile(path.join(cssDir,f),'utf8')))).join('\n').replace(/@import\s+[^;]+;/g,'');
  for(const width of [360,390]){
    const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.abort());
    await page.setContent('<html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>');
    await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});
    const input=page.getByRole('textbox',{name:'메시지',exact:true});
    await input.fill('실패해도 남길 메시지');
    await page.getByRole('button',{name:'전송',exact:true}).evaluate(b=>{b.click();b.click();});
    assert.equal(await page.evaluate(()=>window.calls.length),1);
    await page.evaluate(()=>window.calls.at(-1).reject(new Error('연결 실패')));
    await page.getByRole('alert').waitFor();assert.equal(await input.inputValue(),'실패해도 남길 메시지');
    await page.getByRole('button',{name:'전송',exact:true}).click();
    await input.fill('전송 도중 새로 작성한 메시지');
    await page.evaluate(()=>window.calls.at(-1).resolve({data:{id:'sent',sender_type:'worker',sender_id:'me',body:'전송된 내용',created_at:'2026-10-14T02:00:00Z'},error:null}));
    await page.getByText('전송된 내용',{exact:true}).waitFor();assert.equal(await input.inputValue(),'전송 도중 새로 작성한 메시지');
    await page.getByRole('button',{name:/메시지 신고·차단/}).first().click();
    await page.getByRole('button',{name:'이 메시지 신고하기'}).click();
    await page.getByRole('textbox',{name:'추가 설명 (선택)'}).fill('검토 부탁합니다');
    await page.getByRole('button',{name:'신고 접수',exact:true}).evaluate(b=>{b.click();b.click();});
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='report_safety_message').length),1);
    await page.evaluate(()=>window.calls.at(-1).resolve({data:null,error:{message:'신고 연결 실패'}}));
    await page.getByRole('alert').filter({hasText:'신고 연결 실패'}).waitFor();
    assert.equal(await page.getByRole('textbox',{name:'추가 설명 (선택)'}).inputValue(),'검토 부탁합니다');
    await page.setViewportSize({width,height:480});
    const bounds=await page.getByRole('dialog').boundingBox();assert.ok(bounds.x>=0&&bounds.width<=width&&bounds.height<=480);
    await page.getByRole('button',{name:'닫기',exact:true}).click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(directory,`${appName}-${width}-chat.png`),fullPage:true});
    await page.evaluate(()=>{window.historyFailure=true;window.mount();});
    await page.getByRole('button',{name:'다시 불러오기',exact:true}).waitFor();
    assert.equal(await page.getByText('아직 대화가 없어요',{exact:true}).count(),0);
    await page.evaluate(()=>{window.historyFailure=false;});await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();await input.fill('복구됨');
    if(admin){
      await page.setViewportSize({width,height:844});await page.evaluate(()=>window.mount('workroom'));
      const roomInput=page.getByRole('textbox',{name:'워크룸 메시지'});await roomInput.fill('전체방 작성 중');
      await page.getByRole('button',{name:'근무자',exact:true}).click();await roomInput.fill('개인방 작성 중');
      await page.getByRole('button',{name:'전체 공지',exact:true}).click();await page.waitForFunction(()=>document.querySelector('textarea[aria-label="워크룸 메시지"]')?.value==='전체방 작성 중');
      await page.getByRole('button',{name:'전송',exact:true}).evaluate(b=>{b.click();b.click();});
      assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='send_facility_workroom_message').length),1);
      await page.evaluate(()=>window.calls.at(-1).reject(new Error('전송 실패')));await page.getByRole('alert').waitFor();
      assert.equal(await roomInput.inputValue(),'전체방 작성 중');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:path.join(directory,`${appName}-${width}-workroom.png`),fullPage:true});
    }
    assert.deepEqual(errors,[]);await page.close();console.log(`PASS ${appName} ${width}px: single-flight, failure recovery, draft preservation, report dialog, mobile layout${admin?', room draft isolation':''}`);
  }
 }
 console.log(`Screenshots: ${directory}`);
}finally{await browser.close();}
