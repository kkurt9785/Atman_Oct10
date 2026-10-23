import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ fail: false, filters: [] as number[] }));
vi.mock('../../../admin-web/lib/facility', () => ({ getCurrentFacilityId: async () => 'facility' }));
vi.mock('../../../admin-web/lib/date', () => ({ todayKST: () => '2026-10-23' }));
vi.mock('../../../admin-web/lib/supabase', () => ({ adminClient: () => ({ from(table: string) {
  let cursor = ''; let limit = 1000; let ids: string[] | null = null;
  const q: any = {
    select: () => q, eq: () => q, neq: () => q, gte: () => q, lte: () => q, order: () => q,
    gt: (_: string, value: string) => { cursor = value; return q; },
    limit: (value: number) => { limit = value; return q; },
    in: (column: string, values: string[]) => { if (column === 'shift_id' || column === 'worker_id') { ids = values; state.filters.push(values.length); } return q; },
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      const rows = Array.from({ length: 1200 }, (_, i) => ({ id: String(i).padStart(6, '0'), worker_id: String(i).padStart(6, '0'), shift_id: String(i).padStart(6, '0'), estimated_total_pay: 100, status: 'open', shifts: { shift_date: i === 1199 ? '2025-01-01' : '2026-10-01' }, period_month: '2026-10-01' }));
      return Promise.resolve({ data: rows.filter(r => r.id > cursor && (!ids || ids.includes(r.id))).slice(0, limit), count: ids?.length ?? 0, error: state.fail && table === 'wage_payment_instructions' && cursor ? { message: 'second page failed' } : null }).then(resolve, reject);
    },
  };
  return q;
} }) }));
import { getOperationsSummary } from '../../../admin-web/lib/db/operations';
beforeEach(() => { state.fail = false; state.filters = []; });
describe('operations summary complete reads', () => {
  it('counts all rows and finds the oldest month on the last page', async () => {
    const result = await getOperationsSummary();
    expect(result).toMatchObject({ monthEstimatedCost: 120000, openShiftCount: 1200, pendingWageCount: 2400, pendingWageMonth: '2025-01', pendingWageTab: 'shift', urgentUnfilledCount: 0, expiringCredentialCount: 1200 });
    expect(Math.max(...state.filters)).toBeLessThanOrEqual(100);
  });
  it('does not show partial totals when a later page fails', async () => {
    state.fail = true;
    await expect(getOperationsSummary()).rejects.toThrow('전체 운영 데이터');
  });
});
