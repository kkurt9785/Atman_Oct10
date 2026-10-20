import { describe, expect, it } from 'vitest';
import { estimateTemporary, temporaryNet, temporaryTier } from '../../../admin-web/lib/pricing-proposal';
describe('temporary pricing proposal only', () => {
  it('includes both dates', () => {
    expect(estimateTemporary(10, '2026-10-19', '2026-10-19')).toEqual({ days: 1, tier: 10, quote: { net: 9900, vat: 990, total: 10890 } });
    expect(estimateTemporary(10, '2026-10-19', '2026-10-21')?.quote?.net).toBe(29700);
  });
  it('maps people to the 10/30/50 tiers and nothing beyond', () => {
    for (const [people, tier] of [[1, 10], [10, 10], [11, 30], [30, 30], [31, 50], [50, 50]] as const) expect(temporaryTier(people)).toBe(tier);
    for (const people of [0, -1, 51, 120, Number.NaN]) expect(temporaryTier(people)).toBeNull();
    expect(estimateTemporary(51, '2026-10-19', '2026-10-19')).toEqual({ days: 1, tier: null, quote: null });
  });
  it('charges per day up to the weekly flat rate from day four', () => {
    expect(temporaryNet(10, 3)).toBe(29700);
    expect(temporaryNet(30, 3)).toBe(59700);
    expect(temporaryNet(50, 3)).toBe(89700);
    for (const days of [4, 5, 6, 7]) {
      expect(temporaryNet(10, days)).toBe(39000);
      expect(temporaryNet(30, days)).toBe(79000);
      expect(temporaryNet(50, days)).toBe(119000);
    }
    for (const end of ['2026-10-22', '2026-10-25']) expect(estimateTemporary(10, '2026-10-19', end)?.quote).toEqual({ net: 39000, vat: 3900, total: 42900 });
  });
  it('adds days after the first week until the two-week flat rate', () => {
    expect(temporaryNet(10, 8)).toBe(48900);
    expect(temporaryNet(10, 10)).toBe(68700);
    for (const days of [11, 12, 13, 14]) expect(temporaryNet(10, days)).toBe(69000);
    expect(temporaryNet(30, 8)).toBe(98900);
    expect(temporaryNet(30, 10)).toBe(138700);
    for (const days of [11, 14]) expect(temporaryNet(30, days)).toBe(139000);
    expect(estimateTemporary(25, '2026-10-19', '2026-11-01')).toEqual({ days: 14, tier: 30, quote: { net: 139000, vat: 13900, total: 152900 } });
  });
  it('leaves 50-person second weeks and anything past 14 days to a manual quote', () => {
    for (const days of [8, 14]) expect(temporaryNet(50, days)).toBeNull();
    expect(estimateTemporary(50, '2026-10-19', '2026-10-26')).toEqual({ days: 8, tier: 50, quote: null });
    for (const tier of [10, 30, 50] as const) expect(temporaryNet(tier, 15)).toBeNull();
    expect(estimateTemporary(10, '2026-10-19', '2026-11-02')).toEqual({ days: 15, tier: 10, quote: null });
  });
  it('never produces fractional won', () => {
    for (const tier of [10, 30, 50] as const) for (let days = 1; days <= 14; days++) {
      const net = temporaryNet(tier, days);
      if (net === null) continue;
      expect(Number.isInteger(net)).toBe(true);
      expect(Number.isInteger(Math.round(net * 0.1))).toBe(true);
      expect(net * 0.1).toBeCloseTo(Math.round(net * 0.1), 6);
    }
  });
  it('rejects missing, reversed and impossible dates', () => {
    for (const [start, end] of [['', ''], ['2026-10-21', '2026-10-19'], ['2026-02-30', '2026-03-03'], ['bad', '2026-10-19']]) expect(estimateTemporary(10, start, end)).toBeNull();
  });
  it('handles year boundaries and leap days', () => {
    expect(estimateTemporary(10, '2026-12-31', '2027-01-02')?.days).toBe(3);
    expect(estimateTemporary(10, '2028-02-28', '2028-03-01')?.days).toBe(3);
  });
});
