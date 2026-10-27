begin;
-- Ledger round 1: income rows, a monthly family budget (total + per category), and a one-time push at 80% / 100%.

alter table public.hg_expenses add column if not exists kind text not null default 'expense' check (kind in ('expense','income'));

-- The budget for a month carries forward until a later month sets a new one.
create table public.hg_budgets (
  family_id uuid not null references public.hg_families(id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),
  total bigint not null default 0 check (total between 0 and 100000000000),
  by_category jsonb not null default '{}'::jsonb,
  updated_by uuid default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (family_id, month)
);
alter table public.hg_budgets enable row level security;
revoke all on public.hg_budgets from anon, authenticated;
grant select, insert, update, delete on public.hg_budgets to authenticated;
create policy budgets_read on public.hg_budgets for select to authenticated using (public.hg_is_member(family_id));
create policy budgets_insert on public.hg_budgets for insert to authenticated with check (public.hg_is_member(family_id));
create policy budgets_update on public.hg_budgets for update to authenticated using (public.hg_is_member(family_id)) with check (public.hg_is_member(family_id));
create policy budgets_delete on public.hg_budgets for delete to authenticated using (public.hg_is_member(family_id));

-- Alert bookkeeping: one push per family, month and level. Not visible to clients.
create table public.hg_budget_alerts (
  family_id uuid not null references public.hg_families(id) on delete cascade,
  month date not null,
  level smallint not null check (level in (80, 100)),
  sent_at timestamptz not null default now(),
  primary key (family_id, month, level)
);
alter table public.hg_budget_alerts enable row level security;
revoke all on public.hg_budget_alerts from anon, authenticated;

create function public.hg_budget_alert() returns trigger language plpgsql security definer set search_path = '' as $$
declare m date; b record; spent bigint; lvl smallint;
begin
  if new.kind <> 'expense' then return new; end if;
  m := date_trunc('month', new.date)::date;
  select total into b from public.hg_budgets where family_id = new.family_id and month <= m order by month desc limit 1;
  if b is null or b.total <= 0 then return new; end if;
  select coalesce(sum(amount), 0) into spent from public.hg_expenses where family_id = new.family_id and kind = 'expense' and date >= m and date < (m + interval '1 month')::date;
  lvl := case when spent >= b.total then 100 when spent * 5 >= b.total * 4 then 80 else null end;
  if lvl is null then return new; end if;
  insert into public.hg_budget_alerts (family_id, month, level) values (new.family_id, m, lvl) on conflict do nothing;
  if found then
    perform public.hg_notify_push(jsonb_build_object('kind', 'budget', 'family_id', new.family_id, 'level', lvl, 'spent', spent, 'budget', b.total, 'month', to_char(m, 'YYYY-MM')));
  end if;
  return new;
end $$;
revoke all on function public.hg_budget_alert() from public;
create trigger hg_expense_budget_alert after insert or update of amount, date, kind on public.hg_expenses for each row execute function public.hg_budget_alert();

alter table public.hg_push_subscriptions alter column prefs set default '{"messages":true,"files":true,"daily":true,"eve":true,"ingest":true,"unread":true,"budget":true}';

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hg_budgets') then
    alter publication supabase_realtime add table public.hg_budgets;
  end if;
end $$;
commit;
