begin;

-- Each successive level costs 15 XP more, starting at 20 XP for level 2.
create function oopsie_private.hunt_level(lifetime_xp bigint)
returns bigint language sql immutable strict set search_path = '' as $$
  select 1 + floor((sqrt(625 + 120 * greatest(lifetime_xp, 0)::numeric) - 25) / 30)::bigint;
$$;

revoke all on function oopsie_private.hunt_level(bigint) from public, anon, authenticated;

-- Preserve the level already earned under the old 100 XP rule.
alter table oopsie_private.hunt_profiles
  add column legacy_level bigint not null default 1 check (legacy_level >= 1);

update oopsie_private.hunt_profiles p set legacy_level = greatest(1, 1 + totals.xp / 100)
from (select user_id, sum(xp) as xp from oopsie_private.hunt_xp_awards group by user_id) totals
where p.user_id = totals.user_id;

create or replace function oopsie_private.get_hunt_achievements()
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
      select p.user_id, p.username, coalesce(x.xp, 0) as xp, greatest(p.legacy_level, oopsie_private.hunt_level(coalesce(x.xp, 0))) as level,
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

commit;
