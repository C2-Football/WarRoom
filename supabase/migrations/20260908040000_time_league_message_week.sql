begin;

-- The saved scoring week advances before the owner leaves postgame. Validate
-- chat against that visible final while retaining the internal progression week
-- for rivalry decay. Old Edge runtimes may submit the internal week during the
-- rollout; the DB always stores its own visible week. Existing rows are untouched.
create or replace function public.send_time_league_message(p_user_id uuid, p_league_id uuid, p_expected_version integer, p_messages jsonb, p_relationship jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_game time_leagues; v_member time_league_members; v_first jsonb; v_message jsonb;
    v_existing jsonb; v_target jsonb; v_sender jsonb; v_count integer; v_index integer;
    v_week integer; v_message_week integer; v_heat integer; v_previous jsonb; v_relationships jsonb;
    v_now timestamptz := clock_timestamp(); v_reply text;
begin
    select * into v_game from time_leagues where id = p_league_id for update;
    if not found then raise exception 'This league is unavailable'; end if;
    select * into v_member from time_league_members where league_id = p_league_id and user_id = p_user_id and joined_at is not null;
    if not found then raise exception 'You need a joined seat to send messages'; end if;
    if jsonb_typeof(p_messages) is distinct from 'array' or jsonb_array_length(p_messages) not between 1 and 2 then raise exception 'Invalid message package'; end if;
    v_first := p_messages->0;
    select value into v_sender from jsonb_array_elements(v_game.state->'teams') where value->>'teamId' = v_member.seat_team_id and value->>'manager' = 'human';
    if v_sender is null or v_first->>'fromTeamId' is distinct from v_member.seat_team_id then raise exception 'You can only speak for your own team'; end if;
    select value into v_target from jsonb_array_elements(v_game.state->'teams') where value->>'teamId' = v_first->>'toTeamId';
    if v_target is null or v_target->>'teamId' = v_member.seat_team_id then raise exception 'Choose another manager in your league'; end if;
    if v_target->>'manager' = 'human' and not exists(select 1 from time_league_members where league_id = p_league_id and seat_team_id = v_target->>'teamId' and user_id is not null and joined_at is not null) then raise exception 'That manager has not joined the league yet'; end if;
    if v_first->>'id' is null or v_first->>'id' !~ '^chat:[A-Za-z0-9_-]{8,80}$' then raise exception 'Invalid send identifier'; end if;

    -- Exact retries are acknowledged before CAS, rate checks, or AI updates.
    select payload into v_existing from time_league_messages where league_id = p_league_id and message_id = v_first->>'id';
    if found then
        if (v_existing->>'fromTeamId',v_existing->>'toTeamId',v_existing->>'text',v_existing->>'tone',coalesce(v_existing->>'replyToId',''))
            is distinct from (v_first->>'fromTeamId',v_first->>'toTeamId',v_first->>'text',v_first->>'tone',coalesce(v_first->>'replyToId','')) then
            raise exception 'That message identifier was already used';
        end if;
        return jsonb_build_object('ok',true,'version',v_game.version,'deduplicated',true);
    end if;
    if p_expected_version is null or p_expected_version <> v_game.version then return jsonb_build_object('ok',false,'conflict',true); end if;
    select count(*) into v_count from time_league_messages where league_id = p_league_id and from_team_id = v_member.seat_team_id and message_id like 'chat:%' and created_at > v_now - interval '1 minute';
    if v_count >= 10 then raise exception 'Give that manager a moment before sending another message'; end if;
    v_week := least(20,greatest(1,coalesce(v_game.current_week,1)));
    v_message_week := greatest(1,v_week - case when v_game.state->>'weekStage' = 'postgame' then 1 else 0 end);
    if jsonb_array_length(p_messages) <> (case when v_target->>'manager' = 'ai' then 2 else 1 end) then raise exception 'Invalid reply package'; end if;

    for v_index in 0..jsonb_array_length(p_messages)-1 loop
        v_message := p_messages->v_index;
        if jsonb_typeof(v_message) is distinct from 'object'
            or (v_message - array['id','fromTeamId','toTeamId','text','tone','week','createdAt','sequence','replyToId']) <> '{}'::jsonb
            or jsonb_typeof(v_message->'text') is distinct from 'string'
            or char_length(v_message->>'text') not between 1 and 500 or btrim(v_message->>'text') = ''
            or jsonb_typeof(v_message->'tone') is distinct from 'string' or v_message->>'tone' not in ('neutral','friendly','competitive','dismissive')
            or jsonb_typeof(v_message->'week') is distinct from 'number' or v_message->>'week' not in (v_message_week::text,v_week::text)
            or jsonb_typeof(v_message->'sequence') is distinct from 'number' or v_message->>'sequence' !~ '^[1-9][0-9]{0,8}$'
            or jsonb_typeof(v_message->'createdAt') is distinct from 'string' then raise exception 'Invalid message fields'; end if;
        -- Timestamps in the persisted payload are always assigned by the DB.
        if v_index = 1 and (v_message->>'id' is distinct from 'reply:' || substring(v_first->>'id' from 6)
            or v_message->>'fromTeamId' is distinct from v_target->>'teamId'
            or v_message->>'toTeamId' is distinct from v_member.seat_team_id
            or v_message->>'tone' is distinct from 'neutral'
            or v_message->>'replyToId' is distinct from v_first->>'id') then raise exception 'Invalid AI reply'; end if;
        if v_message ? 'replyToId' then
            v_reply := v_message->>'replyToId';
            if jsonb_typeof(v_message->'replyToId') is distinct from 'string' or char_length(v_reply) not between 1 and 160 then raise exception 'Invalid reply reference'; end if;
            if v_index = 0 and v_reply ~ '^(chat|reply):' and not exists(select 1 from time_league_messages where league_id=p_league_id and message_id=v_reply and (from_team_id,to_team_id) in ((v_member.seat_team_id,v_target->>'teamId'),(v_target->>'teamId',v_member.seat_team_id))) then raise exception 'That message is not part of this conversation'; end if;
            if v_index = 0 and v_reply !~ '^(chat|reply|game|trade|waiver):' then raise exception 'Invalid reply reference'; end if;
        end if;
    end loop;

    if v_target->>'manager' = 'ai' then
        if jsonb_typeof(p_relationship) is distinct from 'object'
            or (p_relationship - array['ownerTeamId','otherTeamId','heat','updatedWeek']) <> '{}'::jsonb
            or p_relationship->>'ownerTeamId' is distinct from v_target->>'teamId'
            or p_relationship->>'otherTeamId' is distinct from v_member.seat_team_id
            or jsonb_typeof(p_relationship->'heat') is distinct from 'number'
            or p_relationship->>'heat' !~ '^-?[0-6]$'
            or jsonb_typeof(p_relationship->'updatedWeek') is distinct from 'number'
            or p_relationship->>'updatedWeek' is distinct from v_week::text then raise exception 'Invalid rivalry update'; end if;
        select value into v_previous from jsonb_array_elements(coalesce(v_game.state->'rivalRelationships','[]'::jsonb))
            where value->>'ownerTeamId'=v_target->>'teamId' and value->>'otherTeamId'=v_member.seat_team_id limit 1;
        v_heat := coalesce((v_previous->>'heat')::integer,0);
        v_heat := sign(v_heat) * greatest(0,abs(v_heat) - greatest(0,v_week - coalesce((v_previous->>'updatedWeek')::integer,v_week)));
        v_heat := least(6,greatest(-6,v_heat + case v_first->>'tone' when 'friendly' then -2 when 'competitive' then 2 when 'dismissive' then 1 else 0 end));
        if (p_relationship->>'heat')::integer <> v_heat then raise exception 'Invalid rivalry update'; end if;
        select coalesce(jsonb_agg(value),'[]'::jsonb) into v_relationships from jsonb_array_elements(coalesce(v_game.state->'rivalRelationships','[]'::jsonb))
            where not (value->>'ownerTeamId'=v_target->>'teamId' and value->>'otherTeamId'=v_member.seat_team_id);
        v_relationships := v_relationships || jsonb_build_array(p_relationship);
    elsif p_relationship is not null and p_relationship <> 'null'::jsonb then raise exception 'Human conversations do not change AI relationships'; end if;

    for v_message in select value from jsonb_array_elements(p_messages) loop
        v_message := jsonb_set(v_message,'{createdAt}',to_jsonb(v_now));
        v_message := jsonb_set(v_message,'{week}',to_jsonb(v_message_week));
        insert into time_league_messages(league_id,message_id,from_team_id,to_team_id,payload,created_at)
            values(p_league_id,v_message->>'id',v_message->>'fromTeamId',v_message->>'toTeamId',v_message,v_now);
    end loop;
    update time_leagues set state = case when v_relationships is null then state - 'rivalMessages'
            else jsonb_set(state - 'rivalMessages','{rivalRelationships}',v_relationships) end,
        version = version + 1 where id=p_league_id;
    return jsonb_build_object('ok',true,'version',v_game.version+1);
end $$;

revoke all on function public.send_time_league_message(uuid,uuid,integer,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.send_time_league_message(uuid,uuid,integer,jsonb,jsonb) to service_role;

commit;
