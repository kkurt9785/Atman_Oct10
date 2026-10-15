import { readFileSync } from 'node:fs';
const migrations=['20261015060000_gig_sites_and_optional_location_address.sql','20261015070000_worker_attendance_policy.sql'].map(f=>readFileSync('supabase/migrations/'+f,'utf8')).join('\n');
console.log(readFileSync('supabase/tests/gig_sites_transaction.sql','utf8').replace('-- APPLY_MIGRATION',()=>migrations).replaceAll('public.','qa_gig_sites.').replaceAll('qa_gig_sites.ST_','public.ST_').replaceAll('qa_gig_sites.geography','public.geography').replaceAll('qa_gig_sites.geometry','public.geometry'));
