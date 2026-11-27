begin;

alter table public.budgets
  add column reset_period text not null default 'monthly'
    check (reset_period in ('weekly', 'monthly', 'yearly', 'once')),
  add column starts_on date,
  add constraint one_time_budget_start check (reset_period <> 'once' or starts_on is not null);
grant insert (reset_period, starts_on), update (reset_period, starts_on) on public.budgets to authenticated;

alter table public.savings_goals
  add column fund_cadence text check (fund_cadence in ('weekly', 'monthly')),
  add column fund_amount_minor bigint check (fund_amount_minor between 1 and 99999999999),
  add column fund_starts_on date check (fund_starts_on between date '1900-01-01' and date '9999-01-01'),
  add column fund_next_due date,
  add column fund_active boolean not null default true,
  add constraint bill_fund_schedule check (
    (fund_cadence is null and fund_amount_minor is null and fund_starts_on is null and fund_next_due is null)
    or (fund_cadence is not null and fund_amount_minor is not null and fund_starts_on is not null and fund_next_due is not null)
  );
grant insert (fund_cadence, fund_amount_minor, fund_starts_on, fund_active),
  update (fund_cadence, fund_amount_minor, fund_starts_on, fund_active) on public.savings_goals to authenticated;

create function oopsie_private.set_fund_due()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  today date := timezone('Europe/Berlin', now())::date;
begin
  if new.fund_cadence is null then return new; end if;
  if TG_OP = 'INSERT' or old.fund_cadence is distinct from new.fund_cadence
    or old.fund_starts_on is distinct from new.fund_starts_on or (new.fund_active and not old.fund_active) then
    if TG_OP = 'UPDATE' and exists (select 1 from public.goal_allocations
      where goal_id = new.id and user_id = new.user_id and allocated_on = today and amount_minor > 0) then
      today := today + 1;
    end if;
    new.fund_next_due := oopsie_private.first_due(new.fund_starts_on, new.fund_cadence, today);
  end if;
  return new;
end;
$$;
revoke all on function oopsie_private.set_fund_due() from public, anon, authenticated;
create trigger set_fund_due before insert or update of fund_cadence, fund_starts_on, fund_active
  on public.savings_goals for each row execute function oopsie_private.set_fund_due();

alter table public.goal_allocations drop constraint goal_allocations_amount_minor_check,
  add column ledger_entry_id uuid,
  add constraint goal_allocation_ledger_owner foreign key (ledger_entry_id, user_id)
    references public.ledger_entries(id, user_id) on delete cascade,
  add constraint goal_allocation_amount check (
    (ledger_entry_id is null and amount_minor between 1 and 99999999999)
    or (ledger_entry_id is not null and amount_minor between -99999999999 and -1)
  );
create index goal_allocation_by_entry on public.goal_allocations(ledger_entry_id, user_id)
  where ledger_entry_id is not null;

create function oopsie_private.post_due_bill_funds(owner uuid, today date)
returns void language plpgsql set search_path = '' as $$
declare
  fund public.savings_goals%rowtype;
  start_on date;
  week_day integer;
  month_day integer;
  available numeric;
  room numeric;
  contribution bigint;
begin
  select case when raw_user_meta_data->>'week_start_day' ~ '^[1-7]$'
    then (raw_user_meta_data->>'week_start_day')::integer else 1 end into week_day
    from auth.users where id = owner;
  select "monthStartDay" into month_day from public.ledger_preferences where user_id = owner;
  month_day := coalesce(month_day, 1);
  for fund in select * from public.savings_goals
    where user_id = owner and fund_active and fund_next_due <= today
    order by case priority when 'high' then 1 when 'normal' then 2 else 3 end, fund_next_due, id
    for no key update
  loop
    if fund.fund_cadence = 'weekly' then
      start_on := today - ((extract(isodow from today)::integer - week_day + 7) % 7);
    else
      start_on := date_trunc('month', today::timestamp)::date;
      if today < least(start_on + month_day - 1, (start_on + interval '1 month - 1 day')::date) then
        start_on := (start_on - interval '1 month')::date;
      end if;
      start_on := least(start_on + month_day - 1, (start_on + interval '1 month - 1 day')::date);
    end if;
    select fund.amount_minor - fund.saved_minor - coalesce(sum(amount_minor),0) into room
      from public.goal_allocations where user_id = owner and goal_id = fund.id;
    contribution := least(fund.fund_amount_minor, greatest(room, 0));
    if contribution > 0 then
      select coalesce(sum("amountMinor"), 0) into available from public.ledger_entries
        where user_id = owner and date between start_on and today;
      available := available - coalesce((select sum(amount_minor) from public.goal_allocations
        where user_id = owner and allocated_on between start_on and today), 0);
      if available < contribution then continue; end if;
      insert into public.goal_allocations (user_id, request_id, goal_id, allocated_on, amount_minor)
        values (owner, gen_random_uuid(), fund.id, today, contribution);
    end if;
    update public.savings_goals
      set fund_next_due = oopsie_private.first_due(fund.fund_starts_on, fund.fund_cadence, today + 1)
      where id = fund.id;
  end loop;
end;
$$;
revoke all on function oopsie_private.post_due_bill_funds(uuid,date) from public, anon, authenticated;

create function public.sync_my_ledger_schedules()
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := auth.uid();
  today date := timezone('Europe/Berlin', now())::date;
begin
  if owner is null then raise insufficient_privilege; end if;
  perform id from auth.users where id = owner for no key update;
  perform id from public.subscriptions where user_id = owner and active and next_due <= today order by id for update;
  perform oopsie_private.post_due_subscriptions(owner, today);
  perform public.sync_my_recurring_income();
  perform oopsie_private.post_due_bill_funds(owner, today);
  return true;
end;
$$;
revoke all on function public.sync_my_ledger_schedules() from public, anon, authenticated;
grant execute on function public.sync_my_ledger_schedules() to authenticated;

create function public.record_fund_bill(fund_id uuid, entry_id uuid, bill_amount bigint, description text, expense_category text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := auth.uid();
  today date := timezone('Europe/Berlin', now())::date;
  fund public.savings_goals%rowtype;
  reserved numeric;
  covered bigint;
begin
  if owner is null then raise insufficient_privilege; end if;
  if bill_amount is null or bill_amount not between 1 and 99999999999 or entry_id is null then
    raise invalid_parameter_value;
  end if;
  perform id from auth.users where id = owner for no key update;
  if exists (select 1 from public.ledger_entries where id = entry_id and user_id = owner) then
    if exists (
      select 1 from public.goal_allocations draw
      join public.ledger_entries entry on entry.id = draw.ledger_entry_id and entry.user_id = draw.user_id
      where draw.user_id = owner and draw.ledger_entry_id = entry_id and draw.goal_id = fund_id
        and entry."amountMinor" = -bill_amount and entry.name = btrim(description)
        and entry.category = btrim(expense_category)
    ) then return; end if;
    raise invalid_parameter_value;
  end if;
  select * into fund from public.savings_goals where id = fund_id and user_id = owner
    and fund_cadence is not null for no key update;
  if not found then raise invalid_parameter_value; end if;
  select fund.saved_minor + coalesce(sum(amount_minor), 0) into reserved
    from public.goal_allocations where user_id = owner and goal_id = fund_id;
  covered := least(bill_amount, greatest(reserved, 0));
  if covered <= 0 then raise invalid_parameter_value; end if;
  insert into public.ledger_entries (id, user_id, date, name, category, "amountMinor")
    values (entry_id, owner, today, btrim(description), btrim(expense_category), -bill_amount);
  insert into public.goal_allocations (user_id, request_id, goal_id, allocated_on, amount_minor, ledger_entry_id)
    values (owner, entry_id, fund.id, today, -covered, entry_id);
  if fund.fund_next_due <= today then
    update public.savings_goals
      set fund_next_due = oopsie_private.first_due(fund.fund_starts_on, fund.fund_cadence, today + 1)
      where id = fund.id;
  end if;
end;
$$;
revoke all on function public.record_fund_bill(uuid,uuid,bigint,text,text) from public, anon, authenticated;
grant execute on function public.record_fund_bill(uuid,uuid,bigint,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
