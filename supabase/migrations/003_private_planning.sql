begin;

create schema if not exists oopsie_private;
revoke all on schema oopsie_private from public, anon, authenticated;

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category text not null check (char_length(trim(category)) between 1 and 40),
  amount_minor bigint not null check (amount_minor between 1 and 99999999999)
);
create unique index budgets_user_category on public.budgets (user_id, lower(trim(category)));

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  amount_minor bigint not null check (amount_minor between 1 and 99999999999),
  saved_minor bigint not null default 0 check (saved_minor between 0 and 99999999999)
);
create index savings_goals_user on public.savings_goals (user_id);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  amount_minor bigint not null check (amount_minor between 1 and 99999999999),
  starts_on date not null check (starts_on between date '1900-01-01' and date '9999-01-01'),
  cadence text not null check (cadence in ('weekly', 'monthly')),
  active boolean not null default true,
  next_due date not null
);
create index subscriptions_user on public.subscriptions (user_id);
create index subscriptions_due on public.subscriptions (next_due) where active;

create table oopsie_private.subscription_postings (
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  due_on date not null,
  primary key (subscription_id, due_on)
);
revoke all on oopsie_private.subscription_postings from public, anon, authenticated;

alter table public.budgets enable row level security;
alter table public.savings_goals enable row level security;
alter table public.subscriptions enable row level security;
revoke all on public.budgets, public.savings_goals, public.subscriptions from public, anon, authenticated;
grant select, delete on public.budgets, public.savings_goals, public.subscriptions to authenticated;
grant insert (category, amount_minor), update (category, amount_minor) on public.budgets to authenticated;
grant insert (name, amount_minor, saved_minor), update (name, amount_minor, saved_minor) on public.savings_goals to authenticated;
grant insert (name, amount_minor, starts_on, cadence, active), update (name, amount_minor, starts_on, cadence, active) on public.subscriptions to authenticated;

create policy manage_own_budgets on public.budgets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy manage_own_goals on public.savings_goals for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy manage_own_subscriptions on public.subscriptions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create function oopsie_private.first_due(anchor date, cadence text, from_date date)
returns date language plpgsql immutable set search_path = '' as $$
declare
  month_start date;
  due date;
  anchor_day integer := extract(day from anchor)::integer;
begin
  if from_date <= anchor then return anchor; end if;
  if cadence = 'weekly' then
    return anchor + (((from_date - anchor + 6) / 7) * 7);
  end if;
  month_start := date_trunc('month', from_date::timestamp)::date;
  due := least(month_start + (anchor_day - 1), (month_start + interval '1 month - 1 day')::date);
  if due >= from_date then return due; end if;
  month_start := (month_start + interval '1 month')::date;
  return least(month_start + (anchor_day - 1), (month_start + interval '1 month - 1 day')::date);
end;
$$;

create function oopsie_private.set_subscription_due()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    new.next_due := oopsie_private.first_due(new.starts_on, new.cadence, timezone('Europe/Berlin', now())::date);
  elsif new.starts_on <> old.starts_on or new.cadence <> old.cadence or (new.active and not old.active) then
    new.next_due := oopsie_private.first_due(new.starts_on, new.cadence, timezone('Europe/Berlin', now())::date);
  end if;
  return new;
end;
$$;

create trigger set_subscription_due before insert or update of starts_on, cadence, active
  on public.subscriptions for each row execute function oopsie_private.set_subscription_due();

-- The subscription row lock and posting key protect retries and concurrent runs.
create function oopsie_private.post_due_subscriptions(owner uuid, through_date date)
returns integer language plpgsql set search_path = '' as $$
declare
  subscription public.subscriptions%rowtype;
  due date;
  posted integer := 0;
begin
  for subscription in
    select * from public.subscriptions
    where active and next_due <= through_date and (owner is null or user_id = owner)
    order by id for update skip locked
  loop
    due := subscription.next_due;
    while due <= through_date loop
      insert into oopsie_private.subscription_postings values (subscription.id, due)
        on conflict do nothing;
      if found then
        insert into public.ledger_entries (user_id, date, name, category, "amountMinor")
          values (subscription.user_id, due, subscription.name, 'Subscriptions', -subscription.amount_minor);
        posted := posted + 1;
      end if;
      due := oopsie_private.first_due(subscription.starts_on, subscription.cadence, due + 1);
    end loop;
    update public.subscriptions set next_due = due where id = subscription.id;
  end loop;
  return posted;
end;
$$;

create function public.sync_my_subscriptions()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := auth.uid();
begin
  if owner is null then raise insufficient_privilege; end if;
  return oopsie_private.post_due_subscriptions(owner, timezone('Europe/Berlin', now())::date);
end;
$$;

revoke all on all functions in schema oopsie_private from public, anon, authenticated;
revoke all on function public.sync_my_subscriptions() from public, anon, authenticated;
grant execute on function public.sync_my_subscriptions() to authenticated;

commit;
