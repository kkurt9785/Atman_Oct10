// Isolated fixture: ApplySheet shows §25 public flags, locks apply while unknown, offers report entry. Network blocked.
// Usage: node scripts/qa-apply-sheet-public-flags.mjs /absolute/path/to/playwright-core   (from repo root)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright-core');
const { build } = require('../apps/worker-web/node_modules/esbuild');
const app = path.resolve('apps/worker-web');
const bundle = await build({ stdin: { resolveDir: app, loader: 'tsx', contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {ApplySheet} from './components/shifts/ApplySheet';
window.mode='flagged'; window.applies=0;
const shift={id:'s1',facility_id:'f1',shift_date:'2026-11-06',start_time:'07:00:00',end_time:'15:00:00',is_overnight:false,required_role:'na',hourly_wage:12000,estimated_total_pay:90000,description:'병동',department:'3병동',notes:null,facilities:{name:'검증요양병원',address_text:'수원시 영통구'}};
const root=createRoot(document.getElementById('root'));
window.mount=()=>root.render(<ApplySheet key={Math.random()} shift={shift} onClose={()=>{}} onApplied={()=>{}}/>);
window.mount();
` }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'fixtures', setup(b) {
  b.onResolve({ filter: /^@\/lib\/supabase$/ }, () => ({ path: 'db', namespace: 'fx' }));
  b.onResolve({ filter: /^@\/lib\/shifts$/ }, () => ({ path: 'shifts', namespace: 'fx' }));
  b.onLoad({ filter: /^db$/, namespace: 'fx' }, () => ({ contents: `
    export const supabase={rpc:async()=>({error:null}),from(){const q={select(){return q},in(){return q},then(res,rej){
      const m=window.mode; const data=m==='flagged'?[{id:'f1',public_flag_wage_arrears:true,public_flag_industrial_accident:false}]:m==='clean'?[{id:'f1',public_flag_wage_arrears:false,public_flag_industrial_accident:false}]:null;
      return Promise.resolve(m==='error'?{data:null,error:{message:'down'}}:{data,error:null}).then(res,rej)}};return q}};` }));
  b.onLoad({ filter: /^shifts$/, namespace: 'fx' }, () => ({ contents: `export async function applyToShift(){window.applies++;return {ok:true}}` }));
} }] });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', r => r.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  // flagged: full notice visible, apply enabled, report entry present
  await page.getByText('고용노동부가 임금체불 사업주 명단을 공개 중인 사업장이에요.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: '지원하기' }).isDisabled(), false);
  await page.getByRole('button', { name: '공고 내용이 사실과 다른가요? 신고하기' }).waitFor();
  // error: apply locked + retry, then clean → enabled, no notice
  await page.evaluate(() => { window.mode = 'error'; window.mount(); });
  await page.getByText('사업장 공표 정보를 확인하지 못했어요.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: '지원하기' }).isDisabled(), true, 'apply locked while flags unknown');
  await page.getByRole('button', { name: '지원하기' }).click({ force: true });
  assert.equal(await page.evaluate(() => window.applies), 0);
  await page.evaluate(() => { window.mode = 'clean'; });
  await page.getByRole('button', { name: '다시 확인' }).click();
  await page.getByRole('button', { name: '지원하기' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '지원하기' }).isDisabled(), false);
  assert.equal(await page.getByText('임금체불 사업주 명단', { exact: false }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS: flagged notice + apply enabled + report entry; lookup failure locks apply with retry; clean facility shows no notice. No network.');
} finally { await browser.close(); }
