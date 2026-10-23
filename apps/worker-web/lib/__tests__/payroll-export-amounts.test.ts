import { describe, expect, it } from 'vitest';
import { staffExportAmounts } from '../../../admin-web/lib/payroll-export';
const row = { saved: false, status: 'draft', needsProration: false, grossAmount: 3000000, netAmount: 2900000 };
describe('payroll CSV amount review status', () => {
  it('leaves unreviewed payment amounts empty, even for saved drafts', () => {
    for (const saved of [false, true]) for (const status of ['draft', 'collecting', 'config_required']) {
      expect(staffExportAmounts({ ...row, saved, status }).net).toBe('');
    }
  });
  it('labels the full monthly rate as a basis needing proration', () => {
    expect(staffExportAmounts({ ...row, needsProration: true })).toEqual({ gross: 3000000, net: '', basis: '일할계산 필요 · 기준 월급(지급액 아님)' });
  });
  it('preserves confirmed amounts including prorated and zero amounts', () => {
    for (const status of ['approved', 'exported', 'paid']) {
      expect(staffExportAmounts({ ...row, saved: true, status, needsProration: true })).toEqual({ gross: 3000000, net: 2900000, basis: '확정' });
    }
    expect(staffExportAmounts({ ...row, saved: true, status: 'approved', netAmount: 0 }).net).toBe(0);
  });
});
