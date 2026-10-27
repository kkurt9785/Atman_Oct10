-- Apply to the chosen Supabase project only. Not part of the existing itdat migration chain.
begin;
create table public.hg_families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.hg_members (
  family_id uuid not null references public.hg_families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 40),
  primary key (family_id, user_id),
  unique (user_id)
);
create table public.hg_invites (
  family_id uuid primary key references public.hg_families(id) on delete cascade,
  code uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null default now() + interval '7 days'
);
create table public.hg_entries (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.hg_families(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  body text not null default '' check (length(body) <= 5000),
  date date not null,
  kind text not null check (kind in ('task','event')),
  repeat text not null default 'none' check (repeat in ('none','monthly','yearly')),
  assignee uuid,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, family_id),
  foreign key (family_id, assignee) references public.hg_members(family_id, user_id)
);
create table public.hg_receipts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.hg_families(id) on delete cascade,
  entry_id uuid not null,
  occurrence date not null,
  user_id uuid not null default auth.uid() references auth.users(id),
  state text not null check (state in ('seen','done')),
  unique (entry_id, occurrence, user_id, state),
  foreign key (entry_id, family_id) references public.hg_entries(id, family_id) on delete cascade
);
create table public.hg_cards (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.hg_families(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  holder text not null default '' check (length(holder) <= 40),
  budget bigint not null default 0 check (budget between 0 and 1000000000),
  credit_limit bigint not null default 0 check (credit_limit between 0 and 1000000000),
  unique (id, family_id)
);
create table public.hg_expenses (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.hg_families(id) on delete cascade,
  card_id uuid,
  title text not null check (length(title) between 1 and 200),
  amount bigint not null check (amount between -1000000000 and 1000000000 and amount <> 0),
  date date not null,
  category text not null default '기타' check (length(category) <= 40),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (card_id, family_id) references public.hg_cards(id, family_id)
);
create table public.hg_comments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.hg_families(id) on delete cascade,
  entry_id uuid not null,
  occurrence date not null,
  body text not null check (length(body) between 1 and 5000),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (entry_id, family_id) references public.hg_entries(id, family_id) on delete cascade
);
create table public.hg_attachments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.hg_families(id) on delete cascade,
  entry_id uuid not null,
  occurrence date not null,
  path text not null unique,
  name text not null check (length(name) between 1 and 255),
  created_by uuid not null default auth.uid() references auth.users(id),
  foreign key (entry_id, family_id) references public.hg_entries(id, family_id) on delete cascade,
  check (split_part(path, '/', 1) = family_id::text and split_part(path, '/', 2) = created_by::text)
);

create function public.hg_guard_entry_delete() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.hg_attachments where entry_id = old.id) then
    raise exception '첨부파일이 있는 일정의 삭제는 아직 지원하지 않습니다';
  end if;
  return old;
end $$;
revoke all on function public.hg_guard_entry_delete() from public;
create trigger hg_entry_delete_guard before delete on public.hg_entries for each row execute function public.hg_guard_entry_delete();

create function public.hg_is_member(target uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.hg_members where family_id = target and user_id = auth.uid());
$$;
revoke all on function public.hg_is_member(uuid) from public;
grant execute on function public.hg_is_member(uuid) to authenticated;

alter table public.hg_families enable row level security;
alter table public.hg_members enable row level security;
alter table public.hg_invites enable row level security;
create policy family_read on public.hg_families for select to authenticated using (public.hg_is_member(id));
create policy member_read on public.hg_members for select to authenticated using (public.hg_is_member(family_id));
-- Membership and invitations can only be changed through the narrowly scoped RPCs below.
revoke all on public.hg_families, public.hg_members, public.hg_invites from anon, authenticated;
grant select on public.hg_families, public.hg_members to authenticated;

do $$ declare t text; begin
  foreach t in array array['hg_entries','hg_receipts','hg_cards','hg_expenses','hg_comments','hg_attachments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, delete on public.%I to authenticated', t);
    execute format('create policy family_read on public.%I for select to authenticated using (public.hg_is_member(family_id))', t);
    execute format('create index on public.%I (family_id)', t);
  end loop;
  foreach t in array array['hg_entries','hg_expenses','hg_comments','hg_attachments'] loop
    execute format('create policy own_insert on public.%I for insert to authenticated with check (public.hg_is_member(family_id) and created_by = auth.uid())', t);
    execute format('create policy own_delete on public.%I for delete to authenticated using (public.hg_is_member(family_id) and created_by = auth.uid())', t);
  end loop;
end $$;
create policy receipt_insert on public.hg_receipts for insert to authenticated with check (public.hg_is_member(family_id) and user_id = auth.uid());
create policy receipt_delete on public.hg_receipts for delete to authenticated using (public.hg_is_member(family_id) and user_id = auth.uid());
create policy card_insert on public.hg_cards for insert to authenticated with check (public.hg_is_member(family_id));
-- Cards are shared metadata; updates/deletion intentionally omitted in this first version.

create function public.hg_create_family(family_name text, member_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare fid uuid;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if exists(select 1 from public.hg_members where user_id = auth.uid()) then raise exception '이미 가족 공간에 참여하고 있습니다'; end if;
  insert into public.hg_families(name,owner_id) values(trim(family_name),auth.uid()) returning id into fid;
  insert into public.hg_members values(fid,auth.uid(),trim(member_name));
  return fid;
end $$;
create function public.hg_invite(family uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare token uuid;
begin
  if not exists(select 1 from public.hg_families where id = family and owner_id = auth.uid()) then raise exception '가족 공간 소유자만 초대할 수 있습니다'; end if;
  insert into public.hg_invites(family_id) values(family)
  on conflict(family_id) do update set code = gen_random_uuid(), expires_at = now() + interval '7 days'
  returning code into token;
  return token;
end $$;
create function public.hg_join_family(invite_code uuid, member_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare fid uuid;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if exists(select 1 from public.hg_members where user_id = auth.uid()) then raise exception '이미 가족 공간에 참여하고 있습니다'; end if;
  select family_id into fid from public.hg_invites where code = invite_code and expires_at > now();
  if fid is null then raise exception '초대 코드가 올바르지 않거나 만료되었습니다'; end if;
  insert into public.hg_members values(fid, auth.uid(), trim(member_name));
  return fid;
end $$;
revoke all on function public.hg_create_family(text,text), public.hg_invite(uuid), public.hg_join_family(uuid,text) from public;
grant execute on function public.hg_create_family(text,text), public.hg_invite(uuid), public.hg_join_family(uuid,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('haraguri-files','haraguri-files',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
create policy hg_file_read on storage.objects for select to authenticated using (
  bucket_id = 'haraguri-files' and exists(select 1 from public.hg_members where user_id = auth.uid() and family_id::text = (storage.foldername(name))[1])
);
create policy hg_file_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'haraguri-files' and (storage.foldername(name))[2] = auth.uid()::text
  and exists(select 1 from public.hg_members where user_id = auth.uid() and family_id::text = (storage.foldername(name))[1])
);
create policy hg_file_delete on storage.objects for delete to authenticated using (
  bucket_id = 'haraguri-files' and (storage.foldername(name))[2] = auth.uid()::text
  and exists(select 1 from public.hg_members where user_id = auth.uid() and family_id::text = (storage.foldername(name))[1])
);
commit;
