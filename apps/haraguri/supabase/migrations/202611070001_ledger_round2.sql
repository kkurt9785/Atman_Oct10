begin;
-- Ledger rounds 2/3: learned category rules, cancellation links, notes, shared/personal scope, regret tag,
-- monthly settlements, saving envelopes (with per-member contributions), weekly digest.

-- "Merchant contains X → category Y" rules, learned from what the family saves. Shared by the whole family.
create table public.hg_category_rules (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.hg_families(id) on delete cascade,
  keyword text not null check (length(keyword) between 1 and 60),
  category text not null check (length(category) <= 40),
  scope text check (scope in ('shared','personal')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (family_id, keyword)
);
alter table public.hg_category_rules enable row level security;
revoke all on public.hg_category_rules from anon, authenticated;
grant select, insert, update, delete on public.hg_category_rules to authenticated;
create policy rules_read on public.hg_category_rules for select to authenticated using (public.hg_is_member(family_id));
create policy rules_insert on public.hg_category_rules for insert to authenticated with check (public.hg_is_member(family_id));
create policy rules_update on public.hg_category_rules for update to authenticated using (public.hg_is_member(family_id)) with check (public.hg_is_member(family_id));
create policy rules_delete on public.hg_category_rules for delete to authenticated using (public.hg_is_member(family_id));

alter table public.hg_expenses
  add column if not exists note text not null default '' check (length(note) <= 200),
  add column if not exists cancels uuid references public.hg_expenses(id) on delete set null,      -- this refund row cancels that purchase
  add column if not exists canceled_by uuid references public.hg_expenses(id) on delete set null,  -- this purchase was canceled by that refund row
  add column if not exists scope text not null default 'shared' check (scope in ('shared','personal')),
  add column if not exists regret boolean not null default false;
create index if not exists hg_expenses_cancel on public.hg_expenses(family_id, canceled_by) where canceled_by is null;

-- Month-end settlement of shared spending between members: one row marks the month as settled.
create table public.hg_settlements (
  family_id uuid not null references public.hg_families(id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),
  settled_at timestamptz not null default now(),
  settled_by uuid not null default auth.uid() references auth.users(id),
  note text not null default '' check (length(note) <= 200),
  primary key (family_id, month)
);
alter table public.hg_settlements enable row level security;
revoke all on public.hg_settlements from anon, authenticated;
grant select, insert, update, delete on public.hg_settlements to authenticated;
create policy settlements_all on public.hg_settlements for all to authenticated using (public.hg_is_member(family_id)) with check (public.hg_is_member(family_id));

-- Saving envelopes: a goal with a target and optional due month; balance = sum of entries (negative = withdrawal).
create table public.hg_envelopes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.hg_families(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  target bigint not null check (target between 1 and 100000000000),
  due_month date check (due_month is null or due_month = date_trunc('month', due_month)::date),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create table public.hg_envelope_entries (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.hg_families(id) on delete cascade,
  envelope_id uuid not null references public.hg_envelopes(id) on delete cascade,
  amount bigint not null check (amount between -100000000000 and 100000000000 and amount <> 0),
  date date not null default (now() at time zone 'Asia/Seoul')::date,
  note text not null default '' check (length(note) <= 120),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.hg_envelopes enable row level security;
alter table public.hg_envelope_entries enable row level security;
revoke all on public.hg_envelopes, public.hg_envelope_entries from anon, authenticated;
grant select, insert, update, delete on public.hg_envelopes, public.hg_envelope_entries to authenticated;
create policy envelopes_all on public.hg_envelopes for all to authenticated using (public.hg_is_member(family_id)) with check (public.hg_is_member(family_id));
create policy envelope_entries_read on public.hg_envelope_entries for select to authenticated using (public.hg_is_member(family_id));
create policy envelope_entries_insert on public.hg_envelope_entries for insert to authenticated
  with check (public.hg_is_member(family_id) and created_by = auth.uid() and exists (select 1 from public.hg_envelopes e where e.id = envelope_id and e.family_id = hg_envelope_entries.family_id));
create policy envelope_entries_delete on public.hg_envelope_entries for delete to authenticated using (public.hg_is_member(family_id));
create index hg_envelope_entries_env on public.hg_envelope_entries(envelope_id);

-- Weekly digest: Monday 08:00 KST.
alter table public.hg_push_subscriptions alter column prefs set default '{"messages":true,"files":true,"daily":true,"eve":true,"ingest":true,"unread":true,"budget":true,"weekly":true}';
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'haraguri-weekly-digest') then
    perform cron.schedule('haraguri-weekly-digest', '0 23 * * 0', $job$select public.hg_notify_push('{"kind":"weekly"}'::jsonb)$job$);
  end if;
end $$;

do $$ declare t text; begin
  foreach t in array array['hg_category_rules','hg_settlements','hg_envelopes','hg_envelope_entries'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
commit;
