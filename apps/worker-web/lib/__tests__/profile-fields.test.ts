import { describe, expect, it } from 'vitest';
import { PROFILE_TOTAL, profileFieldsFor, profileFilledCount, profileRole, withdrawMentionsLicense } from '@/lib/profile-fields';

const WARD_ONLY = ['중환자실', '응급실', '수술실', '신생아실'];

describe('profileRole — 프로필 칸을 고를 직군', () => {
  it("초대로 간편 가입한 직원('other')은 사업장이 적은 직종을 따른다", () => {
    expect(profileRole('other', 'dental_hygienist')).toBe('dental_hygienist');
    expect(profileRole('', 'rn')).toBe('rn');
  });
  it('본인이 고른 직군이 있으면 그쪽이 먼저다', () => {
    expect(profileRole('rn', 'dental_hygienist')).toBe('rn');
  });
  it("근무자 직군에 없는 직종(코디네이터 등)·빈 값은 중립('other')", () => {
    expect(profileRole('other', 'coordinator')).toBe('other');
    expect(profileRole(null, null)).toBe('other');
    expect(profileRole('unknown')).toBe('other');
  });
});

describe('profileFieldsFor — 직군별 칩·예시·면허 표시', () => {
  it('치과위생사·기타 직군에는 병동 칩과 중환자실 예시가 없다', () => {
    for (const fields of [profileFieldsFor('dental_hygienist'), profileFieldsFor('other'), profileFieldsFor('other', 'dental_hygienist'), profileFieldsFor(null)]) {
      for (const ward of WARD_ONLY) expect(fields.departmentTags).not.toContain(ward);
      expect(fields.workplacePlaceholder).not.toContain('중환자실');
      expect(fields.departmentTitle).toBe('주요 업무');
    }
    expect(profileFieldsFor('dental_hygienist').departmentTags).toContain('예방·스케일링');
    expect(profileFieldsFor('dental_hygienist').workplacePlaceholder).toContain('치과');
  });
  it('면허가 필수(*)로 보이는 직군은 약사뿐이다', () => {
    const roles = ['rn', 'na', 'pharmacist', 'pharmacy_staff', 'care_worker', 'dental_hygienist', 'other'];
    expect(roles.filter((role) => profileFieldsFor(role).credential.required)).toEqual(['pharmacist']);
    expect(roles.filter((role) => profileFieldsFor(role).credential.title.includes('*'))).toEqual(['pharmacist']);
  });
  it('간호 직군은 지금까지와 같은 병동 칩', () => {
    expect(profileFieldsFor('rn').departmentTags).toContain('중환자실');
    expect(profileFieldsFor('na').workplacePlaceholder).toBe('예: ○○병원 중환자실');
  });
  it('약국 사무직은 이력서 — 번호 입력이 없다', () => {
    expect(profileFieldsFor('pharmacy_staff').credential).toMatchObject({ kind: 'resume', numberPlaceholder: null });
  });
});

describe("profileFilledCount — 내 정보의 '프로필 n/4'", () => {
  const filled = { experience_years: '3~5년', last_workplace: '○○치과의원', department_tags: ['진료실'] };
  it('면허가 선택인 직군은 면허 없이도 다 채울 수 있다', () => {
    expect(profileFilledCount({ role: 'dental_hygienist', ...filled })).toBe(PROFILE_TOTAL);
    expect(profileFilledCount({ role: 'other', ...filled })).toBe(PROFILE_TOTAL);
    expect(profileFilledCount({ role: 'care_worker', ...filled })).toBe(PROFILE_TOTAL);
  });
  it('약사는 면허가 있어야 4/4', () => {
    expect(profileFilledCount({ role: 'pharmacist', ...filled })).toBe(3);
    expect(profileFilledCount({ role: 'pharmacist', license_number: '12345', ...filled })).toBe(4);
  });
  it('아무것도 안 채운 직원은 면허 칸만 통과한 1', () => {
    expect(profileFilledCount({ role: 'other' })).toBe(1);
    expect(profileFilledCount({ role: 'other', department_tags: [] })).toBe(1);
  });
});

describe('withdrawMentionsLicense — 탈퇴 안내의 면허 문구', () => {
  it('면허를 올릴 일이 없고 올린 것도 없으면 뺀다', () => {
    expect(withdrawMentionsLicense({ role: 'dental_hygienist' })).toBe(false);
    expect(withdrawMentionsLicense({ role: 'other', license_number: null, license_photo_url: null })).toBe(false);
  });
  it('실제로 올린 것이 있으면 직군과 상관없이 알린다', () => {
    expect(withdrawMentionsLicense({ role: 'other', license_photo_url: 'licenses/a.jpg' })).toBe(true);
    expect(withdrawMentionsLicense({ role: 'dental_hygienist', license_number: '1' })).toBe(true);
  });
  it('면허·서류를 받는 직군과, 아직 못 읽은 경우는 알린다', () => {
    expect(withdrawMentionsLicense({ role: 'rn' })).toBe(true);
    expect(withdrawMentionsLicense({ role: 'pharmacy_staff' })).toBe(true);
    expect(withdrawMentionsLicense(null)).toBe(true);
  });
});
