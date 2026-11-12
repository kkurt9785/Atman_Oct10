export type ManageItem = {
  label: string;
  description: string;
  href: string;
  payrollOnly?: boolean;
};

export type ManageSection = {
  slug: 'operations' | 'recruit' | 'payroll' | 'settings';
  eyebrow: string;
  title: string;
  description: string;
  icon: 'operations' | 'recruit' | 'billing' | 'account';
  href?: string;
  payrollOnly?: boolean;
  items: ManageItem[];
};

export const MANAGE_SECTIONS: ManageSection[] = [
  {
    slug: 'operations',
    eyebrow: '사업장 운영',
    title: '인력 운영',
    description: '출퇴근·연차를 관리하고, 필요 인원 기준으로 부족 인원·결원에 대응해요.',
    icon: 'operations',
    items: [
      { label: '연차 관리', description: '직원 신청 승인과 남은 연차', href: '/leave' },
      { label: '월 근태 내역', description: '직원별 근무시간과 예외 기록', href: '/attendance-history' },
      { label: '출퇴근 인증 설정', description: '위치·동적 QR 인증 방식과 현장 QR', href: '/attendance-qr' },
      { label: '필요 인원·운영 알림', description: '직군·시간대별 기준 인원과 미충원·노쇼 대응', href: '/operations' },
      { label: '함께한 근무자 재요청', description: '검증된 근무 이력이 있는 근무자에게 다시 요청', href: '/workforce' },
    ],
  },
  {
    // 하단 탭에서 '모집'을 뺐다(2026-11-12 탭 개편). 새 공고는 홈의 [+ 근무자 모집], 목록·지원자는 여기.
    slug: 'recruit',
    eyebrow: '단기 인력',
    title: '공고 모집',
    description: '빈 자리를 공고로 올리고 지원자를 확인해요.',
    icon: 'recruit',
    items: [
      { label: '새 공고 올리기', description: '날짜·시간·시급을 정해 공고를 올려요', href: '/shifts/new' },
      { label: '올린 공고', description: '공고별 지원 현황과 확정 인원', href: '/shifts' },
      { label: '지원자', description: '지원자를 확인하고 근무를 확정해요', href: '/applications' },
    ],
  },
  {
    slug: 'payroll',
    eyebrow: '직원 급여',
    title: '급여 지급',
    description: '근무시간을 확인하고 지급·입금 상태를 관리해요.',
    icon: 'billing',
    href: '/payroll',
    payrollOnly: true,
    items: [],
  },
  {
    slug: 'settings',
    eyebrow: '사업장·서비스',
    title: '사업장 설정',
    description: '사업장 정보, 운영 기준 총원, 관리자 권한과 잇닿 요금제를 설정해요.',
    icon: 'account',
    href: '/settings',
    items: [],
  },
];

export function visibleManageItems(section: ManageSection, canViewPayroll: boolean) {
  return section.items.filter((item) => !item.payrollOnly || canViewPayroll);
}

export function visibleManageSections(canViewPayroll: boolean) {
  return MANAGE_SECTIONS.filter((section) => !section.payrollOnly || canViewPayroll);
}
