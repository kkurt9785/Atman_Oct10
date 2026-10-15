import { dateKST } from '@/lib/date';

export type FacilityLike = {
  name?: string | null;
  address_text?: string | null;
} | Array<{
  name?: string | null;
  address_text?: string | null;
}> | null | undefined;

export type ShiftDisplayLike = {
  shift_date: string;
  start_time: string;
  end_time?: string;
  is_overnight?: boolean;
  facilities?: FacilityLike;
  distance_km?: number | null;
  distance_m?: number | null;
  distance_meters?: number | null;
};

export function facilityOf(shift: { facilities?: FacilityLike }) {
  return Array.isArray(shift.facilities) ? shift.facilities[0] : shift.facilities;
}

export function facilityName(shift: { facilities?: FacilityLike }) {
  return facilityOf(shift)?.name ?? '병원/클리닉';
}

export function areaLabel(shift: { facilities?: FacilityLike }) {
  const address = facilityOf(shift)?.address_text;
  if (!address) return null;
  return address.split(' ').slice(0, 2).join(' ');
}

export function dateLabel(date: string) {
  const today = dateKST();
  const tomorrow = dateKST(1);
  if (date === today) return '오늘';
  if (date === tomorrow) return '내일';
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

export function timeLabel(shift: ShiftDisplayLike) {
  const start = shift.start_time.slice(0, 5);
  const end = shift.end_time?.slice(0, 5);
  return `${start}${end ? ` – ${end}` : ''}${shift.is_overnight ? ' (익일)' : ''}`;
}

export function distanceKm(shift: ShiftDisplayLike) {
  if (typeof shift.distance_km === 'number') return shift.distance_km;
  if (typeof shift.distance_m === 'number') return shift.distance_m / 1000;
  if (typeof shift.distance_meters === 'number') return shift.distance_meters / 1000;
  return null;
}

export function mobilityLabel(shift: ShiftDisplayLike) {
  const km = distanceKm(shift);
  if (km == null || !Number.isFinite(km)) {
    // 거리를 모르면 지역 이름만 — 활동 지역 안인지 확인하지 않았으니 '활동지역 내'라고 하지 않는다
    return areaLabel(shift) ?? '';
  }

  const roundedKm = km < 10 ? km.toFixed(1) : Math.round(km).toString();
  return `직선거리 ${roundedKm}km`;
}

// 이미 시작한 근무는 지원할 수 없다 — 서버 조회가 오늘 공고를 시간과 상관없이 돌려줘서 화면에서 한 번 더 거른다
export function hasStarted(shift: { shift_date: string; start_time: string }, now = Date.now()) {
  return Date.parse(`${shift.shift_date}T${shift.start_time.slice(0, 5)}:00+09:00`) <= now;
}
