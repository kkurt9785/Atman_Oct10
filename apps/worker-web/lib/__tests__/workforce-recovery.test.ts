import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ pool: { data: [] as unknown[], error: null as unknown }, credentials: { data: [] as unknown[], error: null as unknown } }));
vi.mock('../../../admin-web/lib/facility', () => ({ getCurrentFacilityId: async () => 'facility' }));
vi.mock('../../../admin-web/lib/supabase', () => ({ adminClient: () => ({ from: (table: string) => {
  const result = table === 'facility_worker_pool' ? state.pool : state.credentials;
  const query: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
  for (const method of ['select', 'eq', 'gt', 'order', 'in']) query[method] = () => query;
  return query;
} }) }));
import { getWorkforcePool } from '../../../admin-web/lib/db/workforce';
beforeEach(() => {
  state.pool = { data: [], error: null };
  state.credentials = { data: [], error: null };
});
describe('workforce loading states', () => {
  it('throws on a failed pool read instead of presenting an empty workforce', async () => {
    state.pool.error = { message: 'offline' };
    await expect(getWorkforcePool()).rejects.toThrow('전체 근무 이력을 확인하지 못했어요');
  });
  it('keeps a successful empty workforce empty', async () => {
    await expect(getWorkforcePool()).resolves.toEqual([]);
  });
  it('preserves the worker but marks credentials unknown when the credential read fails', async () => {
    state.pool.data = [{ id: 'pool', worker_id: 'worker', status: 'active', workers: { name: '근무자', role: 'rn', deleted_at: null } }];
    state.credentials.error = { message: 'offline' };
    const [worker] = await getWorkforcePool();
    expect(worker).toMatchObject({ name: '근무자', credentialStatus: 'unknown', credentialBlocked: true, credentialExpiresAt: null });
  });
});
