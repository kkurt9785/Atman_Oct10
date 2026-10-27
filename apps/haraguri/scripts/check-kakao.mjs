import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright-core');
const base = process.env.BASE_URL || 'https://haraguri.vercel.app';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage({viewport:{width:390,height:844}});
  await page.goto(`${base}/auth/callback?error=access_denied`);
  await page.getByRole('alert').filter({hasText:'로그인이 취소'}).waitFor();
  assert.equal(new URL(page.url()).search, '');
  await page.getByRole('link',{name:'로그인 화면으로'}).click();
  await page.getByRole('button',{name:'카카오 로그인',exact:true}).click();
  await page.waitForURL(url => /(^|\.)kakao\.com$/.test(url.hostname));
  await page.waitForLoadState('domcontentloaded');
  const body = await page.locator('body').innerText();
  const errors = [...new Set(body.match(/KOE\d{3}/g) || [])];
  console.log(JSON.stringify({host:new URL(page.url()).hostname,title:await page.title(),errors,body:body.slice(0,1600)},null,2));
  await page.screenshot({path:'/tmp/haraguri-kakao-login.png',fullPage:true});
  assert.equal(errors.length,0,'Kakao provider configuration error');
} finally { await browser.close(); }
