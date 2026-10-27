begin;
-- Read state per person per room, so the app can show unread counts, badge the icon, and remind once about messages left unread.
alter table public.hg_members add column if not exists joined_at timestamptz not null default now();

create table public.hg_room_reads (
  family_id uuid not null references public.hg_families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid references public.hg_entries(id) on delete cascade,
  occurrence date,
  last_read_at timestamptz not null default now()
);
create unique index hg_room_reads_key on public.hg_room_reads (family_id, user_id, coalesce(entry_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(occurrence, '1900-01-01'::date));
alter table public.hg_room_reads enable row level security;
revoke all on public.hg_room_reads from anon, authenticated;
grant select on public.hg_room_reads to authenticated;
create policy room_reads_own on public.hg_room_reads for select to authenticated using (user_id = auth.uid());

create function public.hg_mark_read(family uuid, entry uuid default null, occ date default null) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.hg_is_member(family) then raise exception '모임 멤버만 읽음 처리할 수 있어요'; end if;
  insert into public.hg_room_reads (family_id, user_id, entry_id, occurrence, last_read_at) values (family, auth.uid(), entry, occ, now())
  on conflict (family_id, user_id, coalesce(entry_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(occurrence, '1900-01-01'::date)) do update set last_read_at = now();
end $$;

-- Unread messages/files per room for one person. Service role (no auth.uid()) may ask for anyone; a signed-in user only for themselves.
create function public.hg_unread_summary(target uuid) returns table(family_id uuid, family_name text, entry_id uuid, occurrence date, room_title text, unread int, latest_at timestamptz, latest_body text, latest_author text)
language sql stable security definer set search_path = '' as $$
  with m as (
    select family_id, joined_at as since from public.hg_members where user_id = target and (auth.uid() is null or auth.uid() = target)
  ), items as (
    select c.family_id, c.entry_id, c.occurrence, c.created_at, c.created_by, left(c.body, 80) as body
    from public.hg_comments c join m on m.family_id = c.family_id where c.created_by <> target and c.created_at > m.since
    union all
    select a.family_id, a.entry_id, a.occurrence, a.created_at, a.created_by, '📎 ' || a.name
    from public.hg_attachments a join m on m.family_id = a.family_id where a.created_by <> target and a.created_at > m.since
  ), unread as (
    select i.* from items i
    left join public.hg_room_reads r on r.user_id = target and r.family_id = i.family_id and r.entry_id is not distinct from i.entry_id and r.occurrence is not distinct from i.occurrence
    where r.last_read_at is null or i.created_at > r.last_read_at
  )
  select u.family_id, f.name, u.entry_id, u.occurrence, coalesce(e.title, '가족 기본 채팅'), count(*)::int, max(u.created_at),
    (array_agg(u.body order by u.created_at desc))[1], (array_agg(coalesce(mm.display_name, '가족') order by u.created_at desc))[1]
  from unread u
  join public.hg_families f on f.id = u.family_id
  left join public.hg_entries e on e.id = u.entry_id
  left join public.hg_members mm on mm.family_id = u.family_id and mm.user_id = u.created_by
  group by u.family_id, f.name, u.entry_id, u.occurrence, e.title
  order by max(u.created_at) desc;
$$;
revoke all on function public.hg_mark_read(uuid, uuid, date), public.hg_unread_summary(uuid) from public;
grant execute on function public.hg_mark_read(uuid, uuid, date), public.hg_unread_summary(uuid) to authenticated, service_role;

-- One reminder per batch of unread messages, at most every 6 hours; the push function keeps the bookkeeping here.
create table public.hg_unread_reminders (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reminded_at timestamptz not null default now(),
  latest_seen timestamptz not null
);
alter table public.hg_unread_reminders enable row level security;
revoke all on public.hg_unread_reminders from anon, authenticated;

alter table public.hg_push_subscriptions alter column prefs set default '{"messages":true,"files":true,"daily":true,"eve":true,"ingest":true,"unread":true}';

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'haraguri-unread-reminder') then
    perform cron.schedule('haraguri-unread-reminder', '20 * * * *', $job$select public.hg_notify_push('{"kind":"unread"}'::jsonb)$job$);
  end if;
end $$;
commit;
