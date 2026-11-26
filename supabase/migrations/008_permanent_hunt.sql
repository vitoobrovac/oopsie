begin;

create table oopsie_private.hunt_achievements (
  id text primary key,
  name text not null,
  description text not null,
  icon text not null,
  active boolean not null default false
);

create table oopsie_private.hunt_achievement_tiers (
  achievement_id text not null references oopsie_private.hunt_achievements(id),
  tier integer not null check (tier between 1 and 3),
  target integer not null check (target > 0),
  xp integer not null check (xp > 0),
  primary key (achievement_id, tier)
);

create table oopsie_private.hunt_milestones (
  user_id uuid not null references oopsie_private.hunt_profiles(user_id) on delete cascade,
  achievement_id text not null references oopsie_private.hunt_achievements(id),
  milestone_key text not null,
  primary key (user_id, achievement_id, milestone_key)
);

-- Both permanent claims and future weekly leaderboard XP payouts use this lifetime ledger.
create table oopsie_private.hunt_xp_awards (
  user_id uuid not null references oopsie_private.hunt_profiles(user_id) on delete cascade,
  source text not null check (source in ('permanent', 'weekly_reward')),
  award_key text not null,
  xp integer not null check (xp > 0),
  primary key (user_id, source, award_key)
);

revoke all on oopsie_private.hunt_achievements, oopsie_private.hunt_achievement_tiers,
  oopsie_private.hunt_milestones, oopsie_private.hunt_xp_awards from public, anon, authenticated;

insert into oopsie_private.hunt_achievements (id, name, description, icon, active) values
  ('receipt_days', 'Receipt Archivist', 'Save receipts from different purchase dates.', 'receipt', true),
  ('income_months', 'Income Tracker', 'Record income in different calendar months.', 'wallet', true),
  ('budget_categories', 'Budget Builder', 'Set up budgets for different categories.', 'target', true),
  ('receipt_collector', 'Receipt Collector', 'Save verified receipt scans.', 'camera', false),
  ('weekly_warrior', 'Weekly Warrior', 'Participate in weekly hunts.', 'calendar', false),
  ('perfect_sniper', 'Perfect Sniper', 'Find exact target prices.', 'target', false),
  ('bargain_hunter', 'Bargain Hunter', 'Find products below their benchmark.', 'arrow-down', false),
  ('fresh_habits', 'Fresh Habits', 'Complete healthy missions.', 'cart', false),
  ('bingo_master', 'Bingo Master', 'Complete full bingo boards.', 'grid', false),
  ('hunt_specialist', 'Hunt Specialist', 'Complete main objectives.', 'target', false),
  ('personal_best', 'Personal Best', 'Improve past challenge results.', 'sparkles', false),
  ('consistent_hunter', 'Consistent Hunter', 'Participate in different Hunt weeks.', 'calendar', false),
  ('variety_hunter', 'Variety Hunter', 'Participate in different challenge types.', 'grid', false);

insert into oopsie_private.hunt_achievement_tiers (achievement_id, tier, target, xp)
select id, tier, targets[tier], rewards[tier]
from (values
  ('receipt_days', array[2, 10, 50], array[30, 200, 2000]),
  ('income_months', array[1, 3, 12], array[30, 150, 1200]),
  ('budget_categories', array[1, 3, 6], array[20, 100, 600]),
  ('receipt_collector', array[2, 10, 50], array[30, 200, 2000]),
  ('weekly_warrior', array[2, 10, 30], array[30, 200, 2000]),
  ('perfect_sniper', array[1, 5, 25], array[30, 150, 1500]),
  ('bargain_hunter', array[5, 25, 100], array[30, 200, 2000]),
  ('fresh_habits', array[3, 15, 75], array[30, 200, 2000]),
  ('bingo_master', array[1, 5, 15], array[50, 250, 2500]),
  ('hunt_specialist', array[5, 25, 100], array[30, 200, 2000]),
  ('personal_best', array[2, 10, 50], array[30, 200, 2000]),
  ('consistent_hunter', array[3, 12, 30], array[30, 200, 2000]),
  ('variety_hunter', array[2, 3, 4], array[30, 150, 1200])
) as definitions(id, targets, rewards)
cross join generate_series(1, 3) as tiers(tier);

create function oopsie_private.record_permanent_hunt_milestone()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'receipts' then
    insert into oopsie_private.hunt_milestones values (new.user_id, 'receipt_days', to_char(new.purchased_on, 'YYYY-MM-DD'))
    on conflict do nothing;
  elsif tg_table_name = 'ledger_entries' then
    if new."amountMinor" > 0 and new.date <= timezone('Europe/Berlin', now())::date then
      insert into oopsie_private.hunt_milestones values (new.user_id, 'income_months', to_char(new.date, 'YYYY-MM'))
      on conflict do nothing;
    end if;
  elsif tg_table_name = 'budgets' then
    insert into oopsie_private.hunt_milestones values (new.user_id, 'budget_categories', lower(btrim(new.category)))
    on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke all on function oopsie_private.record_permanent_hunt_milestone() from public, anon, authenticated;
create trigger hunt_receipt_day after insert on public.receipts
  for each row execute function oopsie_private.record_permanent_hunt_milestone();
create trigger hunt_income_month after insert on public.ledger_entries
  for each row execute function oopsie_private.record_permanent_hunt_milestone();
create trigger hunt_budget_category after insert or update of category on public.budgets
  for each row execute function oopsie_private.record_permanent_hunt_milestone();

insert into oopsie_private.hunt_milestones (user_id, achievement_id, milestone_key)
select user_id, 'receipt_days', to_char(purchased_on, 'YYYY-MM-DD') from public.receipts
union all
select user_id, 'income_months', to_char(date, 'YYYY-MM') from public.ledger_entries
  where "amountMinor" > 0 and date <= timezone('Europe/Berlin', now())::date
union all
select user_id, 'budget_categories', lower(btrim(category)) from public.budgets
on conflict do nothing;

create function public.get_hunt_achievements()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  owner uuid := auth.uid();
begin
  if owner is null or not exists (
    select 1 from oopsie_private.hunt_profiles where user_id = owner and username is not null
  ) then raise insufficient_privilege; end if;

  return (
    with xp_totals as (
      select user_id, sum(xp) as xp from oopsie_private.hunt_xp_awards group by user_id
    ), ranked as (
      select p.user_id, p.username, coalesce(x.xp, 0) as xp, 1 + coalesce(x.xp, 0) / 100 as level,
        rank() over (order by coalesce(x.xp, 0) desc) as rank
      from oopsie_private.hunt_profiles p left join xp_totals x using (user_id)
      where p.username is not null
    ), challenges as (
      select a.id, a.name, a.description, a.icon,
        (select count(*) from oopsie_private.hunt_milestones m where m.user_id = owner and m.achievement_id = a.id) as progress,
        (select jsonb_agg(jsonb_build_object('tier', t.tier, 'target', t.target, 'xp', t.xp,
          'claimed', exists (select 1 from oopsie_private.hunt_xp_awards w
            where w.user_id = owner and w.source = 'permanent' and w.award_key = a.id || ':' || t.tier))
          order by t.tier) from oopsie_private.hunt_achievement_tiers t where t.achievement_id = a.id) as tiers
      from oopsie_private.hunt_achievements a where a.active
    )
    select jsonb_build_object(
      'player', (select to_jsonb(r) - 'user_id' from ranked r where r.user_id = owner),
      'leaders', (select coalesce(jsonb_agg(to_jsonb(r) - 'user_id' order by r.rank, r.username), '[]'::jsonb)
        from (select * from ranked order by rank, username limit 20) r),
      'challenges', (select coalesce(jsonb_agg(to_jsonb(c) order by c.name), '[]'::jsonb) from challenges c)
    )
  );
end;
$$;

create function public.claim_hunt_achievement(challenge_id text, requested_tier integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := auth.uid();
  reward integer;
  requirement integer;
  awarded integer;
begin
  if owner is null or not exists (
    select 1 from oopsie_private.hunt_profiles where user_id = owner and username is not null
  ) then raise insufficient_privilege; end if;

  select t.xp, t.target into reward, requirement
  from oopsie_private.hunt_achievement_tiers t
  join oopsie_private.hunt_achievements a on a.id = t.achievement_id
  where a.id = challenge_id and a.active and t.tier = requested_tier;

  if not found or (select count(*) from oopsie_private.hunt_milestones m
    where m.user_id = owner and m.achievement_id = challenge_id) < requirement then
    raise invalid_parameter_value using message = 'This tier is not ready to claim.';
  end if;

  insert into oopsie_private.hunt_xp_awards values (owner, 'permanent', challenge_id || ':' || requested_tier, reward)
    on conflict do nothing returning xp into awarded;
  return public.get_hunt_achievements() || jsonb_build_object('awarded_xp', coalesce(awarded, 0));
end;
$$;

revoke all on function public.get_hunt_achievements(), public.claim_hunt_achievement(text, integer) from public, anon, authenticated;
grant execute on function public.get_hunt_achievements(), public.claim_hunt_achievement(text, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
