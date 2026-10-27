import { describe, expect, it } from 'vitest';
import { Entry, Expense, monthEntries, occurrence, total } from './model';

const entry: Entry = { id:'e',family_id:'f',title:'정기 납부',body:'',date:'2026-01-31',kind:'task',repeat:'monthly',assignee:'',created_by:'u' };
describe('recurring family calendar', () => {
  it('clamps a monthly 31st to February then restores it in March', () => {
    expect(occurrence(entry,'2026-02')).toBe('2026-02-28');
    expect(occurrence(entry,'2026-03')).toBe('2026-03-31');
  });
  it('never creates a recurrence before its starting month', () => {
    expect(occurrence(entry,'2025-12')).toBeNull();
  });
  it('handles leap-day anniversaries without moving them into March', () => {
    const leap = {...entry,date:'2024-02-29',repeat:'yearly' as const};
    expect(occurrence(leap,'2026-02')).toBe('2026-02-28');
    expect(occurrence(leap,'2028-02')).toBe('2028-02-29');
    expect(occurrence(leap,'2026-03')).toBeNull();
  });
  it('does not repeat one-off events and provides distinct occurrence keys', () => {
    expect(occurrence({...entry,repeat:'none'},'2026-02')).toBeNull();
    expect(monthEntries([entry],'2026-02')[0].date).not.toBe(monthEntries([entry],'2026-03')[0].date);
  });
});
describe('recorded spending', () => {
  const base = {family_id:'f',card_id:'c',title:'장보기',category:'식비',created_by:'u'};
  const expenses: Expense[] = [
    {...base,id:'1',amount:10000,date:'2026-10-01'},
    {...base,id:'2',amount:-3000,date:'2026-10-02'},
    {...base,id:'3',amount:5000,date:'2026-11-01'},
    {...base,id:'4',card_id:'other',amount:2000,date:'2026-10-02'},
  ];
  it('separates card, day and month totals and includes refunds', () => {
    expect(total(expenses,'2026-10','c')).toBe(7000);
    expect(total(expenses,'2026-10')).toBe(9000);
    expect(total(expenses,'2026-10-02')).toBe(-1000);
  });
});
