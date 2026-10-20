// Actual worker pages with entirely mocked transport; no production reads/writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.argv[2]||'playwright-core');
const {build}=require('../apps/worker-web/node_modules/esbuild');
const app=path.resolve('apps/worker-web');
const cssDir=path.join(app,'.next/static/css');
const css=(await Promise.all((await readdir(cssDir)).filter(f=>f.endsWith('.css')).map(f=>readFile(path.join(cssDir,f),'utf8')))).join('\n').replace(/@import\s+[^;]+;/g,'');
const mocks={
 'next/link':"import React from 'react';export default p=>React.createElement('a',p,p.children);",
 'next/navigation':"export const useSearchParams=()=>new URLSearchParams(window.location.search);export const useRouter=()=>({replace(path){window.destination=path;},back(){}});",
 '@/lib/supabase':"export const supabase=new Proxy({},{get:(_,k)=>window.client[k]});",
 '@/components/BackButton':"export const BackButton=()=>null;",
 '@/components/invite/LinkedNotice':"export const LinkedNotice=()=>null;export const LINKED_NOTICE_KEY='qa-linked';",
 '@/components/attendance/MyAttendanceCalendar':"export const MyAttendanceCalendar=()=>null;",
 '@/lib/worker-mode':"export const isGigLink=row=>row.worker_kind==='gig';export const rememberWorkerShell=()=>{};export const setGigworkerModePreference=()=>{};",
 '@/components/worker/WorkerModeBadge':"export const WorkerModeBadge=()=>null;",
 '@/lib/demo-session':"export const demoKindOf=()=>null;export const leaveDemo=async()=>{};",
 '@/components/DemoSignup':"export const DemoEndSheet=()=>null;",
 '@/lib/kakao-login':"export const startKakaoLogin=()=>{};",
 '@/components/InstallAppButton':"export const InstallAppButton=()=>null;",
 '@/lib/push-subscribe':"export const getExistingSubscription=async()=>null;export const unsubscribeFromPush=async()=>{};",
 '@/lib/consents':"export const isLocationAllowed=async()=>false;",
};
const transport=`window.calls=[];window.fail=true;window.failClaim=true;window.scenario=new URLSearchParams(location.search).get('scenario');
const staff=['a','b'].map(id=>({id:'staff-'+id,name:'근무자 '+id,worker_kind:'staff',default_start_time:'09:00',default_end_time:'18:00',facilities:{id,name:'현장 '+id}}));
window.client={auth:{getUser:async()=>({data:{user:{id:'user'}}}),getSession:async()=>({data:{session:null}})},
from(table){const query=new Proxy({},{get(_,key){if(key==='then')return resolve=>{window.calls.push(table);const result=window.fail&&table==='facility_staff'?{data:null,error:{message:'offline'}}:{error:null,data:table==='facility_staff'?(window.scenario==='shift'?[{...staff[0],worker_kind:'gig'}]:staff):table==='facility_attendance_settings'?[{facility_id:'a',authentication_mode:'admin'},{facility_id:'b',authentication_mode:'admin'}]:table==='workers'?{id:'worker'}:table==='worker_bank_accounts'?null:table==='shift_applications'&&window.scenario==='shift'?[{id:'shift-app',status:'accepted',checked_in_at:new Date().toISOString(),checked_out_at:null,shifts:{shift_date:new Date(Date.now()+32400000).toISOString().slice(0,10),start_time:'09:00',end_time:'18:00',facilities:{id:'a',name:'공고 현장'}}}]:[]};return Promise.resolve(result).then(resolve);};return()=>query;}});return query;},
rpc:async(name,args)=>{window.calls.push(name);if(name==='get_facility_staff_invite_preview')return window.fail?{error:{message:'offline'},data:null}:{error:null,data:{ok:true,isGigworker:window.scenario==='gig',facilityName:'테스트 현장',workerName:'테스트 워커',contractStart:'2026-10-01',contractEnd:'2026-12-31',workWeekdays:[1,2,3,4,5],startTime:'09:00',endTime:'18:00'}};if(name==='claim_facility_staff_invite')throw Error('transport failed');if(name==='get_my_attendance_policy')return {data:{mode:'qr',qrFallback:true,facilityId:'a'},error:null};if(name==='record_unified_attendance')throw Error('must not record mismatched facility');return {data:null,error:null};}};`;
async function bundle(kind){
 const isDemo=kind==='medicalDemo'||kind==='gigDemo';
 const demoTransport=`window.destination='';window.preparations=0;window.savedSessions=0;window.signOuts=0;window.gigResume=false;window.fail=true;window.client={auth:{getSession:async()=>({data:{session:{user:{email:'real@example.test'}}},error:null}),setSession:async()=>{window.savedSessions++;return {error:null};},signOut:async()=>{window.signOuts++;return {error:null};}}};window.fetch=async()=>{window.preparations++;return {ok:!window.fail,json:async()=>window.fail?{error:'테스트 준비 실패'}:{accessToken:'mock',refreshToken:'mock',gigInviteToken:'mock-invite',gigResume:window.gigResume}};};`;
 const component=isDemo?`import Page from './app/${kind==='gigDemo'?'gig/demo':'demo'}/page';createRoot(document.getElementById('root')).render(<Page/>);`:kind==='workplace'?"import Page from './app/workplace/page';createRoot(document.getElementById('root')).render(<Page/>);":(kind==='invite'||kind==='gigInvite')?"import {JoinInvite} from './components/invite/JoinInvite';createRoot(document.getElementById('root')).render(<JoinInvite variant={new URLSearchParams(location.search).get('scenario')==='gig'?'gig':'medical'}/>);":"import{TouchToCheckButton}from'./components/attendance/AttendanceActionButton';createRoot(document.getElementById('root')).render(<TouchToCheckButton targetType='staff' targetId='staff-a' action='check_in' qrToken='token'/>);";
 const result=await build({stdin:{contents:"import React from 'react';import{createRoot}from'react-dom/client';"+(isDemo?demoTransport:transport)+component,loader:'tsx',resolveDir:app},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"','process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN':'"1"'},plugins:[{name:'mock',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)&&!(isDemo&&a.path==='@/lib/demo-session')?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({resolveDir:app,contents:mocks[a.path]}));}}]});
 return result.outputFiles[0].text;
}
const bundles=Object.fromEntries(await Promise.all(['workplace','invite','gigInvite','attendance','medicalDemo','gigDemo'].map(async kind=>[kind,await bundle(kind)])));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {for(const width of [360,390]){
 const page=await browser.newPage({viewport:{width,height:844},timezoneId:'America/Los_Angeles'});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 // Explicitly reject all external requests. Mock tests never touch production.
 await page.route('**/*',route=>route.request().url().startsWith('http://localhost:31999/')?route.fulfill({contentType:'text/html',body:'<html><body style="margin:0"><div id="root"></div></body></html>'}):route.abort());
 async function mount(kind,query=''){await page.goto('http://localhost:31999/'+query);await page.addStyleTag({content:css});await page.addScriptTag({content:bundles[kind]});}
 await mount('workplace');
 await page.getByRole('alert').filter({hasText:'근태 정보를 확인하지 못했어요'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'길게 눌러 출근 기록'}).count(),0);
 await page.evaluate(()=>window.fail=false);await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();
 await page.getByRole('button',{name:'길게 눌러 출근 기록'}).waitFor();
 assert.equal(await page.getByRole('alert').count(),0);
 await page.getByText('관리자가 실제 근무를 확인하고 출퇴근을 기록하는 현장이에요.').waitFor();
 console.log('PASS workplace load retry',width);
 await mount('workplace','?scenario=shift&applicationId=shift-app');
 await page.getByRole('alert').waitFor();await page.evaluate(()=>window.fail=false);await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();
 await page.getByRole('button',{name:'길게 눌러 퇴근 기록'}).waitFor();
 await page.getByText('공고 현장',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'휴가 신청',exact:true}).count(),0);
 console.log('PASS shift attendance and gig staff exclusion',width);
 await mount('workplace','?staffId=staff-a&facility=b&attendanceToken=test');
 await page.getByRole('alert').waitFor();await page.evaluate(()=>window.fail=false);await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();
 await page.waitForFunction(()=>window.calls.filter(name=>name==='facility_staff').length===2);
 await page.getByRole('alert').filter({hasText:'근태 정보를 확인하지 못했어요'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'길게 눌러 출근 기록'}).count(),0);
 await mount('invite','?token=mock-token');
 console.log('PASS explicit staff QR conflict',width);
 await page.getByText('초대 정보를 확인하지 못했어요. 연결 상태를 확인하고 다시 불러와 주세요.').waitFor();
 await page.evaluate(()=>window.fail=false);await page.getByRole('button',{name:'초대 다시 불러오기',exact:true}).click();
 await page.getByRole('button',{name:'초대 수락하고 연결',exact:true}).click();
 await page.getByText('연결 결과를 확인하지 못했어요. 이미 연결됐을 수 있으니 내 근무를 먼저 확인하거나 초대를 다시 불러와 주세요.').waitFor();
 await page.getByRole('button',{name:'초대 다시 불러오기',exact:true}).click();
 await page.getByRole('button',{name:'초대 수락하고 연결',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'연결 중...',exact:true}).count(),0);
 console.log('PASS invite preview/claim retry',width);
 await mount('gigInvite','?token=mock-token&scenario=gig');
 await page.getByRole('button',{name:'초대 다시 불러오기',exact:true}).waitFor();
 await page.evaluate(()=>window.fail=false);await page.getByRole('button',{name:'초대 다시 불러오기',exact:true}).click();
 await page.getByRole('button',{name:'초대 수락하고 연결',exact:true}).waitFor();
 await page.getByText('수락 후 근태·지급 탭에서 지급 계좌를 등록·전달해 주세요.').waitFor();
 console.log('PASS gig invite branch',width);
 await mount('attendance','?facility=b&attendanceToken=token');
 await page.getByRole('button',{name:'길게 눌러 출근 기록'}).press('Enter');
 await page.getByText('스캔한 QR과 선택한 현장이 달라요. QR의 현장을 선택하거나 해당 현장의 QR을 다시 스캔해 주세요.').waitFor();
 assert.equal(await page.evaluate(()=>window.calls.includes('record_unified_attendance')),false);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await mount('medicalDemo');page.once('dialog',dialog=>dialog.dismiss());
 await page.getByRole('button',{name:/간호사.*시작/}).click();
 await page.getByRole('alert').filter({hasText:'시연 전환을 취소'}).waitFor();
 assert.equal(await page.evaluate(()=>window.preparations),0);
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:/간호사.*시작/}).click();
 await page.getByRole('alert').filter({hasText:'테스트 준비 실패'}).waitFor();
 assert.equal(await page.evaluate(()=>window.signOuts+window.savedSessions),0);
 await page.evaluate(()=>window.fail=false);page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:/간호사.*시작/}).click();
 await page.waitForFunction(()=>window.destination==='/home');
 for(const resume of [false,true]){
  await mount('gigDemo');await page.evaluate(value=>{window.fail=false;window.gigResume=value;},resume);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'시연 계정으로 시작',exact:true}).click();
  await page.waitForFunction(expected=>window.destination===expected,resume?'/gig':'/gig/join?token=mock-invite');
 }
 console.log('PASS demo real-session confirmation, retry, medical home, gig invitation/resume',width);
 assert.deepEqual(errors,[]);await page.close();
 console.log('PASS worker recovery / explicit staff QR conflict / invite retry / QR fail-closed',width);
}}finally{await browser.close();}
