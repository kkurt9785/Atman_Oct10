import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ rpc: vi.fn(), eq: vi.fn(), remove: vi.fn(), send: vi.fn() }));
vi.mock('../../../admin-web/lib/supabase', () => ({ adminClient: () => ({ rpc: mock.rpc, from: () => ({ select: () => ({ eq: mock.eq }), delete: () => ({ in: mock.remove }) }) }) }));
vi.mock('../../../admin-web/lib/push', () => ({ sendWebPush: mock.send }));
import { dispatchPendingNotifications } from '../../../admin-web/lib/notification-dispatch';
const row = { id: 'notice-1', worker_auth_user_id: 'user-1', title: '지급 확인', body: '확인해 주세요', data: { url: '/gig/settlement' } };
beforeEach(() => {
  vi.clearAllMocks();
  mock.rpc.mockImplementation(async (name) => name === 'claim_notification_outbox' ? { data: [row], error: null } : { error: null });
  mock.eq.mockResolvedValue({ data: [{ id: 'subscription-1', subscription: {} }], error: null });
  mock.send.mockResolvedValue({ ok: true });
  mock.remove.mockResolvedValue({ error: null });
});
describe('알림 발송 결과 분류', () => {
  it('발송 직전 차단을 다시 확인해 이미 처리 중이던 채팅 알림도 보내지 않는다', async () => {
    mock.rpc.mockImplementation(async name => name === 'claim_notification_outbox'
      ? { data: [{ ...row, data: { type: 'chat' } }], error: null }
      : name === 'is_safety_outbox_allowed' ? { data: false, error: null } : { error: null });
    expect(await dispatchPendingNotifications()).toMatchObject({ discarded: 1, sent: 0 });
    expect(mock.send).not.toHaveBeenCalled();
  });
  it('차단 상태를 확인할 수 없는 채팅은 발송하지 않고 재시도한다', async () => {
    mock.rpc.mockImplementation(async name => name === 'claim_notification_outbox'
      ? { data: [{ ...row, data: { kind: 'workroom.direct' } }], error: null }
      : name === 'is_safety_outbox_allowed' ? { data: null, error: { message: 'offline' } } : { error: null });
    expect(await dispatchPendingNotifications()).toMatchObject({ failed: 1, sent: 0 });
    expect(mock.send).not.toHaveBeenCalled();
  });
  it('구독 조회 실패는 폐기하지 않고 재시도 대상으로 남긴다', async () => {
    mock.eq.mockResolvedValue({ data: null, error: { message: 'temporary db error' } });
    expect(await dispatchPendingNotifications()).toMatchObject({ failed: 1, discarded: 0, sent: 0 });
    expect(mock.rpc).toHaveBeenLastCalledWith('complete_notification_outbox', { p_id: row.id, p_status: 'failed', p_error: 'temporary db error' });
    expect(mock.send).not.toHaveBeenCalled();
  });
  it('정상 조회한 미구독 계정만 푸시 대상을 건너뛴다', async () => {
    mock.eq.mockResolvedValue({ data: [], error: null });
    expect(await dispatchPendingNotifications()).toMatchObject({ discarded: 1 });
  });
  it('동일 알림 식별자를 기기에 보내 중복 팝업을 합칠 수 있다', async () => {
    expect(await dispatchPendingNotifications()).toMatchObject({ sent: 1 });
    expect(mock.send.mock.calls[0][1].data).toEqual({ url: '/gig/settlement', notificationId: row.id });
  });
  it('만료된 구독만 제거한다', async () => {
    mock.send.mockResolvedValue({ ok: false, expired: true, error: '410' });
    expect(await dispatchPendingNotifications()).toMatchObject({ discarded: 1 });
    expect(mock.remove).toHaveBeenCalledWith('id', ['subscription-1']);
  });
  it('일시적인 전송 오류는 재시도한다', async () => {
    mock.send.mockResolvedValue({ ok: false, expired: false, error: '503' });
    expect(await dispatchPendingNotifications()).toMatchObject({ failed: 1 });
    expect(mock.remove).not.toHaveBeenCalled();
  });
  it('완료 상태 저장 실패를 발송 처리 완료로 보고하지 않는다', async () => {
    mock.rpc.mockImplementation(async (name) => name === 'claim_notification_outbox' ? { data: [row], error: null } : { error: { message: 'write failed' } });
    await expect(dispatchPendingNotifications()).rejects.toThrow('상태를 저장');
  });
});
