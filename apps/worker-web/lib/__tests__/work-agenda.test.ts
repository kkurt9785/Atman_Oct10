import { describe, expect, it } from 'vitest';
import { agendaEndsAt, agendaTime, sortAgenda, staffAgenda, type AgendaItem, type StaffPlan } from '../work-agenda';
const staff: StaffPlan = { id: 's', contract_start: '2026-10-19', contract_end: '2026-10-21', work_weekdays: [1, 2, 3], default_start_time: '09:00', default_end_time: '18:00', facilities: { name: '병원' } };
const item: AgendaItem = { id: 'a', date: '2026-10-19', start: '23:00', end: '07:00', facility: '병원', status: '확정', href: '/applications' };
describe('worker agenda', () => {
  it('respects inclusive contract boundaries and weekdays', () => { expect(staffAgenda([staff], '2026-10-18', 6).map(x => x.date)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']); });
  it('does not invent shifts on off days', () => { expect(staffAgenda([{ ...staff, work_weekdays: [2] }], '2026-10-18', 6)).toHaveLength(1); });
  it('labels contract plans honestly and links to the correct staff', () => { const row = staffAgenda([staff], '2026-10-19', 1)[0]; expect(row.status).toBe('계약 기준 예정'); expect(row.href).toBe('/workplace?staffId=s'); });
  it('puts ongoing work first without mutating data', () => { const rows = [item, { ...item, id: 'b', date: '2026-10-20', active: true }]; expect(sortAgenda(rows)[0].id).toBe('b'); expect(rows[0].id).toBe('a'); });
  it('sorts dates and actual times', () => { expect(sortAgenda([item, { ...item, id: 'b', start: '09:00' }])[0].id).toBe('b'); });
  it('handles overnight work in KST', () => { expect(agendaTime(item)).toBe('23:00–07:00 (다음 날)'); expect(agendaEndsAt(item)).toBe(Date.parse('2026-10-20T07:00:00+09:00')); });
});
