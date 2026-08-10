export type ManageItem = {
  label: string;
  description: string;
  href: string;
  payrollOnly?: boolean;
};

export type ManageSection = {
  slug: 'operations' | 'billing' | 'account';
  eyebrow: string;
  title: string;
  description: string;
  icon: 'operations' | 'billing' | 'account';
  items: ManageItem[];
};

export const MANAGE_SECTIONS: ManageSection[] = [
  {
    slug: 'operations',
    eyebrow: '사업장 운영',
    title: '근무 운영',
    description: '반복 모집, 출퇴근 인증과 휴가·월 근태를 설정해요.',
    icon: 'operations',
    items: [
      { label: '반복 일정·운영 알림', description: '반복 모집과 미충원·노쇼 대응', href: '/operations' },
      { label: '함께한 근무자', description: '근무 이력이 있는 워커에게 다시 요청', href: '/workforce' },
      { label: '출퇴근 인증 설정', description: '위치·동적 QR 인증 방식과 현장 QR', href: '/attendance-qr' },
      { label: '휴가 관리', description: '직원 신청 승인과 사용 내역', href: '/leave' },
      { label: '월 근태 내역', description: '직원별 근무시간과 예외 기록', href: '/attendance-history' },
    ],
  },
  {
    slug: 'billing',
    eyebrow: '요금·결제',
    title: '요금과 지급',
    description: '이용 요금제와 근무 급여 지급 현황을 확인해요.',
    icon: 'billing',
    items: [
      { label: '급여·지급 관리', description: '근무시간과 지급·입금 확인 상태', href: '/payroll', payrollOnly: true },
      { label: '이용 요금', description: '사업장 요금제와 서비스 청구 내역', href: '/membership' },
    ],
  },
  {
    slug: 'account',
    eyebrow: '계정·지원',
    title: '사업장 설정',
    description: '사업장 정보와 관리자 권한, 서비스 설정을 관리해요.',
    icon: 'account',
    items: [
      { label: '사업장 설정', description: '사업장 정보·관리자 권한·알림 설정', href: '/settings' },
    ],
  },
];

export function visibleManageItems(section: ManageSection, canViewPayroll: boolean) {
  return section.items.filter((item) => !item.payrollOnly || canViewPayroll);
}
