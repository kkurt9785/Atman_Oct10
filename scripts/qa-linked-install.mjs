// Real notice + install components, mocked session classification, no production writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.argv[2]||'playwright-core');
const {build}=require('../apps/worker-web/node_modules/esbuild');
const app=path.resolve('apps/worker-web');
const bundle=await build({stdin:{contents:"import React from 'react';import{createRoot}from'react-dom/client';import{LinkedNotice}from'./components/invite/LinkedNotice';import{InstallBanner}from'./components/InstallBanner';createRoot(document.getElementById('root')).render(<><LinkedNotice/><InstallBanner/></>);",loader:'tsx',resolveDir:app},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'mock-session',setup(b){b.onResolve({filter:/^@\/lib\/demo-session$/},()=>({path:'demo',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const useDemoSession=()=>window.demo;',resolveDir:app}));}}]});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  for(const scenario of ['real','demo','installed','no-invite']){
    const page=await browser.newPage({viewport:{width:390,height:844}});
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => console.error(error.message));
    await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
    await page.goto('http://localhost:31999/workplace');
    await page.evaluate(scenario=>{
      window.process={env:{NODE_ENV:'development'}};
      window.demo=scenario==='demo'?'gig':false;
      Object.defineProperty(navigator,'standalone',{value:scenario==='installed'});
      Object.defineProperty(navigator,'userAgent',{value:'iPhone Safari'});
      if(scenario!=='no-invite'){
        sessionStorage.setItem('atman_linked_notice',JSON.stringify({facility:'테스트 근무지',bank:'missing',bankLabel:null}));
        sessionStorage.setItem('atman_linked_install',String(Date.now()));
      }
    },scenario);
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const install=page.getByRole('button',{name:'내 근무표를 홈 화면에 추가',exact:true});
    if(scenario==='real'){
      await install.waitFor();
      assert.equal(await page.getByRole('button',{name:'방법 보기',exact:true}).count(),0);
      await install.click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'확인했어요'}).click();
      await page.getByRole('button',{name:'나중에 · 근무 화면 계속 보기'}).click();
      await page.getByRole('region',{name:'근무지 연결 완료'}).waitFor({state:'detached'});
      assert.equal(await page.getByRole('button',{name:'방법 보기',exact:true}).count(),0);
      assert.ok(await page.evaluate(()=>Number(localStorage.getItem('installBannerDismissedAt'))>0));
    }else{
      if(scenario!=='no-invite')await page.getByText('✓ 연결됐어요 · 테스트 근무지').waitFor();
      else await page.getByRole('button',{name:'방법 보기',exact:true}).waitFor();
      assert.equal(await install.count(),0);
    }
    console.log('PASS contextual install:',scenario);await page.close();
  }
}finally{await browser.close();}
