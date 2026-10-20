// Installation events are synthetic; no native installation or production requests.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.argv[2]||'playwright-core');
const {build}=require('../apps/worker-web/node_modules/esbuild');
const app=path.resolve('apps/worker-web');
const bundle=await build({stdin:{contents:"import React from 'react';import{createRoot}from'react-dom/client';import{InstallAppButton}from'./components/InstallAppButton';import{InstallBanner}from'./components/InstallBanner';createRoot(document.getElementById('root')).render(<><InstallAppButton/><InstallBanner/></>);",loader:'tsx',resolveDir:app},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
const cssDir=path.join(app,'.next/static/css'),css=(await Promise.all((await readdir(cssDir)).filter(file=>file.endsWith('.css')).map(file=>readFile(path.join(cssDir,file),'utf8')))).join('\n').replace(/@import\s+[^;]+;/g,'');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{for(const width of [360,390]){
 const page=await browser.newPage({viewport:{width,height:844}});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>route.request().url().startsWith('http://localhost:31999/')?route.fulfill({contentType:'text/html',body:'<html><body style="margin:0"><div id="root"></div></body></html>'}):route.abort());
 async function mount(kind){await page.goto('http://localhost:31999/');if(kind==='ipad')await page.evaluate(()=>{Object.defineProperty(navigator,'userAgent',{value:'Mozilla Macintosh Safari'});Object.defineProperty(navigator,'maxTouchPoints',{value:5});});if(kind==='inapp')await page.evaluate(()=>{Object.defineProperty(navigator,'userAgent',{value:'iPhone KAKAOTALK'});});await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});await page.getByRole('button',{name:'홈 화면에 앱 추가',exact:true}).waitFor();}
 await mount('android');
 await page.evaluate(()=>{window.prompts=0;const event=new Event('beforeinstallprompt');event.prompt=async()=>{window.prompts++;};event.userChoice=Promise.resolve({outcome:'accepted'});window.dispatchEvent(event);});
 await page.getByRole('button',{name:'홈 화면에 앱 추가',exact:true}).evaluate(button=>{button.click();button.click();});
 await page.getByRole('status').filter({hasText:'설치 요청을 전달했어요'}).waitFor();assert.equal(await page.evaluate(()=>window.prompts),1);
 await page.getByRole('button',{name:'설치 진행 확인 · 안내',exact:true}).waitFor();
 await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));await page.getByRole('button',{name:'설치 진행 확인 · 안내',exact:true}).waitFor({state:'detached'});
 await mount('error');await page.evaluate(()=>{const event=new Event('beforeinstallprompt');event.prompt=async()=>{throw Error('test');};event.userChoice=Promise.resolve({outcome:'dismissed'});window.dispatchEvent(event);});
 await page.getByRole('button',{name:'홈 화면에 앱 추가',exact:true}).click();await page.getByRole('alert').first().waitFor();assert.equal(await page.getByRole('button',{name:'홈 화면에 앱 추가',exact:true}).isEnabled(),true);
 await page.getByRole('button',{name:'홈 화면에 앱 추가',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});
 for(const kind of ['ipad','inapp']){await mount(kind);await page.getByRole('button',{name:'홈 화면에 앱 추가',exact:true}).click();await page.getByRole('heading',{name:'iPhone·iPad에 잇닿 추가'}).waitFor();await page.getByText('더 보기(…)',{exact:true}).waitFor();assert.equal(await page.getByText(/사파리 하단/).count(),0);if(kind==='inapp')await page.getByRole('button',{name:'현재 주소 복사',exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.getByRole('button',{name:'확인했어요'}).click();await page.getByRole('dialog').waitFor({state:'detached'});}
 assert.deepEqual(errors,[]);await page.close();console.log('PASS install events, error recovery, iPadOS, in-app iPhone and dialog',width);
}}finally{await browser.close();}
