import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright-core');
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: {width:390,height:844} });
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.type() === 'prompt' ? d.accept(/금액/.test(d.message()) ? '50000' : '테스트 이름') : d.accept()); // confirm → OK, prompt → a fixed name (or an amount)
  const base = process.env.BASE_URL || 'http://127.0.0.1:3004';
  // An invite link shows a banner on the login screen, remembers the code for after login, and cleans the URL.
  await page.goto(`${base}/?invite=00000000-0000-4000-8000-000000000000`);
  await page.getByText('초대받으셨네요!',{exact:false}).waitFor();
  await page.waitForFunction(() => location.search === '');
  assert.equal(await page.evaluate(() => localStorage.getItem('haraguri-invite')),'00000000-0000-4000-8000-000000000000');
  await page.evaluate(() => localStorage.removeItem('haraguri-invite'));
  await page.goto(base);
  // A code (or whole link) pasted on the login screen is remembered the same way, before signing in.
  await page.getByRole('button',{name:'초대 코드를 받았어요'}).click();
  await page.getByLabel('초대 코드 또는 링크').fill('잘못된 코드');
  await page.getByRole('button',{name:'코드 기억하기'}).click();
  await page.getByRole('alert').filter({hasText:'초대 코드 형식이 아니에요'}).waitFor();
  await page.getByLabel('초대 코드 또는 링크').fill(`${base}/?invite=11111111-2222-4333-8444-555555555555`);
  await page.getByRole('button',{name:'코드 기억하기'}).click();
  await page.getByText('초대받으셨네요!',{exact:false}).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('haraguri-invite')),'11111111-2222-4333-8444-555555555555');
  await page.evaluate(() => localStorage.removeItem('haraguri-invite'));
  // Simulate an Android share-sheet hand-off: the service worker would have cached these items before redirecting to /?shared=1.
  await page.evaluate(async () => { const c = await caches.open('haraguri-share'); await c.put('/share/meta', new Response(JSON.stringify({ count: 0, text: '신한카드(5678)승인 김*한 15,900원(일시불)10/26 09:10 스타벅스 역삼점', at: Date.now() }), { headers: { 'Content-Type': 'application/json' } })); });
  await page.goto(`${base}/?shared=1`);
  await page.waitForFunction(() => location.search === '');
  // Email fallback is reachable from the login screen without leaving the app.
  if (await page.getByRole('button',{name:'카카오가 안 될 때 · 이메일로 로그인'}).count()) {
    await page.getByRole('button',{name:'카카오가 안 될 때 · 이메일로 로그인'}).click();
    await page.getByLabel('이메일',{exact:true}).waitFor();
    await page.getByRole('button',{name:'← 카카오 로그인으로'}).click();
    await page.getByRole('button',{name:'카카오 로그인',exact:true}).waitFor();
  }
  await page.getByRole('button',{name:'로그인 없이 미리보기'}).click();
  await page.getByRole('heading',{name:'우리의 하루를 함께.'}).waitFor();
  const dialog = page.getByRole('dialog');
  const moreFields = async () => { const b = dialog.getByRole('button',{name:/^자세히/}); if (await b.count()) await b.click(); }; // expense form hides date/method/card until asked
  // The money tab shows one feed; 리포트·반복·적립·카드 sit behind '더 보기'. Card folds live in the 카드 view.
  const views = page.getByRole('group',{name:'가계부 보기'});
  const openMore = async () => { const b = views.getByRole('button',{name:'더 보기 ▾'}); if (await b.count()) await b.click(); };
  const toView = async name => { await openMore(); await views.getByRole('button',{name,exact:true}).click(); };
  const openFold = async name => { await toView('카드'); const fold = page.locator('details.fold').filter({hasText:name}); if (!(await fold.evaluate(el => el.open))) await fold.locator(':scope > summary').click(); };
  const openSettingsFold = async name => { const fold = page.locator('details.settings-fold').filter({hasText:name}); if (!(await fold.evaluate(el => el.open))) await fold.locator(':scope > summary').click(); }; // 가족 초대·다른 모임 are folded in 설정
  const openReportDetail = async () => { const fold = page.locator('details.report-detail'); if (!(await fold.evaluate(el => el.open))) await fold.locator(':scope > summary').click(); }; // 리포트 = card first, tables under '자세히'
  // The shared card message is offered as an expense and pre-fills the form.
  await dialog.getByRole('heading',{name:'공유받은 항목'}).waitFor();
  await dialog.getByRole('button',{name:'₩ 카드 결제로 가계부에 기록'}).click();
  await dialog.getByText('→ 아래에 채웠어요',{exact:false}).waitFor();
  assert.equal(await dialog.getByLabel('사용처·내용').inputValue(),'스타벅스 역삼점');
  assert.equal(await dialog.getByLabel('금액 (원)',{exact:true}).inputValue(),'15900');
  assert.equal(await dialog.locator('input[name=category]').inputValue(),'카페'); // 스타벅스 → 카페 since the ☕ category (11/4)
  await dialog.getByRole('button',{name:'닫기',exact:true}).click();
  // Home week strip → day view of that date → back home. Holiday names show in the month grid.
  const todayStr = new Date().toLocaleDateString('sv-SE');
  await page.getByRole('group',{name:'이번 주'}).getByRole('button',{name:new RegExp(`^${todayStr}`)}).click();
  assert.equal(await page.getByLabel('조회 일',{exact:true}).inputValue(),todayStr);
  await page.getByRole('group',{name:'일정 보기'}).getByRole('button',{name:'월간',exact:true}).click();
  await page.getByLabel('조회 월').fill('2026-02');
  await page.getByText('설날',{exact:true}).first().waitFor();
  await page.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'우리집'}).click();
  await page.getByRole('button',{name:'일정·할 일 추가',exact:true}).click();
  await dialog.getByLabel('제목',{exact:true}).fill('테스트 정기 납부');
  await dialog.getByLabel('날짜',{exact:true}).fill('2026-01-31');
  await dialog.locator('select[name=repeat]').selectOption('monthly');
  await dialog.getByRole('button',{name:'저장하기',exact:true}).click();
  await page.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'일정·할 일'}).click();
  await page.getByLabel('조회 월').fill('2026-02');
  await page.locator('button.entry').filter({hasText:/테스트 정기 납부/}).click();
  await dialog.getByText('2026-02-28 · 매월 · 함께',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'완료했어요',exact:true}).click();
  await dialog.getByLabel('메시지',{exact:true}).fill('납부했어요');
  await dialog.getByRole('button',{name:'보내기',exact:true}).click();
  await dialog.locator('.chat-bubble:not(.pending)').filter({hasText:'납부했어요'}).waitFor();
  await dialog.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByLabel('조회 월').fill('2026-03');
  await page.locator('button.entry').filter({hasText:/테스트 정기 납부/}).click();
  assert.equal(await dialog.getByRole('button',{name:'완료했어요',exact:true}).getAttribute('aria-pressed'),'false');
  assert.equal(await dialog.locator('.chat-bubble:not(.pending)').filter({hasText:'납부했어요'}).count(),0);
  assert.equal(await dialog.getByRole('button',{name:'이전 대화 보기'}).count(),0);
  // Editing: records exist on this entry, so date/repeat are locked while the title still changes.
  await dialog.getByRole('button',{name:'✎ 수정',exact:true}).click();
  await dialog.getByText('날짜와 반복은 바꿀 수 없어요',{exact:false}).waitFor();
  assert.equal(await dialog.getByLabel('날짜',{exact:true}).getAttribute('readonly'),'');
  await dialog.getByLabel('제목',{exact:true}).fill('테스트 정기 납부 (수정)');
  await dialog.getByRole('button',{name:'저장하기',exact:true}).click();
  await page.locator('button.entry').filter({hasText:/테스트 정기 납부 \(수정\)/}).click();
  await dialog.getByText('2026-03-31 · 매월 · 함께',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('button',{name:'일정·할 일 추가',exact:true}).click();
  await dialog.getByLabel('제목',{exact:true}).fill('수정 가능한 약속');
  await dialog.getByLabel('날짜',{exact:true}).fill('2026-03-20');
  await dialog.getByRole('button',{name:'저장하기',exact:true}).click();
  await page.locator('button.entry').filter({hasText:/수정 가능한 약속/}).click();
  await dialog.getByRole('button',{name:'✎ 수정',exact:true}).click();
  assert.equal(await dialog.getByLabel('날짜',{exact:true}).getAttribute('readonly'),null);
  await dialog.getByLabel('날짜',{exact:true}).fill('2026-03-21');
  await dialog.getByRole('button',{name:'저장하기',exact:true}).click();
  await page.locator('button.entry').filter({hasText:/수정 가능한 약속/}).click();
  await dialog.getByText('2026-03-21 · 한 번 · 함께',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('group',{name:'일정 보기'}).getByRole('button',{name:'연간',exact:true}).click();
  await page.getByRole('button',{name:'2026-02-28 일정 1개 완료',exact:true}).click();
  assert.equal(await page.getByLabel('조회 일',{exact:true}).inputValue(),'2026-02-28');
  await page.getByRole('button',{name:'다음 기간',exact:true}).click();
  assert.equal(await page.getByLabel('조회 일',{exact:true}).inputValue(),'2026-03-01');
  await page.getByRole('group',{name:'일정 보기'}).getByRole('button',{name:'연간',exact:true}).click();
  await page.screenshot({path:'/tmp/haraguri-planner-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.getByRole('group',{name:'일정 보기'}).getByRole('button',{name:'월간',exact:true}).click();
  await page.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'가계부'}).click();
  await page.getByRole('button',{name:'지출 기록',exact:true}).click();
  await moreFields();
  await dialog.locator('select[name=payment_method]').selectOption('cash');
  await dialog.getByLabel('사용처·내용').fill('테스트 지출');
  await dialog.getByLabel('금액 (원)',{exact:true}).fill('12345');
  await dialog.getByLabel('날짜',{exact:true}).fill('2026-03-05');
  await dialog.getByRole('button',{name:'저장하기'}).click();
  await page.getByText('테스트 지출',{exact:true}).waitFor();
  await page.getByText('3월 5일 (목)',{exact:false}).waitFor(); // ledger rows are grouped by day
  await openFold('카드별 실적');
  await page.getByRole('button',{name:'우리 생활비 카드 설정'}).click();
  await dialog.locator('input[name=performance_thresholds]').fill('300000, 500000');
  await dialog.getByRole('button',{name:'저장하기'}).click();
  await page.getByRole('button',{name:'지출 기록',exact:true}).click();
  await moreFields();
  assert.equal(await dialog.locator('select[name=payment_method]').inputValue(),'cash'); // remembered from the previous entry
  await dialog.locator('select[name=payment_method]').selectOption('card');
  await dialog.getByLabel('사용처·내용').fill('실적 테스트');
  await dialog.getByLabel('금액 (원)',{exact:true}).fill('310000');
  await dialog.getByLabel('날짜',{exact:true}).fill('2026-03-10');
  await dialog.locator('select[name=card_id]').selectOption('c1');
  await dialog.getByRole('button',{name:'저장하기'}).click();
  await page.getByText('190,000원 남았어요',{exact:true}).waitFor();
  // One switch per transaction: counts toward the card's performance or not.
  await toView('피드');
  await page.getByRole('button',{name:'실적 테스트 수정'}).click();
  await dialog.getByLabel(/이 거래는 카드 실적에서 제외/).check();
  await dialog.getByRole('button',{name:'저장하기'}).click();
  await toView('카드');
  await page.getByText('300,000원 남았어요',{exact:true}).waitFor();
  await toView('피드');
  await page.getByRole('button',{name:'실적 테스트 수정'}).click();
  assert.equal(await dialog.getByLabel(/이 거래는 카드 실적에서 제외/).isChecked(),true);
  await dialog.getByRole('button',{name:'닫기',exact:true}).click();
  await page.screenshot({path:'/tmp/haraguri-finance-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'지출 기록',exact:true}).click();
  await moreFields();
  await dialog.locator('select[name=payment_method]').selectOption('bank_transfer');
  await dialog.getByLabel('사용처·내용').fill('월세 이체');
  await dialog.getByLabel('금액 (원)',{exact:true}).fill('500000');
  await dialog.getByLabel('날짜',{exact:true}).fill('2026-03-11');
  await dialog.getByRole('button',{name:'저장하기'}).click();
  await toView('피드');
  await page.getByRole('button',{name:/^필터/}).click(); // filters are folded away by default
  await page.getByRole('group',{name:'결제 수단 필터'}).getByRole('button',{name:'계좌이체',exact:true}).click();
  await page.getByText('월세 이체',{exact:true}).waitFor();
  assert.equal(await page.getByText('실적 테스트',{exact:true}).count(),0);
  await page.getByRole('button',{name:/^필터 \(1\)/}).waitFor(); // active filter count shows on the toggle
  await page.getByRole('group',{name:'결제 수단 필터'}).getByRole('button',{name:'전체',exact:true}).click();
  await openFold('카드별 실적');
  await page.getByRole('button',{name:'우리 생활비 카드 설정'}).click();
  await dialog.locator('select[name=card_type]').selectOption('debit');
  await dialog.getByRole('button',{name:'저장하기'}).click();
  await toView('피드');
  await page.getByRole('group',{name:'결제 수단 필터'}).getByRole('button',{name:'체크카드',exact:true}).click();
  await page.getByText('실적 테스트',{exact:true}).waitFor();
  assert.equal(await page.getByText('월세 이체',{exact:true}).count(),0);
  // Pasting a card approval SMS fills merchant, amount, date and picks the only card.
  await page.getByRole('button',{name:'지출 기록',exact:true}).click();
  await moreFields();
  await dialog.getByRole('button',{name:'✉ 카드 승인 문자 붙여넣어 채우기'}).click();
  await dialog.getByLabel('카드 승인 문자').fill('[Web발신]\nKB국민카드 1234승인\n김*한\n48,300원 일시불\n10/27 11:21\n동네마트\n누적1,234,567원');
  await dialog.getByText('→ 아래에 채웠어요',{exact:false}).waitFor();
  assert.equal(await dialog.getByLabel('사용처·내용').inputValue(),'동네마트');
  assert.equal(await dialog.getByLabel('금액 (원)',{exact:true}).inputValue(),'48300');
  assert.equal(await dialog.locator('select[name=card_id]').inputValue(),'c1');
  const smsMonth = (await dialog.getByLabel('날짜',{exact:true}).inputValue()).slice(0,7);
  await dialog.getByRole('button',{name:'저장하기'}).click();
  await page.getByRole('group',{name:'결제 수단 필터'}).getByRole('button',{name:'전체',exact:true}).click();
  await page.getByLabel('가계부 조회 월').fill(smsMonth); // the list shows the month being viewed, not the month just saved
  await page.getByText('동네마트',{exact:true}).waitFor();
  if (smsMonth === todayStr.slice(0,7)) await page.locator('.finance-expense').filter({hasText:'편의점 CU'}).waitFor(); // collected rows sit in the feed like any other — no review queue
  await openMore();
  await page.getByRole('group',{name:'가계부 보기'}).getByRole('button',{name:'리포트'}).click();
  await openReportDetail();
  await page.getByText(`${smsMonth} 총지출`,{exact:true}).waitFor();
  await page.getByRole('heading',{name:'자주 쓴 곳 TOP 5'}).waitFor();
  await page.getByRole('group',{name:'가계부 보기'}).getByRole('button',{name:'반복·적립'}).click();
  await page.getByText('아파트 관리비',{exact:true}).waitFor();
  await page.getByRole('button',{name:'＋ 반복 지출'}).click();
  await dialog.getByLabel('이름',{exact:true}).fill('넷플릭스');
  await dialog.getByLabel('금액 (원)',{exact:true}).fill('17000');
  await dialog.locator('select[name=payment_method]').selectOption('cash');
  await dialog.getByRole('button',{name:'저장하기'}).click();
  await page.getByText('넷플릭스',{exact:true}).waitFor();
  // In-place classification: the category tag on a feed row opens chips; one tap files it (same-merchant rows follow).
  await page.getByRole('group',{name:'가계부 보기'}).getByRole('button',{name:'피드'}).click();
  await page.getByLabel('가계부 조회 월').fill(todayStr.slice(0,7)); // the demo's collected row is dated today
  const cuRow=page.locator('.finance-expense').filter({hasText:'편의점 CU'});
  await cuRow.getByRole('button',{name:/식비/}).click();
  await cuRow.getByRole('button',{name:'더보기',exact:true}).click();
  await cuRow.getByRole('group',{name:'분류 고르기'}).getByRole('button',{name:/생활/}).click();
  await page.getByRole('status').filter({hasText:'생활로 정리했어요'}).waitFor();
  await cuRow.getByRole('button',{name:/생활/}).waitFor();
  await page.getByLabel('가계부 조회 월').fill('2026-03');
  await page.getByRole('button',{name:'다음 달',exact:true}).click(); // one tap per month instead of opening the picker
  assert.equal(await page.getByLabel('가계부 조회 월').inputValue(),'2026-04');
  await page.getByRole('button',{name:'이전 달',exact:true}).click();
  assert.equal(await page.getByLabel('가계부 조회 월').inputValue(),'2026-03');
  // Budget: set a monthly total from the summary cell; the cell then shows what is left and today's allowance.
  await page.getByRole('button',{name:'예산 설정',exact:true}).click();
  await dialog.getByRole('heading',{name:'예산 설정'}).waitFor();
  await dialog.locator('input[name=budget_total]').fill('2000000');
  await dialog.locator('input[name=budget_식비]').fill('300000');
  await dialog.getByRole('button',{name:'저장하기'}).click();
  await page.getByText('남은 예산',{exact:false}).first().waitFor();
  await page.locator('.budget-cell').getByText(/오늘은 .*까지|이번 달 마감/).waitFor(); // a past month has no daily allowance
  // Income: the form's 지출/수입 toggle; income shows as +amount and never counts as spending.
  const spentBefore = await page.locator('.fin-figures > div').nth(0).locator('strong').innerText();
  await page.getByRole('button',{name:'지출 기록',exact:true}).click();
  await dialog.getByRole('group',{name:'종류'}).getByRole('button',{name:'수입',exact:true}).click();
  await dialog.getByLabel('금액 (원)',{exact:true}).fill('500000');
  await dialog.getByLabel('사용처·내용').fill('보너스');
  await moreFields();
  await dialog.getByLabel('날짜',{exact:true}).fill('2026-03-15');
  await dialog.getByRole('button',{name:'저장하기'}).click();
  await page.locator('.finance-expense').filter({hasText:'보너스'}).getByText('+500,000원',{exact:true}).waitFor();
  assert.equal(await page.locator('.fin-figures > div').nth(0).locator('strong').innerText(),spentBefore,'Income must not change the spending total');
  await page.getByRole('button',{name:'지출 기록',exact:true}).click();
  await dialog.getByRole('group',{name:'종류'}).getByRole('button',{name:'자금 이동',exact:true}).click();
  await dialog.getByLabel('금액 (원)',{exact:true}).fill('500000');
  await dialog.getByLabel('사용처·내용').fill('본인 계좌 간 이동');
  await moreFields();
  await dialog.getByLabel('날짜',{exact:true}).fill('2026-03-16');
  await dialog.getByRole('button',{name:'저장하기'}).click();
  await page.locator('.finance-expense').filter({hasText:'본인 계좌 간 이동'}).getByText('자금 이동 · 집계 제외',{exact:true}).waitFor();
  assert.equal(await page.locator('.fin-figures > div').nth(0).locator('strong').innerText(),spentBefore,'Own-account movement must not change spending');
  await openMore();
  await page.getByRole('group',{name:'가계부 보기'}).getByRole('button',{name:'리포트'}).click();
  await openReportDetail();
  await page.getByText('수입 · 남는 돈',{exact:true}).waitFor();
  await page.getByText('예산 2,000,000원 중',{exact:false}).waitFor();
  // Month card bars: one tap on a category opens the feed filtered to it; the feed itself folds days older than the newest three.
  await page.getByRole('list',{name:'분류별 지출'}).getByRole('button').first().click();
  await page.getByText(/만 보는 중/).waitFor();
  await page.getByRole('button',{name:'전체 보기'}).click();
  assert.ok(await page.locator('.day-head.closed').count()>=1,'older days fold to one line');
  await page.getByRole('button',{name:/모두 펼치기/}).click();
  assert.equal(await page.locator('.day-head.closed').count(),0);
  await page.getByRole('button',{name:/최근 3일만/}).click();
  // Learned rule: saving '스타벅스 강남' as 교통 teaches the family; the next '스타벅스 …' pre-selects 교통.
  await page.getByRole('button',{name:'지출 기록',exact:true}).click();
  await dialog.getByLabel('금액 (원)',{exact:true}).fill('4500');
  await dialog.getByLabel('사용처·내용').fill('스타벅스 강남');
  await dialog.getByRole('group',{name:'분류'}).getByRole('button',{name:/교통/}).click();
  await moreFields(); await dialog.getByLabel('날짜',{exact:true}).fill('2026-03-16');
  await dialog.getByRole('button',{name:'저장하기'}).click();
  await page.locator('.finance-expense').filter({hasText:'스타벅스 강남'}).waitFor();
  await page.getByRole('button',{name:'지출 기록',exact:true}).click();
  await dialog.getByLabel('사용처·내용').fill('스타벅스 역삼');
  assert.equal(await dialog.getByRole('group',{name:'분류'}).getByRole('button',{name:/교통/}).getAttribute('aria-pressed'),'true');
  await dialog.getByRole('button',{name:'닫기',exact:true}).click();
  // Regret toggle, expense → chat room, calendar view with a day filter, search.
  const star = page.locator('.finance-expense').filter({hasText:'스타벅스 강남'});
  await star.getByRole('button',{name:'스타벅스 강남 대화'}).click();
  await dialog.getByRole('heading',{name:'스타벅스 강남'}).waitFor();
  await dialog.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('group',{name:'내역 보기'}).getByRole('button',{name:'달력'}).click();
  await page.getByRole('button',{name:/^2026-03-16 /}).click();
  await page.getByText('3월 16일 (월)만 보는 중').waitFor();
  await page.getByRole('button',{name:'전체 보기'}).click();
  if (!(await page.getByLabel('내역 검색').count())) await page.getByRole('button',{name:/^필터/}).click();
  await page.getByLabel('내역 검색').fill('스타벅스');
  assert.equal(await page.locator('.finance-expense').count(),1);
  await page.getByLabel('내역 검색').fill('');
  // Screenshot import: QA injects OCR text through the test seam (no 10MB language download), then confirms the parsed rows.
  await page.evaluate(() => { window.__haraguriOcr = async () => '이용내역\n이마트 성수점 32,400원\n03.14 18:02 일시불\n다이소 7,000원\n03.14 18:30 일시불'; });
  await page.getByRole('button',{name:'📷 캡처 가져오기'}).click();
  await dialog.getByRole('heading',{name:'카드앱 캡처로 가져오기'}).waitFor();
  await dialog.getByLabel('이용내역 캡처 선택').setInputFiles({name:'capture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKXcAAAAASUVORK5CYII=','base64')});
  await dialog.getByText('2건 찾았어요',{exact:false}).waitFor();
  await dialog.locator('select').first().selectOption('c1');
  await dialog.getByRole('button',{name:/2건 가계부에 추가/}).click();
  await page.locator('.finance-expense').filter({hasText:'이마트 성수점'}).waitFor();
  await page.locator('.finance-expense').filter({hasText:'다이소'}).waitFor();
  // Envelopes: the demo envelope takes a deposit through the amount prompt (50,000).
  await openMore();
  await page.getByRole('group',{name:'가계부 보기'}).getByRole('button',{name:'반복·적립'}).click();
  await page.locator('.envelope').filter({hasText:'자동차세'}).getByRole('button',{name:'＋ 넣기'}).click();
  await page.locator('.envelope').filter({hasText:'자동차세'}).getByText('150,000원',{exact:true}).waitFor();
  // Report: settlement panel (2 demo members) and a CSV download.
  await page.getByRole('group',{name:'가계부 보기'}).getByRole('button',{name:'리포트'}).click();
  await openReportDetail();
  await page.getByRole('heading',{name:'월말 정산'}).waitFor();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button',{name:'CSV 내려받기'}).click()]);
  assert.equal(download.suggestedFilename(),'haraguri-2026-03.csv');
  await page.getByRole('group',{name:'가계부 보기'}).getByRole('button',{name:'피드'}).click();


  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'대화',exact:true}).click();
  await page.getByLabel('메시지',{exact:true}).fill('가족 기본방 테스트');
  await page.getByRole('button',{name:'보내기',exact:true}).click();
  await page.locator('.chat-bubble:not(.pending)').filter({hasText:'가족 기본방 테스트'}).waitFor();
  await page.locator('.chat-date').filter({hasText:'오늘'}).first().waitFor(); // day separator
  // Enter sends on a fine pointer (desktop); Shift+Enter would add a line.
  await page.getByLabel('메시지',{exact:true}).fill('엔터로 전송');
  await page.getByLabel('메시지',{exact:true}).press('Enter');
  await page.locator('.chat-bubble:not(.pending)').filter({hasText:'엔터로 전송'}).waitFor();
  // Own messages can be edited and deleted from the long-press / right-click menu.
  const mine = page.locator('.chat-line.mine').filter({hasText:'가족 기본방 테스트'}).first();
  await mine.locator('.chat-bubble:not(.pending)').click({button:'right'});
  await mine.getByRole('menuitem',{name:'수정',exact:true}).click();
  await page.getByLabel('메시지 수정').fill('가족 기본방 테스트 (수정)');
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await page.locator('.chat-line.mine').filter({hasText:'가족 기본방 테스트 (수정)'}).filter({hasText:'수정됨'}).waitFor();
  const edited = page.locator('.chat-line.mine').filter({hasText:'(수정)'});
  await edited.locator('.chat-bubble:not(.pending)').click({button:'right'});
  await edited.getByRole('menuitem',{name:'삭제',exact:true}).click();
  await page.waitForFunction(()=>![...document.querySelectorAll('.chat-bubble')].some(b=>b.textContent?.includes('가족 기본방 테스트 (수정)')));
  await page.getByLabel('메시지',{exact:true}).fill('가족 기본방 테스트');
  await page.getByRole('button',{name:'보내기',exact:true}).click();
  await page.locator('.chat-bubble:not(.pending)').filter({hasText:'가족 기본방 테스트'}).waitFor();
  // Reply, reaction, pin and search from the message menu (chat rounds 2/3).
  const baseMsg = page.locator('.chat-line.mine:not(:has(.quote))').filter({hasText:'가족 기본방 테스트'}).last(); // the reply quotes the same text, so exclude quoted lines
  await baseMsg.locator('.chat-bubble:not(.pending)').click({button:'right'});
  await baseMsg.getByRole('menuitem',{name:'답장',exact:true}).click();
  await page.locator('.reply-preview').filter({hasText:'가족 기본방 테스트'}).waitFor();
  await page.getByLabel('메시지',{exact:true}).fill('답장이에요');
  await page.getByRole('button',{name:'보내기',exact:true}).click();
  await page.locator('.chat-bubble:not(.pending)').filter({hasText:'답장이에요'}).waitFor(); // the pending bubble lingers a few hundred ms after the real row lands
  await page.locator('.chat-line').filter({hasText:'답장이에요'}).filter({hasNot:page.locator('.chat-bubble.pending')}).locator('.quote').filter({hasText:'가족 기본방 테스트'}).waitFor();
  await baseMsg.locator('.chat-bubble:not(.pending)').click({button:'right'});
  await baseMsg.getByRole('menuitem',{name:'👍 반응',exact:true}).click();
  await baseMsg.locator('.reaction-chips button').filter({hasText:'👍 1'}).waitFor();
  await baseMsg.locator('.chat-bubble:not(.pending)').click({button:'right'});
  await baseMsg.getByRole('menuitem',{name:'고정',exact:true}).click();
  await page.locator('.pin-banner').filter({hasText:'가족 기본방 테스트'}).waitFor();
  await page.getByRole('button',{name:'고정 해제',exact:true}).click();
  assert.equal(await page.locator('.pin-banner').count(),0);
  await page.getByRole('button',{name:'대화 검색',exact:true}).click();
  await page.getByLabel('대화 검색어').fill('답장이에요');
  await page.locator('.search-hits').getByRole('listitem').filter({hasText:'답장이에요'}).first().waitFor();
  await page.getByRole('button',{name:'대화 검색',exact:true}).click();
  await page.getByRole('group',{name:'대화 종류'}).getByRole('button',{name:'일정·구매별 대화'}).click();
  await page.getByRole('button',{name:/아이 자전거 같이 고르기/}).click();
  assert.equal(await dialog.locator('.chat-bubble:not(.pending)').filter({hasText:'가족 기본방 테스트'}).count(),0);
  await dialog.getByLabel('메시지',{exact:true}).fill('이 모델로 살까요?');
  await dialog.getByRole('button',{name:'보내기',exact:true}).click();
  await dialog.locator('.chat-bubble:not(.pending)').filter({hasText:'이 모델로 살까요?'}).waitFor();
  await dialog.getByLabel('구매 진행',{exact:true}).selectOption('decided');
  await dialog.getByLabel('기존 지출 연결',{exact:true}).selectOption({label:'2026-03-11 · 월세 이체 · 500,000원'});
  await dialog.getByText('월세 이체',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'가족 기본 채팅에 공유'}).click();
  await page.getByRole('button',{name:/아이 자전거 같이 고르기.*우리집 일 열기/}).click();
  await dialog.locator('.chat-bubble:not(.pending)').filter({hasText:'이 모델로 살까요?'}).waitFor();
  assert.equal(await dialog.getByLabel('구매 진행',{exact:true}).inputValue(),'decided');
  await dialog.getByRole('button',{name:'대화 바로가기 ↓'}).click();
  await page.screenshot({path:'/tmp/haraguri-work-mobile.png',fullPage:true});
  // Finishing the purchase suggests closing; closing hides the composer, reopening restores it.
  assert.equal(await dialog.locator('.finish-banner').count(),0);
  await dialog.getByLabel('구매 진행',{exact:true}).selectOption('purchased');
  await dialog.locator('.finish-banner').getByRole('button',{name:'대화 종료',exact:true}).click();
  await dialog.getByText('종료된 대화예요.',{exact:false}).first().waitFor();
  assert.equal(await dialog.getByLabel('메시지',{exact:true}).count(),0);
  await dialog.locator('.chat-bubble:not(.pending)').filter({hasText:'이 모델로 살까요?'}).waitFor();
  await dialog.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('group',{name:'대화 종류'}).getByRole('button',{name:'일정·구매별 대화'}).click();
  await page.getByRole('group',{name:'진행 상태'}).getByRole('button',{name:/종료됨 1/}).click();
  await page.getByRole('button',{name:/종료됨.*아이 자전거 같이 고르기/}).click();
  await dialog.getByText('종료된 대화예요',{exact:false}).first().waitFor(); // closed rooms are read-only now (no reopen)
  assert.equal(await dialog.getByLabel('메시지',{exact:true}).count(),0);
  await dialog.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('group',{name:'진행 상태'}).getByRole('button',{name:/진행 중/}).click();
  // Settings: rename yourself (prompt → '테스트 이름').
  await page.getByRole('button',{name:'설정',exact:true}).first().click();
  await page.locator('.member-row').filter({hasText:'(나)'}).getByRole('button',{name:'이름 바꾸기'}).click();
  await page.locator('.member-row').filter({hasText:'테스트 이름 (나)'}).waitFor();
  // Owner-side invite tools: nickname/email target form and the link/code section both render.
  await openSettingsFold('가족 초대');
  await page.getByLabel('카카오 닉네임 또는 이메일').waitFor();
  await page.getByRole('heading',{name:'초대 링크·코드'}).waitFor();
  await page.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'우리집'}).click();
  await page.screenshot({path:'/tmp/haraguri-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'/tmp/haraguri-desktop.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  const manifest=await (await page.request.get(`${process.env.BASE_URL || 'http://127.0.0.1:3004'}/manifest.webmanifest`)).json();
  assert.equal(manifest.name,'HARAGURI');
  for (const icon of manifest.icons) assert.equal((await page.request.get(`${process.env.BASE_URL || 'http://127.0.0.1:3004'}${icon.src}`)).status(),200);
  assert.deepEqual(errors,[]);
  console.log('PASS: mobile/desktop; year/month/day planner; recurring conversations; general/work chat and sharing; purchase status; existing expense linking; card performance; PWA assets.');
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({path:'/tmp/haraguri-failure.png'});
    console.error('Page errors:', JSON.stringify(errors));
    console.error('Alerts:', JSON.stringify(await page.getByRole('alert').allInnerTexts().catch(()=>[])));
    console.error((await page.locator('body').innerText()).slice(-3000));
  }
  throw error;
} finally { await browser.close(); }
