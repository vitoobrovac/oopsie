begin;

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  name text not null check (char_length(trim(name)) between 1 and 120),
  category text not null check (char_length(category) between 1 and 40),
  merchant text not null default '' check (char_length(merchant) <= 120),
  "amountMinor" bigint not null check ("amountMinor" between -99999999999 and 99999999999 and "amountMinor" <> 0)
);
create index ledger_entries_user_date_idx on public.ledger_entries (user_id, date desc, id);

create table public.ledger_preferences (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  "monthStartDay" integer not null default 1 check ("monthStartDay" between 1 and 31)
);

alter table public.ledger_entries enable row level security;
alter table public.ledger_preferences enable row level security;
revoke all on public.ledger_entries, public.ledger_preferences from public, anon, authenticated;
grant select, insert, delete on public.ledger_entries to authenticated;
grant select, insert, update on public.ledger_preferences to authenticated;

create policy read_own_entries on public.ledger_entries for select to authenticated
  using ((select auth.uid()) = user_id);
create policy create_own_entries on public.ledger_entries for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy delete_own_entries on public.ledger_entries for delete to authenticated
  using ((select auth.uid()) = user_id);
create policy manage_own_preferences on public.ledger_preferences for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

commit;
