begin;

-- Authoritative fixed years remain private. Managers acknowledge their own final recap.
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
        'name-ruler','name-alliance','ritual','propose-pinnacle','approve-pinnacle','decline-pinnacle','next-season','reveal-years','address-ruler') or v_type is null then raise exception 'Unknown Duat action'; end if;
    if not v_dynasty and v_type in ('name-ruler','name-alliance','ritual','propose-pinnacle','approve-pinnacle','decline-pinnacle','next-season','reveal-years','address-ruler') then raise exception 'This action requires a sourcebook dynasty'; end if;
    if p_action ? 'factionId' and p_action->>'factionId' is distinct from v_member.faction_id then raise exception 'You can only control your own faction'; end if;
    select f into v_own from jsonb_array_elements(v_room.state->'factions') f where f->>'id'=v_member.faction_id;
    if v_room.state->>'phase'='complete' and (not v_dynasty or v_type not in ('set-ready','next-season','ritual','claim','attack','reveal-years','address-ruler')) then raise exception 'This campaign is complete'; end if;
    if v_type='reveal-years' and (not v_dynasty or v_room.state#>>'{era,hiddenYears}' is distinct from 'true' or v_room.state->>'phase' is distinct from 'complete') then raise exception 'Reveal scoring years from the final season recap'; end if;
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
            or p_next_state->'era' is distinct from v_room.state->'era'
            or p_next_state->>'seed' is distinct from v_room.state->>'seed'
            or (select jsonb_agg(f->>'id') from jsonb_array_elements(p_next_state->'factions') f) is distinct from (select jsonb_agg(f->>'id') from jsonb_array_elements(v_room.state->'factions') f)
            then raise exception 'Invalid authoritative campaign state'; end if;
        if v_room.state#>>'{era,hiddenYears}'='true' then
            if p_next_state#>>'{hiddenYears,version}' is distinct from '1'
                or jsonb_typeof(p_next_state#>'{hiddenYears,assignments}') is distinct from 'object'
                or exists(select 1 from jsonb_each(v_room.state#>'{hiddenYears,assignments}') old where p_next_state#>'{hiddenYears,assignments}'->old.key is distinct from old.value)
                then raise exception 'Fixed hidden scoring years cannot change'; end if;
            if v_type not in ('start-draft','draft-pick','ritual','next-season') and p_next_state#>'{hiddenYears,assignments}' is distinct from v_room.state#>'{hiddenYears,assignments}' then raise exception 'Only new player acquisition may assign a hidden year'; end if;
            if v_type='reveal-years' then
                if (p_next_state - 'updatedAt' - 'hiddenYears') is distinct from (v_room.state - 'updatedAt' - 'hiddenYears')
                    or ((p_next_state#>'{hiddenYears,revealedByFaction}') - v_member.faction_id) is distinct from ((v_room.state#>'{hiddenYears,revealedByFaction}') - v_member.faction_id)
                    then raise exception 'A recap reveal cannot rewrite game state or another manager'; end if;
            elsif p_next_state#>'{hiddenYears,revealedByFaction}' is distinct from v_room.state#>'{hiddenYears,revealedByFaction}' then raise exception 'Only recap acknowledgement reveals scoring years'; end if;
        end if;
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
        if v_type='address-ruler' then
            if (p_next_state - 'updatedAt' - 'council') is distinct from (v_room.state - 'updatedAt' - 'council')
                or p_next_state#>>'{council,version}' is distinct from '1'
                or jsonb_typeof(p_next_state#>'{council,messages}') is distinct from 'array'
                or jsonb_array_length(p_next_state#>'{council,messages}') not between 1 and 400
                then raise exception 'Council conversations may only update their saved exchanges'; end if;
            if p_next_state->'council' is distinct from v_room.state->'council' then
                if (p_next_state#>'{council,messages}')->-1->>'fromFactionId' is distinct from v_member.faction_id
                    or (p_next_state#>'{council,messages}')->-1->>'toFactionId' is distinct from p_action->>'targetFactionId'
                    or (p_next_state#>'{council,messages}')->-1->>'id' is distinct from p_action->>'messageId'
                    or ((p_next_state#>'{council,messages}') - (jsonb_array_length(p_next_state#>'{council,messages}')-1)) is distinct from
                        (case when jsonb_array_length(coalesce(v_room.state#>'{council,messages}','[]'::jsonb))=400
                            then (v_room.state#>'{council,messages}') - 0 else coalesce(v_room.state#>'{council,messages}','[]'::jsonb) end)
                    then raise exception 'Append only the acting managers council exchange'; end if;
            end if;
        elsif p_next_state->'council' is distinct from v_room.state->'council' then
            raise exception 'Only addressing a ruler may change council conversations';
        end if;
        update duat_campaigns set state=p_next_state where id=p_room_id;
        if v_type in ('start-draft','reveal-rulers','advance-week','next-season') or (v_type='reveal-next' and p_next_state->>'phase'='season') then update duat_campaign_members set ready=false where room_id=p_room_id; end if;
    end if;
    update duat_campaigns set revision=revision+1,updated_at=now() where id=p_room_id returning revision into v_revision;
    insert into duat_campaign_actions(room_id,user_id,action_id,request,revision) values(p_room_id,p_user_id,p_action_id,p_action,v_revision);
    return jsonb_build_object('ok',true,'revision',v_revision);
end $$;

revoke all on function public.commit_duat_campaign_action(uuid,uuid,integer,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.commit_duat_campaign_action(uuid,uuid,integer,text,jsonb,jsonb) to service_role;

commit;
