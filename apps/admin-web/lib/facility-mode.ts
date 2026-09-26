// 관리자 앱은 사업장 하나가 두 제품 중 하나다.
//   - medical: 병원·의원·약국 — 인력 모집·지원자·직원·근태·휴가·급여·요금제
//   - gig:     긱워커 근무지(무료 베타) — 초대·오늘 근태·워크룸·인증센터만
// 어느 모드인지는 이 파일 하나가 정한다. 화면·액션에서 facility_type 이나 registration_source 를 직접 비교하지 않는다.
// (예전에는 어떤 곳은 facility_type='gigworker' 를, 어떤 곳은 registration_source='gigworker_trial' 을 봐서 기준이 둘이었다.)

export type FacilityMode = 'medical' | 'gig';

export const GIGWORKER_FACILITY_TYPE = 'gigworker';
export const GIGWORKER_REGISTRATION_SOURCE = 'gigworker_trial';

type FacilityLike = {
  facility_type?: string | null;
  registration_source?: string | null;
  facilityType?: string | null;
  registrationSource?: string | null;
};

export function isGigworkerFacility(facility: FacilityLike | null | undefined) {
  if (!facility) return false;
  const type = facility.facility_type ?? facility.facilityType ?? null;
  const source = facility.registration_source ?? facility.registrationSource ?? null;
  return type === GIGWORKER_FACILITY_TYPE || source === GIGWORKER_REGISTRATION_SOURCE;
}

export function facilityModeOf(facility: FacilityLike | null | undefined): FacilityMode {
  return isGigworkerFacility(facility) ? 'gig' : 'medical';
}

// 긱워커 근무지에서는 없는 기능. 주소로 직접 들어와도 홈으로 돌려보낸다.
// (공고 등록은 lib/actions/shifts.ts 가 서버에서도 한 번 더 막는다.)
const MEDICAL_ONLY_PREFIXES = ['/shifts', '/applications', '/chats', '/leave', '/payroll', '/workforce', '/operations'];

export function isMedicalOnlyPath(path: string) {
  return MEDICAL_ONLY_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

// 사업장 종류별 아이콘·이름표. 전환기·목록·홈 헤더가 같은 표를 쓴다.
export function facilityKindBadge(facility: FacilityLike | null | undefined) {
  if (isGigworkerFacility(facility)) return { icon: '📍', label: '긱워커 근태' };
  const type = facility?.facility_type ?? facility?.facilityType ?? null;
  if (type === 'pharmacy') return { icon: '💊', label: '약국' };
  if (type === 'care_hospital') return { icon: '🏥', label: '요양병원' };
  return { icon: '🏥', label: '병원·의원' };
}

// 워커 앱에서 이 사업장의 근무자가 쓰는 셸 경로. 초대 링크·동적 QR 이 여기로 열린다.
export function workerShellPaths(mode: FacilityMode) {
  return mode === 'gig'
    ? { join: '/gig/join', attendance: '/gig' as const }
    : { join: '/workplace/join', attendance: '/workplace' as const };
}
