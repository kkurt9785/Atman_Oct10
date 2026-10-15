// Isolated, rollback-only local database regression.
import { readFileSync } from 'node:fs';
const migration = readFileSync('supabase/migrations/20261015050000_transactional_account_storage_cleanup.sql', 'utf8');
const core = migration.slice(0, migration.indexOf('CREATE FUNCTION public.account_storage_cleanup_health'));
const fixture = readFileSync('supabase/tests/account_storage_cleanup_transaction.sql', 'utf8');
console.log(fixture.replace('-- APPLY_MIGRATION', () => core)
  .replaceAll('public.', 'qa_account_storage.').replaceAll('storage.objects', 'qa_account_storage.objects')
  .replaceAll('auth.users', 'qa_account_storage.users'));
