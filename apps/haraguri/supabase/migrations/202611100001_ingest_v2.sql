begin;
-- Ingest v2: every message/notification that reaches the collect address is kept in an inbox with its outcome,
-- so nothing is silently lost and unreadable formats can be fixed from real samples. Push-notification rows get source 'push'.
create table public.hg_inbox (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.hg_families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  received_at timestamptz not null default now(),
  via text not null default '' check (length(via) <= 40),       -- ios-shortcut · mac-relay-sms · mac-relay-notif · android · test
  app text not null default '' check (length(app) <= 120),      -- notification source app (bundle id or name) when known
  raw text not null check (length(raw) <= 2000),
  status text not null check (status in ('saved','duplicate','ignored','unparsed')),
  summary text not null default '' check (length(summary) <= 200),
  expense_id uuid references public.hg_expenses(id) on delete set null
);
alter table public.hg_inbox enable row level security;
revoke all on public.hg_inbox from anon, authenticated;
grant select, delete on public.hg_inbox to authenticated;
create policy inbox_read on public.hg_inbox for select to authenticated using (public.hg_is_member(family_id));
create policy inbox_delete on public.hg_inbox for delete to authenticated using (public.hg_is_member(family_id));
create index hg_inbox_family_time on public.hg_inbox(family_id, received_at desc);

alter table public.hg_expenses drop constraint if exists hg_expenses_source_check;
alter table public.hg_expenses add constraint hg_expenses_source_check check (source in ('manual','sms','recurring','ocr','ai','push'));

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'haraguri-inbox-cleanup') then
    perform cron.schedule('haraguri-inbox-cleanup', '30 18 * * *', $job$delete from public.hg_inbox where received_at < now() - interval '60 days'$job$);
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hg_inbox') then
    alter publication supabase_realtime add table public.hg_inbox;
  end if;
end $$;
commit;
