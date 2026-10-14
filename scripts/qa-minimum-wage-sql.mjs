// Emit only. Pipe to local PostgreSQL; uses an isolated, rollback-only schema.
import { readFileSync } from 'node:fs';
const migration = readFileSync('supabase/migrations/20261015000000_year_aware_minimum_wage.sql', 'utf8');
const fixture = readFileSync('supabase/tests/minimum_wage_transaction.sql', 'utf8');
console.log(fixture.replace('-- APPLY_MIGRATION', () => migration).replaceAll('public.', 'qa_minimum_wage.'));
