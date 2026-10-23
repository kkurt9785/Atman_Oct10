import { describe, expect, it } from 'vitest';
import { loadScopedNoticePage, type NoticeCursor } from '../notification-pages';
import type { Notice } from '../notification-scope';
const context = { gigStaffIds: ['g'], gigFacilityIds: ['f'], hasGig: true, hasMedical: true };
const notices = (count: number, gigCount: number): Notice[] => Array.from({ length: count }, (_, i) => ({
  id: String(count - i).padStart(6, '0'), event_type: 'test', title: 'notice', body: '',
  data: i < gigCount ? { url: '/gig/settlement' } : null, created_at: '2026-10-23T00:00:00.123456+00:00', read_at: null,
}));
function fetcher(rows: Notice[], size = 50) {
  return async (cursor: NoticeCursor | null) => rows.filter(row => !cursor || row.id < cursor.id).slice(0, size);
}
describe('scoped notification pagination', () => {
  it('finds medical notices behind more than 50 gig notices', async () => {
    const result = await loadScopedNoticePage(fetcher(notices(80, 60)), context, 'medical', null);
    expect(result.rows).toHaveLength(20);
    expect(result.cursor?.createdAt).toBe('2026-10-23T00:00:00.123456+00:00');
  });
  it('shows more rather than a false empty state after the scan budget', async () => {
    const fetch = fetcher(notices(310, 300));
    const first = await loadScopedNoticePage(fetch, context, 'medical', null);
    expect(first.rows).toEqual([]);
    expect(first.hasMore).toBe(true);
    const second = await loadScopedNoticePage(fetch, context, 'medical', first.cursor);
    expect(second.rows).toHaveLength(10);
    expect(second.hasMore).toBe(false);
  });
  it('handles identical timestamps, short server pages and exhausted inboxes', async () => {
    const fetch = fetcher(notices(5, 0), 2);
    const result = await loadScopedNoticePage(fetch, context, 'medical', null);
    expect(result.rows.map(row => row.id)).toEqual(['000005','000004','000003','000002','000001']);
    expect(result.hasMore).toBe(false);
  });
  it('propagates errors instead of returning a partial empty result', async () => {
    await expect(loadScopedNoticePage(async () => { throw Error('offline'); }, context, 'medical', null)).rejects.toThrow('offline');
  });
  it('keeps account notices visible when classification context is unavailable', async () => {
    const result = await loadScopedNoticePage(fetcher(notices(5, 5)), null, 'medical', null);
    expect(result.rows).toHaveLength(5);
  });
});
