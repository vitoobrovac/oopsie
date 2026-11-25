begin;

alter table public.ledger_entries add constraint ledger_entry_owner_unique unique (id, user_id);

create table public.receipts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  store text not null check (char_length(btrim(store)) between 1 and 120),
  purchased_on date not null,
  currency text not null check (currency = 'EUR'),
  total_minor bigint not null check (total_minor between 1 and 99999999999),
  foreign key (id, user_id) references public.ledger_entries(id, user_id) on delete cascade,
  unique (id, user_id)
);
create index receipts_owner_date on public.receipts(user_id, purchased_on desc, id);

create table public.receipt_lines (
  receipt_id uuid not null,
  user_id uuid not null,
  position integer not null check (position between 1 and 300),
  kind text not null check (kind in ('product', 'discount', 'deposit')),
  receipt_name text not null check (char_length(btrim(receipt_name)) between 1 and 240),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  category text not null default '' check (char_length(category) <= 60),
  aliases jsonb not null default '[]' check (
    jsonb_typeof(aliases) = 'array' and jsonb_array_length(aliases) <= 20 and pg_column_size(aliases) <= 2048
  ),
  quantity numeric check (quantity > 0 and quantity <= 1000000 and scale(quantity) <= 3),
  unit text not null check (unit in ('unit', 'kg', 'L')),
  amount_minor bigint not null check (
    amount_minor between -99999999999 and 99999999999
    and ((kind = 'discount' and amount_minor < 0) or (kind <> 'discount' and amount_minor >= 0))
  ),
  primary key (receipt_id, position),
  foreign key (receipt_id, user_id) references public.receipts(id, user_id) on delete cascade
);

create table public.receipt_product_labels (
  user_id uuid not null references auth.users(id) on delete cascade,
  store_key text not null,
  receipt_key text not null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  category text not null check (char_length(category) <= 60),
  primary key (user_id, store_key, receipt_key)
);

alter table public.receipts enable row level security;
alter table public.receipt_lines enable row level security;
alter table public.receipt_product_labels enable row level security;
revoke all on public.receipts, public.receipt_lines, public.receipt_product_labels from public, anon, authenticated;
grant select on public.receipts, public.receipt_lines, public.receipt_product_labels to authenticated;
create policy read_own_receipts on public.receipts for select to authenticated
  using ((select auth.uid()) = user_id);
create policy read_own_receipt_lines on public.receipt_lines for select to authenticated
  using ((select auth.uid()) = user_id);
create policy read_own_product_labels on public.receipt_product_labels for select to authenticated
  using ((select auth.uid()) = user_id);

create function public.save_receipt(
  receipt_id uuid, merchant text, receipt_date date, total bigint, lines jsonb
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  line_sum numeric;
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

  insert into public.ledger_entries (id, user_id, date, name, category, merchant, "amountMinor")
    values (receipt_id, owner_id, receipt_date, merchant, 'Groceries', merchant, -total)
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

revoke all on function public.save_receipt(uuid, text, date, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.save_receipt(uuid, text, date, bigint, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
