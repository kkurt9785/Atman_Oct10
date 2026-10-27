begin;
alter table public.hg_cards add column card_type text not null default 'credit' check (card_type in ('credit','debit'));
alter table public.hg_expenses add column payment_method text;
update public.hg_expenses set payment_method = case when card_id is null then 'other' else 'card' end;
alter table public.hg_expenses alter column payment_method set not null;
alter table public.hg_expenses add constraint hg_payment_method_check check (payment_method in ('card','bank_transfer','cash','other'));
alter table public.hg_expenses add constraint hg_payment_card_check check ((payment_method = 'card') = (card_id is not null));
-- Older clients inserting without a payment method keep their existing semantics.
create function public.hg_default_payment_method() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.payment_method is null then new.payment_method := case when new.card_id is null then 'other' else 'card' end; end if;
  return new;
end;
$$;
create trigger hg_expense_payment_method before insert on public.hg_expenses for each row execute function public.hg_default_payment_method();
revoke all on function public.hg_default_payment_method() from public;
grant update (card_type) on public.hg_cards to authenticated;
grant update (payment_method) on public.hg_expenses to authenticated;
commit;
