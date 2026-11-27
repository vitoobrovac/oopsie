begin;

alter table public.savings_goals
  add column fund_due_on date check (fund_due_on between date '1900-01-01' and date '9999-01-01'),
  drop constraint bill_fund_schedule,
  add constraint bill_fund_schedule check (
    (fund_cadence is null and fund_amount_minor is null and fund_due_on is null and fund_starts_on is null and fund_next_due is null)
    or (fund_cadence is not null and fund_starts_on is not null and fund_next_due is not null
      and ((fund_amount_minor is not null and fund_due_on is null)
        or (fund_amount_minor is null and fund_due_on is not null and fund_due_on >= fund_starts_on)))
  );
grant insert (fund_due_on), update (fund_due_on) on public.savings_goals to authenticated;

create function oopsie_private.bill_fund_installments(anchor date, cadence text, first_date date, deadline date)
returns integer language plpgsql immutable strict set search_path = '' as $$
declare
  last_month date := date_trunc('month', deadline::timestamp)::date;
begin
  if first_date > deadline then return 0; end if;
  if cadence = 'weekly' then return 1 + (deadline - first_date) / 7; end if;
  return (extract(year from deadline)::integer - extract(year from first_date)::integer) * 12
    + extract(month from deadline)::integer - extract(month from first_date)::integer
    + case when oopsie_private.first_due(anchor, cadence, last_month) <= deadline then 1 else 0 end;
end;
$$;
revoke all on function oopsie_private.bill_fund_installments(date,text,date,date) from public, anon, authenticated;

create or replace function oopsie_private.post_due_bill_funds(owner uuid, today date)
returns void language plpgsql set search_path = '' as $$
declare
  fund public.savings_goals%rowtype;
  start_on date;
  week_day integer;
  month_day integer;
  available numeric;
  room numeric;
  contribution bigint;
  next_due date;
begin
  select case when raw_user_meta_data->>'week_start_day' ~ '^[1-7]$'
    then (raw_user_meta_data->>'week_start_day')::integer else 1 end into week_day
    from auth.users where id = owner;
  select "monthStartDay" into month_day from public.ledger_preferences where user_id = owner;
  month_day := coalesce(month_day, 1);
  for fund in select * from public.savings_goals
    where user_id = owner and fund_active and fund_next_due <= today
      and (fund_due_on is null or fund_due_on >= today)
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
    next_due := oopsie_private.first_due(fund.fund_starts_on, fund.fund_cadence, today + 1);
    contribution := least(greatest(room, 0), coalesce(
      fund.fund_amount_minor,
      ceil(greatest(room, 0) / (1 + oopsie_private.bill_fund_installments(
        fund.fund_starts_on, fund.fund_cadence, next_due, fund.fund_due_on)))
    ));
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
      set fund_next_due = next_due
      where id = fund.id;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
