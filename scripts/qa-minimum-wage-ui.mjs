// Actual form, mocked server action/router. No network or backend writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright-core');
const { build } = require('../apps/worker-web/node_modules/esbuild');
const app = path.resolve('apps/admin-web');
const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {GigProjectForm} from './components/gig/GigProjectForm';
    createRoot(document.getElementById('root')).render(<GigProjectForm mode="create"/>);`, loader: 'tsx', resolveDir: app },
  bundle: true, write: false, platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'mocks', setup(build) {
    build.onResolve({filter: /^next\/navigation$/}, () => ({path:'router',namespace:'qa'}));
    build.onResolve({filter: /^\.\/GigActionForm$/}, () => ({path:'form',namespace:'qa'}));
    build.onLoad({filter: /.*/,namespace:'qa'}, args => ({loader:'tsx',resolveDir:app,contents:args.path==='router'
      ? 'export const useRouter = () => ({push(){}});'
      : 'import React from "react"; export const GigActionForm = ({children}) => <form onSubmit={e=>e.preventDefault()}>{children}</form>;' }));
    build.onResolve({filter:/^@\//},args=>({path:path.join(app,args.path.slice(2)+'.ts')}));
  }}],
});
const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  const page = await browser.newPage();
  await page.route('**/*',route=>route.abort());
  await page.setContent('<html lang="ko"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const start = page.locator('input[name="starts_on"]');
  const wage = page.locator('input[name="pay_rate"]');
  await start.fill('2026-10-14');
  await wage.fill('15000');
  assert.equal(await wage.evaluate(input=>input.checkValidity()),true);
  await wage.fill('10320');
  assert.equal(await wage.evaluate(input=>input.checkValidity()),true);
  await start.fill('2027-01-01');
  await page.getByRole('alert').filter({hasText:'10,700'}).waitFor();
  assert.equal(await wage.evaluate(input=>input.checkValidity()),false);
  await wage.fill('10700');
  assert.equal(await wage.evaluate(input=>input.checkValidity()),true);
  await page.getByRole('button',{name:'기간 · 반복 근무'}).click();
  await start.fill('2026-12-20');
  await page.locator('input[name="ends_on"]').fill('2027-01-02');
  await wage.fill('10320');
  await page.getByRole('alert').filter({hasText:'10,700'}).waitFor();
  await page.locator('input[name="ends_on"]').fill('2028-01-01');
  await page.getByRole('alert').filter({hasText:'등록되지'}).waitFor();
  console.log('PASS: valid 15,000/10,320 input, 2027 floor, multi-year dates, unknown-year warning; backend writes 0');
} finally { await browser.close(); }
