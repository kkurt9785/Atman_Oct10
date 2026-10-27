begin;
-- A room (entry + occurrence) can be closed once the work is done: writes stop and its files are removed. Text stays.
create table public.hg_rooms (
  family_id uuid not null references public.hg_families(id) on delete cascade,
  entry_id uuid not null,
  occurrence date not null,
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  purged_at timestamptz,
  purged_files integer not null default 0 check (purged_files >= 0),
  purged_bytes bigint not null default 0 check (purged_bytes >= 0),
  primary key (entry_id, occurrence),
  foreign key (entry_id, family_id) references public.hg_entries(id, family_id) on delete cascade
);
alter table public.hg_rooms enable row level security;
revoke all on public.hg_rooms from anon, authenticated;
grant select, insert, update on public.hg_rooms to authenticated;
create policy room_read on public.hg_rooms for select to authenticated using (public.hg_is_member(family_id));
create policy room_insert on public.hg_rooms for insert to authenticated with check (public.hg_is_member(family_id));
create policy room_update on public.hg_rooms for update to authenticated using (public.hg_is_member(family_id)) with check (public.hg_is_member(family_id));
create index hg_rooms_family on public.hg_rooms(family_id, closed_at);

create function public.hg_room_is_closed(entry uuid, occ date) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.hg_rooms where entry_id = entry and occurrence = occ and closed_at is not null);
$$;
revoke all on function public.hg_room_is_closed(uuid, date) from public;
grant execute on function public.hg_room_is_closed(uuid, date) to authenticated;

create function public.hg_guard_closed_room() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.entry_id is not null and public.hg_room_is_closed(new.entry_id, new.occurrence) then
    raise exception '종료된 대화예요. 다시 열면 이어서 쓸 수 있어요';
  end if;
  return new;
end $$;
revoke all on function public.hg_guard_closed_room() from public;
create trigger hg_comment_closed_room before insert on public.hg_comments for each row execute function public.hg_guard_closed_room();
create trigger hg_attachment_closed_room before insert on public.hg_attachments for each row execute function public.hg_guard_closed_room();

-- Cleanup on close removes every member's files in that room, so deletion is family-wide (uploads stay owner-only).
drop policy own_delete on public.hg_attachments;
create policy family_delete on public.hg_attachments for delete to authenticated using (public.hg_is_member(family_id));
drop policy hg_file_delete on storage.objects;
create policy hg_file_delete on storage.objects for delete to authenticated using (
  bucket_id = 'haraguri-files' and exists(select 1 from public.hg_members where user_id = auth.uid() and family_id::text = (storage.foldername(name))[1])
);

alter publication supabase_realtime add table public.hg_rooms;
commit;
