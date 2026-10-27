begin;
-- family_id is the workspace boundary; a user may now belong to several spaces.
alter table public.hg_members drop constraint hg_members_user_id_key;
create index hg_members_user_spaces on public.hg_members(user_id,family_id);
create or replace function public.hg_create_family(family_name text, member_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare fid uuid;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  insert into public.hg_families(name,owner_id) values(trim(family_name),auth.uid()) returning id into fid;
  insert into public.hg_members values(fid,auth.uid(),trim(member_name));
  return fid;
end $$;
create or replace function public.hg_join_family(invite_code uuid, member_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare fid uuid;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select family_id into fid from public.hg_invites where code = invite_code and expires_at > now();
  if fid is null then raise exception '초대 코드가 올바르지 않거나 만료되었습니다'; end if;
  if exists(select 1 from public.hg_members where family_id=fid and user_id=auth.uid()) then raise exception '이미 참여한 모임입니다'; end if;
  insert into public.hg_members values(fid,auth.uid(),trim(member_name));
  return fid;
end $$;
commit;
