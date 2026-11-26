begin;

create or replace function public.save_receipt(
  receipt_id uuid, merchant text, receipt_date date, total bigint, lines jsonb
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  line_sum numeric;
  ledger_category text;
begin
  if owner_id is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if total is null or total <= 0 or receipt_date is null or receipt_date > current_date + 1
     or jsonb_typeof(lines) is distinct from 'array'
     or jsonb_array_length(lines) not between 1 and 300 then
    raise exception 'Invalid receipt' using errcode = '22023';
  end if;
  select sum((value->>'amount_minor')::bigint) into line_sum from jsonb_array_elements(lines);
  if line_sum is distinct from total or not exists (
    select 1 from jsonb_array_elements(lines) where value->>'kind' = 'product'
  ) then
    raise exception 'Receipt lines must reconcile with the total' using errcode = '22023';
  end if;

  -- Keep the same RPC signature for existing callers and validate the optional category.
  ledger_category := lines->0->>'spending_category';
  if ledger_category is null or ledger_category not in (
    'Groceries', 'Dining out', 'Entertainment', 'Music & instruments', 'Subscriptions',
    'Transport', 'Travel', 'Education', 'Tools', 'Housing', 'Shopping', 'Health',
    'Business', 'Yearly expenses', 'Other'
  ) then
    select case when bool_and((value->>'category') is not distinct from 'Music & instruments')
      then 'Music & instruments' else 'Groceries' end into ledger_category
    from jsonb_array_elements(lines) where value->>'kind' = 'product';
  end if;

  insert into public.ledger_entries (id, user_id, date, name, category, merchant, "amountMinor")
    values (receipt_id, owner_id, receipt_date, merchant, ledger_category, merchant, -total)
    on conflict (id) do nothing;
  if not found then
    if exists (select 1 from public.receipts r where r.id = receipt_id and r.user_id = owner_id) then
      return receipt_id;
    end if;
    raise exception 'Receipt could not be saved' using errcode = '22023';
  end if;
  insert into public.receipts (id, user_id, store, purchased_on, currency, total_minor)
    values (receipt_id, owner_id, merchant, receipt_date, 'EUR', total);
  insert into public.receipt_lines (
    receipt_id, user_id, position, kind, receipt_name, display_name, category, aliases, quantity, unit, amount_minor
  )
  select receipt_id, owner_id, ord::integer, value->>'kind', value->>'receipt_name',
    value->>'display_name', coalesce(value->>'category', ''), coalesce(value->'aliases', '[]'::jsonb),
    (value->>'quantity')::numeric, value->>'unit', (value->>'amount_minor')::bigint
  from jsonb_array_elements(lines) with ordinality as rows(value, ord);
  insert into public.receipt_product_labels (user_id, store_key, receipt_key, display_name, category)
  select distinct on (lower(btrim(regexp_replace(value->>'receipt_name', '\s+', ' ', 'g'))))
    owner_id, lower(btrim(regexp_replace(merchant, '\s+', ' ', 'g'))),
    lower(btrim(regexp_replace(value->>'receipt_name', '\s+', ' ', 'g'))),
    value->>'display_name', coalesce(value->>'category', '')
  from jsonb_array_elements(lines) with ordinality as rows(value, ord)
  where value->>'kind' = 'product' and value->'remember' = 'true'::jsonb
  order by lower(btrim(regexp_replace(value->>'receipt_name', '\s+', ' ', 'g'))), ord desc
  on conflict (user_id, store_key, receipt_key)
  do update set display_name = excluded.display_name, category = excluded.category;
  return receipt_id;
end;
$$;

commit;
