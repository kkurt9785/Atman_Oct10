// Isolated browser fixtures; all network requests are blocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright-core');
const { build } = require('../apps/worker-web/node_modules/esbuild');
const bundle = await build({ stdin: { resolveDir: path.resolve('apps/worker-web'), loader: 'tsx', contents: `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import {MyAttendanceCalendar} from './components/attendance/MyAttendanceCalendar';
window.fail=false; window.pending=false;
function App(){const [staff,setStaff]=useState('slow');return <><button onClick={()=>setStaff('fast')}>사업장 변경</button><MyAttendanceCalendar staffId={staff}/></>}
createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'fixtures', setup(b) {
  b.onResolve({ filter: /^@\/lib\/supabase$/ }, () => ({ path: 'db', namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
export const supabase={auth:{getUser:async()=>({data:{user:{id:'fixture'}}})},from(table){let staff='',month='';const q={select(){return q},eq(k,v){if(k==='staff_id')staff=v;return q},gte(k,v){month=v.slice(0,7);return q},lte(){return q},maybeSingle(){return window.fail?Promise.resolve({error:{message:'offline'}}):Promise.resolve({data:{id:'worker'}})},then(resolve,reject){return new Promise(done=>setTimeout(()=>{const date=month+'-01',base={work_date:date,check_in_at:date+'T00:00:00Z',check_out_at:date+'T09:00:00Z',status:'completed',break_minutes:60};done({data:table==='staff_attendances'?[{...base,break_minutes:staff==='slow'?0:60}]:[{...base,id:'shift',shifts:{shift_date:date},wage_calculations:window.pending?[]:[{worked_minutes:480,break_minutes:60}]}]})},staff==='slow'?500:10)).then(resolve,reject)}};return q}};
` }));
} }] });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 640 }, timezoneId: 'America/Los_Angeles' });
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.getByRole('button',{name:'사업장 변경'}).click();
  await page.getByText('1일 · 16시간 0분',{exact:true}).waitFor();
  await page.waitForTimeout(650);
  assert.equal(await page.getByText('1일 · 16시간 0분',{exact:true}).count(),1);
  assert.equal(await page.getByText('09:00 → 18:00',{exact:true}).count(),2);
  await page.evaluate(()=>{window.fail=true});
  await page.getByRole('button',{name:'이전 달'}).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByText('1일 · 16시간 0분',{exact:true}).count(),0);
  await page.evaluate(()=>{window.fail=false;window.pending=true});
  await page.getByRole('button',{name:'다시 불러오기'}).click();
  await page.getByText('정산 대기',{exact:true}).waitFor();
  await page.getByText('1일 · 8시간 0분',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: stale facility response ignored; saved recognition; unique workdays; KST in US timezone; query failure/retry; pending recognition. No backend writes.');
} finally { await browser.close(); }
