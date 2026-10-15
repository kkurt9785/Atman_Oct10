// Real UI with mocked transport: never sends production messages.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {readFile,readdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.argv[2]||'playwright-core');
const {build}=require('../apps/worker-web/node_modules/esbuild');
const app=path.resolve('apps/admin-web');
const source=`import React from 'react';import{createRoot}from'react-dom/client';import{GigOperationsBoard}from'./components/GigOperationsBoard';
window.calls=[];window.result=2;window.fail=false;
const workers=['단체근무자','개별근무자'].map((name,i)=>({staffId:String(i),name,title:'업무',workerLinked:true,startTime:'09:00',endTime:'18:00',status:'scheduled',statusLabel:'출근 예정',checkInAt:'2026-10-14T23:30:00Z',checkOutAt:null,unpaidDays:0,unreadMessages:0}));
const board={today:'2026-10-15',workers,days:[{date:'2026-10-15',dayLabel:'목',dateLabel:'10/15',workers}],summary:{issue:0,working:2,invite:0,pay:0}};
const projects=[{id:'project',title:'단체 행사',startsOn:'2026-10-15',endsOn:'2026-10-15',workWeekdays:[4],startTime:'09:00:00',endTime:'18:00:00',status:'active',participants:[workers[0]],headcount:1}];
createRoot(document.getElementById('root')).render(<GigOperationsBoard board={board} projects={projects} facilityId='site' facilityName='테스트 행사장'/>);`;
const bundle=await build({stdin:{contents:source,loader:'tsx',resolveDir:app},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'mock',setup(b){
 b.onResolve({filter:/^(next\/link|next\/navigation|@\/lib\/supabase-browser)$/},a=>({path:a.path,namespace:'mock'}));
 b.onResolve({filter:/^\.\.\/(supabase|facility)$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({resolveDir:app,contents:a.path==='next/link'?"import React from 'react';export default p=>React.createElement('a',p,p.children);":a.path==='next/navigation'?"export const useRouter=()=>({refresh(){}});":a.path==='@/lib/supabase-browser'?"export const supabase={rpc:async(name,args)=>{window.calls.push({name,args});await new Promise(r=>setTimeout(r,150));if(window.fail)throw Error('offline');return {data:window.result,error:null}}};":"export const adminClient=()=>null;export const getCurrentFacilityId=async()=>null;"}));
}}]});
const cssDir=path.join(app,'.next/static/css');
const css=(await Promise.all((await readdir(cssDir)).filter(f=>f.endsWith('.css')).map(f=>readFile(path.join(cssDir,f),'utf8')))).join('\n').replace(/@import\s+[^;]+;/g,'');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {for(const width of [360,390]){
 const page=await browser.newPage({viewport:{width,height:844},timezoneId:'America/Los_Angeles'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://localhost:31999/**',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('http://localhost:31999/');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});
 const schedule=page.locator('section').filter({has:page.getByRole('heading',{name:'7일 근무 일정',exact:true})});
 assert.equal(await schedule.getByText('단체 행사',{exact:true}).count(),1);
 assert.equal(await schedule.getByText('개별근무자',{exact:true}).count(),1);
 assert.equal(await schedule.getByText('단체근무자',{exact:true}).count(),0);
 assert.equal(await page.getByText('출근 08:30 → 퇴근 —',{exact:true}).count(),2);
 await page.getByRole('button',{name:'연결된 근무자 전체 선택'}).click();await page.getByRole('button',{name:'메시지',exact:true}).click();
 await page.getByText('받는 사람: 단체근무자, 개별근무자',{exact:true}).waitFor();await page.getByLabel('전달할 내용').fill('일정 확인 부탁드려요');
 await page.getByRole('button',{name:'2명에게 보내기'}).evaluate(button=>{button.click();button.click();});
 await page.getByRole('status').filter({hasText:'선택 2명 중 2명'}).waitFor();assert.equal(await page.evaluate(()=>window.calls.length),1);
 await page.getByRole('button',{name:'연결된 근무자 전체 선택'}).click();await page.getByRole('button',{name:'메시지',exact:true}).click();await page.getByLabel('전달할 내용').fill('재시도 테스트');await page.evaluate(()=>window.fail=true);
 await page.getByRole('button',{name:'2명에게 보내기'}).click();await page.getByRole('alert').filter({hasText:'연결이 끊겨'}).waitFor();assert.equal(await page.getByRole('button',{name:'2명에게 보내기'}).isEnabled(),true);
 await page.evaluate(()=>{window.fail=false;window.result=null;});await page.getByRole('button',{name:'2명에게 보내기'}).click();await page.getByRole('alert').filter({hasText:'발송 결과를 확인하지 못했어요.'}).waitFor();
 await page.evaluate(()=>window.result=0);await page.getByRole('button',{name:'2명에게 보내기'}).click();await page.getByRole('alert').filter({hasText:'전달된 대상이 없어요'}).waitFor();
 await page.getByRole('button',{name:'닫기',exact:true}).click();await page.getByRole('button',{name:'출석 확인',exact:true}).click();await page.getByLabel('확인 기한 · 한국 시간 · 선택').fill('2020-01-01T09:00');
 const before=await page.evaluate(()=>window.calls.length);await page.getByRole('button',{name:'2명에게 보내기'}).click();await page.getByRole('alert').filter({hasText:'현재 이후'}).waitFor();assert.equal(await page.evaluate(()=>window.calls.length),before);
 await page.getByLabel('확인 기한 · 한국 시간 · 선택').fill('2099-10-15T09:00');await page.evaluate(()=>window.result=1);await page.getByRole('button',{name:'2명에게 보내기'}).click();await page.getByRole('status').filter({hasText:'선택 2명 중 1명'}).waitFor();assert.equal(await page.evaluate(()=>window.calls.at(-1).args.p_due_at),'2099-10-15T00:00:00.000Z');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await page.close();console.log('PASS operations UI',width);
}}finally{await browser.close();}
