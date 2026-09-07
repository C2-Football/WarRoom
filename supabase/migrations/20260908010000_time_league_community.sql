begin;
-- Community data is only returned by the authenticated Edge endpoint. Public
-- profile IDs are random, separate from app user IDs, and opt-in by default.
create table if not exists public.time_league_profiles (
    user_id uuid primary key references public.app_users(id) on delete cascade,
    profile_id uuid not null unique default gen_random_uuid(),
    identity jsonb not null,
    public_profile boolean not null default false,
    looking_for_league boolean not null default false,
    updated_at timestamptz not null default now(),
    check (not looking_for_league or public_profile)
);
create index if not exists time_league_profiles_public on public.time_league_profiles(public_profile, looking_for_league);
create table if not exists public.time_league_verified_records (
    league_id uuid not null references public.time_leagues(id) on delete cascade,
    user_id uuid not null references public.app_users(id) on delete cascade,
    wins integer not null default 0, losses integer not null default 0, ties integer not null default 0,
    games integer not null default 0, points_for numeric not null default 0, best_game numeric not null default 0,
    championships integer not null default 0, leagues_completed integer not null default 0,
    primary key (league_id,user_id)
);
create index if not exists time_league_verified_records_user on public.time_league_verified_records(user_id);
create table if not exists public.time_league_community_invites (
    id uuid primary key default gen_random_uuid(),
    league_id uuid not null references public.time_leagues(id) on delete cascade,
    seat_team_id text not null,
    sender_id uuid not null references public.app_users(id) on delete cascade,
    recipient_id uuid not null references public.app_users(id) on delete cascade,
    status text not null default 'pending' check(status in ('pending','accepted','declined')),
    created_at timestamptz not null default now(),
    responded_at timestamptz,
    unique(league_id,recipient_id),
    check(sender_id <> recipient_id)
);
create index if not exists time_league_community_invites_recipient on public.time_league_community_invites(recipient_id,created_at desc);
create index if not exists time_league_community_invites_sender on public.time_league_community_invites(sender_id,created_at desc);
alter table public.time_league_profiles enable row level security;
alter table public.time_league_verified_records enable row level security;
alter table public.time_league_community_invites enable row level security;
revoke all on public.time_league_profiles, public.time_league_verified_records, public.time_league_community_invites from anon,authenticated;
grant all on public.time_league_profiles, public.time_league_verified_records, public.time_league_community_invites to service_role;

-- The only record source is server-owned finalized league snapshots. Count
-- head-to-head games only when BOTH seats have a distinct joined human owner.
create or replace function public.refresh_time_league_verified_records(p_league_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
    delete from time_league_verified_records where league_id=p_league_id;
    insert into time_league_verified_records(league_id,user_id,wins,losses,ties,games,points_for,best_game,championships,leagues_completed)
    with league as (select * from time_leagues where id=p_league_id and draft_started),
    human as (
        select m.user_id,m.seat_team_id from time_league_members m join league l on l.id=m.league_id
        where m.user_id is not null and exists(select 1 from jsonb_array_elements(l.state->'teams') t where t->>'teamId'=m.seat_team_id and t->>'manager'='human')
    ), matches as (
        select w->>'week' as week, match from league l,
        lateral jsonb_array_elements(coalesce(l.state->'finalizedWeeks','[]')) w,
        lateral jsonb_array_elements(coalesce(w->'matchups','[]')) match
    ), played as (
        select h.user_id,h.seat_team_id,m.match,
            case when m.match->>'home'=h.seat_team_id then (m.match->>'homePoints')::numeric else (m.match->>'awayPoints')::numeric end as points
        from human h join matches m on h.seat_team_id in (m.match->>'home',m.match->>'away')
        join human opponent on opponent.seat_team_id=case when m.match->>'home'=h.seat_team_id then m.match->>'away' else m.match->>'home' end
            and opponent.user_id<>h.user_id
    )
    select l.id,h.user_id,
        count(p.match) filter(where p.match->>'winner'=h.seat_team_id)::integer,
        count(p.match) filter(where p.match->>'winner' is not null and p.match->>'winner'<>h.seat_team_id)::integer,
        count(p.match) filter(where p.match->>'winner' is null)::integer,
        count(p.match)::integer,coalesce(sum(p.points),0),coalesce(max(p.points),0),
        case when l.phase='complete' and l.state->>'championTeamId'=h.seat_team_id and count(p.match)>0 then 1 else 0 end,
        case when l.phase='complete' and count(p.match)>0 then 1 else 0 end
    from league l cross join human h left join played p on p.user_id=h.user_id
    group by l.id,l.phase,l.state,h.user_id,h.seat_team_id;
end $$;
create or replace function public.time_league_records_after_save()
returns trigger language plpgsql security definer set search_path=public as $$
begin
    if tg_op='INSERT' or new.state->'finalizedWeeks' is distinct from old.state->'finalizedWeeks'
        or new.state->>'phase' is distinct from old.state->>'phase'
        or new.state->>'championTeamId' is distinct from old.state->>'championTeamId' then
        perform refresh_time_league_verified_records(new.id);
    end if;
    return new;
end $$;
drop trigger if exists time_league_records_after_save on public.time_leagues;
create trigger time_league_records_after_save after insert or update of state on public.time_leagues
for each row execute function public.time_league_records_after_save();
revoke all on function public.refresh_time_league_verified_records(uuid),public.time_league_records_after_save() from public,anon,authenticated;
grant execute on function public.refresh_time_league_verified_records(uuid) to service_role;

create or replace view public.time_league_public_directory with (security_barrier=true) as
select p.profile_id,p.identity,p.looking_for_league,
    coalesce(sum(r.wins),0)::integer as wins,coalesce(sum(r.losses),0)::integer as losses,coalesce(sum(r.ties),0)::integer as ties,
    coalesce(sum(r.games),0)::integer as games,coalesce(sum(r.points_for),0) as points_for,coalesce(max(r.best_game),0) as best_game,
    coalesce(sum(r.championships),0)::integer as championships,coalesce(sum(r.leagues_completed),0)::integer as leagues_completed
from public.time_league_profiles p left join public.time_league_verified_records r on r.user_id=p.user_id
where p.public_profile group by p.profile_id,p.identity,p.looking_for_league;
revoke all on public.time_league_public_directory from anon,authenticated;
grant select on public.time_league_public_directory to service_role;

-- Only applies at a new seat claim. Existing league identities are not rewritten
-- when an owner edits the global profile later.
create or replace function public.apply_time_league_profile(p_league_id uuid,p_user_id uuid,p_seat text)
returns void language plpgsql security definer set search_path=public as $$
declare v_identity jsonb;
begin
    select identity into v_identity from time_league_profiles where user_id=p_user_id;
    if v_identity is null then return; end if;
    update time_leagues l set state=jsonb_set(l.state,'{teams}',(
        select jsonb_agg(case when t->>'teamId'=p_seat then t || jsonb_build_object('name',v_identity->>'teamName','helmet',v_identity->'helmet','primaryColor',v_identity->>'primaryColor','secondaryColor',v_identity->>'secondaryColor','backdrop',v_identity->>'backdrop') else t end order by n)
        from jsonb_array_elements(l.state->'teams') with ordinality a(t,n)
    )) where l.id=p_league_id;
end $$;
create or replace function public.claim_time_league_invite(p_user_id uuid,p_code text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_member time_league_members; v_league time_leagues; v_id uuid;
begin
    select league_id into v_id from time_league_members where invite_code=p_code;
    if not found then raise exception 'This invitation does not exist'; end if;
    select * into v_league from time_leagues where id=v_id for update;
    select * into v_member from time_league_members where invite_code=p_code for update;
    if v_member.user_id=p_user_id then return v_id; end if;
    if v_member.user_id is not null then raise exception 'This seat has already been claimed'; end if;
    if v_league.draft_started or v_league.phase<>'draft' then raise exception 'This draft has already started'; end if;
    if exists(select 1 from time_league_members where league_id=v_id and user_id=p_user_id) then raise exception 'You already have a seat in this league'; end if;
    update time_league_members set user_id=p_user_id,joined_at=now() where id=v_member.id;
    perform apply_time_league_profile(v_id,p_user_id,v_member.seat_team_id);
    update time_leagues set version=version+1 where id=v_id;
    return v_id;
end $$;

create or replace function public.send_time_league_community_invite(p_user_id uuid,p_league_id uuid,p_seat_team_id text,p_profile_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_league time_leagues; v_target uuid; v_id uuid;
begin
    -- Serialize a sender's requests across leagues to enforce the daily limit.
    perform 1 from app_users where id=p_user_id for update;
    select * into v_league from time_leagues where id=p_league_id for update;
    if not found or not exists(select 1 from time_league_members where league_id=p_league_id and user_id=p_user_id and role='commissioner') then raise exception 'Only this league commissioner can invite a manager'; end if;
    if v_league.draft_started or v_league.phase<>'draft' then raise exception 'Invite managers before the draft starts'; end if;
    if not exists(select 1 from time_league_profiles where user_id=p_user_id) then raise exception 'Save your manager profile first'; end if;
    select user_id into v_target from time_league_profiles where profile_id=p_profile_id and public_profile and looking_for_league;
    if not found or v_target=p_user_id then raise exception 'This manager is not available for invitations'; end if;
    if exists(select 1 from time_league_members where league_id=p_league_id and user_id=v_target) then raise exception 'This manager already has a seat'; end if;
    if not exists(select 1 from time_league_members where league_id=p_league_id and seat_team_id=p_seat_team_id and user_id is null) then raise exception 'Choose an open human seat'; end if;
    if exists(select 1 from time_league_community_invites where league_id=p_league_id and recipient_id=v_target) then raise exception 'You already invited this manager to this league'; end if;
    if (select count(*) from time_league_community_invites where sender_id=p_user_id and created_at>now()-interval '1 day')>=24 then raise exception 'You have reached the daily limit of 24 invitations'; end if;
    insert into time_league_community_invites(league_id,seat_team_id,sender_id,recipient_id) values(p_league_id,p_seat_team_id,p_user_id,v_target) returning id into v_id;
    return v_id;
end $$;
create or replace function public.respond_time_league_community_invite(p_user_id uuid,p_invite_id uuid,p_accept boolean)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_invite time_league_community_invites; v_league time_leagues;
begin
    select * into v_invite from time_league_community_invites where id=p_invite_id and recipient_id=p_user_id;
    if not found then raise exception 'This invitation is not addressed to you'; end if;
    select * into v_league from time_leagues where id=v_invite.league_id for update;
    select * into v_invite from time_league_community_invites where id=p_invite_id for update;
    if v_invite.status='accepted' then return v_invite.league_id; end if;
    if v_invite.status<>'pending' then raise exception 'This invitation has already been answered'; end if;
    if p_accept then
        if v_league.draft_started or v_league.phase<>'draft' then raise exception 'This draft has already started'; end if;
        if exists(select 1 from time_league_members where league_id=v_invite.league_id and user_id=p_user_id) then raise exception 'You already have a seat in this league'; end if;
        update time_league_members set user_id=p_user_id,joined_at=now() where league_id=v_invite.league_id and seat_team_id=v_invite.seat_team_id and user_id is null;
        if not found then raise exception 'This seat has already been claimed'; end if;
        perform apply_time_league_profile(v_invite.league_id,p_user_id,v_invite.seat_team_id);
        update time_leagues set version=version+1 where id=v_invite.league_id;
    end if;
    update time_league_community_invites set status=case when p_accept then 'accepted' else 'declined' end,responded_at=now() where id=p_invite_id;
    return case when p_accept then v_invite.league_id else null end;
end $$;
revoke all on function public.apply_time_league_profile(uuid,uuid,text),public.claim_time_league_invite(uuid,text),public.send_time_league_community_invite(uuid,uuid,text,uuid),public.respond_time_league_community_invite(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_time_league_invite(uuid,text),public.send_time_league_community_invite(uuid,uuid,text,uuid),public.respond_time_league_community_invite(uuid,uuid,boolean) to service_role;
-- Backfill existing server saves; reapplication is safe and never accumulates
-- duplicate totals because records are replaced for each league.
select public.refresh_time_league_verified_records(id) from public.time_leagues;
commit;
