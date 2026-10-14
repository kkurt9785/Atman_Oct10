// Emit rollback-only SQL for the local DB. Never pipe to a linked/production DB.
import {readFileSync} from 'node:fs';
const migration=readFileSync('supabase/migrations/20261015010000_atomic_staff_payroll_and_payout_outbox.sql','utf8');
const fixture=readFileSync('supabase/tests/payroll_integrity_transaction.sql','utf8');
console.log(fixture.replace('-- APPLY_MIGRATION',()=>migration).replaceAll('public.','qa_payroll_integrity.'));
