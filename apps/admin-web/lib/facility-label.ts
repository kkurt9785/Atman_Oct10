export function facilityTypeLabel(facilityType?: string | null) {
  if (facilityType === 'gigworker') return '근무지';
  if (facilityType === 'pharmacy') return '약국';
  if (facilityType === 'care_hospital') return '요양병원';
  return '병원';
}
