begin;

alter table public.budgets add column priority text not null default 'normal'
  check (priority in ('low', 'normal', 'high'));
alter table public.savings_goals add column priority text not null default 'normal'
  check (priority in ('low', 'normal', 'high'));
grant insert (priority), update (priority) on public.budgets, public.savings_goals to authenticated;
alter table public.savings_goals add constraint savings_goal_owner_unique unique (id, user_id);

create table public.goal_allocations (
  user_id uuid not null,
  request_id uuid not null,
  goal_id uuid not null,
  allocated_on date not null,
  amount_minor bigint not null check (amount_minor between 1 and 99999999999),
  primary key (user_id, request_id, goal_id),
  foreign key (goal_id, user_id) references public.savings_goals(id, user_id) on delete cascade
);
create index goal_allocations_by_date on public.goal_allocations (user_id, allocated_on, request_id, goal_id);
create index goal_allocations_by_goal on public.goal_allocations (goal_id, user_id);
alter table public.goal_allocations enable row level security;
revoke all on public.goal_allocations from public, anon, authenticated;
grant select on public.goal_allocations to authenticated;
create policy read_own_goal_allocations on public.goal_allocations for select to authenticated
  using ((select auth.uid()) = user_id);

create function public.allocate_to_goals(allocation_id uuid, period text, contributions jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := auth.uid();
  today date := timezone('Europe/Berlin', now())::date;
  start_on date;
  start_day integer;
  balance numeric;
  requested numeric;
  metadata jsonb;
begin
  if owner is null then raise insufficient_privilege; end if;
  if allocation_id is null or period is null or period not in ('week', 'month', 'year')
     or jsonb_typeof(contributions) is distinct from 'array' then
    raise invalid_parameter_value;
  end if;
  if jsonb_array_length(contributions) not between 1 and 100 then raise invalid_parameter_value; end if;

  -- Serialize allocations with other allocations and account resets for this owner.
  select raw_user_meta_data into metadata from auth.users where id = owner for no key update;
  if exists (select 1 from public.goal_allocations where user_id = owner and request_id = allocation_id) then return; end if;

  if period = 'week' then
    start_day := case when metadata->>'week_start_day' ~ '^[1-7]$'
      then (metadata->>'week_start_day')::integer else 1 end;
    start_on := today - ((extract(isodow from today)::integer - start_day + 7) % 7);
  elsif period = 'month' then
    select "monthStartDay" into start_day from public.ledger_preferences where user_id = owner;
    start_day := coalesce(start_day, 1);
    start_on := date_trunc('month', today::timestamp)::date;
    if today < least(start_on + (start_day - 1), (start_on + interval '1 month - 1 day')::date) then
      start_on := (start_on - interval '1 month')::date;
    end if;
    start_on := least(start_on + (start_day - 1), (start_on + interval '1 month - 1 day')::date);
  else
    start_on := date_trunc('year', today::timestamp)::date;
  end if;

  if exists (
    select 1 from jsonb_to_recordset(contributions) as part(goal_id uuid, amount_minor bigint)
    where part.goal_id is null or part.amount_minor is null or part.amount_minor not between 1 and 99999999999
  ) or (
    select count(distinct part.goal_id) <> count(*)
    from jsonb_to_recordset(contributions) as part(goal_id uuid, amount_minor bigint)
  ) then raise invalid_parameter_value; end if;

  select sum(part.amount_minor) into requested
    from jsonb_to_recordset(contributions) as part(goal_id uuid, amount_minor bigint);
  perform id from public.savings_goals
    where user_id = owner and id in (select part.goal_id from jsonb_to_recordset(contributions) as part(goal_id uuid))
    order by id for no key update;
  if exists (
    select 1 from jsonb_to_recordset(contributions) as part(goal_id uuid, amount_minor bigint)
    left join public.savings_goals goal on goal.user_id = owner and goal.id = part.goal_id
    where goal.id is null or part.amount_minor + goal.saved_minor + coalesce((
      select sum(saved.amount_minor) from public.goal_allocations saved
      where saved.user_id = owner and saved.goal_id = goal.id
    ), 0) > goal.amount_minor
  ) then raise invalid_parameter_value; end if;

  select coalesce(sum("amountMinor"), 0) into balance from public.ledger_entries
    where user_id = owner and date between start_on and today;
  balance := balance - coalesce((select sum(amount_minor) from public.goal_allocations
    where user_id = owner and allocated_on between start_on and today), 0);
  if requested > balance then raise invalid_parameter_value; end if;

  insert into public.goal_allocations (user_id, request_id, goal_id, allocated_on, amount_minor)
    select owner, allocation_id, part.goal_id, today, part.amount_minor
    from jsonb_to_recordset(contributions) as part(goal_id uuid, amount_minor bigint);
end;
$$;
revoke all on function public.allocate_to_goals(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.allocate_to_goals(uuid, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
