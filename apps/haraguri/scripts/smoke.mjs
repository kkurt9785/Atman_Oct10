import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright-core');
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: {width:390,height:844} });
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.type() === 'prompt' ? d.accept('테스트 이름') : d.accept()); // confirm → OK, prompt → a fixed name
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
  const openFold = async name => { const fold = page.locator('details.fold').filter({hasText:name}); if (!(await fold.evaluate(el => el.open))) await fold.locator('summary').click(); };
  // The shared card message is offered as an expense and pre-fills the form.
  await dialog.getByRole('heading',{name:'공유받은 항목'}).waitFor();
  await dialog.getByRole('button',{name:'₩ 카드 결제로 가계부에 기록'}).click();
  await dialog.getByText('→ 아래에 채웠어요',{exact:false}).waitFor();
  assert.equal(await dialog.getByLabel('사용처·내용').inputValue(),'스타벅스 역삼점');
  assert.equal(await dialog.getByLabel('금액 (원)',{exact:true}).inputValue(),'15900');
  assert.equal(await dialog.locator('select[name=category]').inputValue(),'식비');
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
  await page.getByRole('button',{name:/테스트 정기 납부/}).click();
  await dialog.getByText('2026-02-28 · 매월 · 함께',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'완료했어요',exact:true}).click();
  await dialog.getByLabel('메시지',{exact:true}).fill('납부했어요');
  await dialog.getByRole('button',{name:'보내기',exact:true}).click();
  await dialog.locator('.chat-bubble').filter({hasText:'납부했어요'}).waitFor();
  await dialog.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByLabel('조회 월').fill('2026-03');
  await page.getByRole('button',{name:/테스트 정기 납부/}).click();
  assert.equal(await dialog.getByRole('button',{name:'완료했어요',exact:true}).getAttribute('aria-pressed'),'false');
  assert.equal(await dialog.locator('.chat-bubble').filter({hasText:'납부했어요'}).count(),0);
  assert.equal(await dialog.getByRole('button',{name:'이전 대화 보기'}).count(),0);
  // Editing: records exist on this entry, so date/repeat are locked while the title still changes.
  await dialog.getByRole('button',{name:'✎ 수정',exact:true}).click();
  await dialog.getByText('날짜와 반복은 바꿀 수 없어요',{exact:false}).waitFor();
  assert.equal(await dialog.getByLabel('날짜',{exact:true}).getAttribute('readonly'),'');
  await dialog.getByLabel('제목',{exact:true}).fill('테스트 정기 납부 (수정)');
  await dialog.getByRole('button',{name:'저장하기',exact:true}).click();
  await page.getByRole('button',{name:/테스트 정기 납부 \(수정\)/}).click();
  await dialog.getByText('2026-03-31 · 매월 · 함께',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('button',{name:'일정·할 일 추가',exact:true}).click();
  await dialog.getByLabel('제목',{exact:true}).fill('수정 가능한 약속');
  await dialog.getByLabel('날짜',{exact:true}).fill('2026-03-20');
  await dialog.getByRole('button',{name:'저장하기',exact:true}).click();
  await page.getByRole('button',{name:/수정 가능한 약속/}).click();
  await dialog.getByRole('button',{name:'✎ 수정',exact:true}).click();
  assert.equal(await dialog.getByLabel('날짜',{exact:true}).getAttribute('readonly'),null);
  await dialog.getByLabel('날짜',{exact:true}).fill('2026-03-21');
  await dialog.getByRole('button',{name:'저장하기',exact:true}).click();
  await page.getByRole('button',{name:/수정 가능한 약속/}).click();
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
  await dialog.getByLabel('사용처·내용').fill('실적 테스트');
  await dialog.getByLabel('금액 (원)',{exact:true}).fill('310000');
  await dialog.getByLabel('날짜',{exact:true}).fill('2026-03-10');
  await dialog.locator('select[name=card_id]').selectOption('c1');
  await dialog.getByRole('button',{name:'저장하기'}).click();
  await page.getByText('190,000원 남았어요',{exact:true}).waitFor();
  await page.getByRole('button',{name:'실적 테스트 수정'}).click();
  await dialog.locator('select[name=qualifying_mode]').selectOption('exclude');
  await dialog.getByRole('button',{name:'저장하기'}).click();
  await page.getByText('300,000원 남았어요',{exact:true}).waitFor();
  await page.getByRole('button',{name:'실적 테스트 수정'}).click();
  await dialog.locator('select[name=qualifying_mode]').selectOption('manual');
  await dialog.getByLabel('인정 실적 (원)',{exact:true}).fill('300000');
  await dialog.getByRole('button',{name:'저장하기'}).click();
  await page.getByText('200,000원 남았어요',{exact:true}).waitFor();
  await page.screenshot({path:'/tmp/haraguri-finance-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'지출 기록',exact:true}).click();
  await dialog.locator('select[name=payment_method]').selectOption('bank_transfer');
  await dialog.getByLabel('사용처·내용').fill('월세 이체');
  await dialog.getByLabel('금액 (원)',{exact:true}).fill('500000');
  await dialog.getByLabel('날짜',{exact:true}).fill('2026-03-11');
  await dialog.getByRole('button',{name:'저장하기'}).click();
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
  await page.getByRole('group',{name:'결제 수단 필터'}).getByRole('button',{name:'체크카드',exact:true}).click();
  await page.getByText('실적 테스트',{exact:true}).waitFor();
  assert.equal(await page.getByText('월세 이체',{exact:true}).count(),0);
  // Pasting a card approval SMS fills merchant, amount, date and picks the only card.
  await page.getByRole('button',{name:'지출 기록',exact:true}).click();
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
  await page.getByText('확인을 기다려요',{exact:false}).waitFor(); // pending strip + inline confirm on the unreviewed row
  await page.getByRole('button',{name:'편의점 CU 확인'}).waitFor();
  // Ledger views: report numbers, recurring add, review queue confirm.
  await page.getByRole('group',{name:'가계부 보기'}).getByRole('button',{name:'리포트'}).click();
  await page.getByText(`${smsMonth} 총지출`,{exact:true}).waitFor();
  await page.getByRole('heading',{name:'자주 쓴 곳 TOP 5'}).waitFor();
  await page.getByRole('group',{name:'가계부 보기'}).getByRole('button',{name:'반복 지출'}).click();
  await page.getByText('아파트 관리비',{exact:true}).waitFor();
  await page.getByRole('button',{name:'＋ 반복 지출'}).click();
  await dialog.getByLabel('이름',{exact:true}).fill('넷플릭스');
  await dialog.getByLabel('금액 (원)',{exact:true}).fill('17000');
  await dialog.locator('select[name=payment_method]').selectOption('cash');
  await dialog.getByRole('button',{name:'저장하기'}).click();
  await page.getByText('넷플릭스',{exact:true}).waitFor();
  await page.getByRole('group',{name:'가계부 보기'}).getByRole('button',{name:/확인 대기/}).click();
  await page.getByText('편의점 CU',{exact:true}).waitFor();
  await page.getByRole('button',{name:'확인',exact:true}).click();
  await page.getByText('확인할 자동 등록 건이 없어요',{exact:false}).waitFor();
  await page.getByRole('group',{name:'가계부 보기'}).getByRole('button',{name:'내역'}).click();
  await page.getByLabel('가계부 조회 월').fill('2026-03');
  await page.getByRole('button',{name:'다음 달',exact:true}).click(); // one tap per month instead of opening the picker
  assert.equal(await page.getByLabel('가계부 조회 월').inputValue(),'2026-04');
  await page.getByRole('button',{name:'이전 달',exact:true}).click();
  assert.equal(await page.getByLabel('가계부 조회 월').inputValue(),'2026-03');


  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'대화',exact:true}).click();
  await page.getByLabel('메시지',{exact:true}).fill('가족 기본방 테스트');
  await page.getByRole('button',{name:'보내기',exact:true}).click();
  await page.locator('.chat-bubble').filter({hasText:'가족 기본방 테스트'}).waitFor();
  // Own messages can be edited and deleted.
  const mine = page.locator('.chat-line.mine').filter({hasText:'가족 기본방 테스트'});
  await mine.getByRole('button',{name:'수정',exact:true}).click();
  await page.getByLabel('메시지 수정').fill('가족 기본방 테스트 (수정)');
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await page.locator('.chat-line.mine').filter({hasText:'가족 기본방 테스트 (수정)'}).filter({hasText:'수정됨'}).waitFor();
  await page.locator('.chat-line.mine').filter({hasText:'(수정)'}).getByRole('button',{name:'삭제',exact:true}).click();
  await page.waitForFunction(()=>![...document.querySelectorAll('.chat-bubble')].some(b=>b.textContent?.includes('가족 기본방 테스트 (수정)')));
  await page.getByLabel('메시지',{exact:true}).fill('가족 기본방 테스트');
  await page.getByRole('button',{name:'보내기',exact:true}).click();
  await page.locator('.chat-bubble').filter({hasText:'가족 기본방 테스트'}).waitFor();
  await page.getByRole('group',{name:'대화 종류'}).getByRole('button',{name:'일정·구매별 대화'}).click();
  await page.getByRole('button',{name:/아이 자전거 같이 고르기/}).click();
  assert.equal(await dialog.locator('.chat-bubble').filter({hasText:'가족 기본방 테스트'}).count(),0);
  await dialog.getByLabel('메시지',{exact:true}).fill('이 모델로 살까요?');
  await dialog.getByRole('button',{name:'보내기',exact:true}).click();
  await dialog.locator('.chat-bubble').filter({hasText:'이 모델로 살까요?'}).waitFor();
  await dialog.getByLabel('구매 진행',{exact:true}).selectOption('decided');
  await dialog.getByLabel('기존 지출 연결',{exact:true}).selectOption({label:'2026-03-11 · 월세 이체 · 500,000원'});
  await dialog.getByText('월세 이체',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'가족 기본 채팅에 공유'}).click();
  await page.getByRole('button',{name:/아이 자전거 같이 고르기.*우리집 일 열기/}).click();
  await dialog.locator('.chat-bubble').filter({hasText:'이 모델로 살까요?'}).waitFor();
  assert.equal(await dialog.getByLabel('구매 진행',{exact:true}).inputValue(),'decided');
  await dialog.getByRole('button',{name:'대화 바로가기 ↓'}).click();
  await page.screenshot({path:'/tmp/haraguri-work-mobile.png',fullPage:true});
  // Finishing the purchase suggests closing; closing hides the composer, reopening restores it.
  assert.equal(await dialog.locator('.finish-banner').count(),0);
  await dialog.getByLabel('구매 진행',{exact:true}).selectOption('purchased');
  await dialog.locator('.finish-banner').getByRole('button',{name:'대화 종료',exact:true}).click();
  await dialog.getByText('종료된 대화예요.',{exact:false}).first().waitFor();
  assert.equal(await dialog.getByLabel('메시지',{exact:true}).count(),0);
  await dialog.locator('.chat-bubble').filter({hasText:'이 모델로 살까요?'}).waitFor();
  await dialog.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('group',{name:'대화 종류'}).getByRole('button',{name:'일정·구매별 대화'}).click();
  await page.getByRole('group',{name:'진행 상태'}).getByRole('button',{name:/종료됨 1/}).click();
  await page.getByRole('button',{name:/종료됨.*아이 자전거 같이 고르기/}).click();
  await dialog.getByRole('button',{name:'다시 열기',exact:true}).click();
  await dialog.getByLabel('메시지',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('group',{name:'진행 상태'}).getByRole('button',{name:/진행 중/}).click();
  // Settings: rename yourself (prompt → '테스트 이름').
  await page.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'가족 설정'}).click();
  await page.locator('.member-row').filter({hasText:'(나)'}).getByRole('button',{name:'이름 바꾸기'}).click();
  await page.locator('.member-row').filter({hasText:'테스트 이름 (나)'}).waitFor();
  // Owner-side invite tools: nickname/email target form and the link/code section both render.
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
