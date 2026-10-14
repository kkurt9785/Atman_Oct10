// Rollback-only isolated local fixture. Pipe into local PostgreSQL only.
import {readFileSync} from 'node:fs';
const migration=readFileSync('supabase/migrations/20261015020000_atomic_staff_leave_management.sql','utf8');
const fixture=readFileSync('supabase/tests/staff_leave_transaction.sql','utf8');
console.log(fixture.replace('-- APPLY_MIGRATION',()=>migration).replaceAll('public.','qa_staff_leave.'));
