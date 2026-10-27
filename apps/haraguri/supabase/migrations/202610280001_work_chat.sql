begin;
-- Existing entries become the shared family work records; IDs and history stay intact.
alter table public.hg_entries drop constraint hg_entries_kind_check;
alter table public.hg_entries add constraint hg_entries_kind_check check (kind in ('task','event','purchase'));
alter table public.hg_entries add column expected_amount bigint not null default 0 check (expected_amount between 0 and 1000000000);
alter table public.hg_entries add column purchase_state text not null default 'discussing' check (purchase_state in ('discussing','decided','purchased','hold'));
grant update (expected_amount,purchase_state) on public.hg_entries to authenticated;
create policy family_work_update on public.hg_entries for update to authenticated using (public.hg_is_member(family_id)) with check (public.hg_is_member(family_id));

-- A NULL room is the family's single general chat. Other rooms retain occurrence isolation.
alter table public.hg_comments alter column entry_id drop not null, alter column occurrence drop not null;
alter table public.hg_comments add constraint hg_comment_room check ((entry_id is null) = (occurrence is null));
alter table public.hg_comments add column shared_entry_id uuid;
alter table public.hg_comments add column shared_occurrence date;
alter table public.hg_comments add constraint hg_shared_entry foreign key (shared_entry_id,family_id) references public.hg_entries(id,family_id);
alter table public.hg_comments add constraint hg_shared_room check ((shared_entry_id is null) = (shared_occurrence is null));
alter table public.hg_attachments alter column entry_id drop not null, alter column occurrence drop not null;
alter table public.hg_attachments add column created_at timestamptz not null default now();
alter table public.hg_attachments add constraint hg_attachment_room check ((entry_id is null) = (occurrence is null));

alter table public.hg_expenses add column entry_id uuid;
alter table public.hg_expenses add column occurrence date;
alter table public.hg_expenses add constraint hg_expense_entry foreign key (entry_id,family_id) references public.hg_entries(id,family_id);
alter table public.hg_expenses add constraint hg_expense_room check ((entry_id is null) = (occurrence is null));
grant update (entry_id,occurrence) on public.hg_expenses to authenticated;
create index hg_comments_room on public.hg_comments(family_id,entry_id,occurrence,created_at);
create index hg_expenses_room on public.hg_expenses(family_id,entry_id,occurrence);

-- Postgres changes respect each subscriber's existing family SELECT policies.
do $$ declare t text; begin
  foreach t in array array['hg_comments','hg_attachments','hg_entries','hg_expenses','hg_receipts'] loop
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end $$;
commit;
