// Isolated browser QA: no network, login, or real application submission.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright-core');
const app = path.resolve('apps/worker-web');
const { build } = require('../apps/worker-web/node_modules/esbuild');
const postcss = require('../apps/worker-web/node_modules/postcss');
const tailwind = require('../apps/worker-web/node_modules/tailwindcss');
const css = await postcss([tailwind({ content: [path.join(app, 'components/shifts/*.tsx')], theme: { extend: {} } })]).process('@tailwind base; @tailwind utilities;', { from: undefined });
const bundle = await build({ stdin: { resolveDir: app, loader: 'tsx', contents: `
import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import {ApplySheet} from './components/shifts/ApplySheet';
import {FacilitySheet} from './components/shifts/FacilitySheet';
window.calls=[]; window.submitCalls=0; window.failFacility=false; window.failApply=false;
const shift={id:'fixture',shift_date:'2026-12-01',start_time:'09:00',end_time:'18:00',hourly_wage:20000,estimated_total_pay:160000,required_role:'rn',notes:'긴 근무 안내입니다. '.repeat(120),facilities:{name:'검증 병원',address_text:'검증 주소'}};
function App(){const [open,setOpen]=useState(''); return <><button id="trigger" onClick={()=>setOpen('apply')}>지원 열기</button><button onClick={()=>setOpen('facility')}>사업장 열기</button>{open==='apply'&&<ApplySheet shift={shift} onClose={()=>setOpen('')} onApplied={()=>setOpen('')}/ >}{open==='facility'&&<FacilitySheet facilityId="fixture" facilityName="검증 병원" onClose={()=>setOpen('')}/>}</>}
createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'isolated', setup(b) {
  b.onResolve({ filter: /^@\/lib\/(supabase|shifts)$/ }, args => ({ path: args.path.split('/').at(-1), namespace: 'mock' }));
  b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path === 'shifts' ? `export async function applyToShift(){window.submitCalls++; if(window.failApply)throw new Error('offline'); return {ok:true,applicationId:'fixture'};}` : `export const supabase={from(table){window.calls.push(table);const q={select(){return q},eq(){return q},single:async()=>window.failFacility?{data:null,error:{message:'offline'}}:{data:{name:'검증 병원',facility_type:'clinic'},error:null},maybeSingle:async()=>({data:{business_status:'active'},error:null})};return q}};` }));
} }] });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
 for (const viewport of [{width:360,height:640},{width:667,height:375}]) {
  const page = await browser.newPage({ viewport });
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.route('**/*', route=>route.abort());
  await page.setContent('<html><body><div id="root"></div></body></html>');
  await page.addStyleTag({content:css.css}); await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.getByRole('button',{name:'지원 열기'}).click();
  const dialog=page.getByRole('dialog',{name:'근무 지원'});
  const bounds=await dialog.boundingBox(); assert.ok(bounds.y>=0 && bounds.height<=viewport.height*0.91);
  assert.ok(await dialog.evaluate(el=>el.scrollHeight>el.clientHeight));
  await page.keyboard.press('Shift+Tab'); assert.equal(await page.evaluate(()=>document.activeElement.textContent),'취소');
  await page.keyboard.press('Tab'); assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'지원하기');
  await page.keyboard.press('Escape'); assert.equal(await dialog.count(),0);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'trigger');
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
  await page.getByRole('button',{name:'지원 열기'}).click();
  await page.evaluate(()=>{window.failApply=true});
  await page.getByRole('button',{name:'지원하기',exact:true}).click();
  await page.getByText('지원 결과를 확인하지 못했어요.',{exact:false}).waitFor();
  assert.equal(await dialog.evaluate(el=>el.scrollTop),0);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'사업장 열기'}).click();
  await page.getByText('사업장 전체 근무 이력과 평점은 현재 제공하지 않아요.',{exact:false}).waitFor();
  assert.deepEqual(await page.evaluate(()=>[...new Set(window.calls)]),['facilities']);
  assert.equal(await page.getByText('최근 6개월',{exact:true}).count(),0);
  await page.getByRole('button',{name:'✕',exact:true}).click();
  await page.evaluate(()=>{window.failFacility=true});
  await page.getByRole('button',{name:'사업장 열기'}).click();
  await page.getByRole('alert').waitFor();
  await page.evaluate(()=>{window.failFacility=false});
  await page.getByRole('button',{name:'다시 불러오기'}).click();
  await page.getByText('사업장 전체 근무 이력과 평점은 현재 제공하지 않아요.',{exact:false}).waitFor();
  assert.deepEqual(errors,[]); await page.close();
 }
 console.log('PASS: two viewports; scroll bounds, keyboard/focus restore, application failure recovery, honest facility information and retry.');
} finally { await browser.close(); }
