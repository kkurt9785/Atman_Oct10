import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url), { chromium } = require(process.argv[2] || 'playwright-core');
const { build } = require('../apps/worker-web/node_modules/esbuild');
const app = path.resolve('apps/worker-web'), directory = await mkdtemp(path.join(tmpdir(), 'itdot-agenda-ui-'));
const source = `import React from 'react';import{createRoot}from'react-dom/client';import{WorkAgenda}from'./components/worker/WorkAgenda';
window.failure=false;const date=new Date(Date.now()+86400000+9*3600000).toISOString().slice(0,10);
window.client={auth:{getUser:async()=>({data:{user:{id:'me'}}})},from:table=>{const data=table==='workers'?{id:'worker'}:table==='facility_staff'?[]:[{id:'application1',status:'accepted',checked_in_at:null,checked_out_at:null,shifts:{shift_date:date,start_time:'09:00:00',end_time:'18:00:00',status:'filled',facilities:{name:'검증 병원'}}}];const q={then:resolve=>Promise.resolve(window.failure?{data:null,error:{message:'offline'}}:{data,error:null}).then(resolve)};for(const key of ['select','eq','neq','in','maybeSingle'])q[key]=()=>q;return q;}};
createRoot(document.getElementById('root')).render(<WorkAgenda/>);`;
const bundle = await build({ stdin: { contents: source, loader: 'tsx', resolveDir: app }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'mock', setup(b) {
  b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'mock' }));
  b.onResolve({ filter: /^@\/lib\/supabase$/ }, () => ({ path: 'supabase', namespace: 'mock' }));
  b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ resolveDir: app, contents: args.path === 'link' ? "import React from 'react';export default p=>React.createElement('a',p,p.children);" : "export const supabase=new Proxy({},{get:(_,key)=>window.client[key]});" }));
} }] });
const cssDir = path.join(app, '.next/static/css'), css = (await Promise.all((await readdir(cssDir)).filter(f => f.endsWith('.css')).map(f => readFile(path.join(cssDir, f), 'utf8')))).join('\n').replace(/@import\s+[^;]+;/g, '');
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  for (const width of [360, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<html><body style="margin:0;padding:16px"><div id="root"></div></body></html>');
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByText('검증 병원', { exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: /검증 병원/ }).getAttribute('href'), '/applications#application-application1');
    await page.getByRole('button', { name: '달력', exact: true }).click();
    const date = await page.evaluate(() => new Date(Date.now()+86400000+9*3600000).toISOString().slice(0,10));
    await page.getByRole('button', { name: date+' 근무 1건', exact: true }).click();
    await page.getByText('검증 병원', { exact: true }).waitFor();
    await page.getByRole('button', { name: '이 달 전체 보기' }).click();
    await page.evaluate(() => { window.failure=true; });
    await page.getByLabel('일정 조회 월').fill('2027-01');
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByText('선택한 기간에 일정이 없어요', {exact:true}).count(),0);
    await page.evaluate(() => { window.failure=false; });
    await page.getByRole('button',{name:'다시 불러오기'}).click();
    await page.getByLabel('일정 조회 월').fill(date.slice(0,7));
    await page.getByText('검증 병원',{exact:true}).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    assert.deepEqual(errors,[]);
    await page.screenshot({path:path.join(directory,`agenda-${width}.png`),fullPage:true});
    await page.close(); console.log(`PASS ${width}: date cards, calendar selection, detail link, load failure and retry, no overflow`);
  }
  console.log(directory);
} finally { await browser.close(); }
