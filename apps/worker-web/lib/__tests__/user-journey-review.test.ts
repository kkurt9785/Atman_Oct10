import { describe, expect, it } from 'vitest';
import { upcomingGigAssignments, type UpcomingAssignment } from '../gig-upcoming';
import { summarizeCredentials, type Credential } from '../../../admin-web/lib/workforce-credentials';
import { readFileSync } from 'node:fs';

const shift = (overrides: Partial<UpcomingAssignment> = {}): UpcomingAssignment => ({ id: 'a', title: '행사', starts_on: '2026-10-24', ends_on: '2026-10-31', work_weekdays: [6], start_time: '13:00', end_time: '17:00', status: 'planned', source: 'admin', ...overrides });
describe('upcoming gig assignments', () => {
  it('shows the next actual date and assignment times, not default contract times', () => {
    expect(upcomingGigAssignments([shift()], '2026-10-23')[0]).toMatchObject({ nextDate: '2026-10-24', start_time: '13:00' });
  });
  it('finds the next weekday after today for a repeating assignment', () => {
    expect(upcomingGigAssignments([shift()], '2026-10-24')[0].nextDate).toBe('2026-10-31');
  });
  it('excludes cancelled, completed, elapsed and weekday-mismatched schedules', () => {
    expect(upcomingGigAssignments([shift({ status: 'cancelled' }), shift({ status: 'completed' }), shift({ ends_on: '2026-10-23' }), shift({ ends_on: '2026-10-24', work_weekdays: [1] })], '2026-10-23')).toEqual([]);
  });
  it('does not reintroduce compatibility contracts when admin assignments exist', () => {
    expect(upcomingGigAssignments([shift({ status: 'cancelled' }), shift({ id: 'compat', source: 'staff' })], '2026-10-23')).toEqual([]);
  });
  it('sorts by the next date and starting time, including month boundaries', () => {
    const result = upcomingGigAssignments([shift({ id: 'later', starts_on: '2026-11-01', ends_on: '2026-11-01', work_weekdays: [7] }), shift({ id: 'early', start_time: '09:00' }), shift()], '2026-10-30');
    expect(result.map(row => row.id)).toEqual(['early', 'a', 'later']);
  });
});

const credential = (overrides: Partial<Credential> = {}): Credential => ({ worker_id: 'worker', credential_type: 'nursing_license', expires_at: '2025-10-01', verification_status: 'expired', ...overrides });
describe('renewed workforce credentials', () => {
  it('prefers an approved renewal over expired history in either order', () => {
    const rows = [credential(), credential({ expires_at: '2027-10-01', verification_status: 'approved' })];
    for (const values of [rows, [...rows].reverse()]) expect(summarizeCredentials(values, 'rn', '2026-10-23')).toMatchObject({ status: 'valid', blocked: false });
  });
  it('recognizes an approved non-expiring licence', () => {
    expect(summarizeCredentials([credential(), credential({ expires_at: null, verification_status: 'approved' })], 'rn', '2026-10-23')).toMatchObject({ status: 'valid', blocked: false });
  });
  it('keeps expired professional credentials blocked', () => {
    expect(summarizeCredentials([credential()], 'rn', '2026-10-23')).toMatchObject({ status: 'expired', blocked: true });
  });
  it('warns about optional expired documents without calling the professional licence expired', () => {
    expect(summarizeCredentials([credential({ expires_at: null, verification_status: 'approved' }), credential({ credential_type: 'cpr_cert' })], 'rn', '2026-10-23')).toMatchObject({ status: 'expired', blocked: false });
  });
  it('distinguishes missing records and upcoming expiration', () => {
    expect(summarizeCredentials([], 'rn', '2026-10-23')).toMatchObject({ status: 'missing', blocked: false });
    expect(summarizeCredentials([credential({ verification_status: 'approved', expires_at: '2026-11-01' })], 'rn', '2026-10-23')).toMatchObject({ status: 'expiring', blocked: false });
  });
  it('does not turn query errors into empty or missing credentials', () => {
    const source = readFileSync(new URL('../../../admin-web/lib/db/workforce.ts', import.meta.url), 'utf8');
    expect(source).toContain("if (error || (pool?.length ?? 0) >= 1000) throw new Error");
    expect(source).toContain("credentialsUnavailable ? 'unknown' : summary.status");
    expect(source).toContain('credentialBlocked: credentialsUnavailable || summary.blocked');
  });
});
