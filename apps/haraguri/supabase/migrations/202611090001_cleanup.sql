begin;
-- Cleanup round: once-a-month card performance override, family settings (settlement on/off), fewer push kinds.

-- "카드사 실적 보정": the number the card app shows for a month, as of a date; records after that date are added on top.
alter table public.hg_cards
  add column if not exists perf_override_month date check (perf_override_month is null or perf_override_month = date_trunc('month', perf_override_month)::date),
  add column if not exists perf_override_amount bigint check (perf_override_amount is null or perf_override_amount between 0 and 100000000000),
  add column if not exists perf_override_date date;
grant update (perf_override_month, perf_override_amount, perf_override_date) on public.hg_cards to authenticated;

-- Per-family switches (settlement is opt-in). Owner-only update via the existing rename policy.
alter table public.hg_families add column if not exists settings jsonb not null default '{}'::jsonb;
grant update (settings) on public.hg_families to authenticated;

-- Push kinds shrink to five: messages (files follow it), morning briefing, unread, budget, weekly. Evening preview and ingest pushes are off by default.
alter table public.hg_push_subscriptions alter column prefs set default '{"messages":true,"daily":true,"unread":true,"budget":true,"weekly":true}';
do $$ begin
  if exists (select 1 from cron.job where jobname = 'haraguri-eve-reminder') then perform cron.unschedule('haraguri-eve-reminder'); end if;
end $$;
commit;
