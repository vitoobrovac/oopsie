begin;

create table public.recurring_income (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  category text not null check (char_length(trim(category)) between 1 and 40),
  merchant text not null default '' check (char_length(merchant) <= 120),
  amount_minor bigint not null check (amount_minor between 1 and 99999999999),
  starts_on date not null check (starts_on between date '1900-01-01' and date '9999-01-01'),
  cadence text not null check (cadence in ('weekly', 'monthly', 'yearly')),
  next_due date not null
);
create index recurring_income_owner_due on public.recurring_income (user_id, next_due);
alter table public.recurring_income enable row level security;
revoke all on public.recurring_income from public, anon, authenticated;
grant select, delete on public.recurring_income to authenticated;
grant insert (name, category, merchant, amount_minor, starts_on, cadence) on public.recurring_income to authenticated;
create policy manage_own_recurring_income on public.recurring_income for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create function oopsie_private.set_income_due()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.next_due := oopsie_private.first_due(new.starts_on, new.cadence, timezone('Europe/Berlin', now())::date);
  return new;
end;
$$;
revoke all on function oopsie_private.set_income_due() from public, anon, authenticated;
create trigger set_income_due before insert on public.recurring_income
  for each row execute function oopsie_private.set_income_due();

create function public.sync_my_recurring_income()
returns void language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := auth.uid();
  today date := timezone('Europe/Berlin', now())::date;
  schedule public.recurring_income%rowtype;
  due date;
begin
  if owner is null then raise insufficient_privilege; end if;
  for schedule in
    select * from public.recurring_income where user_id = owner and next_due <= today
    order by id for update
  loop
    due := schedule.next_due;
    while due <= today loop
      insert into public.ledger_entries (user_id, date, name, category, merchant, "amountMinor")
        values (owner, due, schedule.name, schedule.category, schedule.merchant, schedule.amount_minor);
      due := oopsie_private.first_due(schedule.starts_on, schedule.cadence, due + 1);
    end loop;
    -- Each write and the cursor advance share this transaction and row lock.
    update public.recurring_income set next_due = due where id = schedule.id;
  end loop;
end;
$$;
revoke all on function public.sync_my_recurring_income() from public, anon, authenticated;
grant execute on function public.sync_my_recurring_income() to authenticated;

notify pgrst, 'reload schema';
commit;
