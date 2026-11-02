begin;
alter table public.hg_expenses drop constraint hg_expenses_kind_check;
alter table public.hg_expenses add constraint hg_expenses_kind_check check (kind in ('expense','income','transfer'));
alter table public.hg_expenses add constraint hg_internal_transfer_check check (
  kind <> 'transfer' or (amount > 0 and payment_method = 'bank_transfer' and card_id is null)
);
comment on column public.hg_expenses.kind is 'expense: consumption/refund; income: external income; transfer: movement between own accounts, excluded from consumption/income/budget/performance/settlement';
commit;
