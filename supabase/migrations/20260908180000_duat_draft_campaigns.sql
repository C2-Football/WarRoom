begin;

-- Extend only Duat contracts. Existing version-one campaigns keep their original flow.
create or replace function public.create_duat_campaign(p_user_id uuid,p_state jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_faction text; v_host text; v_humans text[];
begin
    if p_user_id is null or jsonb_typeof(p_state) is distinct from 'object' or (((p_state->>'phase'='preseason' and p_state->>'version'='1') or (p_state->>'phase'='draft' and p_state->>'version'='2' and p_state#>>'{draft,status}'='waiting')) is not true) then raise exception 'Invalid new campaign'; end if;
    v_host := p_state->>'hostFactionId';
    select array_agg(value) into v_humans from jsonb_array_elements_text(p_state->'humanFactionIds');
    if v_host is null or coalesce(array_length(v_humans,1),0) not between 1 and 14 or not (v_host=any(v_humans))
        or (select count(distinct value) from unnest(v_humans) value) <> array_length(v_humans,1)
        or jsonb_array_length(p_state->'factions') is distinct from 14
        or (select count(distinct f->>'id') from jsonb_array_elements(p_state->'factions') f) <> 14
        or exists(select 1 from unnest(v_humans) h where not exists(select 1 from jsonb_array_elements(p_state->'factions') f where f->>'id'=h))
        then raise exception 'Choose unique human factions including the host'; end if;
    insert into duat_campaigns(created_by,state) values(p_user_id,p_state) returning id into v_id;
    foreach v_faction in array v_humans loop
        insert into duat_campaign_members(room_id,faction_id,role,user_id,joined_at)
        values(v_id,v_faction,case when v_faction=v_host then 'host' else 'member' end,
            case when v_faction=v_host then p_user_id else null end,
            case when v_faction=v_host then now() else null end);
    end loop;
    return v_id;
end $$;

create or replace function public.claim_duat_campaign_invite(p_user_id uuid,p_code text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_room_id uuid; v_room duat_campaigns; v_member duat_campaign_members;
begin
    if p_user_id is null then raise exception 'Sign in to claim a faction'; end if;
    select room_id into v_room_id from duat_campaign_members where invite_code=p_code;
    if v_room_id is null then raise exception 'This invitation does not exist'; end if;
    -- Lock the room first for the same ordering as readiness and game actions.
    select * into v_room from duat_campaigns where id=v_room_id for update;
    select * into v_member from duat_campaign_members where invite_code=p_code for update;
    if v_member.user_id=p_user_id then return v_room_id; end if;
    if v_member.user_id is not null then raise exception 'This faction already has an owner'; end if;
    if not (v_room.state->>'phase'='preseason' or (v_room.state->>'phase'='draft' and v_room.state#>>'{draft,status}'='waiting')) then raise exception 'The campaign has started; seats are locked'; end if;
    if exists(select 1 from duat_campaign_members where room_id=v_room_id and user_id=p_user_id) then raise exception 'You already own a faction in this campaign'; end if;
    update duat_campaign_members set user_id=p_user_id,joined_at=now(),ready=false where room_id=v_room_id and faction_id=v_member.faction_id;
    update duat_campaigns set revision=revision+1,updated_at=now() where id=v_room_id;
    return v_room_id;
end $$;

-- The Edge engine computes p_next_state; this transaction rechecks membership,
-- readiness and the expected revision before committing that exact result.
create or replace function public.commit_duat_campaign_action(p_user_id uuid,p_room_id uuid,p_expected_revision integer,p_action_id text,p_action jsonb,p_next_state jsonb default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_room duat_campaigns; v_member duat_campaign_members; v_receipt duat_campaign_actions;
    v_type text; v_ready boolean; v_revision integer; v_cursor integer; v_position integer; v_turn text;
begin
    if p_user_id is null or p_action_id is null or length(p_action_id) not between 1 and 120 or jsonb_typeof(p_action) is distinct from 'object' then raise exception 'Invalid campaign action'; end if;
    select * into v_room from duat_campaigns where id=p_room_id for update;
    if not found then raise exception 'Campaign not found'; end if;
    select * into v_member from duat_campaign_members where room_id=p_room_id and user_id=p_user_id and joined_at is not null;
    if not found then raise exception 'You do not have a faction in this campaign'; end if;
    select * into v_receipt from duat_campaign_actions where room_id=p_room_id and user_id=p_user_id and action_id=p_action_id;
    if found then
        if v_receipt.request is distinct from p_action then raise exception 'This action ID was already used for another intent'; end if;
        return jsonb_build_object('ok',true,'revision',v_room.revision,'deduplicated',true);
    end if;
    if p_expected_revision is null or p_expected_revision<>v_room.revision then return jsonb_build_object('ok',false,'conflict',true,'revision',v_room.revision); end if;
    v_type := p_action->>'type';
    if v_type not in ('set-ready','start-draft','draft-pick','reveal-next','reveal-rulers','set-lineup','declare-favor','clear-favor','claim','attack','fortify','advance-week') or v_type is null then raise exception 'Unknown Duat action'; end if;
    if p_action ? 'factionId' and p_action->>'factionId' is distinct from v_member.faction_id then raise exception 'You can only control your own faction'; end if;
    if v_room.state->>'phase'='complete' then raise exception 'This campaign is complete'; end if;
    if v_type in ('start-draft','reveal-next','reveal-rulers','advance-week') then
        if v_member.role<>'host' then raise exception 'Only the host can advance the campaign'; end if;
        if exists(select 1 from duat_campaign_members where room_id=p_room_id and (user_id is null or joined_at is null or not ready)) then raise exception 'Every human faction must join and be ready'; end if;
        if (v_type='reveal-rulers' and v_room.state->>'phase'<>'preseason')
            or (v_type='advance-week' and v_room.state->>'phase'<>'season')
            or (v_type='start-draft' and (v_room.state->>'phase'<>'draft' or v_room.state#>>'{draft,status}'<>'waiting'))
            or (v_type='reveal-next' and v_room.state->>'phase'<>'reveal') then raise exception 'That campaign stage is not open'; end if;
    end if;
    if v_type='draft-pick' then
        if v_room.state->>'phase'<>'draft' or v_room.state#>>'{draft,status}'<>'active' then raise exception 'This draft is not accepting picks'; end if;
        v_cursor := (v_room.state#>>'{draft,cursor}')::integer;
        v_position := mod(v_cursor,14);
        if mod(v_cursor / 14,2)=1 then v_position := 13-v_position; end if;
        v_turn := v_room.state#>'{draft,order}'->>v_position;
        if v_turn is distinct from v_member.faction_id then raise exception 'Wait for your faction turn to draft'; end if;
    end if;
    if v_type='set-ready' and v_room.state->>'phase'='draft' and v_room.state#>>'{draft,status}'<>'waiting' then raise exception 'Readiness is not used during draft turns'; end if;
    if v_type='set-ready' and v_room.state->>'phase'='reveal' and jsonb_array_length(v_room.state#>'{archaeology,revealedFactionIds}')>0 then raise exception 'The expedition has begun; readiness returns in Week 1'; end if;
    if v_type in ('set-lineup','declare-favor','clear-favor') and v_member.ready then raise exception 'Mark yourself unready before changing your lineup or favor'; end if;
    if v_type='set-ready' then
        if jsonb_typeof(p_action->'ready') is distinct from 'boolean' or p_next_state is not null then raise exception 'Invalid readiness action'; end if;
        v_ready := (p_action->>'ready')::boolean;
        update duat_campaign_members set ready=v_ready where room_id=p_room_id and faction_id=v_member.faction_id;
    else
        if jsonb_typeof(p_next_state) is distinct from 'object' or p_next_state->>'id' is distinct from v_room.state->>'id'
            or p_next_state->'humanFactionIds' is distinct from v_room.state->'humanFactionIds'
            or p_next_state->>'hostFactionId' is distinct from v_room.state->>'hostFactionId'
            or p_next_state->>'version' is distinct from v_room.state->>'version'
            or p_next_state->>'seed' is distinct from v_room.state->>'seed'
            or (select jsonb_agg(f->>'id') from jsonb_array_elements(p_next_state->'factions') f) is distinct from (select jsonb_agg(f->>'id') from jsonb_array_elements(v_room.state->'factions') f)
            then raise exception 'Invalid authoritative campaign state'; end if;
        update duat_campaigns set state=p_next_state where id=p_room_id;
        if v_type in ('start-draft','reveal-rulers','advance-week') or (v_type='reveal-next' and p_next_state->>'phase'='season') then update duat_campaign_members set ready=false where room_id=p_room_id; end if;
    end if;
    update duat_campaigns set revision=revision+1,updated_at=now() where id=p_room_id returning revision into v_revision;
    insert into duat_campaign_actions(room_id,user_id,action_id,request,revision) values(p_room_id,p_user_id,p_action_id,p_action,v_revision);
    return jsonb_build_object('ok',true,'revision',v_revision);
end $$;

revoke all on function public.create_duat_campaign(uuid,jsonb), public.claim_duat_campaign_invite(uuid,text), public.commit_duat_campaign_action(uuid,uuid,integer,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_duat_campaign(uuid,jsonb), public.claim_duat_campaign_invite(uuid,text), public.commit_duat_campaign_action(uuid,uuid,integer,text,jsonb,jsonb) to service_role;
commit;
