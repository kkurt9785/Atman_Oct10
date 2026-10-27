begin;
-- Each family gets a storage allowance so one busy chat cannot exhaust the shared bucket. Adjust per family from the dashboard.
alter table public.hg_families add column storage_limit bigint not null default 524288000 check (storage_limit between 0 and 1099511627776);

drop function public.hg_storage_usage(uuid);
create function public.hg_storage_usage(family uuid) returns table(files bigint, bytes bigint, limit_bytes bigint) language sql stable set search_path = '' as $$
  select count(a.id), coalesce(sum(a.size), 0), (select f.storage_limit from public.hg_families f where f.id = family)
  from public.hg_attachments a where a.family_id = family and public.hg_is_member(family);
$$;
revoke all on function public.hg_storage_usage(uuid) from public;
grant execute on function public.hg_storage_usage(uuid) to authenticated;

create function public.hg_guard_storage_quota() returns trigger language plpgsql security definer set search_path = '' as $$
declare used bigint; allowed bigint;
begin
  select coalesce(sum(size), 0) into used from public.hg_attachments where family_id = new.family_id;
  select storage_limit into allowed from public.hg_families where id = new.family_id;
  if used + new.size > allowed then
    raise exception '가족 저장공간 한도(%MB)를 넘었어요. 끝난 대화를 종료해 사진을 정리한 뒤 다시 올려 주세요', allowed / 1048576;
  end if;
  return new;
end $$;
revoke all on function public.hg_guard_storage_quota() from public;
create trigger hg_attachment_quota before insert on public.hg_attachments for each row execute function public.hg_guard_storage_quota();
commit;
