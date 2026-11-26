begin;

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
          values (subscription.user_id, due, subscription.name,
            case when subscription.cadence in ('yearly', 'yearly_split') then 'Yearly expenses' else 'Subscriptions' end,
            -charge);
        posted := posted + 1;
      end if;
      due := oopsie_private.first_due(subscription.starts_on, subscription.cadence, due + 1);
    end loop;
    update public.subscriptions set next_due = due where id = subscription.id;
  end loop;
  return posted;
end;
$$;

commit;
