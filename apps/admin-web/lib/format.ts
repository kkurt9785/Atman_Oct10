// 앱 전역 공용 포맷터 — 금액·시간·날짜 표기를 한 곳에서 통일한다.
// (금액은 한국어 관례인 "12,000원" 접미 표기로 통일)

export const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`;

export const hours = (min: number) => `${Math.floor(min / 60)}시간`;

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** '2026-07-20' → '7/20 (일) 오늘' 형태. 오늘/내일/모레는 라벨을 덧붙인다. */
export function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return dateStr;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  const label = diff === 0 ? '오늘' : diff === 1 ? '내일' : diff === 2 ? '모레' : null;
  const base = `${d.getMonth() + 1}/${d.getDate()} (${DAYS[d.getDay()]})`;
  return label ? `${base} ${label}` : base;
}

/** '09:00:00' → '오전 9:00' */
export function formatTime(t: string) {
  const [h, m] = t.split(':');
  const hour = parseInt(h, 10);
  if (Number.isNaN(hour)) return t;
  return `${hour < 12 ? '오전' : '오후'} ${hour % 12 || 12}:${m}`;
}
