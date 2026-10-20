// Actual share-entry component; no production API or account writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright-core');
const { build } = require('../apps/worker-web/node_modules/esbuild');
const app = path.resolve('apps/worker-web');
const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Intro from './app/intro/page';import{usePwaInstall}from'./lib/pwa-install';function App(){usePwaInstall();return <Intro/>}createRoot(document.getElementById('root')).render(<App/>);`, loader: 'tsx', resolveDir: app }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'next-link', setup(b) { b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'mock'})); b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:"import React from 'react';export default function Link(props){return React.createElement('a',props)}",resolveDir:app})); } }] });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  for (const width of [360, 390, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
    await page.goto('http://localhost:31999/intro?role=worker&kind=gigworker');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const start = page.getByRole('link', { name: '설치 없이 시연하기 →' });
    await page.waitForFunction(() => document.querySelector('a')?.getAttribute('href') === '/gig/demo');
    await page.getByRole('button', { name: '병원·약국 근무', exact: true }).click();
    assert.equal(await start.getAttribute('href'), '/demo');
    for (const link of await page.getByRole('link', { name: '선택한 시연 계속하기 →' }).all()) assert.equal(await link.getAttribute('href'), '/demo');
    assert.equal(await page.locator('a[href*="admin.itdot.co.kr/login"]').count(), 0);
    await page.getByRole('button', { name: '사장님·관리자', exact: true }).click();
    for (const [label, kind] of [['병원·의원','hospital'],['약국','pharmacy'],['요양병원','care'],['단기·행사','gigworker']]) {
      await page.getByRole('button', { name: label, exact: true }).click();
      assert.equal(await start.getAttribute('href'), `https://admin.itdot.co.kr/login?demo=${kind}`);
      for (const link of await page.getByRole('link', { name: '선택한 시연 계속하기 →' }).all()) assert.equal(await link.getAttribute('href'), `https://admin.itdot.co.kr/login?demo=${kind}`);
    }
    await page.getByText('홈 화면에 앱 추가하기 · 선택사항').click();
    assert.equal(await page.getByRole('link', { name: '관리자 앱 설치 안내 →' }).getAttribute('href'), 'https://admin.itdot.co.kr/login?install=1');
    await page.getByRole('button', { name: '다른 기기에서 보기 · QR' }).click();
    assert.equal(await page.getByRole('textbox', { name: '공유 주소' }).inputValue(), 'https://itdot.co.kr/intro?role=admin&kind=gigworker');
    await page.getByRole('button', { name: '근무자', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: '공유 주소' }).inputValue(), 'https://itdot.co.kr/intro?role=worker&kind=gigworker');
    assert.equal(await page.getByRole('link', { name: '관리자 앱 설치 안내 →' }).count(), 0);
    await page.getByRole('button', { name: '워커 앱 홈 화면에 추가', exact: true }).first().waitFor();
    assert.equal(await page.locator('a[href*="admin.itdot.co.kr/login"]').count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: shared selection, six demo routes, correct install origin, QR updates`);
    await page.close();
  }
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.goto('http://localhost:31999/intro');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.getByRole('button',{name:'근무자',exact:true}).waitFor();
  const captured = await page.evaluate(() => {
    window.prompts = 0;
    const event = new Event('beforeinstallprompt',{cancelable:true});
    event.prompt = async () => { window.prompts++; };
    event.userChoice = Promise.resolve({outcome:'accepted'});
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(captured,true);
  await page.getByRole('button',{name:'근무자',exact:true}).click();
  await page.getByText('홈 화면에 앱 추가하기 · 선택사항').click();
  await page.getByRole('button',{name:'워커 앱 홈 화면에 추가',exact:true}).first().click();
  assert.equal(await page.evaluate(()=>window.prompts),1);
  console.log('PASS first-arrival install event retained across role switch');
  await page.close();
} finally { await browser.close(); }
