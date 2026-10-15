// Public demo navigation only; no applications, attendance, reports or payments.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.argv[2]||'playwright-core');
const directory=await mkdtemp(path.join(tmpdir(),'itdot-live-home-'));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('https://itdot.co.kr/demo');
 await page.getByRole('button',{name:/간호사/}).first().click();
 await page.waitForURL('**/home',{timeout:45000});
 await page.getByRole('button',{name:'설정 지역 함께',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'설정 지역 함께',exact:true}).getAttribute('aria-pressed'),'true');
 await page.screenshot({path:path.join(directory,'worker-home-390.png'),fullPage:true});
 await page.goto('https://itdot.co.kr/shifts');await page.getByLabel('공고 정렬').waitFor();
 await page.screenshot({path:path.join(directory,'worker-discovery-390.png'),fullPage:true});
 await page.goto('https://itdot.co.kr/safety');await page.getByText('차단한 사용자가 없어요.',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 console.log(`PASS live demo: combined areas selected, discovery sorting controls, safety RLS read; screenshots ${directory}`);
}finally{await browser.close();}
