import { describe, expect, it } from 'vitest';
import { attendanceTime, recordedShiftMinutes } from '../attendance-display';

describe('worker attendance recognition', () => {
  it('uses saved paid minutes including recorded breaks', () => {
    expect(recordedShiftMinutes([{ worked_minutes: 480, break_minutes: 60 }])).toBe(480);
    expect(recordedShiftMinutes({ worked_minutes: 0, break_minutes: 0 })).toBe(0);
  });
  it('keeps missing settlement pending rather than inferring elapsed time', () => {
    expect(recordedShiftMinutes([])).toBeNull();
    expect(recordedShiftMinutes(null)).toBeNull();
  });
  it('rejects corrupt and duplicate recognition', () => {
    expect(() => recordedShiftMinutes({ worked_minutes: -1, break_minutes: 0 })).toThrow();
    expect(() => recordedShiftMinutes({ worked_minutes: null, break_minutes: 0 })).toThrow();
    expect(() => recordedShiftMinutes([{ worked_minutes: 60, break_minutes: 0 }, { worked_minutes: 60, break_minutes: 0 }])).toThrow();
  });
  it('renders Korean attendance time across the UTC date boundary', () => {
    expect(attendanceTime('2026-10-22T23:30:00Z')).toBe('08:30');
    expect(attendanceTime(null)).toBe('—');
  });
});
