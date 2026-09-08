begin;

-- Sourcebook dynasties extend the existing private Duat rooms. The Edge engine
-- remains the only author of outcomes. Versions 1--3 keep their original shape.
create or replace function public.create_duat_campaign(p_user_id uuid,p_state jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_faction text; v_host text; v_humans text[]; v_size integer;
begin
    if p_user_id is null or jsonb_typeof(p_state) is distinct from 'object'
        or (((p_state->>'phase'='preseason' and p_state->>'version'='1')
        or (p_state->>'phase'='draft' and p_state->>'version' in ('2','3','4') and p_state#>>'{draft,status}'='waiting')) is not true)
        then raise exception 'Invalid new campaign'; end if;
    v_size := case when p_state->>'version' in ('3','4') then (p_state#>>'{settings,leagueSize}')::integer else 14 end;
    if v_size is null or v_size not in (8,10,12,14,16) then raise exception 'Invalid league size'; end if;
    if p_state->>'version'='4' and (p_state->>'expansionVersion' is distinct from '1'
        or p_state->>'dynastySeason' is distinct from '1' or p_state#>>'{dynasty,cycle}' is distinct from '1'
        or jsonb_typeof(p_state->'expansionSettings') is distinct from 'object'
        or jsonb_typeof(p_state#>'{draft,queue}') is distinct from 'array') then raise exception 'Invalid sourcebook dynasty'; end if;
    v_host := p_state->>'hostFactionId';
    select array_agg(value) into v_humans from jsonb_array_elements_text(p_state->'humanFactionIds');
    if v_host is null or coalesce(array_length(v_humans,1),0) not between 1 and v_size or not (v_host=any(v_humans))
        or (select count(distinct value) from unnest(v_humans) value) <> array_length(v_humans,1)
        or jsonb_array_length(p_state->'factions') is distinct from v_size
        or (select count(distinct f->>'id') from jsonb_array_elements(p_state->'factions') f) <> v_size
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

create or replace function public.commit_duat_campaign_action(p_user_id uuid,p_room_id uuid,p_expected_revision integer,p_action_id text,p_action jsonb,p_next_state jsonb default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_room duat_campaigns; v_member duat_campaign_members; v_receipt duat_campaign_actions;
    v_type text; v_ready boolean; v_revision integer; v_cursor integer; v_position integer; v_turn text;
    v_size integer; v_rounds integer; v_dynasty boolean; v_cycle integer; v_own jsonb;
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
    v_dynasty := coalesce(v_room.state->>'version'='4' and v_room.state->>'expansionVersion'='1',false);
    if v_type not in ('set-ready','start-draft','draft-pick','reveal-next','reveal-rulers','set-lineup','declare-favor','clear-favor','claim','attack','fortify','advance-week',
        'name-ruler','name-alliance','ritual','propose-pinnacle','approve-pinnacle','decline-pinnacle','next-season') or v_type is null then raise exception 'Unknown Duat action'; end if;
    if not v_dynasty and v_type in ('name-ruler','name-alliance','ritual','propose-pinnacle','approve-pinnacle','decline-pinnacle','next-season') then raise exception 'This action requires a sourcebook dynasty'; end if;
    if p_action ? 'factionId' and p_action->>'factionId' is distinct from v_member.faction_id then raise exception 'You can only control your own faction'; end if;
    select f into v_own from jsonb_array_elements(v_room.state->'factions') f where f->>'id'=v_member.faction_id;
    if v_room.state->>'phase'='complete' and (not v_dynasty or v_type not in ('set-ready','next-season','ritual','claim','attack')) then raise exception 'This campaign is complete'; end if;
    if v_type='ritual' and v_room.state->>'phase'='complete' and
        (p_action->>'ritualId' not in ('amun','plutus') or p_action->>'ritualId' is null or v_room.state->>'championId' is distinct from v_member.faction_id)
        then raise exception 'Only the reigning champion may enter the Throne Room'; end if;
    if v_type in ('start-draft','reveal-next','reveal-rulers','advance-week','next-season') then
        if v_member.role<>'host' then raise exception 'Only the host can advance the campaign'; end if;
        if exists(select 1 from duat_campaign_members where room_id=p_room_id and (user_id is null or joined_at is null or not ready)) then raise exception 'Every human faction must join and be ready'; end if;
        if v_dynasty and exists(select 1 from jsonb_array_elements(v_room.state->'factions') f where f#>'{rituals,pendingMahdi}' is not null and f#>'{rituals,pendingMahdi}'<>'null'::jsonb) then raise exception 'Accept or decline every waiting Mahdi recruit before advancing'; end if;
        if (v_type='reveal-rulers' and v_room.state->>'phase'<>'preseason')
            or (v_type='advance-week' and v_room.state->>'phase'<>'season')
            or (v_type='next-season' and v_room.state->>'phase'<>'complete')
            or (v_type='start-draft' and (v_room.state->>'phase'<>'draft' or v_room.state#>>'{draft,status}'<>'waiting'))
            or (v_type='reveal-next' and v_room.state->>'phase'<>'reveal') then raise exception 'That campaign stage is not open'; end if;
    end if;
    if v_type='draft-pick' then
        if v_room.state->>'phase'<>'draft' or v_room.state#>>'{draft,status}'<>'active' then raise exception 'This draft is not accepting picks'; end if;
        v_cursor := (v_room.state#>>'{draft,cursor}')::integer;
        if v_dynasty then
            -- Refilling damaged tombs and champion claims can make rounds uneven.
            -- The engine's explicit queue, not a modulus, determines the actor.
            v_turn := v_room.state#>'{draft,queue}'->v_cursor->>'factionId';
        else
            v_size := jsonb_array_length(v_room.state->'factions');
            v_rounds := (v_room.state#>>'{draft,totalPicks}')::integer / v_size / jsonb_array_length(v_room.state->'seasons');
            v_position := mod(v_cursor,v_size);
            if mod(mod(v_cursor,v_size*v_rounds) / v_size,2)=1 then v_position := v_size-1-v_position; end if;
            v_turn := v_room.state#>'{draft,order}'->>v_position;
        end if;
        if v_turn is distinct from v_member.faction_id then raise exception 'Wait for your faction turn to draft'; end if;
    end if;
    if v_type='set-ready' and v_room.state->>'phase'='draft' and v_room.state#>>'{draft,status}'<>'waiting' then raise exception 'Readiness is not used during draft turns'; end if;
    if v_type='set-ready' and v_room.state->>'phase'='reveal' and jsonb_array_length(v_room.state#>'{archaeology,revealedFactionIds}')>0 then raise exception 'The expedition has begun; readiness returns in Week 1'; end if;
    if v_type in ('set-lineup','declare-favor','clear-favor','name-ruler','name-alliance','ritual','propose-pinnacle','approve-pinnacle','decline-pinnacle') and v_member.ready then raise exception 'Mark yourself unready before changing dynasty decisions'; end if;
    if v_type='set-ready' then
        if jsonb_typeof(p_action->'ready') is distinct from 'boolean' or p_next_state is not null then raise exception 'Invalid readiness action'; end if;
        v_ready := (p_action->>'ready')::boolean;
        if v_ready and v_dynasty and v_own#>'{rituals,pendingMahdi}' is not null and v_own#>'{rituals,pendingMahdi}'<>'null'::jsonb then raise exception 'Accept or decline your waiting Mahdi recruit before becoming ready'; end if;
        update duat_campaign_members set ready=v_ready where room_id=p_room_id and faction_id=v_member.faction_id;
    else
        if jsonb_typeof(p_next_state) is distinct from 'object' or p_next_state->>'id' is distinct from v_room.state->>'id'
            or p_next_state->'humanFactionIds' is distinct from v_room.state->'humanFactionIds'
            or p_next_state->>'hostFactionId' is distinct from v_room.state->>'hostFactionId'
            or p_next_state->>'version' is distinct from v_room.state->>'version'
            or p_next_state->'settings' is distinct from v_room.state->'settings'
            or p_next_state->'scoring' is distinct from v_room.state->'scoring'
            or p_next_state->>'seed' is distinct from v_room.state->>'seed'
            or (select jsonb_agg(f->>'id') from jsonb_array_elements(p_next_state->'factions') f) is distinct from (select jsonb_agg(f->>'id') from jsonb_array_elements(v_room.state->'factions') f)
            then raise exception 'Invalid authoritative campaign state'; end if;
        if v_dynasty then
            v_cycle := (v_room.state->>'dynastySeason')::integer;
            if p_next_state->>'expansionVersion' is distinct from v_room.state->>'expansionVersion'
                or p_next_state->'expansionSettings' is distinct from v_room.state->'expansionSettings'
                or p_next_state->'calendarVersion' is distinct from v_room.state->'calendarVersion'
                or p_next_state->>'createdAt' is distinct from v_room.state->>'createdAt'
                or p_next_state->>'name' is distinct from v_room.state->>'name'
                then raise exception 'Invalid immutable dynasty rules'; end if;
            if v_type='next-season' then
                if p_next_state->>'phase' is distinct from 'draft' or p_next_state->>'week' is distinct from '1'
                    or (p_next_state->>'dynastySeason')::integer is distinct from v_cycle+1
                    or (p_next_state#>>'{dynasty,cycle}')::integer is distinct from v_cycle+1
                    then raise exception 'A dynasty may advance exactly one season'; end if;
            elsif p_next_state->'dynastySeason' is distinct from v_room.state->'dynastySeason'
                or p_next_state#>'{dynasty,cycle}' is distinct from v_room.state#>'{dynasty,cycle}' then raise exception 'Only next-season may change the dynasty cycle'; end if;
            if v_type not in ('ritual','next-season') and p_next_state->'seasons' is distinct from v_room.state->'seasons' then raise exception 'Only a ritual or next-season may change historical years'; end if;
            if jsonb_typeof(p_next_state->'seasons') is distinct from 'array' or jsonb_array_length(p_next_state->'seasons') not between 1 and 24
                or (select count(distinct value) from jsonb_array_elements(p_next_state->'seasons')) <> jsonb_array_length(p_next_state->'seasons')
                or exists(select 1 from jsonb_array_elements(p_next_state->'seasons') y where jsonb_typeof(y)<>'number' or y::text !~ '^[0-9]{4}$' or (y::text)::integer not between 1920 and 2100)
                then raise exception 'Invalid dynasty historical years'; end if;
        elsif p_next_state->'seasons' is distinct from v_room.state->'seasons' then raise exception 'Invalid authoritative campaign state'; end if;
        update duat_campaigns set state=p_next_state where id=p_room_id;
        if v_type in ('start-draft','reveal-rulers','advance-week','next-season') or (v_type='reveal-next' and p_next_state->>'phase'='season') then update duat_campaign_members set ready=false where room_id=p_room_id; end if;
    end if;
    update duat_campaigns set revision=revision+1,updated_at=now() where id=p_room_id returning revision into v_revision;
    insert into duat_campaign_actions(room_id,user_id,action_id,request,revision) values(p_room_id,p_user_id,p_action_id,p_action,v_revision);
    return jsonb_build_object('ok',true,'revision',v_revision);
end $$;

revoke all on function public.create_duat_campaign(uuid,jsonb), public.claim_duat_campaign_invite(uuid,text), public.commit_duat_campaign_action(uuid,uuid,integer,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_duat_campaign(uuid,jsonb), public.claim_duat_campaign_invite(uuid,text), public.commit_duat_campaign_action(uuid,uuid,integer,text,jsonb,jsonb) to service_role;
commit;
