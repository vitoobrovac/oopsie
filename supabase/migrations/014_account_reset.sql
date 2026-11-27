begin;

create table public.account_reset_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  request_id uuid not null,
  email text not null,
  expires_at timestamptz not null,
  completed_at timestamptz
);
alter table public.account_reset_requests enable row level security;
revoke all on public.account_reset_requests from public, anon, authenticated;
grant select, insert, update on public.account_reset_requests to service_role;

-- Only the API can call this after Supabase verifies the email code.
create function public.reset_oopsie_data(reset_owner uuid, confirmation uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  pending public.account_reset_requests%rowtype;
  reset_at timestamptz;
begin
  select * into pending from public.account_reset_requests
    where user_id = reset_owner and request_id = confirmation for update;
  if not found or pending.expires_at <= clock_timestamp() then raise insufficient_privilege; end if;
  if pending.completed_at is not null then return pending.completed_at; end if;
  perform id from auth.users where id = reset_owner for no key update;

  -- Stop schedules before deleting the entries they can create.
  delete from public.recurring_income where user_id = reset_owner;
  delete from public.subscriptions where user_id = reset_owner;
  delete from public.ledger_entries where user_id = reset_owner;
  delete from public.receipt_product_labels where user_id = reset_owner;
  delete from public.budgets where user_id = reset_owner;
  delete from public.savings_goals where user_id = reset_owner;
  delete from public.ledger_preferences where user_id = reset_owner;
  delete from oopsie_private.hunt_profiles where user_id = reset_owner;
  insert into oopsie_private.hunt_profiles (user_id) values (reset_owner);
  update auth.users set
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - array['display_name', 'week_start_day'],
    updated_at = clock_timestamp()
  where id = reset_owner;

  reset_at := clock_timestamp();
  update public.account_reset_requests set completed_at = reset_at
    where user_id = reset_owner;
  return reset_at;
end;
$$;
revoke all on function public.reset_oopsie_data(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reset_oopsie_data(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
