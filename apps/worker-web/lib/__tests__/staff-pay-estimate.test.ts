import { describe, expect, it } from 'vitest';
import { estimateStaffPay, payBasisLine, payMonthKST, workedTimeLabel, type StaffPayAttendance } from '@/lib/staff-pay-estimate';

const MONTH = '2026-11-01', END = '2026-11-30';
// 09:00~18:00, 휴게 60분 → 480분
const day = (date: string, status = 'completed', out = true): StaffPayAttendance => ({
  work_date: date, status, check_in_at: `${date}T09:00:00+09:00`, check_out_at: out ? `${date}T18:00:00+09:00` : null, break_minutes: 60,
});
const two = [day('2026-11-02'), day('2026-11-03')];

describe('estimateStaffPay — 사장님 급여 화면과 같은 식', () => {
  it('월급은 약정 금액 그대로 (근태는 참고로만 센다)', () => {
    const result = estimateStaffPay({ pay_basis: 'monthly', pay_rate: 2_800_000 }, two, MONTH, END);
    expect(result).toMatchObject({ status: 'ready', basis: 'monthly', amount: 2_800_000, days: 2, minutes: 960, pendingCount: 0, needsProration: false });
  });
  it('시급은 확정 근태 분 × 시급 ÷ 60', () => {
    expect(estimateStaffPay({ pay_basis: 'hourly', pay_rate: 12_000 }, two, MONTH, END).amount).toBe(192_000);
    // DB numeric 은 문자열로 올 수 있다
    expect(estimateStaffPay({ pay_basis: 'hourly', pay_rate: '12000' }, two, MONTH, END).amount).toBe(192_000);
  });
  it('일급은 확정 근무일 × 일급', () => {
    expect(estimateStaffPay({ pay_basis: 'daily', pay_rate: 100_000 }, two, MONTH, END).amount).toBe(200_000);
  });
  it('확정되지 않은 기록은 금액에서 빼고 건수만 알린다 — 퇴근 전 기록은 건수에도 안 넣는다', () => {
    const rows = [...two, day('2026-11-04', 'pending_review'), day('2026-11-05', 'working', false)];
    const result = estimateStaffPay({ pay_basis: 'hourly', pay_rate: 12_000 }, rows, MONTH, END);
    expect(result.amount).toBe(192_000);
    expect(result.days).toBe(2);
    expect(result.pendingCount).toBe(1);
  });
  it('이번 달 밖의 기록은 세지 않는다', () => {
    const result = estimateStaffPay({ pay_basis: 'daily', pay_rate: 100_000 }, [...two, day('2026-10-31'), day('2026-12-01', 'pending_review')], MONTH, END);
    expect(result.amount).toBe(200_000);
    expect(result.pendingCount).toBe(0);
  });
  it('급여 기준·금액이 없으면 금액을 지어내지 않는다', () => {
    expect(estimateStaffPay({ pay_basis: null, pay_rate: null }, two, MONTH, END)).toMatchObject({ status: 'config_required', amount: 0, days: 2, minutes: 960 });
    expect(estimateStaffPay({ pay_basis: 'monthly', pay_rate: 0 }, two, MONTH, END).status).toBe('config_required');
    expect(estimateStaffPay({ pay_basis: 'weekly', pay_rate: 500_000 }, two, MONTH, END).status).toBe('config_required');
  });
  it('월급인데 달 중간에 입사·퇴사하면 다시 계산될 수 있다고 알린다 (시급·일급은 일한 만큼이라 해당 없음)', () => {
    expect(estimateStaffPay({ pay_basis: 'monthly', pay_rate: 2_800_000, contract_start: '2026-11-10' }, [], MONTH, END).needsProration).toBe(true);
    expect(estimateStaffPay({ pay_basis: 'monthly', pay_rate: 2_800_000, contract_end: '2026-11-20' }, [], MONTH, END).needsProration).toBe(true);
    expect(estimateStaffPay({ pay_basis: 'monthly', pay_rate: 2_800_000, contract_start: '2026-11-01', contract_end: '2026-11-30' }, [], MONTH, END).needsProration).toBe(false);
    expect(estimateStaffPay({ pay_basis: 'monthly', pay_rate: 2_800_000, contract_start: '2026-03-02' }, [], MONTH, END).needsProration).toBe(false);
    expect(estimateStaffPay({ pay_basis: 'hourly', pay_rate: 12_000, contract_start: '2026-11-10' }, [], MONTH, END).needsProration).toBe(false);
  });
});

describe('payMonthKST — 이번 달은 한국 시간 기준', () => {
  it('UTC 로는 아직 10월 31일이어도 한국이 11월 1일이면 11월', () => {
    expect(payMonthKST(new Date('2026-10-31T15:30:00Z'))).toEqual({ month: '2026-11', periodMonth: '2026-11-01', endDate: '2026-11-30', label: '11월' });
  });
  it('달의 끝날 — 2월·12월', () => {
    expect(payMonthKST(new Date('2027-02-10T00:00:00Z')).endDate).toBe('2027-02-28');
    expect(payMonthKST(new Date('2026-12-15T00:00:00Z'))).toMatchObject({ periodMonth: '2026-12-01', endDate: '2026-12-31', label: '12월' });
  });
});

describe('표시 문구', () => {
  it('근무 분은 시간·분으로', () => {
    expect(workedTimeLabel(10_180)).toBe('169시간 40분');
    expect(workedTimeLabel(480)).toBe('8시간');
  });
  it('계산 근거를 식 그대로 보여 준다', () => {
    expect(payBasisLine(estimateStaffPay({ pay_basis: 'monthly', pay_rate: 2_800_000 }, two, MONTH, END))).toBe('월급 2,800,000원');
    expect(payBasisLine(estimateStaffPay({ pay_basis: 'hourly', pay_rate: 12_000 }, two, MONTH, END))).toBe('시급 12,000원 × 확정 근무 16시간');
    expect(payBasisLine(estimateStaffPay({ pay_basis: 'daily', pay_rate: 100_000 }, two, MONTH, END))).toBe('일급 100,000원 × 확정 근무 2일');
    expect(payBasisLine(estimateStaffPay({ pay_basis: null, pay_rate: null }, two, MONTH, END))).toBe('');
  });
});
