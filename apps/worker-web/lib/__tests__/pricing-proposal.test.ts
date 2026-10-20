import { describe, expect, it } from 'vitest';
import { estimateTemporary } from '../../../admin-web/lib/pricing-proposal';
describe('temporary pricing proposal only', () => {
  it('includes both dates', () => {
    expect(estimateTemporary(10, '2026-10-19', '2026-10-19')).toEqual({ days: 1, quote: { net: 9900, vat: 990, total: 10890 } });
    expect(estimateTemporary(10, '2026-10-19', '2026-10-21')?.quote?.net).toBe(29700);
  });
  it('caps up to seven days at the weekly proposal', () => {
    for (const end of ['2026-10-22', '2026-10-25']) expect(estimateTemporary(10, '2026-10-19', end)?.quote).toEqual({ net: 39000, vat: 3900, total: 42900 });
  });
  it('does not invent larger or longer prices', () => {
    for (const people of [30, 50, 51]) expect(estimateTemporary(people, '2026-10-19', '2026-10-19')?.quote).toBeNull();
    expect(estimateTemporary(10, '2026-10-19', '2026-10-26')).toEqual({ days: 8, quote: null });
  });
  it('rejects missing, reversed and impossible dates', () => {
    for (const [start, end] of [['', ''], ['2026-10-21', '2026-10-19'], ['2026-02-30', '2026-03-03'], ['bad', '2026-10-19']]) expect(estimateTemporary(10, start, end)).toBeNull();
  });
  it('handles year boundaries and leap days', () => {
    expect(estimateTemporary(10, '2026-12-31', '2027-01-02')?.days).toBe(3);
    expect(estimateTemporary(10, '2028-02-28', '2028-03-01')?.days).toBe(3);
  });
});
