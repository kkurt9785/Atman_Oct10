begin;

-- Only the hash of a five-minute, one-use pairing code is stored. Issuing a code
-- keeps the member's existing ingest token, including any working SMS setup.
create table public.hg_shortcut_pairings (
  code_hash text primary key check (length(code_hash) = 64),
  ingest_token text not null references public.hg_ingest_tokens(token) on delete cascade,
  family_id uuid not null references public.hg_families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz
);
alter table public.hg_shortcut_pairings enable row level security;
revoke all on public.hg_shortcut_pairings from anon, authenticated;
grant select, insert, update, delete on public.hg_shortcut_pairings to service_role;
create index hg_shortcut_pairings_member on public.hg_shortcut_pairings(user_id, family_id);

create function public.hg_create_shortcut_pairing(family uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  member_id uuid := auth.uid();
  collect_token text;
  pair_code text := encode(extensions.gen_random_bytes(24), 'hex');
  deadline timestamptz := now() + interval '5 minutes';
begin
  if member_id is null or not public.hg_is_member(family) then
    raise exception 'Family membership required' using errcode = '42501';
  end if;
  insert into public.hg_ingest_tokens(family_id, user_id) values(family, member_id)
    on conflict (family_id, user_id) do nothing;
  select t.token into strict collect_token from public.hg_ingest_tokens t
    where t.family_id = family and t.user_id = member_id;
  delete from public.hg_shortcut_pairings p where p.user_id = member_id and p.family_id = family;
  insert into public.hg_shortcut_pairings(code_hash, ingest_token, family_id, user_id, expires_at)
    values(encode(extensions.digest(pair_code, 'sha256'), 'hex'), collect_token, family, member_id, deadline);
  return jsonb_build_object('code', pair_code, 'expires_at', deadline);
end;
$$;
revoke all on function public.hg_create_shortcut_pairing(uuid) from public, anon;
grant execute on function public.hg_create_shortcut_pairing(uuid) to authenticated;

-- Claiming is atomic: retries and concurrent requests cannot reuse a code.
create function public.hg_claim_shortcut_pairing(pair_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pairing public.hg_shortcut_pairings%rowtype;
begin
  if pair_code is null or pair_code !~ '^[0-9a-f]{48}$' then return null; end if;
  update public.hg_shortcut_pairings p set claimed_at = now()
    where p.code_hash = encode(extensions.digest(pair_code, 'sha256'), 'hex')
      and p.claimed_at is null and p.expires_at > now()
      and exists(select 1 from public.hg_members m where m.family_id = p.family_id and m.user_id = p.user_id)
    returning p.* into pairing;
  if not found then return null; end if;
  insert into public.hg_inbox(family_id, user_id, via, app, raw, status, summary)
    values(pairing.family_id, pairing.user_id, 'ios-shortcut-pairing', '', '', 'ignored', '계정 연결 정보 전달 · 실제 알림 수신 대기');
  return jsonb_build_object('token', pairing.ingest_token);
end;
$$;
revoke all on function public.hg_claim_shortcut_pairing(text) from public, anon, authenticated;
grant execute on function public.hg_claim_shortcut_pairing(text) to service_role;

commit;
