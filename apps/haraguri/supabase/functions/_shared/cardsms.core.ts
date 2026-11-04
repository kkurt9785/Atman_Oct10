// Pure parser for Korean card/bank payment messages. No imports: the same file is copied to
// supabase/functions/_shared/cardsms.core.ts for the ingest function (a test asserts both copies are identical).
export const CATEGORY_LABELS = ['식비','카페','생활','교육','교통','의료','여행','쇼핑','통신','보험','관리비','세금','상품권','기타'];
export type Channel = 'credit' | 'debit' | 'bank_transfer' | 'unknown';
export type ParsedCardMessage = {
  amount: number; date: string; time?: string; merchant: string; issuer?: string; last4?: string;
  cancel: boolean; installment?: string; category: string; channel: Channel; incoming: boolean;
};

const ISSUERS: [RegExp, string][] = [
  [/KB\s*국민|국민|KB\s*Pay|KBPay/i, '국민'], [/신한|SOL\s*페이|쏠페이/i, '신한'], [/삼성/, '삼성'], [/현대/, '현대'], [/롯데/, '롯데'], [/우리/, '우리'], [/하나/, '하나'],
  [/MG\s*체크|새마을금고/i, '새마을'], [/NH\s*농협|농협/, '농협'], [/\bBC\b|비씨/, 'BC'], [/씨티|시티/, '씨티'], [/IBK\s*기업|기업/, '기업'], [/카카오뱅크/, '카카오뱅크'], [/토스뱅크/, '토스뱅크'], [/케이뱅크/, '케이뱅크'],
  [/카카오페이/, '카카오페이'], [/토스/, '토스'], [/네이버페이/, '네이버페이'], [/페이코/, '페이코'], [/새마을/, '새마을'], [/수협/, '수협'],
];
const CATEGORY_RULES: [RegExp, string][] = [
  // 카페 is split out of 식비 (2026-11-04): coffee is the family's most frequent small spend and was invisible inside 식비.
  [/카페|커피|coffee|cafe|스타벅스|투썸|빽다방|바나프레소|메가커피|컴포즈|이디야|할리스|폴바셋|텐퍼센트|파스쿠찌|공차|던킨|배스킨|설빙|베이커리|빵|파리바게뜨|뚜레쥬르|와플|디저트|케이크|도넛|마카롱|빙수/i, '카페'],
  [/마트|식자재|편의점|GS25|CU|세븐일레븐|이마트|홈플러스|코스트코|쿠팡이츠|배달|배민|요기요|식당|음식점|치킨|피자|맥도날드|버거킹|롯데리아|맘스터치|서브웨이|교촌|BBQ|BHC|도미노|푸라닭|김밥|분식|국밥|냉면|초밥|스시|족발|보쌈|횟집|정육|과일|반찬|추어정|추어탕|고기|삼겹|갈비|한식|중식|일식|포차|술집|호프|맥주|소주/i, '식비'],
  [/약국|병원|의원|치과|한의원|소아과|청소년과|내과|외과|피부과|안과|이비인후과|정형외과|산부인과|가정의학과|보건소|메디|클리닉/, '의료'],
  [/주유|주유소|석유|오일뱅크|SK에너지|GS칼텍스|S-?OIL|충전소|택시|버스|지하철|코레일|SRT|주차|파킹|parking|톨게이트|하이패스|카카오T|쏘카|그린카/i, '교통'],
  [/다이소|세탁|빨래|미용|헤어|이발|목욕|사우나|찜질|꽃집|철물|세차|생활용품|무인양품|이케아|IKEA|한샘/i, '생활'],
  [/쿠팡|네이버|11번가|지마켓|G마켓|옥션|SSG|무신사|올리브영|알리|테무|아마존|amazon|백화점|아울렛/i, '쇼핑'],
  [/SKT|SK텔레콤|KT\b|LG\s*U|유플러스|통신|알뜰폰/i, '통신'],
  [/학원|교육|문구|서점|교보|예스24|알라딘|학습지|어린이집|유치원/i, '교육'],
  [/보험/, '보험'], [/관리비|아파트|도시가스|한전|전기요금|수도/, '관리비'], [/세금|국세|지방세|위택스|홈택스/, '세금'],
  [/호텔|항공|대한항공|아시아나|제주항공|진에어|여행|펜션|리조트|에어비앤비|야놀자|여기어때/i, '여행'],
  [/상품권|기프트/, '상품권'],
];

export function guessCategory(merchant: string) {
  const hit = CATEGORY_RULES.find(([re]) => re.test(merchant));
  return hit ? hit[1] : '기타';
}
const pad = (n: number) => String(n).padStart(2, '0');
const WON_AMOUNT = /(\d{1,3}(?:,\d{3})+|\d+)\s*원(?!\s*당)/;
const CURRENCY_AMOUNT = /(?:₩|KRW)\s*(\d{1,3}(?:,\d{3})+|\d+)/;
const PAYMENT_AMOUNT = `(?:${WON_AMOUNT.source}|${CURRENCY_AMOUNT.source})`;
const PAID_AMOUNT = new RegExp(`${PAYMENT_AMOUNT}\\s*(?:[이가을를]\\s*)?(?:결제|승인(?:취소)?|출금|입금|이체|송금)(?=\\s*(?:[.!。\\n]|$|(?:가|이)?\\s*(?:완료|취소|되었|됐|하였|했)|\\d{1,2}[/:.]|\\())`, 'i');
const TRANSFER_AMOUNT = new RegExp(`(?:출금|입금|이체|송금|승인취소)\\s*[:：]?\\s*${PAYMENT_AMOUNT}`, 'i');
const COMPLETED_AMOUNT = new RegExp(`(?:결제|구매|사용|출금|입금|이체|송금)(?:가|이)?\\s*완료\\s*[:：]?\\s*${PAYMENT_AMOUNT}`, 'i');

// Channel rules agreed with the family: 계좌이체·출금 → 계좌, '잔액' → 체크카드, '누적' → 신용카드.
export function detectChannel(text: string): Channel {
  if (/체크카드|체크\s*승인|체크\s*[,)]/.test(text)) return 'debit';
  if (/신용카드|할부|\d{1,2}개월/.test(text)) return 'credit';
  if (/누적/.test(text)) return 'credit';
  if (/잔액/.test(text) && !/카드/.test(text) && /이체|출금|송금|자동이체|계좌/.test(text)) return 'bank_transfer';
  if (/잔액/.test(text)) return 'debit';
  if (/이체|송금|출금|자동이체|계좌/.test(text) && !/카드/.test(text)) return 'bank_transfer';
  if (/카드/.test(text)) return 'credit';
  return 'unknown';
}

// Benefit messages quote amounts and even "승인" (e.g. a merger approval).
// Keep genuine payments with reward footnotes, but never turn a reward notice into an expense.
export function nonTransactionReason(raw: string): string | null {
  raw = raw.normalize('NFKC'); // NFKC also folds full-width letters (Ａｍａｚｏｎ) and ㈜ so later rules see plain text
  // Anything a sender labels as an advertisement (토스오더 coupons, card promotions) is never a transaction, whatever amounts it quotes.
  if (/[(\[]\s*광고\s*[)\]]/.test(raw)) return '광고 안내';
  const benefit = /마일리지|포인트|적립률|적립\s*기준|적립금|캐시백|혜택/.test(raw);
  const rewardOffer = /(?:퀴즈|이벤트|출석|미션|응모|정답|참여)[\s\S]*(?:받아가|받으세요|받을\s*수|드려요|드립니다|당첨|추첨|증정)/.test(raw)
    || /친구가\s*떠나기\s*전에\s*눌러보세요|출석\s*티켓이\s*충전|복권\s*응모장|럭키볼\s*뽑기|동전\s*미션[\s\S]*동전을\s*모아보세요|클릭\s*한번에\s*응모하세요|카드로\s*커피값도\s*아낄\s*수\s*있어요/.test(raw);
  const receivedReward = /[\d,]+\s*원\s*(?:받았어요|받았습니다|적립(?:됐어요|되었습니다)?(?:\s|$))/.test(raw)
    || /[\d,]+\s*원[을를]?[\s\S]*통장[\s\S]*넣어드렸어요/.test(raw);
  const priceNotice = /[\d,]+\s*원에서\s*[\d,]+\s*원으로\s*내렸어요/.test(raw);
  const serviceNotice = /날씨\s*체크\s*알림|납부\s*기한이\s*\d+일\s*남았어요/.test(raw);
  if (!benefit && !rewardOffer && !receivedReward && !serviceNotice && !priceNotice) return null;
  const text = raw.replace(/(누적|잔액|잔여|한도|가용|포인트|적립)\s*[:：]?\s*[\d,]+\s*원?/g, ' ');
  const hasAmount = WON_AMOUNT.test(text) || CURRENCY_AMOUNT.test(text);
  const cardApproval = /(?:카드|페이|Pay)\s*(?:\(?[\d*]{2,12}\)?\s*)?(?:해외\s*)?승인(?:취소)?/i.test(text);
  const markedTransaction = /\[(?:출금|입금|승인(?:취소)?|결제(?:취소)?)\]/.test(text);
  if (hasAmount && (cardApproval || markedTransaction || PAID_AMOUNT.test(text) || TRANSFER_AMOUNT.test(text) || COMPLETED_AMOUNT.test(text))) return null;
  return benefit ? '마일리지·포인트 혜택 안내' : rewardOffer ? '이벤트·리워드 안내' : receivedReward ? '입금·리워드 안내' : priceNotice ? '가격 인하 안내' : '생활·납부 예정 안내';
}

export function parseCardMessage(raw: string, now = new Date()): ParsedCardMessage | null {
  const text = raw.normalize('NFKC').replace(/\r/g, '').replace(/\[?\s*Web발신\s*\]?/gi, ' ').trim();
  if (!text || nonTransactionReason(text)) return null;
  // A [입금] marker counts wherever it sits: WON bank pushes lead with "입출금알림", whose 출금 must not override it.
  const incoming = /\[입금\]/.test(text) || (/입금/.test(text) && !/출금|승인|결제/.test(text));
  // Running totals and balances are not the transaction amount.
  const cleaned = text.split('\n').filter(line => !nonTransactionReason(line)).join('\n').replace(/(누적|잔액|잔여|한도|가용|포인트|적립)\s*[:：]?\s*[\d,]+\s*원?/g, ' ');
  const amountMatch = cleaned.match(WON_AMOUNT) ?? cleaned.match(CURRENCY_AMOUNT); // Per-won reward rates are not transaction amounts.
  if (!amountMatch) return null;
  const amount = Number(amountMatch[1].replace(/,/g, ''));
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  const cancel = /취소/.test(cleaned);

  let date: string | null = null;
  const full = cleaned.match(/(20\d{2})[.\-/]\s?(\d{1,2})[.\-/]\s?(\d{1,2})/);
  const short = cleaned.match(/(?:^|[^\d:])(\d{1,2})[/.](\d{1,2})(?=\s|\(|일|$|[^\d/.:])/);
  const korean = cleaned.match(/(\d{1,2})월\s*(\d{1,2})일/);
  const pick = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31) ? `${y}-${pad(m)}-${pad(d)}` : null;
  if (full) date = pick(Number(full[1]), Number(full[2]), Number(full[3]));
  else {
    const m = short ? Number(short[1]) : korean ? Number(korean[1]) : null;
    const d = short ? Number(short[2]) : korean ? Number(korean[2]) : null;
    if (m && d) {
      let year = now.getFullYear();
      if (m > now.getMonth() + 1 || (m === now.getMonth() + 1 && d > now.getDate())) year -= 1; // last December's message pasted in January
      date = pick(year, m, d);
    }
  }
  if (!date) date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeMatch = cleaned.match(/(\d{1,2}):(\d{2})/);
  const time = timeMatch ? `${pad(Number(timeMatch[1]))}:${timeMatch[2]}` : undefined;
  // An explicit NH card header outranks a merchant such as 현대해상.
  const issuer = /^\[(?:출금|입금)\]/.test(cleaned) ? undefined : /^MG\s*체크/i.test(cleaned) ? '새마을' : /^\[?NH\s*(?:농협)?\s*카드/i.test(cleaned) ? '농협' : ISSUERS.find(([re]) => re.test(cleaned))?.[1];
  const last4 = cleaned.match(/\((\d{4})\)|(\d{4})\s*(?:승인|사용|결제|취소)|끝\s*(\d{4})|\*+(\d{4})/)?.slice(1).find(Boolean);
  const installment = cleaned.match(/일시불|\d{1,2}개월/)?.[0];
  const channel = detectChannel(text);

  // Whatever is left after removing the known tokens is the merchant; the last surviving fragment wins.
  const stripped = cleaned
    .replace(amountMatch[0], ' ').replace(/(?:₩|KRW)\s*[\d,]+/g, ' ')
    .replace(/(20\d{2})[.\-/]\s?\d{1,2}[.\-/]\s?\d{1,2}/g, ' ').replace(/(?:^|[^\d:])\d{1,2}[/.]\d{1,2}(?=\s|\(|일|$|[^\d/.:])/g, ' ').replace(/\d{1,2}월\s*\d{1,2}일/g, ' ')
    .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ')
    // Bank push messages put a masked account after the merchant. It is metadata,
    // and must not become the last surviving merchant fragment.
    .replace(/(?:계좌(?:번호)?\s*[:：]?\s*)?(?:[\d*]+-){2,}[\d*]+(?:\s*계좌(?:번호)?)?/g, ' ')
    .replace(/\(\d{4}\)|\*+\d{4}|\d{4}(?=\s*(?:승인|사용|결제|취소))|끝\s*\d{4}/g, ' ')
    .replace(/[가-힣]\*+[가-힣]*\s*님?|고객님|님/g, ' ')
    .replace(/(KB\s*국민|KB\s*Pay|KBPay|SOL\s*페이|쏠페이|NH\s*농협|IBK\s*기업|카카오뱅크|토스뱅크|카카오페이|네이버페이|케이뱅크|국민|신한|삼성|현대(?!해상)|롯데|우리|하나|농협|비씨|BC|씨티|시티|기업|토스|페이코|새마을|수협)\s*(체크|신용)?\s*(카드|은행|페이|Pay)?/gi, ' ')
    .replace(/해외승인|승인취소|결제취소|승인|취소|일시불|\d{1,2}개월|할부|체크|신용|카드|결제|완료|사용|출금|자동이체|이체|송금|입금|알림|안내|\[|\]|\(|\)|【|】/g, ' ')
    .replace(/되었습니다|됐습니다|되었어요|됐어요|하였습니다|했습니다|되었음|감사합니다|입니다|에서|으로|님의/g, ' ') // push-notification sentence endings
    .replace(/[|·•▶►>]/g, ' ');
  const fragments = stripped.split(/\n/).flatMap(line => line.split(/\s{2,}/)).map(s => s.replace(/\s+/g, ' ').trim()).filter(s => /[가-힣A-Za-z0-9]{2,}/.test(s));
  // Bank and MG notices place their merchant after the timestamp. Preserve it
  // before issuer removal (현대아울렛 and 네이버페이 are merchant names here).
  const timestampMerchant = /^(?:MG\s*새마을금고\s*)?(?:\[(?:출금|입금)\]|MG\s*체크)/i.test(cleaned)
    ? cleaned.match(/\d{1,2}:\d{2}(?::\d{2})?\s+([^\n]+)$/)?.[1]?.trim() : undefined;
  // WON bank pushes put the counterparty right after [출금] ("[출금] 카카오페이 44,000원"), before the amount and the masked account.
  // Read it there, before provider names (카카오페이·네이버페이) get stripped below as issuer words.
  const bankMerchant = cleaned.match(/\[출금\]\s*([^\d\n]{2,}?)\s*[\d,]+\s*원/)?.[1]?.trim();
  const facepayMerchant = cleaned.match(/페이스페이\s*\([^)]*\)\s*[·•]\s*([^\n]+)/)?.[1]?.trim();
  // Shinhan approvals name the merchant explicitly ("가맹점명: 롯데마트 [신한카드 1544-7000]"); without this the trailing phone number won.
  const namedMerchant = cleaned.match(/가맹점(?:명)?\s*[:：]\s*([^\[\]\n]+?)\s*(?=\[|\n|$)/)?.[1]?.trim();
  const merchant = (namedMerchant || bankMerchant || facepayMerchant || timestampMerchant || fragments[fragments.length - 1] || '').replace(/^[^가-힣A-Za-z0-9]+|[^가-힣A-Za-z0-9)]+$/g, '').replace(/\s[가이은는을를의로에]$/, '').slice(0, 60)
    || (channel === 'bank_transfer' ? '계좌이체' : '카드 결제');
  return { amount: cancel ? -amount : amount, date, time, merchant, issuer, last4, cancel, installment, category: guessCategory(merchant), channel, incoming };
}

// Stable key for de-duplicating the same message delivered twice (SMS + KakaoTalk notification, or a retry).
// Source-agnostic: the same purchase arriving as SMS, app push, KakaoTalk alert or Mac relay collides on one key.
export function fingerprintOf(parsed: ParsedCardMessage) {
  return `pay:${parsed.date}:${parsed.time ?? ''}:${parsed.amount}:${parsed.merchant.replace(/\s+/g, '').toLowerCase().slice(0, 4)}`;
}

export function describe(parsed: ParsedCardMessage) {
  const where = parsed.channel === 'bank_transfer' ? (parsed.issuer ? `${parsed.issuer}은행 이체` : '계좌이체') : parsed.issuer ? `${parsed.issuer}${parsed.channel === 'debit' ? '체크' : ''}카드${parsed.last4 ? `(${parsed.last4})` : ''}` : parsed.channel === 'debit' ? '체크카드' : '';
  return [where, `${Math.abs(parsed.amount).toLocaleString('ko-KR')}원${parsed.cancel ? ' 취소' : ''}`, parsed.date.slice(5).replace('-', '/') + (parsed.time ? ` ${parsed.time}` : ''), parsed.merchant].filter(Boolean).join(' · ');
}

// A bank withdrawal to the family's own pay wallet ("[출금] 토스 김기한 30,000원": wallet + a personal name) is money
// moved between pockets, not spending. Names are a surname plus 1–2 syllables; longer words are merchants (토스 수원아이…).
const SURNAMES = '김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구라진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용';
export function selfTransferWallet(raw: string): string | null {
  const m = raw.normalize('NFKC').match(/\[출금\]\s*(토스|카카오페이|네이버페이|페이코|카카오뱅크|토스뱅크|케이뱅크)\s*([가-힣]{2,3})\s+[\d,]+\s*원/);
  return m && SURNAMES.includes(m[2][0]) ? m[1] : null;
}

// Family-taught rules: the longest keyword contained in the merchant name wins.
export function matchRule<T extends { keyword: string; category: string; scope?: string | null }>(merchant: string, rules: T[] | null | undefined): T | null {
  const m = merchant.replace(/\s+/g, '').toLowerCase();
  let best: T | null = null;
  for (const r of rules ?? []) { const k = r.keyword.replace(/\s+/g, '').toLowerCase(); if (k && m.includes(k) && (!best || k.length > best.keyword.replace(/\s+/g, '').length)) best = r; }
  return best;
}
