import { describe, expect, it } from 'vitest';
import { agendaEndsAt, agendaTime, sortAgenda, splitAgendaByNearness, staffAgenda, type AgendaItem, type StaffPlan } from '../work-agenda';
const staff: StaffPlan = { id: 's', contract_start: '2026-10-19', contract_end: '2026-10-21', work_weekdays: [1, 2, 3], default_start_time: '09:00', default_end_time: '18:00', facilities: { name: '병원' } };
const item: AgendaItem = { id: 'a', date: '2026-10-19', start: '23:00', end: '07:00', facility: '병원', kind: 'confirmed', status: '확정', href: '/applications' };
describe('worker agenda', () => {
  it('respects inclusive contract boundaries and weekdays', () => { expect(staffAgenda([staff], '2026-10-18', 6).map(x => x.date)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']); });
  it('does not invent shifts on off days', () => { expect(staffAgenda([{ ...staff, work_weekdays: [2] }], '2026-10-18', 6)).toHaveLength(1); });
  it('labels contract plans honestly and links to the correct staff', () => { const row = staffAgenda([staff], '2026-10-19', 1)[0]; expect(row.status).toBe('계약 기준 예정'); expect(row.href).toBe('/workplace?staffId=s'); });
  it('puts ongoing work first without mutating data', () => { const rows = [item, { ...item, id: 'b', date: '2026-10-20', active: true }]; expect(sortAgenda(rows)[0].id).toBe('b'); expect(rows[0].id).toBe('a'); });
  it('sorts dates and actual times', () => { expect(sortAgenda([item, { ...item, id: 'b', start: '09:00' }])[0].id).toBe('b'); });
  it('handles overnight work in KST', () => { expect(agendaTime(item)).toBe('23:00–07:00 (익일)'); expect(agendaEndsAt(item)).toBe(Date.parse('2026-10-20T07:00:00+09:00')); });
  // 2026-11-13 = 금요일, 11-14 = 토요일. 요일별 근무시간(weekday_hours)이 있는 날만 그 시간으로 나온다
  it('uses weekday hours for that weekday only', () => {
    const dental: StaffPlan = { ...staff, contract_start: null, contract_end: null, work_weekdays: [1, 2, 3, 4, 5, 6], weekday_hours: { '6': { start: '09:00', end: '13:00' } } };
    expect(staffAgenda([dental], '2026-11-13', 3).map(x => `${x.date} ${x.start}-${x.end}`)).toEqual(['2026-11-13 09:00-18:00', '2026-11-14 09:00-13:00']);
  });
  it('keeps default hours when weekday hours are missing or broken', () => {
    const broken: StaffPlan = { ...staff, contract_start: null, contract_end: null, work_weekdays: [6], weekday_hours: { '6': { start: '13:00', end: '09:00' } } };
    expect(staffAgenda([broken], '2026-11-14', 1)[0]).toMatchObject({ start: '09:00', end: '18:00' });
    expect(staffAgenda([{ ...broken, weekday_hours: null }], '2026-11-14', 1)[0]).toMatchObject({ start: '09:00', end: '18:00' });
  });
  // 직원 일정은 가까운 7일만 펼치고 나머지는 접는다. 공고 근무(지원·확정)는 멀어도 접지 않는다
  it('folds only far-away staff days', () => {
    const rows = [
      { date: '2026-11-10', kind: 'staff' as const }, { date: '2026-11-16', kind: 'staff' as const },
      { date: '2026-11-17', kind: 'staff' as const }, { date: '2026-11-30', kind: 'confirmed' as const },
    ];
    const { near, later } = splitAgendaByNearness(rows, '2026-11-10');
    expect(near.map(x => x.date)).toEqual(['2026-11-10', '2026-11-16', '2026-11-30']);
    expect(later.map(x => x.date)).toEqual(['2026-11-17']);
    expect(splitAgendaByNearness(rows, '2026-11-10', 1).later).toHaveLength(2);
  });
});
