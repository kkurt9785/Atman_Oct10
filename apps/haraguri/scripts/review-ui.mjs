import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.argv[2]||'playwright-core');
const axe=process.argv[3];
const out=process.env.REVIEW_OUTPUT||'/private/tmp/haraguri-ui-review';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const results=[],errors=[];
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.BASE_URL||'http://127.0.0.1:3015');
 await page.getByRole('button',{name:'로그인 없이 미리보기'}).click();
 const tabs=['우리집','일정·할 일','가계부','대화','가족 설정'];
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:width>=768?1000:844});
  for(let i=0;i<tabs.length;i++){
   await page.locator('nav:visible').getByRole('button',{name:tabs[i],exact:true}).first().click();
   await page.waitForTimeout(120);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
   let violations=[];
   if(axe){await page.addScriptTag({path:axe});const r=await page.evaluate(()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}}));violations=r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,html:n.html,summary:n.failureSummary}))}));}
   results.push({width,tab:tabs[i],overflow,violations});
   if((width===320||width===1440)&&[0,2,4].includes(i))await page.screenshot({path:`${out}/${width}-${i}.png`,fullPage:true});
  }
 }
 writeFileSync(`${out}/results.json`,JSON.stringify({at:new Date().toISOString(),results,errors},null,2));
 console.log(JSON.stringify({screens:results.length,overflow:results.filter(r=>r.overflow).map(r=>({width:r.width,tab:r.tab})),violations:results.filter(r=>r.violations.length).map(r=>({width:r.width,tab:r.tab,issues:r.violations.map(v=>v.id)})),errors,report:out}));
 assert.equal(errors.length,0,'No page errors');
 assert.equal(results.some(r=>r.overflow),false,'No horizontal overflow');
 assert.equal(results.some(r=>r.violations.some(v=>['serious','critical'].includes(v.impact))),false,'No serious accessibility violations');
}finally{await browser.close();}
