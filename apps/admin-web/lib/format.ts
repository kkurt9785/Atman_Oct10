// 앱 전역 공용 포맷터 — 금액·시간·날짜 표기를 한 곳에서 통일한다.
// (금액은 한국어 관례인 "12,000원" 접미 표기로 통일)

export const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`;

export const hours = (min: number) => `${Math.floor(min / 60)}시간`;

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** '2026-07-20' → '7/20 (일) 오늘' 형태. 오늘/내일/모레는 라벨을 덧붙인다.
 * 서버(UTC)에서도 KST 기준으로 계산 — 로컬 TZ 의존 시 KST 00~09시에 라벨이 하루 밀린다. */
export function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return dateStr;
  const kstNow = new Date(Date.now() + 9 * 3600000);
  const todayUtcMidnight = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate());
  const diff = Math.round((d.getTime() - todayUtcMidnight) / 86400000);
  const label = diff === 0 ? '오늘' : diff === 1 ? '내일' : diff === 2 ? '모레' : null;
  const base = `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${DAYS[d.getUTCDay()]})`;
  return label ? `${base} ${label}` : base;
}

/** '09:00:00' → '오전 9:00' */
export function formatTime(t: string) {
  const [h, m] = t.split(':');
  const hour = parseInt(h, 10);
  if (Number.isNaN(hour)) return t;
  return `${hour < 12 ? '오전' : '오후'} ${hour % 12 || 12}:${m}`;
}
