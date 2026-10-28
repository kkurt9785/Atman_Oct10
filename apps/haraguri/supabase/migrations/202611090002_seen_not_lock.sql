begin;
-- Opening a room now records "seen" automatically; only completions, messages, files and expenses should freeze an entry's date/repeat.
create or replace function public.hg_guard_entry_reschedule() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.date <> old.date or new.repeat <> old.repeat) and (
    exists(select 1 from public.hg_receipts where entry_id = old.id and state <> 'seen') or
    exists(select 1 from public.hg_comments where entry_id = old.id or shared_entry_id = old.id) or
    exists(select 1 from public.hg_attachments where entry_id = old.id) or
    exists(select 1 from public.hg_expenses where entry_id = old.id)) then
    raise exception '완료·대화·사진·지출 기록이 있는 일정은 날짜와 반복을 바꿀 수 없어요';
  end if;
  return new;
end $$;
commit;
