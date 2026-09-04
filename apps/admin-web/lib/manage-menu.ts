export type ManageItem = {
  label: string;
  description: string;
  href: string;
  payrollOnly?: boolean;
};

export type ManageSection = {
  slug: 'operations' | 'payroll' | 'settings';
  eyebrow: string;
  title: string;
  description: string;
  icon: 'operations' | 'billing' | 'account';
  href?: string;
  payrollOnly?: boolean;
  items: ManageItem[];
};

export const MANAGE_SECTIONS: ManageSection[] = [
  {
    slug: 'operations',
    eyebrow: '사업장 운영',
    title: '인력 공백 관리',
    description: '기준 총원과 근무 기준을 잡고 부족 인원, 반복 결원, 노쇼를 관리해요.',
    icon: 'operations',
    items: [
      { label: '필요 인원·운영 알림', description: '직군·시간대별 기준 인원과 미충원·노쇼 대응', href: '/operations' },
      { label: '함께한 근무자 재요청', description: '검증된 근무 이력이 있는 워커에게 다시 요청', href: '/workforce' },
      { label: '출퇴근 인증 설정', description: '위치·동적 QR 인증 방식과 현장 QR', href: '/attendance-qr' },
      { label: '휴가 관리', description: '직원 신청 승인과 사용 내역', href: '/leave' },
      { label: '월 근태 내역', description: '직원별 근무시간과 예외 기록', href: '/attendance-history' },
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
