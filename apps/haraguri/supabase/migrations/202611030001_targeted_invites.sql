begin;
-- Invite by who they are, not by code: the owner writes the family member's Kakao nickname or email;
-- when that person signs in, hg_my_invites() surfaces the pending invitation and hg_accept_invite() joins them.
create table public.hg_invite_targets (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.hg_families(id) on delete cascade,
  target text not null check (length(target) between 1 and 120),
  invited_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  unique (family_id, target)
);
alter table public.hg_invite_targets enable row level security;
revoke all on public.hg_invite_targets from anon, authenticated;
grant select, insert, delete on public.hg_invite_targets to authenticated;
create policy invite_target_read on public.hg_invite_targets for select to authenticated using (public.hg_is_member(family_id));
create policy invite_target_insert on public.hg_invite_targets for insert to authenticated with check (public.hg_is_member(family_id) and invited_by = auth.uid());
create policy invite_target_delete on public.hg_invite_targets for delete to authenticated using (public.hg_is_member(family_id));
create index hg_invite_targets_target on public.hg_invite_targets(lower(target));

-- The identities a signed-in user can be matched by: email plus the display names Kakao/email providers put in user metadata.
create function public.hg_my_identities() returns text[] language sql stable security definer set search_path = '' as $$
  select array_remove(array[
    lower(u.email),
    lower(u.raw_user_meta_data->>'name'), lower(u.raw_user_meta_data->>'full_name'), lower(u.raw_user_meta_data->>'nickname'),
    lower(u.raw_user_meta_data->>'preferred_username'), lower(u.raw_user_meta_data->>'user_name')
  ], null) from auth.users u where u.id = auth.uid();
$$;
revoke all on function public.hg_my_identities() from public;

create function public.hg_my_invites() returns table(family_id uuid, family_name text, invited_by_name text, matched text) language sql stable security definer set search_path = '' as $$
  select t.family_id, f.name, coalesce(m.display_name, '가족'), t.target
  from public.hg_invite_targets t
  join public.hg_families f on f.id = t.family_id
  left join public.hg_members m on m.family_id = t.family_id and m.user_id = t.invited_by
  where t.expires_at > now()
    and lower(t.target) = any(public.hg_my_identities())
    and not exists (select 1 from public.hg_members x where x.family_id = t.family_id and x.user_id = auth.uid());
$$;
create function public.hg_accept_invite(family uuid, member_name text) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if not exists (select 1 from public.hg_invite_targets t where t.family_id = family and t.expires_at > now() and lower(t.target) = any(public.hg_my_identities())) then
    raise exception '이 모임의 초대를 찾을 수 없어요. 초대한 분께 닉네임·이메일을 확인해 달라고 해 주세요';
  end if;
  if exists (select 1 from public.hg_members where family_id = family and user_id = auth.uid()) then raise exception '이미 참여한 모임입니다'; end if;
  insert into public.hg_members values (family, auth.uid(), left(trim(member_name), 40));
  delete from public.hg_invite_targets t where t.family_id = family and lower(t.target) = any(public.hg_my_identities());
  return family;
end $$;
revoke all on function public.hg_my_invites(), public.hg_accept_invite(uuid, text) from public;
grant execute on function public.hg_my_invites(), public.hg_accept_invite(uuid, text) to authenticated;
commit;
