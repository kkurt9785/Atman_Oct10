// Turns OCR text of a card/bank app "이용내역" screenshot into candidate transactions. Pure: unit-tested, shared by on-device OCR and the AI fallback.
export type OcrRow = { date: string; merchant: string; amount: number; cancel: boolean; raw: string };

const SKIP = /잔액|누적|합계|총\s*(?:이용|사용|결제)|이용한도|결제예정|예정금액|포인트|적립|할인액|청구|이자|연회비|한도|가용/;
const CANCEL = /취소|환불|승인\s*취소/;
const LABELS = /승인\s*번호\s*\d*|\b\d{6,}\b|승인취소|승인|일시불|할부|\d+\s*개월|체크|신용|국내|해외|거래|결제|완료|이용|사용|매출|정상|카드|원\b/g;
const FULL_DATE = /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?/;
const SHORT_DATE = /(?<![\d:])(\d{1,2})\s*[./]\s*(\d{1,2})(?![\d:.])/;
const KOREAN_DATE = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/;
const TIME = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
const AMOUNT = /(-|−|–)?\s*(\d{1,3}(?:,\d{3})+|\d{4,9})\s*(원|won)?/gi;

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Digits that OCR likes to misread inside numbers: letters inside a money token ("l56,8OO원") and dots used as thousands separators.
const DIGIT_FIX: Record<string, string> = { O: '0', o: '0', D: '0', l: '1', I: '1', '|': '1' };
export function fixDigits(s: string) {
  return s
    .replace(/[\dOoDlI|,.]{3,}(?=\s*(?:원|won))/gi, t => t.replace(/[OoDlI|]/g, c => DIGIT_FIX[c] ?? c))
    .replace(/(?<=[\d,])[OoDlI|](?=[\d,])/g, c => DIGIT_FIX[c] ?? c)
    .replace(/(?<=\d)\.(?=\d{3}\b)/g, ',');
}

export function findDate(line: string, now: Date): string | null {
  const full = line.match(FULL_DATE);
  if (full) { const [, y, m, d] = full; const mo = Number(m), da = Number(d); if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) return `${y}-${pad(mo)}-${pad(da)}`; }
  const short = line.match(SHORT_DATE) ?? line.match(KOREAN_DATE);
  if (short) {
    const mo = Number(short[1]), da = Number(short[2]);
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    let year = now.getFullYear();
    if (mo > now.getMonth() + 1 || (mo === now.getMonth() + 1 && da > now.getDate())) year -= 1; // a future date must be last year's
    return `${year}-${pad(mo)}-${pad(da)}`;
  }
  return null;
}

// The rightmost money-looking token is the amount column; approval numbers (long, no commas) are not money.
function findAmount(line: string): { value: number; negative: boolean; token: string } | null {
  const cleaned = line.replace(TIME, ' ').replace(FULL_DATE, ' ').replace(SHORT_DATE, ' ').replace(KOREAN_DATE, ' ');
  let best: { value: number; negative: boolean; token: string } | null = null;
  for (const m of cleaned.matchAll(AMOUNT)) {
    const digits = m[2].replace(/,/g, '');
    if (!m[2].includes(',') && !m[3]) continue; // apps print thousands separators; a bare number is an approval/phone/date number
    const value = Number(digits);
    if (!Number.isFinite(value) || value < 100 || value > 100000000) continue;
    best = { value, negative: !!m[1], token: m[0] };
  }
  return best;
}

export function parseOcrText(text: string, now = new Date()): OcrRow[] {
  const lines = text.split(/\r?\n/).map(l => fixDigits(l.replace(/\s+/g, ' ').trim())).filter(Boolean);
  const rows: (OcrRow & { dated: boolean })[] = [];
  let currentDate: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const date = findDate(line, now);
    const amount = findAmount(line);
    if (date && !amount) {
      // "10.27 11:21 일시불" under a row describes that row; a bare "10.27 (월)" is a section header for the rows below.
      const detail = TIME.test(line) || /일시불|할부|개월|승인/.test(line); TIME.lastIndex = 0;
      const prev = rows.at(-1);
      if (detail && prev && !prev.dated) { prev.date = date; prev.dated = true; } else currentDate = date;
      continue;
    }
    if (!amount) continue;
    if (SKIP.test(line)) continue;
    const cancel = CANCEL.test(line) || amount.negative;
    let merchant = line.replace(amount.token, ' ').replace(FULL_DATE, ' ').replace(SHORT_DATE, ' ').replace(KOREAN_DATE, ' ').replace(TIME, ' ').replace(LABELS, ' ').replace(/[()[\]{}|·•*_\-–—:,.]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (merchant.length < 2) {
      // Merchant printed on its own line above (or below) the amount line.
      for (const j of [i - 1, i - 2, i + 1]) {
        const cand = lines[j]; if (!cand || findAmount(cand) || SKIP.test(cand)) continue;
        const text2 = cand.replace(FULL_DATE, ' ').replace(SHORT_DATE, ' ').replace(KOREAN_DATE, ' ').replace(TIME, ' ').replace(LABELS, ' ').replace(/[()[\]{}|·•*_\-–—:,.]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (text2.length >= 2) { merchant = text2; break; }
      }
    }
    const rowDate = date ?? currentDate;
    rows.push({ date: rowDate ?? ymd(now), dated: !!date, merchant: merchant || '(가맹점 미확인)', amount: cancel ? -amount.value : amount.value, cancel, raw: line });
  }
  // The same transaction can appear twice when a screenshot overlaps the previous one.
  const seen = new Set<string>();
  return rows.filter(r => { const k = `${r.date}|${r.amount}|${r.merchant}`; if (seen.has(k)) return false; seen.add(k); return true; }).map(({ dated: _d, ...r }) => r);
}
