begin;

create function oopsie_private.clear_reset_overview_period()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update auth.users
    set raw_user_meta_data = raw_user_meta_data - 'overview_period',
        updated_at = clock_timestamp()
    where id = new.user_id and raw_user_meta_data ? 'overview_period';
  return new;
end;
$$;
revoke all on function oopsie_private.clear_reset_overview_period() from public, anon, authenticated;

create trigger clear_reset_overview_period
  after update of completed_at on public.account_reset_requests
  for each row when (old.completed_at is null and new.completed_at is not null)
  execute function oopsie_private.clear_reset_overview_period();

commit;
