begin;
-- Tables in the realtime publication need a replica identity for UPDATE/DELETE; these two key on expression indexes, not a primary key.
-- Without this, hg_mark_read (insert … on conflict do update) and unpinning failed with "does not have a replica identity and publishes updates".
alter table public.hg_room_reads replica identity full;
alter table public.hg_pins replica identity full;
commit;
