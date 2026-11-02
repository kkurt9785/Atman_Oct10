begin;
-- Exposes only the caller's code state; collection secrets stay server-side.
create function public.hg_shortcut_pairing_status(pair_code text)
returns text language plpgsql security definer set search_path = '' as $$
declare pairing public.hg_shortcut_pairings%rowtype;
begin
  if auth.uid() is null or pair_code is null or pair_code !~ '^[0-9a-f]{48}$' then return 'missing'; end if;
  select p.* into pairing from public.hg_shortcut_pairings p
    where p.code_hash = encode(extensions.digest(pair_code, 'sha256'), 'hex')
      and p.user_id = auth.uid() and public.hg_is_member(p.family_id);
  if not found then return 'missing'; end if;
  if pairing.claimed_at is not null then return 'claimed'; end if;
  if pairing.expires_at <= now() then return 'expired'; end if;
  return 'pending';
end;
$$;
revoke all on function public.hg_shortcut_pairing_status(text) from public, anon;
grant execute on function public.hg_shortcut_pairing_status(text) to authenticated;
commit;
