begin;

-- Guest identities satisfy existing game ownership FKs without creating a
-- usable password, subscription, or app-account session. Only the two game
-- endpoints accept the opaque bearer capability whose hash is stored here.
create table if not exists public.game_guest_sessions (
    token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
    game text not null check (game in ('vault','duat')),
    room_id uuid not null,
    app_user_id uuid not null unique references public.app_users(id) on delete cascade,
    display_name text not null check (length(display_name) between 1 and 60),
    expires_at timestamptz not null,
    revoked_at timestamptz,
    created_at timestamptz not null default now()
);
alter table public.game_guest_sessions enable row level security;
revoke all on public.game_guest_sessions from public,anon,authenticated;
grant all on public.game_guest_sessions to service_role;

create or replace function public.claim_game_guest_invite(p_game text,p_code text,p_display_name text,p_token_hash text)
returns setof public.game_guest_sessions
language plpgsql security definer set search_path='' as $$
declare
    v_room uuid;
    v_guest public.game_guest_sessions;
    v_vault public.time_leagues;
    v_vault_member public.time_league_members;
    v_duat public.duat_campaigns;
    v_duat_member public.duat_campaign_members;
    v_owner uuid;
    v_role text;
    v_user uuid;
begin
    if p_game is null or p_game not in ('vault','duat') or p_code is null or p_code !~ '^[0-9a-f]{48}$'
        or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
        or p_display_name is null or length(btrim(p_display_name)) not between 1 and 60
        or p_display_name ~ '[[:cntrl:]]' then raise exception 'Use a valid invitation and display name'; end if;
    -- A lost response can be retried with the browser's saved secret, including
    -- when two initial requests arrive together. The hash cannot change seats.
    perform pg_advisory_xact_lock(hashtextextended('game-guest:' || p_token_hash,0));
    if p_game='vault' then
        select league_id into v_room from public.time_league_members where invite_code=p_code;
        if v_room is null then raise exception 'This invitation does not exist'; end if;
        select * into v_vault from public.time_leagues where id=v_room for update;
        select * into v_vault_member from public.time_league_members where invite_code=p_code for update;
        v_owner:=v_vault_member.user_id; v_role:=v_vault_member.role;
    else
        select room_id into v_room from public.duat_campaign_members where invite_code=p_code;
        if v_room is null then raise exception 'This invitation does not exist'; end if;
        select * into v_duat from public.duat_campaigns where id=v_room for update;
        select * into v_duat_member from public.duat_campaign_members where invite_code=p_code for update;
        v_owner:=v_duat_member.user_id; v_role:=v_duat_member.role;
    end if;
    select * into v_guest from public.game_guest_sessions where token_hash=p_token_hash;
    if found then
        if v_guest.game<>p_game or v_guest.room_id<>v_room or v_owner is distinct from v_guest.app_user_id
            then raise exception 'This guest pass belongs to another seat'; end if;
        if v_guest.revoked_at is not null or v_guest.expires_at<=clock_timestamp() then raise exception 'This guest pass has expired or is unavailable'; end if;
        return next v_guest; return;
    end if;
    if v_role is distinct from 'member' or v_owner is not null then raise exception 'This seat has already been claimed'; end if;
    if p_game='vault' and (v_vault.draft_started or v_vault.phase is distinct from 'draft') then raise exception 'This draft has already started'; end if;
    if p_game='duat' and not coalesce(v_duat.state->>'phase'='preseason' or (v_duat.state->>'phase'='draft' and v_duat.state#>>'{draft,status}'='waiting'),false)
        then raise exception 'The campaign has started; seats are locked'; end if;
    v_user:=gen_random_uuid();
    insert into public.app_users(id,email,password_hash,display_name)
        values(v_user,'guest-' || v_user::text || '@guests.invalid','guest:' || gen_random_uuid()::text,btrim(p_display_name));
    if p_game='vault' then
        perform public.claim_time_league_invite(v_user,p_code);
    else
        perform public.claim_duat_campaign_invite(v_user,p_code);
    end if;
    insert into public.game_guest_sessions(token_hash,game,room_id,app_user_id,display_name,expires_at)
        values(p_token_hash,p_game,v_room,v_user,btrim(p_display_name),clock_timestamp()+interval '180 days') returning * into v_guest;
    return next v_guest;
end $$;
revoke all on function public.claim_game_guest_invite(text,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_game_guest_invite(text,text,text,text) to service_role;

commit;
