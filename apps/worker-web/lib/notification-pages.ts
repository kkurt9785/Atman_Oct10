import { classifyNotice, noticeBelongsTo, type Notice } from './notification-scope';
import type { WorkerShell, WorkerShellContext } from './worker-mode';

export type NoticeCursor = { createdAt: string; id: string };
type Context = Pick<WorkerShellContext, 'gigStaffIds' | 'gigFacilityIds' | 'hasGig' | 'hasMedical'>;
export async function loadScopedNoticePage(
  fetchPage: (cursor: NoticeCursor | null) => Promise<Notice[]>,
  context: Context | null, shell: WorkerShell, initial: NoticeCursor | null,
) {
  const rows: Notice[] = [];
  let cursor = initial;
  // Bound work per click. A page full of the other shell never means an empty inbox.
  for (let page = 0; page < 5; page++) {
    const batch = await fetchPage(cursor);
    if (!batch.length) return { rows, cursor, hasMore: false };
    const last = batch[batch.length - 1];
    if (cursor?.id === last.id) throw new Error('알림 조회 위치를 확인하지 못했어요. 새로고침해 주세요.');
    rows.push(...batch.filter(row => !context || noticeBelongsTo(classifyNotice(row, context), shell)));
    cursor = { createdAt: last.created_at, id: last.id };
    // Only an empty response proves exhaustion (server page caps may vary).
    if (rows.length >= 20) return { rows, cursor, hasMore: true };
  }
  return { rows, cursor, hasMore: true };
}
