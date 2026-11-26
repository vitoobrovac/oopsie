begin;

create table oopsie_private.hunt_participants (
  user_id uuid not null references oopsie_private.hunt_profiles(user_id) on delete cascade,
  starts_on date not null references oopsie_private.hunt_weeks(starts_on),
  primary key (user_id, starts_on)
);
revoke all on oopsie_private.hunt_participants from public, anon, authenticated;

update oopsie_private.hunt_achievements set active = true
  where id in ('weekly_warrior', 'consistent_hunter', 'variety_hunter');

insert into oopsie_private.hunt_achievements (id, name, description, icon, active) values
  ('receipt_months', 'Receipt Regular', 'Save receipts in different calendar months.', 'calendar', true);

insert into oopsie_private.hunt_achievement_tiers values
  ('receipt_months', 1, 2, 30), ('receipt_months', 2, 6, 150), ('receipt_months', 3, 18, 1500);

insert into oopsie_private.hunt_milestones (user_id, achievement_id, milestone_key)
select user_id, 'receipt_months', left(milestone_key, 7)
from oopsie_private.hunt_milestones where achievement_id = 'receipt_days'
on conflict do nothing;

create function oopsie_private.record_hunt_receipt_month()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.achievement_id = 'receipt_days' then
    insert into oopsie_private.hunt_milestones values (new.user_id, 'receipt_months', left(new.milestone_key, 7))
      on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke all on function oopsie_private.record_hunt_receipt_month() from public, anon, authenticated;
create trigger hunt_receipt_month after insert on oopsie_private.hunt_milestones
  for each row when (new.achievement_id = 'receipt_days')
  execute function oopsie_private.record_hunt_receipt_month();

alter function public.get_hunt_achievements() set schema oopsie_private;
revoke all on function oopsie_private.get_hunt_achievements() from public, anon, authenticated;

create function public.get_hunt_achievements()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  progress jsonb := oopsie_private.get_hunt_achievements();
  owner uuid := auth.uid();
  week_start date := date_trunc('week', timezone('Europe/Berlin', now()))::date;
begin
  return progress || jsonb_build_object(
    'upcoming', (select coalesce(jsonb_agg(to_jsonb(c) order by c.name), '[]'::jsonb)
      from (
        select a.id, a.name, a.description, a.icon,
          (select jsonb_agg(jsonb_build_object('tier', tier, 'target', target, 'xp', xp) order by tier)
             from oopsie_private.hunt_achievement_tiers t where t.achievement_id = a.id) as tiers
        from oopsie_private.hunt_achievements a where not a.active
      ) c),
    'joined_week', (select starts_on from oopsie_private.hunt_participants where user_id = owner and starts_on = week_start)
  );
end;
$$;

create function public.join_current_hunt(expected_week date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := auth.uid();
  week_start date := date_trunc('week', timezone('Europe/Berlin', now()))::date;
  hunt_type text;
begin
  if owner is null or not exists (
    select 1 from oopsie_private.hunt_profiles where user_id = owner and username is not null
  ) then raise insufficient_privilege; end if;

  select challenge_type into hunt_type from oopsie_private.hunt_weeks where starts_on = week_start;
  if hunt_type is null or expected_week is distinct from week_start then
    raise invalid_parameter_value using message = 'This hunt week has ended or is unavailable. Refresh the Hunt.';
  end if;

  insert into oopsie_private.hunt_participants values (owner, week_start) on conflict do nothing;
  insert into oopsie_private.hunt_milestones values
    (owner, 'weekly_warrior', to_char(week_start, 'YYYY-MM-DD')),
    (owner, 'consistent_hunter', to_char(week_start, 'YYYY-MM-DD')),
    (owner, 'variety_hunter', hunt_type)
  on conflict do nothing;
  return public.get_hunt_achievements();
end;
$$;

create function public.get_hunt_reward_count()
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer
  from oopsie_private.hunt_achievement_tiers t
  join oopsie_private.hunt_achievements a on a.id = t.achievement_id and a.active
  join lateral (
    select count(*) as milestones from oopsie_private.hunt_milestones m
      where m.user_id = (select auth.uid()) and m.achievement_id = a.id
  ) p on p.milestones >= t.target
  where exists (
    select 1 from oopsie_private.hunt_profiles u where u.user_id = (select auth.uid()) and u.username is not null
  ) and not exists (
    select 1 from oopsie_private.hunt_xp_awards w where w.user_id = (select auth.uid())
      and w.source = 'permanent' and w.award_key = a.id || ':' || t.tier
  );
$$;

revoke all on function public.get_hunt_achievements(), public.join_current_hunt(date),
  public.get_hunt_reward_count() from public, anon, authenticated;
grant execute on function public.get_hunt_achievements(), public.join_current_hunt(date),
  public.get_hunt_reward_count() to authenticated;

notify pgrst, 'reload schema';
commit;
