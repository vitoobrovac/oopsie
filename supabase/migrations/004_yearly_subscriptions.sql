begin;

alter table public.subscriptions drop constraint subscriptions_cadence_check;
alter table public.subscriptions
  add constraint subscriptions_cadence_check check (cadence in ('weekly', 'monthly', 'yearly', 'yearly_split')),
  add constraint subscriptions_installment_amount_check check (cadence <> 'yearly_split' or amount_minor >= 12);

create or replace function oopsie_private.first_due(anchor date, cadence text, from_date date)
returns date language plpgsql immutable set search_path = '' as $$
declare
  month_start date;
  due date;
  anchor_day integer := extract(day from anchor)::integer;
  step interval := interval '1 month';
begin
  if from_date <= anchor then return anchor; end if;
  if cadence = 'weekly' then
    return anchor + (((from_date - anchor + 6) / 7) * 7);
  end if;
  if cadence = 'yearly' then
    month_start := (date_trunc('year', from_date::timestamp)
      + (extract(month from anchor)::integer - 1) * interval '1 month')::date;
    step := interval '1 year';
  else
    month_start := date_trunc('month', from_date::timestamp)::date;
  end if;
  due := least(month_start + (anchor_day - 1), (month_start + interval '1 month - 1 day')::date);
  if due >= from_date then return due; end if;
  month_start := (month_start + step)::date;
  return least(month_start + (anchor_day - 1), (month_start + interval '1 month - 1 day')::date);
end;
$$;

create or replace function oopsie_private.post_due_subscriptions(owner uuid, through_date date)
returns integer language plpgsql set search_path = '' as $$
declare
  subscription public.subscriptions%rowtype;
  due date;
  posted integer := 0;
  installment integer;
  charge bigint;
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
        charge := subscription.amount_minor;
        if subscription.cadence = 'yearly_split' then
          installment := ((extract(year from due)::integer - extract(year from subscription.starts_on)::integer) * 12
            + extract(month from due)::integer - extract(month from subscription.starts_on)::integer) % 12;
          charge := charge / 12 + case when installment < charge % 12 then 1 else 0 end;
        end if;
        insert into public.ledger_entries (user_id, date, name, category, "amountMinor")
          values (subscription.user_id, due, subscription.name, 'Subscriptions', -charge);
        posted := posted + 1;
      end if;
      due := oopsie_private.first_due(subscription.starts_on, subscription.cadence, due + 1);
    end loop;
    update public.subscriptions set next_due = due where id = subscription.id;
  end loop;
  return posted;
end;
$$;

notify pgrst, 'reload schema';
commit;
