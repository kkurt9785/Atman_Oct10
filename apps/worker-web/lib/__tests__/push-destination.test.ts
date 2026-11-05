import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { noticeDestination } from '../notification-destination';

// 푸시 클릭(public/sw.js)과 앱 안 알림 목록(lib/notification-destination.ts)이 같은 화면을 연다 — 서비스워커는 TS를 못 읽어 규칙을 두 벌 둔다.
// sw.js 를 그대로 실행해 두 규칙을 같은 입력으로 비교한다. 푸시 data 에는 발송기가 eventType 을 실어 보낸다(notification-dispatch.ts).
const source = readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8');
const sandbox: Record<string, unknown> = { self: { addEventListener() {}, location: { origin: 'https://itdot.co.kr' } }, URL, encodeURIComponent };
vm.runInNewContext(source, sandbox);
const pushDestination = sandbox.pushDestination as (data: Record<string, unknown>) => string;

const cases: Array<[string, string | null, Record<string, unknown>]> = [
  ['새 공고', 'shift.created', { type: 'new_shift', shiftId: 's1' }],
  ['결원 공고(목록 주소만)', 'shift.created', { type: 'new_shift', shiftId: 's2', url: '/shifts' }],
  ['긴급 공고', 'shift.urgent', { type: 'urgent_shift', shiftId: 's3' }],
  ['반복 공고 묶음', 'shift.batch_created', { type: 'new_shift_batch', batchId: 'b1', url: '/shifts' }],
  ['채팅', 'chat.message', { type: 'chat', applicationId: 'a1' }],
  ['반복근무 요청', 'shift.invited', { type: 'new_shift', shiftId: 's4', applicationId: 'a2' }],
  ['근무 취소', 'shift.cancelled', { url: '/applications', shiftId: 's5' }],
  ['수락', 'shift_application.accepted', { type: 'accepted', applicationId: 'a3' }],
  ['대타 요청', 'shift.cover_requested', { coverId: 'c1' }],
  ['출근 알림', 'attendance.reminder', { kind: 'attendance.reminder', url: '/workplace' }],
  ['외부 주소 거부', 'shift.created', { type: 'new_shift', shiftId: 's6', url: '//evil.example/x' }],
  ['모르는 알림', 'something.else', {}],
  ['종류 없음(옛 푸시)', null, { type: 'chat', applicationId: 'a4' }],
];

describe('push click destination = in-app notice destination', () => {
  it.each(cases)('%s', (_label, eventType, data) => {
    const inApp = noticeDestination({ event_type: eventType, data } as never, 'medical');
    expect(pushDestination({ ...data, eventType })).toBe(inApp ?? '/shifts');
  });
  it('푸시는 목록 주소보다 그 공고·지원을 바로 연다', () => {
    expect(pushDestination({ type: 'new_shift', shiftId: 's1', eventType: 'shift.created', url: '/shifts' })).toBe('/shifts?highlight=s1');
    expect(pushDestination({ type: 'accepted', applicationId: 'a1', eventType: 'shift_application.accepted' })).toBe('/applications#application-a1');
  });
});
