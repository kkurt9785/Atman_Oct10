import { readFileSync } from 'node:fs';
const migration = readFileSync('supabase/migrations/20261019090000_protect_gig_contract_rates.sql', 'utf8').replaceAll('public.', 'qa_gig_contract_rates.');
console.log(readFileSync('supabase/tests/gig_contract_rates_transaction.sql', 'utf8').replace('-- APPLY_MIGRATION', () => migration));
