import type { Card } from './model';
import { categories } from './finance';

// Korean card approval SMS/alerts share a small vocabulary; pull the fields out so a pasted or shared message fills the expense form.
export type ParsedCardMessage = {
  amount: number; date: string; time?: string; merchant: string; issuer?: string; last4?: string;
  cancel: boolean; installment?: string; category: string;
};

const ISSUERS: [RegExp, string][] = [
  [/KB\s*국민|국민/, '국민'], [/신한/, '신한'], [/삼성/, '삼성'], [/현대/, '현대'], [/롯데/, '롯데'], [/우리/, '우리'], [/하나/, '하나'],
  [/NH\s*농협|농협/, '농협'], [/\bBC\b|비씨/, 'BC'], [/씨티|시티/, '씨티'], [/IBK\s*기업|기업/, '기업'], [/카카오뱅크/, '카카오뱅크'],
  [/카카오페이/, '카카오페이'], [/토스/, '토스'], [/네이버페이/, '네이버페이'], [/페이코/, '페이코'], [/케이뱅크/, '케이뱅크'], [/새마을/, '새마을'], [/수협/, '수협'],
];
const CATEGORY_RULES: [RegExp, string][] = [
  [/마트|식자재|편의점|GS25|CU|세븐일레븐|이마트|홈플러스|코스트코|쿠팡이츠|배달|배민|요기요|식당|치킨|피자|카페|커피|스타벅스|투썸|빽다방|베이커리|빵|김밥|분식|정육|과일|반찬/i, '식비'],
  [/약국|병원|의원|치과|한의원|메디|클리닉/, '의료'],
  [/주유|충전소|택시|버스|지하철|코레일|SRT|주차|톨게이트|하이패스|카카오T|쏘카|그린카/i, '교통'],
  [/쿠팡|네이버|11번가|지마켓|G마켓|옥션|SSG|무신사|다이소|올리브영|알리|테무|백화점|아울렛/i, '쇼핑'],
  [/SKT|SK텔레콤|KT\b|LG\s*U|유플러스|통신|알뜰폰/i, '통신'],
  [/학원|교육|문구|서점|교보|예스24|알라딘|학습지|어린이집|유치원/i, '교육'],
  [/보험/, '보험'], [/관리비|아파트|도시가스|한전|전기요금|수도/, '관리비'], [/세금|국세|지방세|위택스|홈택스/, '세금'],
  [/호텔|항공|대한항공|아시아나|제주항공|진에어|여행|펜션|리조트|에어비앤비|야놀자|여기어때/i, '여행'],
  [/상품권|기프트/, '상품권'],
];

export function guessCategory(merchant: string) {
  const hit = CATEGORY_RULES.find(([re]) => re.test(merchant));
  const label = hit ? hit[1] : '기타';
  return categories.includes(label) ? label : '기타';
}

function pad(n: number) { return String(n).padStart(2, '0'); }

export function parseCardMessage(raw: string, now = new Date()): ParsedCardMessage | null {
  const text = raw.replace(/\r/g, '').replace(/\[?\s*Web발신\s*\]?/gi, ' ').trim();
  if (!text) return null;
  // Running totals and limits are not the transaction amount.
  const cleaned = text.replace(/(누적|잔액|잔여|한도|가용|포인트|적립)\s*[:：]?\s*[\d,]+\s*원?/g, ' ');
  const amountMatch = cleaned.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*원/);
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
      if (m > now.getMonth() + 1 || (m === now.getMonth() + 1 && d > now.getDate())) year -= 1; // a message from last December pasted in January
      date = pick(year, m, d);
    }
  }
  if (!date) date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeMatch = cleaned.match(/(\d{1,2}):(\d{2})/);
  const time = timeMatch ? `${pad(Number(timeMatch[1]))}:${timeMatch[2]}` : undefined;
  const issuer = ISSUERS.find(([re]) => re.test(cleaned))?.[1];
  const last4 = cleaned.match(/\((\d{4})\)|(\d{4})\s*(?:승인|사용|결제|취소)|끝\s*(\d{4})|\*+(\d{4})/)?.slice(1).find(Boolean);
  const installment = cleaned.match(/일시불|\d{1,2}개월/)?.[0];

  // Whatever is left after removing the known tokens is the merchant; the last surviving fragment wins.
  const stripped = cleaned
    .replace(amountMatch[0], ' ')
    .replace(/(20\d{2})[.\-/]\s?\d{1,2}[.\-/]\s?\d{1,2}/g, ' ').replace(/(?:^|[^\d:])\d{1,2}[/.]\d{1,2}(?=\s|\(|일|$|[^\d/.:])/g, ' ').replace(/\d{1,2}월\s*\d{1,2}일/g, ' ')
    .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ')
    .replace(/\(\d{4}\)|\*+\d{4}|\d{4}(?=\s*(?:승인|사용|결제|취소))|끝\s*\d{4}/g, ' ')
    .replace(/[가-힣]\*+[가-힣]*\s*님?|고객님|님/g, ' ')
    .replace(/(KB\s*국민|NH\s*농협|IBK\s*기업|카카오뱅크|카카오페이|네이버페이|케이뱅크|국민|신한|삼성|현대|롯데|우리|하나|농협|비씨|BC|씨티|시티|기업|토스|페이코|새마을|수협)\s*(체크)?\s*카드?/gi, ' ')
    .replace(/해외승인|승인취소|결제취소|승인|취소|일시불|\d{1,2}개월|할부|체크|신용|카드|결제|완료|사용|출금|이체|입금|알림|안내|\[|\]|\(|\)|【|】/g, ' ')
    .replace(/[|·•▶►>]/g, ' ');
  const fragments = stripped.split(/\n/).flatMap(line => line.split(/\s{2,}/)).map(s => s.replace(/\s+/g, ' ').trim()).filter(s => /[가-힣A-Za-z0-9]{2,}/.test(s));
  const merchant = (fragments.at(-1) || '').replace(/^[^가-힣A-Za-z0-9]+|[^가-힣A-Za-z0-9)]+$/g, '').slice(0, 60) || '카드 결제';
  return { amount: cancel ? -amount : amount, date, time, merchant, issuer, last4, cancel, installment, category: guessCategory(merchant) };
}

// Pick the family card the message belongs to when exactly one matches by last four digits or issuer name.
export function matchCard(parsed: ParsedCardMessage, cards: Card[]): string | null {
  const text = (c: Card) => `${c.name} ${c.holder} ${c.benefit_note ?? ''}`;
  if (parsed.last4) { const hits = cards.filter(c => text(c).includes(parsed.last4!)); if (hits.length === 1) return hits[0].id; }
  if (parsed.issuer) { const hits = cards.filter(c => text(c).includes(parsed.issuer!)); if (hits.length === 1) return hits[0].id; }
  return cards.length === 1 ? cards[0].id : null;
}

export function describe(parsed: ParsedCardMessage) {
  return [parsed.issuer && `${parsed.issuer}카드${parsed.last4 ? `(${parsed.last4})` : ''}`, `${Math.abs(parsed.amount).toLocaleString('ko-KR')}원${parsed.cancel ? ' 취소' : ''}`, parsed.date.slice(5).replace('-', '/') + (parsed.time ? ` ${parsed.time}` : ''), parsed.merchant].filter(Boolean).join(' · ');
}
