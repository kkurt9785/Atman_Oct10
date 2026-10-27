begin;
-- Attachments record their byte size so a family can see how much shared storage it uses.
alter table public.hg_attachments add column size bigint not null default 0 check (size between 0 and 10485760);
update public.hg_attachments a set size = coalesce((o.metadata->>'size')::bigint, 0)
  from storage.objects o where o.bucket_id = 'haraguri-files' and o.name = a.path;
create index hg_attachments_room on public.hg_attachments(family_id, entry_id, occurrence, created_at);

create function public.hg_storage_usage(family uuid) returns table(files bigint, bytes bigint) language sql stable set search_path = '' as $$
  select count(*), coalesce(sum(size), 0) from public.hg_attachments where family_id = family and public.hg_is_member(family);
$$;
revoke all on function public.hg_storage_usage(uuid) from public;
grant execute on function public.hg_storage_usage(uuid) to authenticated;

-- Any member may correct a shared work item. Date and repeat stay fixed once records depend on the occurrence.
grant update (title, body, date, kind, repeat, assignee) on public.hg_entries to authenticated;
create function public.hg_guard_entry_reschedule() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.date <> old.date or new.repeat <> old.repeat) and (
    exists(select 1 from public.hg_receipts where entry_id = old.id) or
    exists(select 1 from public.hg_comments where entry_id = old.id or shared_entry_id = old.id) or
    exists(select 1 from public.hg_attachments where entry_id = old.id) or
    exists(select 1 from public.hg_expenses where entry_id = old.id)) then
    raise exception '확인·대화·사진·지출 기록이 있는 일정은 날짜와 반복을 바꿀 수 없어요';
  end if;
  return new;
end $$;
revoke all on function public.hg_guard_entry_reschedule() from public;
create trigger hg_entry_reschedule_guard before update on public.hg_entries for each row execute function public.hg_guard_entry_reschedule();
commit;
