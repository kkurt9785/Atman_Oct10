import { describe, expect, it } from 'vitest';
import { resolveStaffBank, STAFF_BANKS } from '../../../admin-web/lib/staff-bank';

// 2026-11-12 계좌 검토 ①: 연결 직원은 근무자 앱 계좌가 기준, 사업장 입력은 확인용·선택
describe('직원 지급 계좌 결정', () => {
  const linked = { workerId: 'w1', bankName: '국민은행', accountLast4: '1024' };
  it('연결 직원은 근무자가 앱에 등록한 계좌를 쓴다(예전 사본이 남아 있어도)', () => {
    expect(resolveStaffBank(linked, { bank_name: '카카오뱅크', account_number_last4: '7766' }))
      .toEqual({ source: 'worker', bankName: '카카오뱅크', accountLast4: '7766', workerHasAccount: true });
  });
  it('근무자 앱에 계좌가 없으면 사업장이 넣은 확인용 값, 그것도 없으면 none', () => {
    expect(resolveStaffBank(linked, null)).toEqual({ source: 'facility', bankName: '국민은행', accountLast4: '1024', workerHasAccount: false });
    expect(resolveStaffBank({ workerId: 'w1', bankName: null, accountLast4: null }, null).source).toBe('none');
  });
  it('연결 안 된 직원은 근무자 계좌를 보지 않는다', () => {
    expect(resolveStaffBank({ workerId: null, bankName: '신한', accountLast4: '2048' }, { bank_name: '토스뱅크', account_number_last4: '0000' }))
      .toEqual({ source: 'facility', bankName: '신한', accountLast4: '2048', workerHasAccount: false });
  });
  it('끝 4자리가 숫자 4개가 아니면 계좌로 치지 않는다', () => {
    expect(resolveStaffBank({ workerId: null, bankName: '신한', accountLast4: '20' }, null).source).toBe('none');
    expect(resolveStaffBank(linked, { bank_name: '카카오뱅크', account_number_last4: '77' }).source).toBe('facility');
  });
  it('은행 목록은 근무자 앱과 같은 이름을 쓴다', () => {
    expect(STAFF_BANKS).toContain('KB국민');
    expect(STAFF_BANKS).toContain('카카오뱅크');
    expect(new Set(STAFF_BANKS).size).toBe(STAFF_BANKS.length);
  });
});
