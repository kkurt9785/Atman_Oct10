begin;
-- Chat round 2/3: replies, reactions, read receipts visible to the family, a pinned notice per room, voice attachments.

-- Replies: a message may quote another message of the same family.
alter table public.hg_comments add column if not exists reply_to uuid references public.hg_comments(id) on delete set null;
create function public.hg_guard_reply() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.reply_to is not null and not exists (select 1 from public.hg_comments c where c.id = new.reply_to and c.family_id = new.family_id) then
    raise exception '같은 모임의 메시지에만 답장할 수 있어요';
  end if;
  return new;
end $$;
revoke all on function public.hg_guard_reply() from public;
create trigger hg_comment_reply_guard before insert or update of reply_to on public.hg_comments for each row execute function public.hg_guard_reply();

-- Reactions: six fixed emoji, one of each per person per message.
create table public.hg_reactions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.hg_families(id) on delete cascade,
  comment_id uuid not null references public.hg_comments(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  emoji text not null check (emoji in ('❤️','👍','😂','😮','😢','🙏')),
  created_at timestamptz not null default now(),
  unique (comment_id, user_id, emoji)
);
alter table public.hg_reactions enable row level security;
revoke all on public.hg_reactions from anon, authenticated;
grant select, insert, delete on public.hg_reactions to authenticated;
create policy reactions_read on public.hg_reactions for select to authenticated using (public.hg_is_member(family_id));
create policy reactions_insert on public.hg_reactions for insert to authenticated
  with check (user_id = auth.uid() and public.hg_is_member(family_id) and exists (select 1 from public.hg_comments c where c.id = comment_id and c.family_id = hg_reactions.family_id));
create policy reactions_delete on public.hg_reactions for delete to authenticated using (user_id = auth.uid());
create index hg_reactions_comment on public.hg_reactions(comment_id);

-- Read receipts: members may see each other's last-read time per room (LINE-style "읽음").
drop policy if exists room_reads_own on public.hg_room_reads;
create policy room_reads_family on public.hg_room_reads for select to authenticated using (public.hg_is_member(family_id));

-- One pinned notice per room (general chat: entry_id/occurrence null). Any member can pin, replace or unpin.
create table public.hg_pins (
  family_id uuid not null references public.hg_families(id) on delete cascade,
  entry_id uuid references public.hg_entries(id) on delete cascade,
  occurrence date,
  comment_id uuid not null references public.hg_comments(id) on delete cascade,
  pinned_by uuid not null default auth.uid() references auth.users(id),
  pinned_at timestamptz not null default now()
);
create unique index hg_pins_room on public.hg_pins (family_id, coalesce(entry_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(occurrence, '1900-01-01'::date));
alter table public.hg_pins enable row level security;
revoke all on public.hg_pins from anon, authenticated;
grant select, delete on public.hg_pins to authenticated;
create policy pins_read on public.hg_pins for select to authenticated using (public.hg_is_member(family_id));
create policy pins_delete on public.hg_pins for delete to authenticated using (public.hg_is_member(family_id));
create function public.hg_pin_message(comment uuid) returns void language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  select family_id, entry_id, occurrence into c from public.hg_comments where id = comment;
  if c is null or not public.hg_is_member(c.family_id) then raise exception '모임 멤버만 고정할 수 있어요'; end if;
  delete from public.hg_pins p where p.family_id = c.family_id and p.entry_id is not distinct from c.entry_id and p.occurrence is not distinct from c.occurrence;
  insert into public.hg_pins (family_id, entry_id, occurrence, comment_id, pinned_by) values (c.family_id, c.entry_id, c.occurrence, comment, auth.uid());
end $$;
revoke all on function public.hg_pin_message(uuid) from public;
grant execute on function public.hg_pin_message(uuid) to authenticated;

-- Voice messages are ordinary attachments; the bucket must accept audio.
update storage.buckets set allowed_mime_types = allowed_mime_types || array['audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/x-m4a','audio/aac']
  where id = 'haraguri-files' and not ('audio/mp4' = any(allowed_mime_types));

-- Live updates for the new tables (subscribers still see only their families through RLS).
do $$ declare t text; begin
  foreach t in array array['hg_reactions','hg_pins','hg_room_reads'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
commit;
