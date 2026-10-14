import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { safeNotificationPath } from '../shared/notifications/navigation';

function worker(app: 'admin-web' | 'worker-web') {
  const events: Record<string, (event: any) => void> = {};
  const show = vi.fn().mockResolvedValue(undefined), open = vi.fn().mockResolvedValue(undefined);
  const ctx = { URL, encodeURIComponent, self: { location: { origin: 'https://app.example' }, addEventListener: (name: string, handler: any) => { events[name] = handler; }, registration: { showNotification: show } }, clients: { matchAll: async () => [], openWindow: open } };
  vm.runInNewContext(readFileSync(new URL(`../../../${app}/public/sw.js`, import.meta.url), 'utf8'), ctx);
  return { events, show, open };
}
describe('알림 URL과 OS 팝업', () => {
  it.each(['https://evil.example', '//evil.example', '/\\evil.example', '/\n/evil.example', 'javascript:alert(1)'])('외부 이동 입력 %s를 거부한다', (url) => {
    expect(safeNotificationPath(url)).toBeNull();
  });
  for(const app of ['admin-web', 'worker-web'] as const) {
    it(`${app}: 알림 식별자와 문구를 팝업에 전달한다`, async () => {
      const { events, show } = worker(app);
      let done: Promise<unknown> = Promise.resolve();
      events.push({ data: { json: () => ({ title: '지급 확인', body: '입금 내역을 확인해 주세요.', data: { notificationId: 'n1', url: '/gig/settlement' } }) }, waitUntil: (value: Promise<unknown>) => { done = value; } });
      await done;
      expect(show).toHaveBeenCalledWith('지급 확인', expect.objectContaining({ body: '입금 내역을 확인해 주세요.', tag: 'n1' }));
    });
    it(`${app}: 잘못된 JSON에도 일반 알림을 보여 준다`, async () => {
      const { events, show } = worker(app);
      events.push({ data: { json: () => { throw new Error('invalid'); } }, waitUntil: () => {} });
      expect(show).toHaveBeenCalledOnce();
    });
    it(`${app}: 알림을 눌러도 외부 사이트로 이동하지 않는다`, async () => {
      const { events, open } = worker(app);
      let done: Promise<unknown> = Promise.resolve();
      events.notificationclick({ notification: { close() {}, data: { url: '/\\evil.example' } }, waitUntil: (value: Promise<unknown>) => { done = value; } });
      await done;
      expect(new URL(open.mock.calls[0][0], 'https://app.example').origin).toBe('https://app.example');
    });
  }
});
