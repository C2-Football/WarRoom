begin;
create table if not exists public.time_leagues (
    id uuid primary key default gen_random_uuid(),
    created_by uuid not null references public.app_users(id),
    state jsonb not null,
    version integer not null default 1,
    draft_started boolean not null default false,
    created_at timestamptz not null default now(),
    league_id text generated always as (state->>'leagueId') stored,
    name text generated always as (state->>'name') stored,
    phase text generated always as (state->>'phase') stored,
    current_week integer generated always as ((state->>'currentWeek')::integer) stored,
    team_count integer generated always as (jsonb_array_length(state->'teams')) stored
);
create table if not exists public.time_league_members (
    id uuid primary key default gen_random_uuid(),
    league_id uuid not null references public.time_leagues(id) on delete cascade,
    seat_team_id text not null,
    role text not null check (role in ('commissioner', 'member')),
    user_id uuid references public.app_users(id),
    invite_code text unique not null default encode(gen_random_bytes(24), 'hex'),
    joined_at timestamptz,
    ready_week integer not null default 0,
    unique (league_id, seat_team_id),
    unique (league_id, user_id)
);
create index if not exists time_league_members_user on public.time_league_members(user_id);
alter table public.time_leagues enable row level security;
alter table public.time_league_members enable row level security;
-- Definer helper avoids recursive membership policies. Mutations are exclusively
-- server-owned, after active-session and action validation in the Edge function.
create or replace function public.is_time_league_member(p_league_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select exists(select 1 from time_league_members where league_id = p_league_id and user_id = public.current_app_user_id());
$$;
revoke all on function public.is_time_league_member(uuid) from public;
grant execute on function public.is_time_league_member(uuid) to authenticated;
drop policy if exists time_leagues_read on public.time_leagues;
create policy time_leagues_read on public.time_leagues for select to authenticated using (public.is_time_league_member(id));
-- Member rows contain invitation secrets. The Edge function returns only the
-- appropriate columns; direct client access is intentionally unavailable.
revoke all on public.time_leagues, public.time_league_members from anon, authenticated;
-- Full snapshots include private draft queues and pending bids. Only the Edge
-- endpoint returns snapshots, with those fields scoped to the requesting seat.
grant all on public.time_leagues, public.time_league_members to service_role;

create or replace function public.create_time_league(p_user_id uuid, p_state jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_team jsonb; v_first boolean := true;
begin
    insert into time_leagues(created_by, state) values (p_user_id, p_state) returning id into v_id;
    for v_team in select value from jsonb_array_elements(p_state->'teams') loop
        if v_team->>'manager' = 'human' then
            insert into time_league_members(league_id, seat_team_id, role, user_id, joined_at)
            values(v_id, v_team->>'teamId', case when v_first then 'commissioner' else 'member' end,
                case when v_first then p_user_id else null end, case when v_first then now() else null end);
            v_first := false;
        end if;
    end loop;
    if v_first then raise exception 'At least one human seat is required'; end if;
    return v_id;
end $$;

create or replace function public.claim_time_league_invite(p_user_id uuid, p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_member time_league_members; v_existing uuid;
begin
    select * into v_member from time_league_members where invite_code = p_code for update;
    if not found then raise exception 'This invitation does not exist'; end if;
    if v_member.user_id = p_user_id then return v_member.league_id; end if;
    if v_member.user_id is not null then raise exception 'This seat has already been claimed'; end if;
    select id into v_existing from time_league_members where league_id = v_member.league_id and user_id = p_user_id;
    if v_existing is not null then raise exception 'You already have a seat in this league'; end if;
    perform 1 from time_leagues where id = v_member.league_id for update;
    update time_league_members set user_id = p_user_id, joined_at = now() where id = v_member.id;
    update time_leagues set version = version + 1 where id = v_member.league_id;
    return v_member.league_id;
end $$;
revoke all on function public.create_time_league(uuid,jsonb), public.claim_time_league_invite(uuid,text) from public, anon, authenticated;
grant execute on function public.create_time_league(uuid,jsonb), public.claim_time_league_invite(uuid,text) to service_role;

-- Readiness and the game's CAS version share a row lock: a manager becoming
-- unready while the host prepares results makes the host's write conflict.
create or replace function public.set_time_league_ready(p_user_id uuid, p_league_id uuid, p_ready boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_week integer;
begin
    select current_week into v_week from time_leagues where id = p_league_id and phase = 'season' for update;
    if not found then raise exception 'Lineups open during the season'; end if;
    update time_league_members set ready_week = case when p_ready then v_week else 0 end where league_id = p_league_id and user_id = p_user_id;
    if not found then raise exception 'You do not have a seat'; end if;
    update time_leagues set version = version + 1 where id = p_league_id;
end $$;
revoke all on function public.set_time_league_ready(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.set_time_league_ready(uuid,uuid,boolean) to service_role;
commit;
