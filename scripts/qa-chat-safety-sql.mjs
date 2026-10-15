// Rollback-only fixtures. Pipe only to the local PostgreSQL container.
import { readFileSync } from 'node:fs';
const source = readFileSync('supabase/migrations/20261015040000_chat_safety_reporting_and_blocks.sql', 'utf8');
const core = source.slice(0, source.indexOf("SELECT cron.unschedule"));
const fixture = readFileSync('supabase/tests/chat_safety_transaction.sql', 'utf8');
console.log(fixture.replace('-- APPLY_MIGRATION', () => core).replaceAll('public.', 'qa_chat_safety.').replaceAll('auth.users', 'qa_chat_safety.users'));
