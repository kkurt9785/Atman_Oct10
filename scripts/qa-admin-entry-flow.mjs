// Actual admin login UI, mocked transport only. No real account login or database writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.argv[2]||'playwright-core');
const {build}=require('../apps/worker-web/node_modules/esbuild');
const app=path.resolve('apps/admin-web');
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Login from './app/login/page';window.sessions=0;window.signouts=0;window.real=false;createRoot(document.getElementById('root')).render(<Login/>);`,loader:'tsx',resolveDir:app},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"','process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN':'"1"'},plugins:[{name:'mock',setup(b){
 b.onResolve({filter:/^(next\/navigation|@\/lib\/supabase-browser|\.\/DemoShareCard|@\/components\/(BrandMark|AdminInstallButton))$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({resolveDir:app,contents:a.path==='next/navigation'?"export const useRouter=()=>({replace:path=>window.location.assign(path)});export const useSearchParams=()=>new URLSearchParams(window.location.search);":a.path==='@/lib/supabase-browser'?"export const supabase={auth:{getSession:async()=>({data:{session:window.real?{user:{email:'real@example.test'}}:null}}),setSession:async()=>{window.sessions++;return {data:{session:{access_token:'test',user:{id:'demo'}}},error:null}},signOut:async()=>{window.signouts++;return {error:null}}}};":a.path==='./DemoShareCard'?"export const DemoShareCard=()=>null;":a.path.endsWith('BrandMark')?"export const Wordmark=()=>null;":"export const AdminInstallButton=()=>null;"}));
}}]});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 for(const mode of ['hospital','pharmacy','care','gigworker']) {
  const page=await browser.newPage({viewport:{width:390,height:844}});const calls=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('http://localhost:31999/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname.startsWith('/api/')){
    calls.push({path:url.pathname,body:request.postDataJSON(),method:request.method()});
    return route.fulfill({contentType:'application/json',body:JSON.stringify(url.pathname==='/api/demo-login'?{accessToken:'test',refreshToken:'test'}:url.pathname==='/api/set-facility'?{facilityId:mode}:{} )});
   }
   return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
  });
  await page.goto(`http://localhost:31999/login?demo=${mode}`);await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForURL('http://localhost:31999/');
  assert.deepEqual(calls.map(call=>call.path),['/api/demo-login','/api/admin-session','/api/set-facility']);
  assert.equal(calls[2].body.demoKind,mode==='gigworker'?'gigworker':undefined);assert.deepEqual(errors,[]);await page.close();console.log('PASS demo entry',mode);
 }
 const page=await browser.newPage();let failFacility=true,calls=0;
 await page.route('http://localhost:31999/**',route=>{
  const url=new URL(route.request().url());if(!url.pathname.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
  calls++;
  if(url.pathname==='/api/set-facility'&&failFacility)return route.fulfill({status:503,contentType:'application/json',body:'{}'});
  return route.fulfill({contentType:'application/json',body:JSON.stringify(url.pathname==='/api/demo-login'?{accessToken:'test',refreshToken:'test'}:{facilityId:'gig'})});
 });
 await page.goto('http://localhost:31999/login');await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.getByRole('button',{name:/단기 알바 근태/}).evaluate(button=>{button.click();button.click();});await page.getByRole('alert').waitFor();
 assert.equal(await page.evaluate(()=>window.sessions),1);assert.equal(await page.evaluate(()=>window.signouts),1);assert.equal(calls,4);assert.equal(new URL(page.url()).pathname,'/login');
 await page.evaluate(()=>window.real=true);page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:/단기 알바 근태/}).click();assert.equal(calls,4);
 await page.evaluate(()=>window.real=false);failFacility=false;await page.getByRole('button',{name:/단기 알바 근태/}).click();await page.waitForURL('http://localhost:31999/');
 console.log('PASS duplicate click lock, wrong-site failure cleanup, real-account cancellation, retry');await page.close();
} finally {await browser.close();}
