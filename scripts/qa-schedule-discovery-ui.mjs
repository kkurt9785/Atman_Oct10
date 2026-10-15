// Isolated UI checks: never registers staff or submits a real application.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,readdir,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.argv[2]||'playwright-core');
const {build}=require('../apps/worker-web/node_modules/esbuild');
const directory=await mkdtemp(path.join(tmpdir(),'itdot-schedule-ui-'));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
for(const admin of [true,false]){
 const app=path.resolve('apps',admin?'admin-web':'worker-web');
 const source=admin?`
 import{StaffRegistrationForm}from'./app/staff/StaffRegistrationForm';window.submissions=[];
 createRoot(document.getElementById('root')).render(<StaffRegistrationForm facilityType='clinic' workerKind='gig'/>);
 `:`
 import Page from './app/shifts/page';window.failure=false;window.discoveryCalls=[];
 window.day=new Date(Date.now()+10*86400000).toISOString().slice(0,10);
 window.nextDay=new Date(Date.now()+11*86400000).toISOString().slice(0,10);
 const row=(id,time,wage,distance,date=window.day)=>({id,facility_id:id,facility_name:id,shift_date:date,start_time:time,end_time:'23:00',required_role:'rn',hourly_wage:wage,estimated_total_pay:wage*8,description:'업무',distance_m:distance});
 const rows=[row('늦은근무','18:00',30000,1000),row('이른근무','09:00',15000,5000),row('다음날근무','10:00',20000,null,window.nextDay)];
 window.client={auth:{getUser:async()=>({data:{user:{id:'me'}},error:null})},
 from:table=>{const data=table==='workers'?{id:'worker',role:'rn',verification_status:'approved'}:table==='worker_location_prefs'?{locations:[{label:'수원 팔달구'},{label:'수원 영통구'}]}:[];const q={then:resolve=>Promise.resolve({data,error:null}).then(resolve)};for(const k of ['select','eq','in','maybeSingle'])q[k]=()=>q;return q;},
 rpc:async(name,args)=>{window.discoveryCalls.push(args);return window.failure?{data:null,error:{message:'offline'}}:{data:args.p_pref_labels?rows.slice(0,1):rows,error:null};}};
 createRoot(document.getElementById('root')).render(<Page/>);
 `;
 const bundle=await build({stdin:{contents:"import React from 'react';import{createRoot}from'react-dom/client';"+source,loader:'tsx',resolveDir:app},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'qa',setup(b){
  b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'qa'}));b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'qa'}));
  b.onResolve({filter:/^@\/lib\/actions\/clinic-workforce$/},()=>({path:'actions',namespace:'qa'}));
  b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'supabase',namespace:'qa'}));
  b.onResolve({filter:/^@\/components\/shifts\/(ApplySheet|FacilitySheet)$/},args=>({path:args.path.split('/').at(-1),namespace:'qa'}));
  b.onLoad({filter:/.*/,namespace:'qa'},args=>({resolveDir:app,contents:args.path==='link'?"import React from 'react';export default function Link(p){return React.createElement('a',p,p.children)}":args.path==='navigation'?"export const useRouter=()=>({refresh(){}});":args.path==='actions'?"export const runWorkforceAction=async(kind,data)=>{window.submissions.push(Object.fromEntries(data));return {ok:false,error:'검증용 응답: 등록하지 않음'}};":args.path==='supabase'?"export const supabase=new Proxy({},{get:(_,key)=>window.client[key]});":`export const ${args.path}=()=>null;`}));
 }}]});
 const cssDir=path.join(app,'.next/static/css');const css=(await Promise.all((await readdir(cssDir)).filter(f=>f.endsWith('.css')).map(f=>readFile(path.join(cssDir,f),'utf8')))).join('\n').replace(/@import\s+[^;]+;/g,'');
 for(const width of [360,390]){
  const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.abort());await page.setContent('<html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});
  if(admin){
   await page.getByRole('button',{name:'연속 며칠',exact:true}).click();
   const start=page.getByLabel('근무 시작일',{exact:true}),end=page.getByLabel('근무 종료일',{exact:true});
   await start.fill('2026-10-21');await page.getByRole('button',{name:'종료일 달력',exact:true}).click();
   await page.getByRole('button',{name:'2026-10-19',exact:true}).click();
   assert.equal(await start.inputValue(),'2026-10-19');assert.equal(await end.inputValue(),'2026-10-21');
   await page.getByRole('button',{name:'2026-10-22',exact:true}).click();assert.equal(await start.inputValue(),'2026-10-19');assert.equal(await end.inputValue(),'2026-10-22');
   await page.getByRole('button',{name:'시작일 달력',exact:true}).click();await page.getByRole('button',{name:'2026-10-20',exact:true}).click();assert.equal(await end.inputValue(),'2026-10-22');
   await start.fill('2026-12-31');await end.fill('');await page.getByRole('button',{name:'종료일 달력',exact:true}).click();await page.getByRole('button',{name:'다음 달',exact:true}).click();await page.getByRole('button',{name:'2027-01-02',exact:true}).click();
   assert.equal(await end.inputValue(),'2027-01-02');await page.getByRole('button',{name:'기간 적용',exact:true}).click();
   await start.fill('2026-12-19');await end.fill('2026-12-21');await page.getByLabel('이름',{exact:true}).fill('검증 근무자');
   await page.getByRole('button',{name:'근무자 등록하고 일회용 초대 만들기',exact:true}).evaluate(b=>{b.click();b.click();});
   await page.getByRole('alert').waitFor();const submissions=await page.evaluate(()=>window.submissions);assert.equal(submissions.length,1);assert.equal(submissions[0].schedule_mode,'range');assert.equal(submissions[0].contract_start,'2026-12-19');assert.equal(submissions[0].contract_end,'2026-12-21');
   await page.getByRole('button',{name:'요일 반복',exact:true}).click();assert.equal(await page.getByRole('checkbox').count(),7);
   await page.getByRole('button',{name:'시작일 달력',exact:true}).click();
  }else{
   const list=page.getByRole('region',{name:'근무 공고'});await list.waitFor();
   const names=()=>list.locator('p.truncate').allTextContents();
   // Facility names share a stable font class; use DOM text order for ordering proof.
   const text=await list.innerText();assert.ok(text.indexOf('이른근무')<text.indexOf('늦은근무'));
   await page.getByLabel('공고 정렬').selectOption('wage');let sorted=await list.innerText();assert.ok(sorted.indexOf('늦은근무')<sorted.indexOf('다음날근무')&&sorted.indexOf('다음날근무')<sorted.indexOf('이른근무'));
   await page.getByLabel('공고 정렬').selectOption('distance');sorted=await list.innerText();assert.ok(sorted.indexOf('늦은근무')<sorted.indexOf('이른근무'));
   await page.getByRole('button',{name:'날짜 선택',exact:true}).click();const day=await page.evaluate(()=>window.nextDay);await page.getByLabel('가능한 시작일').fill(day);await page.getByLabel('가능한 종료일').fill(day);await page.getByRole('heading',{name:'근무 1건',exact:true}).waitFor();assert.ok((await list.innerText()).includes('다음날근무'));
   await page.getByRole('button',{name:'전체 날짜',exact:true}).click();await page.getByRole('button',{name:'수원 영통구',exact:true}).click();await page.getByRole('heading',{name:'근무 1건',exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>window.discoveryCalls.at(-1).p_pref_labels),['수원 영통구']);
   await page.evaluate(()=>{window.failure=true;});await page.getByRole('button',{name:'두 지역 함께',exact:true}).click();await page.getByRole('button',{name:'다시 불러오기',exact:true}).waitFor();assert.equal(await page.getByText('조건에 맞는 근무가 없어요',{exact:true}).count(),0);
   await page.evaluate(()=>{window.failure=false;});await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();await page.getByRole('heading',{name:'근무 3건',exact:true}).waitFor();
  }
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(directory,`${admin?'schedule':'discovery'}-${width}.png`),fullPage:true});await page.close();console.log(`PASS ${admin?'schedule: reversed dates, endpoint editing, year boundary, multiday payload, duplicate prevention':'discovery: chronological/wage/distance ordering, date range, two-area RPC scope, failure recovery'} ${width}px`);
 }
}
console.log(`Screenshots: ${directory}`);
}finally{await browser.close();}
