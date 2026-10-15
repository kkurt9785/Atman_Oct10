// Real components, mocked services: no live site creation or attendance writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,readdir,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.argv[2]||'playwright-core');
const {build}=require('../apps/worker-web/node_modules/esbuild');
const directory=await mkdtemp(path.join(tmpdir(),'itdot-attendance-sites-'));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
for(const kind of ['settings','site','attendance']) {
 const admin=kind!=='attendance',app=path.resolve('apps',admin?'admin-web':'worker-web');
 const source=kind==='settings'?`import{FacilityProfileForm}from'./app/settings/FacilityProfileForm';window.saved=[];createRoot(document.getElementById('root')).render(<FacilityProfileForm profile={{attendance_mode:'network',allowed_ips:['192.0.2.1']}} facilityType='gigworker' part='attendance'/>);`
 :kind==='site'?`import{GigworkerWorkspaceStart}from'./app/setup/claim-facility/GigworkerWorkspaceStart';window.saved=[];createRoot(document.getElementById('root')).render(<GigworkerWorkspaceStart onBack={()=>{}}/>);`
 :`import{AttendanceActionButton}from'./components/attendance/AttendanceActionButton';window.mode='gps_qr';window.calls=[];window.consent=false;window.fallback=true;window.client={auth:{getSession:async()=>({data:{session:null}})},rpc:async(name,args)=>{window.calls.push(name);await new Promise(r=>setTimeout(r,100));return {data:name==='get_my_attendance_policy'?{mode:window.mode,qrFallback:window.fallback,facilityId:'site'}:{ok:false,reason:'GPS_ERROR',message:'위치 확인 필요'}};}};createRoot(document.getElementById('root')).render(<AttendanceActionButton targetType='staff' targetId='staff' action='check_in'/>);`;
 const bundle=await build({stdin:{contents:"import React from 'react';import{createRoot}from'react-dom/client';"+source,loader:'tsx',resolveDir:app},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'mock',setup(b){
  b.onResolve({filter:/^(next\/link|next\/navigation|@\/lib\/actions\/facility|@\/lib\/facility|@\/lib\/supabase|@\/lib\/consents|@\/components\/FacilityPinMap)$/},a=>({path:a.path,namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({resolveDir:app,contents:a.path==='next/link'?"import React from 'react';export default p=>React.createElement('a',p,p.children);":a.path==='next/navigation'?"export const useRouter=()=>({replace(){}});":a.path==='@/lib/actions/facility'?"export const saveFacilityProfileResult=async data=>{window.saved.push(Object.fromEntries(data));return {ok:true}};export const registerWorkplaceNetworkResult=async()=>({ok:false});export const clearWorkplaceNetworksResult=async()=>({ok:false});":a.path==='@/lib/facility'?"export const createGigworkerWorkspace=async data=>{window.saved.push(data);return {ok:false,error:'테스트: 저장하지 않음'}};":a.path==='@/components/FacilityPinMap'?"import React from 'react';export const CurrentLocationButton=()=>null;export const FacilityPinMap=p=>React.createElement('button',{type:'button',onClick:()=>p.onChange({lat:37.1,lng:127.1})},'지도에서 현장 선택');":a.path==='@/lib/consents'?"export const isLocationAllowed=async()=>window.consent;":"export const supabase=new Proxy({},{get:(_,k)=>window.client[k]});"}));
 }}]});
 const cssDir=path.join(app,'.next/static/css'),css=(await Promise.all((await readdir(cssDir)).filter(f=>f.endsWith('.css')).map(f=>readFile(path.join(cssDir,f),'utf8')))).join('\n').replace(/@import\s+[^;]+;/g,'');
 for(const width of [360,390]) {
  const page=await browser.newPage({viewport:{width,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://localhost:31999/**',route=>route.fulfill({contentType:'text/html',body:'<html><body style="margin:0"><div id="root"></div></body></html>'}));await page.goto('http://localhost:31999/');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});
  if(kind==='settings') {
   assert.equal(await page.getByRole('radio',{checked:true}).count(),0);
   assert.equal(await page.getByLabel('고급 인증 방식').inputValue(),'network');
   await page.getByRole('radio',{name:/강화 인증/}).check();
   assert.equal(await page.locator('input[name="attendance_mode"]').inputValue(),'gps_qr');
   await page.getByRole('radio',{name:/관리자 처리/}).check();
   assert.equal(await page.locator('input[name="attendance_mode"]').inputValue(),'admin');
   await page.getByRole('radio',{name:/간편 인증/}).check();
   assert.equal(await page.locator('input[name="attendance_mode"]').inputValue(),'gps_or_qr');
  } else if(kind==='site') {
   await page.getByLabel('근무지 이름',{exact:true}).fill('검색 안 되는 행사장');
   await page.getByRole('button',{name:'긱워커 근태 시작하기',exact:true}).click();
   assert.equal(await page.evaluate(()=>window.saved.length),0);
   await page.getByRole('button',{name:'지도에서 현장 선택',exact:true}).click();
   await page.getByRole('button',{name:'긱워커 근태 시작하기',exact:true}).click();
   await page.getByRole('alert').filter({hasText:'테스트'}).waitFor();
   await page.getByRole('button',{name:'긱워커 근태 시작하기',exact:true}).click();
   const saved=await page.evaluate(()=>window.saved);assert.equal(saved.length,2);assert.equal(saved[0].lat,37.1);assert.equal(saved[0].addressText,null);assert.equal(saved[0].requestId,saved[1].requestId);
  } else {
   await page.getByRole('button',{name:'출근하기',exact:true}).dblclick();
   await page.getByText(/강화 인증은 위치와 QR이 모두 필요/).waitFor();
   assert.equal(await page.getByRole('button',{name:'동적 QR로 인증',exact:true}).count(),0);
   assert.equal(await page.evaluate(()=>window.calls.filter(n=>n==='record_unified_attendance').length),1);
   await page.evaluate(()=>{window.mode='admin';window.calls=[];});
   await page.getByRole('button',{name:'출근하기',exact:true}).click();
   await page.getByText(/관리자 처리 방식이에요/).waitFor();
   assert.equal(await page.evaluate(()=>window.calls.includes('record_unified_attendance')),false);
   await page.evaluate(()=>{window.mode='gps_or_qr';window.fallback=false;});
   await page.getByRole('button',{name:'출근하기',exact:true}).click();
   await page.getByText('위치 확인 필요',{exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'동적 QR로 인증',exact:true}).count(),0);
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(directory,`${kind}-${width}.png`),fullPage:true});await page.close();console.log(`PASS ${kind} ${width}`);
 }
}
console.log(directory);
} finally {await browser.close();}
