export function facilityTypeLabel(facilityType?: string | null) {
  if (facilityType === 'gigworker') return '근무지';
  if (facilityType === 'pharmacy') return '약국';
  if (facilityType === 'care_hospital') return '요양병원';
  // small_hospital 은 병원과 의원(치과의원 포함)을 함께 담는다 — 의원을 '병원'이라 부르지 않는다
  if (facilityType === 'small_hospital') return '병원·의원';
  return '병원';
}
