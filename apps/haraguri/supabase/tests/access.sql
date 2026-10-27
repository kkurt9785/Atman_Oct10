-- Run only against a disposable/test Supabase project after the HARAGURI migration.
-- All fixtures are rolled back. This script has not been run against a remote project.
begin;
insert into auth.users(id,email) values
('caaf0000-0000-4000-8000-000000000001','haraguri-test-a@example.invalid'),
('caaf0000-0000-4000-8000-000000000002','haraguri-test-b@example.invalid');
insert into public.hg_families(id,name,owner_id) values
('faaf0000-0000-4000-8000-000000000001','test family A','caaf0000-0000-4000-8000-000000000001'),
('faaf0000-0000-4000-8000-000000000002','test family B','caaf0000-0000-4000-8000-000000000002');
insert into public.hg_members(family_id,user_id,display_name) values
('faaf0000-0000-4000-8000-000000000001','caaf0000-0000-4000-8000-000000000001','A'),
('faaf0000-0000-4000-8000-000000000002','caaf0000-0000-4000-8000-000000000002','B');
insert into public.hg_entries(id,family_id,title,date,kind,created_by) values
('eaaf0000-0000-4000-8000-000000000001','faaf0000-0000-4000-8000-000000000001','A private','2026-10-26','task','caaf0000-0000-4000-8000-000000000001'),
('eaaf0000-0000-4000-8000-000000000002','faaf0000-0000-4000-8000-000000000002','B private','2026-10-26','task','caaf0000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','caaf0000-0000-4000-8000-000000000001',true);
do $$ begin
  if (select count(*) from public.hg_families) <> 1 then raise exception 'FAIL: family isolation'; end if;
  if (select count(*) from public.hg_entries) <> 1 then raise exception 'FAIL: entry isolation'; end if;
  if (select count(*) from public.hg_members) <> 1 then raise exception 'FAIL: member isolation'; end if;
  begin
    insert into public.hg_entries(family_id,title,date,kind) values('faaf0000-0000-4000-8000-000000000002','forged','2026-10-26','task');
    raise exception 'FAIL: cross-family insert accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.hg_comments(family_id,entry_id,occurrence,body) values('faaf0000-0000-4000-8000-000000000001','eaaf0000-0000-4000-8000-000000000002','2026-10-26','forged');
    raise exception 'FAIL: cross-family attachment relation accepted';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.hg_receipts(family_id,entry_id,occurrence,user_id,state) values('faaf0000-0000-4000-8000-000000000001','eaaf0000-0000-4000-8000-000000000001','2026-10-26','caaf0000-0000-4000-8000-000000000002','done');
    raise exception 'FAIL: forged completion accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.hg_members values('faaf0000-0000-4000-8000-000000000002','caaf0000-0000-4000-8000-000000000001','forged');
    raise exception 'FAIL: direct membership insert accepted';
  exception when insufficient_privilege then null; end;
end $$;
insert into public.hg_receipts(family_id,entry_id,occurrence,state) values
('faaf0000-0000-4000-8000-000000000001','eaaf0000-0000-4000-8000-000000000001','2026-10-26','done');
do $$ begin
  if (select count(*) from public.hg_receipts where occurrence='2026-11-26') <> 0 then raise exception 'FAIL: completion carried across occurrences'; end if;
end $$;
reset role;
rollback;
