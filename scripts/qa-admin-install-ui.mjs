// Real installation UI, synthetic install events; never installs or navigates externally.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.argv[2]||'playwright-core');
const {build}=require('../apps/worker-web/node_modules/esbuild');
const bundle=await build({stdin:{contents:"import React from 'react';import{createRoot}from'react-dom/client';import{AdminInstallButton}from'./components/AdminInstallButton';createRoot(document.getElementById('root')).render(<AdminInstallButton/>);",loader:'tsx',resolveDir:path.resolve('apps/admin-web')},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  for(const scenario of ['native','failure','kakao','ipad']) {
    const page=await browser.newPage({viewport:{width:390,height:650}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('http://localhost:31998/**',route=>route.fulfill({contentType:'text/html',body:'<html><body><div id="root"></div></body></html>'}));
    await page.goto('http://localhost:31998/login?install=1');
    await page.evaluate(scenario=>{
      if(scenario==='kakao')Object.defineProperty(navigator,'userAgent',{value:'iPhone KAKAOTALK'});
      if(scenario==='ipad'){Object.defineProperty(navigator,'userAgent',{value:'Mozilla/5.0 Macintosh Safari'});Object.defineProperty(navigator,'maxTouchPoints',{value:5});}
      Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('clipboard denied')}}});
    },scenario);
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const button=page.getByRole('button',{name:'관리자 앱 설치 방법',exact:true});await button.waitFor();
    if(scenario==='native'||scenario==='failure') {
      await page.evaluate(scenario=>{window.prompts=0;const event=new Event('beforeinstallprompt');event.prompt=async()=>{window.prompts++;if(scenario==='failure')throw Error('prompt unavailable');await new Promise(resolve=>setTimeout(resolve,100));};event.userChoice=Promise.resolve({outcome:'accepted'});window.dispatchEvent(event);},scenario);
      await page.evaluate(()=>{const b=document.querySelector('button');b.click();b.click();});
      if(scenario==='native'){
        await page.getByRole('status').filter({hasText:'설치를 요청했어요'}).waitFor();
        assert.equal(await button.count(),1); // acceptance alone is not installed
        assert.equal(await page.evaluate(()=>window.prompts),1);
        await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));
        await button.waitFor({state:'detached'});
      }else{
        await page.getByRole('dialog').waitFor();
        await page.getByRole('status').filter({hasText:'설치 창을 열지 못했어요'}).waitFor();
        assert.equal(await page.evaluate(()=>window.prompts),1);
      }
    }else{
      await button.click();await page.getByRole('dialog').waitFor();
      assert.equal(page.url(),'http://localhost:31998/login?install=1');
      if(scenario==='kakao'){
        await page.getByRole('button',{name:'설치 링크 복사',exact:true}).click();
        await page.getByRole('status').filter({hasText:'자동 복사가 안 돼요'}).waitFor();
        assert.equal(await page.getByLabel('직접 복사할 주소').inputValue(),'http://localhost:31998/login?install=1');
      }else await page.getByText('웹 앱으로 열기',{exact:true}).waitFor();
      await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});
      assert.equal(await button.evaluate(element=>element===document.activeElement),true);
    }
    assert.deepEqual(errors,[]);await page.close();console.log(`PASS admin install ${scenario}`);
  }
} finally {await browser.close();}
