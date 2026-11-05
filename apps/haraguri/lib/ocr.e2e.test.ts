// Real OCR end-to-end on a rendered fake card-app screen. Downloads ~10MB of language data, so it only runs with OCR_E2E=1.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { parseOcrText } from './ocr';

const require = createRequire(import.meta.url);
const PW = process.env.PW_CORE || '/Users/kihankim/lumenix/main/node_modules/playwright-core'; // the old scratchpad copy is gone
const OUT = '/tmp/haraguri-fake-card-app.png';

describe.skipIf(!process.env.OCR_E2E)('screenshot OCR end to end', () => {
  it('reads a rendered 이용내역 screen with Tesseract and parses the rows', async () => {
    const { chromium } = require(PW);
    const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 });
    const rows = [['스타벅스 역삼점', '10.27 11:21 · 일시불', '4,500원'], ['GS25 강남대로점', '10.26 22:10 · 일시불', '3,200원'], ['쿠팡', '10.25 09:00 · 할부 3개월', '48,300원'], ['배달의민족', '10.24 19:40 · 일시불', '12,900원'], ['배달의민족 승인취소', '10.24 19:52 · 일시불', '-12,900원'], ['이마트 트레이더스 하남', '10.22 14:21 · 일시불', '156,800원']];
    await page.setContent(`<html><body style="margin:0;font-family:'Apple SD Gothic Neo',sans-serif;background:#fff;color:#111"><div style="padding:18px 20px;border-bottom:1px solid #eee;font-size:18px;font-weight:700">이용내역</div><div style="padding:14px 20px;font-size:13px;color:#888;background:#f7f7f7">10월</div>${rows.map(([m, d, a]) => `<div style="display:flex;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #f0f0f0"><div><div style="font-size:16px;font-weight:600">${m}</div><div style="font-size:12px;color:#888;margin-top:4px">${d}</div></div><div style="font-size:16px;font-weight:700">${a}</div></div>`).join('')}<div style="padding:16px 20px;font-size:13px;color:#888">이번 달 누적 213,700원</div></body></html>`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: OUT, fullPage: true });
    await browser.close();
    const { createWorker } = require('tesseract.js');
    const worker = await createWorker('kor+eng', 1, { cachePath: '/tmp' });
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(OUT);
    await worker.terminate();
    const parsed = parseOcrText(data.text, new Date('2026-10-27T12:00:00'));
    console.log('RAW OCR:\n' + data.text.trim() + '\nPARSED: ' + JSON.stringify(parsed.map(r => [r.date, r.merchant, r.amount])));
    const amounts = parsed.map(r => r.amount);
    expect(amounts).toEqual(expect.arrayContaining([4500, 3200, 48300, 12900, -12900, 156800]));
    expect(parsed.find(r => r.amount === 4500)?.date).toBe('2026-10-27');
  }, 180000);
});
