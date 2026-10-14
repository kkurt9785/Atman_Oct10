// Emit an isolated, rollback-only audit. Pipe ONLY to local PostgreSQL.
// Regression assertions for the reviewed definitions; not a full migration replay.
import { readFileSync } from 'node:fs';
const names = [
  ['20261014230000_closure_and_payout_notice_safety.sql', ['close_my_facility', 'withdraw_my_admin_account', 'run_gig_payout_reminders', 'confirm_my_gig_payout']],
  ['20261014180000_gig_payout_attendance_ledger.sql', ['guard_gig_payout_attendances']],
];
let definitions = '';
for (const [file, functions] of names) {
  const source = readFileSync(`supabase/migrations/${file}`, 'utf8');
  for (const name of functions) {
    const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    const end = source.indexOf('\n$$;', start);
    if (start < 0 || end < start) throw new Error(`Missing complete definition: ${name}`);
    definitions += source.slice(start, end + 4) + '\n';
  }
}
const fixture = readFileSync('supabase/tests/md_remaining_characterization.sql', 'utf8');
console.log(fixture.replace('-- APPLY_FUNCTIONS', () => definitions).replaceAll('public.', 'qa_md_remaining.'));
