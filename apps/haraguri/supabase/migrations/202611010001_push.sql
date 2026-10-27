begin;
-- Web Push: each signed-in device may register one subscription. Delivery runs in the `push` Edge Function,
-- called asynchronously through pg_net from triggers (new messages/files) and a daily pg_cron reminder.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create table public.hg_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '' check (length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
alter table public.hg_push_subscriptions enable row level security;
revoke all on public.hg_push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.hg_push_subscriptions to authenticated;
create policy push_own on public.hg_push_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create index hg_push_user on public.hg_push_subscriptions(user_id);

-- The function URL and shared secret live in Vault (set once from the dashboard/SQL, never in migrations).
create function public.hg_notify_push(payload jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare target text; secret text;
begin
  select decrypted_secret into target from vault.decrypted_secrets where name = 'haraguri_push_url' limit 1;
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'haraguri_push_secret' limit 1;
  if target is null or secret is null then return; end if;
  perform net.http_post(
    url := target,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-haraguri-secret', secret),
    body := payload,
    timeout_milliseconds := 8000
  );
exception when others then
  -- Notifications are best-effort; never fail the write that triggered them.
  raise warning 'hg_notify_push skipped: %', sqlerrm;
end $$;
revoke all on function public.hg_notify_push(jsonb) from public;

create function public.hg_push_on_comment() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.hg_notify_push(jsonb_build_object('kind', 'comment', 'comment_id', new.id, 'family_id', new.family_id, 'entry_id', new.entry_id, 'occurrence', new.occurrence, 'author_id', new.created_by, 'body', left(new.body, 140)));
  return new;
end $$;
revoke all on function public.hg_push_on_comment() from public;
create trigger hg_comment_push after insert on public.hg_comments for each row execute function public.hg_push_on_comment();

create function public.hg_push_on_attachment() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.hg_notify_push(jsonb_build_object('kind', 'file', 'attachment_id', new.id, 'family_id', new.family_id, 'entry_id', new.entry_id, 'occurrence', new.occurrence, 'author_id', new.created_by, 'name', new.name));
  return new;
end $$;
revoke all on function public.hg_push_on_attachment() from public;
create trigger hg_attachment_push after insert on public.hg_attachments for each row execute function public.hg_push_on_attachment();

-- 08:00 KST every day = 23:00 UTC the day before.
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'haraguri-daily-reminder') then
    perform cron.schedule('haraguri-daily-reminder', '0 23 * * *', $job$select public.hg_notify_push('{"kind":"daily"}'::jsonb)$job$);
  end if;
end $$;
commit;
