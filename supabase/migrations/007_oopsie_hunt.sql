begin;

create table oopsie_private.hunt_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  player_id uuid not null unique default gen_random_uuid(),
  username text unique check (username ~ '^[a-z0-9_]{3,20}$')
);

revoke all on oopsie_private.hunt_profiles from public, anon, authenticated;

create function oopsie_private.create_hunt_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into oopsie_private.hunt_profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function oopsie_private.create_hunt_profile() from public, anon, authenticated;
create trigger create_oopsie_hunt_profile after insert on auth.users
  for each row execute function oopsie_private.create_hunt_profile();

insert into oopsie_private.hunt_profiles (user_id)
select id from auth.users on conflict (user_id) do nothing;

create table oopsie_private.hunt_weeks (
  starts_on date primary key check (extract(isodow from starts_on) = 1),
  challenge_type text not null check (challenge_type in ('cheapest', 'sniper', 'bingo', 'twins')),
  title text not null,
  description text not null,
  objectives jsonb not null check (jsonb_typeof(objectives) = 'array')
);

revoke all on oopsie_private.hunt_weeks from public, anon, authenticated;

insert into oopsie_private.hunt_weeks (starts_on, challenge_type, title, description, objectives)
values (
  date_trunc('week', timezone('Europe/Berlin', now()))::date,
  'cheapest',
  'The Cheapest Wins',
  'Compare everyday essentials at the same package size. Look for products you already need.',
  '[
    {"label":"Still water","detail":"1 L bottle"},
    {"label":"Dry pasta","detail":"500 g pack"},
    {"label":"Milk","detail":"1 L carton or bottle"},
    {"label":"White rice","detail":"1 kg pack"}
  ]'::jsonb
), (
  date_trunc('week', timezone('Europe/Berlin', now()))::date + 7,
  'sniper',
  'Price Sniper',
  'Spot an individual item priced as close as possible to each target.',
  '[
    {"label":"€0.79","detail":"Target price"},
    {"label":"€1.49","detail":"Target price"},
    {"label":"€2.99","detail":"Target price"},
    {"label":"€4.59","detail":"Target price"}
  ]'::jsonb
), (
  date_trunc('week', timezone('Europe/Berlin', now()))::date + 14,
  'bingo',
  'Oopsie Bingo',
  'Look for a line of three squares on the same board as the other players.',
  '[
    {"label":"Any fruit","detail":"Produce"},
    {"label":"Exactly €1","detail":"Individual price"},
    {"label":"Store brand","detail":"Any product"},
    {"label":"Below €0.50","detail":"Individual price"},
    {"label":"Any vegetable","detail":"Produce"},
    {"label":"On sale","detail":"Discounted item"},
    {"label":"Pasta below €1","detail":"Pantry"},
    {"label":"Seasonal produce","detail":"Fruit or vegetables"},
    {"label":"Whole grain","detail":"Any product"}
  ]'::jsonb
), (
  date_trunc('week', timezone('Europe/Berlin', now()))::date + 21,
  'twins',
  'Price Twins',
  'Find two different products with identical or nearly identical individual prices.',
  '[
    {"label":"Below €1","detail":"Price band"},
    {"label":"€1–€1.99","detail":"Price band"},
    {"label":"€2–€2.99","detail":"Price band"},
    {"label":"€3–€5","detail":"Price band"}
  ]'::jsonb
);

create function public.get_hunt_profile()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  owner uuid := auth.uid();
begin
  if owner is null then raise insufficient_privilege; end if;
  return (
    select jsonb_build_object('player_id', player_id, 'username', username)
    from oopsie_private.hunt_profiles where user_id = owner
  );
end;
$$;

create function public.set_hunt_username(requested_username text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := auth.uid();
  canonical text := lower(btrim(requested_username));
  updated_profile jsonb;
begin
  if owner is null then raise insufficient_privilege; end if;
  if canonical is null or canonical !~ '^[a-z0-9_]{3,20}$' then
    raise invalid_parameter_value using message = 'Use 3–20 letters, numbers, or underscores.';
  end if;

  insert into oopsie_private.hunt_profiles (user_id, username) values (owner, canonical)
    on conflict (user_id) do update set username = excluded.username
    returning jsonb_build_object('player_id', player_id, 'username', username) into updated_profile;
  return updated_profile;
end;
$$;

create function public.get_hunt_lobby()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  profile jsonb := public.get_hunt_profile();
  this_week date := date_trunc('week', timezone('Europe/Berlin', now()))::date;
begin
  if profile->>'username' is null then
    return jsonb_build_object('profile', profile, 'week', null, 'player_count', 0, 'players', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'profile', profile,
    'week', (select jsonb_build_object('starts_on', starts_on, 'ends_on', starts_on + 7,
        'type', challenge_type, 'title', title, 'description', description, 'objectives', objectives)
      from oopsie_private.hunt_weeks where starts_on = this_week),
    'player_count', (select count(*) from oopsie_private.hunt_profiles where username is not null),
    'players', (select coalesce(jsonb_agg(username order by username), '[]'::jsonb)
      from (select username from oopsie_private.hunt_profiles where username is not null order by username limit 20) players)
  );
end;
$$;

revoke all on function public.get_hunt_profile(), public.set_hunt_username(text), public.get_hunt_lobby() from public, anon, authenticated;
grant execute on function public.get_hunt_profile(), public.set_hunt_username(text), public.get_hunt_lobby() to authenticated;

notify pgrst, 'reload schema';
commit;
