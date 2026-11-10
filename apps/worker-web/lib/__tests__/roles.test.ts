import { describe, expect, it } from 'vitest';
import { LICENSED_ROLES, SHIFT_ROLE_LABEL, WORKER_ROLE_LABEL, displayRoleLabel } from '@/lib/roles';

describe('치과위생사 직군', () => {
  it('근무자·공고 직군 이름에 들어 있고, 면허 서류를 강제하는 직군은 아니다', () => {
    expect(WORKER_ROLE_LABEL.dental_hygienist).toBe('치과위생사');
    expect(SHIFT_ROLE_LABEL.dental_hygienist).toBe('치과위생사');
    expect(LICENSED_ROLES).not.toContain('dental_hygienist');
  });
});

describe('displayRoleLabel — 화면에 보이는 내 직군', () => {
  it("초대로 간편 가입한 직원('other')은 사업장이 적은 직종으로 보인다", () => {
    expect(displayRoleLabel('other', 'dental_hygienist')).toBe('치과위생사');
    expect(displayRoleLabel('other', 'coordinator')).toBe('코디네이터');
    expect(displayRoleLabel(null, 'dental_hygienist')).toBe('치과위생사');
  });
  it('본인이 고른 직군이 있으면 그대로', () => {
    expect(displayRoleLabel('rn', 'dental_hygienist')).toBe(WORKER_ROLE_LABEL.rn);
  });
  it('직종도 모르면 기타 직군, 직군 자체가 없으면 빈 글자', () => {
    expect(displayRoleLabel('other', 'other')).toBe('기타 직군');
    expect(displayRoleLabel('other', null)).toBe('기타 직군');
    expect(displayRoleLabel('other', 'unknown_role')).toBe('기타 직군');
    expect(displayRoleLabel(null, null)).toBe('');
  });
});
