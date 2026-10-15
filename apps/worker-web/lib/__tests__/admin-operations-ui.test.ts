import { describe, expect, it } from 'vitest';
import { attendanceTimeKST, checkDeadlineKST, standaloneWorkers } from '../../../admin-web/lib/operations-ui';

describe('관리자 운영 화면 회귀', () => {
  it('UTC timestamp를 한국 시간으로 표시한다', () => {
    expect(attendanceTimeKST('2026-10-14T23:30:00Z')).toBe('08:30');
    expect(attendanceTimeKST('2026-10-14T15:00:00Z')).toBe('00:00');
    expect(attendanceTimeKST(null)).toBe('—');
    expect(attendanceTimeKST('invalid')).toBe('—');
  });
  it('기기 시간대와 무관하게 확인 기한을 KST로 해석한다', () => {
    expect(checkDeadlineKST('2026-10-15T09:30', 0)).toBe('2026-10-15T00:30:00.000Z');
    expect(checkDeadlineKST('')).toBeNull();
  });
  it.each(['invalid', '2026-02-30T09:00', '2026-10-15T24:00', '2026-13-01T12:00'])('잘못된 기한 %s를 거부한다', value => {
    expect(() => checkDeadlineKST(value, 0)).toThrow();
  });
  it('지난 기한은 전송하지 않는다', () => {
    expect(() => checkDeadlineKST('2026-10-15T09:00', Date.parse('2026-10-15T00:00:00Z'))).toThrow('현재 이후');
  });
  const workers = [{ staffId: 'group', startTime: '09:00', endTime: '18:00' }, { staffId: 'individual', startTime: '10:00', endTime: '17:00' }];
  const projects = [{ startTime: '09:00:00', endTime: '18:00:00', participants: [{ staffId: 'group' }] }];
  it('단체 근무가 있어도 별도 근무자를 남긴다', () => {
    expect(standaloneWorkers(workers, projects)).toEqual([workers[1]]);
    expect(standaloneWorkers(workers, [])).toEqual(workers);
  });
  it('같은 사람이어도 다른 시간의 근무는 숨기지 않는다', () => {
    const extra = { ...workers[0], startTime: '19:00', endTime: '22:00' };
    expect(standaloneWorkers([...workers, extra], projects)).toEqual([workers[1], extra]);
  });
});
