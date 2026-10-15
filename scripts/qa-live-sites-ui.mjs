// Public admin demo navigation only. Do not save settings, create sites, or record attendance.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.argv[2]||'playwright-core');
const directory=await mkdtemp(path.join(tmpdir(),'itdot-live-sites-'));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://admin.itdot.co.kr/login?demo=gigworker');
 await page.waitForURL(url=>url.pathname==='/',{timeout:60000});
 await page.goto('https://admin.itdot.co.kr/settings?section=attendance');
 await page.getByRole('radio',{name:/간편 인증/}).waitFor();assert.equal(await page.getByRole('radio').count(),3);
 await page.screenshot({path:path.join(directory,'settings-390.png'),fullPage:true});
 await page.goto('https://admin.itdot.co.kr/sites');await page.getByRole('heading',{name:'사업장·현장 관리',exact:true}).waitFor();
 await page.getByRole('link',{name:'+ 단기 근무 현장 추가',exact:true}).click();
 try {await page.getByRole('heading',{name:'현장과 출퇴근 기준을 정해요',exact:true}).waitFor();} catch(error) {console.log('PAGE',new URL(page.url()).pathname,(await page.locator('body').innerText()).slice(0,1600),errors);await page.screenshot({path:path.join(directory,'failed.png'),fullPage:true});throw error;}
 await page.getByLabel('사업장 위치 지도').waitFor();
 assert.ok(await page.getByText(/처음 보이는 핀은 저장되지 않아요/).count());
 await page.waitForFunction(()=>document.querySelector('[aria-label="사업장 위치 지도"]')?.children.length>0);
 await page.getByLabel('사업장 위치 지도').click({position:{x:80,y:80}});
 await page.getByText(/선택한 위치:/).waitFor();
 await page.screenshot({path:path.join(directory,'new-site-390.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 console.log(`PASS live admin: three presets, accessible sites, direct map before search; no saves; screenshots ${directory}`);
} finally {await browser.close();}
