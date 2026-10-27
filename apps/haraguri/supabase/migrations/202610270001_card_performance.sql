begin;
alter table public.hg_cards
  add column owner_user_id uuid,
  add column performance_thresholds bigint[] not null default '{}',
  add column benefit_basis text not null default 'previous_month' check (benefit_basis in ('previous_month','current_month')),
  add column excluded_categories text[] not null default '{}',
  add column benefit_note text not null default '' check (length(benefit_note) <= 2000),
  add constraint hg_card_owner_member foreign key (family_id,owner_user_id) references public.hg_members(family_id,user_id),
  add constraint hg_card_threshold_bounds check (cardinality(performance_thresholds) <= 5 and 0 < all(performance_thresholds) and 1000000000 >= all(performance_thresholds) and array_position(performance_thresholds,null) is null),
  add constraint hg_card_exclusions_bounds check (cardinality(excluded_categories) <= 30);
alter table public.hg_expenses
  add column qualifying_amount bigint,
  add column performance_month date,
  add constraint hg_expense_qualifying_bounds check (
    qualifying_amount is null or
    (amount > 0 and qualifying_amount between 0 and amount) or
    (amount < 0 and qualifying_amount between amount and 0)
  ),
  add constraint hg_expense_performance_month check (performance_month is null or extract(day from performance_month) = 1);

grant update (name,holder,budget,credit_limit,owner_user_id,performance_thresholds,benefit_basis,excluded_categories,benefit_note) on public.hg_cards to authenticated;
create policy family_card_update on public.hg_cards for update to authenticated
  using (public.hg_is_member(family_id)) with check (public.hg_is_member(family_id));
grant update (card_id,title,amount,date,category,qualifying_amount,performance_month) on public.hg_expenses to authenticated;
create policy own_expense_update on public.hg_expenses for update to authenticated
  using (public.hg_is_member(family_id) and created_by = auth.uid())
  with check (public.hg_is_member(family_id) and created_by = auth.uid());
commit;
