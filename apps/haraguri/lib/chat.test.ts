import { describe, expect, it } from 'vitest';
import { mergeById, olderCursor, roomKey, PAGE } from './chat';
import type { Entry } from './model';

const entry: Entry = { id: 'work', family_id: 'f', title: '관리비', body: '', date: '2026-01-31', kind: 'task', repeat: 'monthly', assignee: '', created_by: 'u' };
const msg = (id: string, created_at: string) => ({ id, created_at });

describe('paged chat rooms', () => {
  it('maps the general room and an occurrence room to distinct keys', () => {
    expect(roomKey(null)).toEqual({ entry_id: null, occurrence: null });
    expect(roomKey({ entry, date: '2026-02-28' })).toEqual({ entry_id: 'work', occurrence: '2026-02-28' });
  });
  it('merges a refreshed newest page into already loaded history without duplicates, oldest first', () => {
    const older = [msg('a', '2026-10-01T00:00:00Z'), msg('b', '2026-10-02T00:00:00Z')];
    const newest = [msg('c', '2026-10-03T00:00:00Z'), msg('b', '2026-10-02T00:00:00Z')];
    expect(mergeById(older, newest).map(m => m.id)).toEqual(['a', 'b', 'c']);
    expect(mergeById([], []).length).toBe(0);
  });
  it('orders same-timestamp rows deterministically and keeps the latest copy of an edited row', () => {
    const merged = mergeById([{ id: 'y', created_at: 't', body: 'old' }], [{ id: 'x', created_at: 't', body: 'x' }, { id: 'y', created_at: 't', body: 'new' }]);
    expect(merged.map(m => m.id)).toEqual(['x', 'y']);
    expect(merged[1].body).toBe('new');
  });
  it('uses the oldest loaded timestamp as the cursor for the previous page', () => {
    expect(olderCursor([msg('a', '2026-10-05T00:00:00Z'), msg('b', '2026-10-01T00:00:00Z'), { created_at: undefined }])).toBe('2026-10-01T00:00:00Z');
    expect(olderCursor([])).toBeNull();
    expect(PAGE).toBeGreaterThanOrEqual(50);
  });
});
