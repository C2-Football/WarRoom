begin;

-- Draft reveals and weekly lineups share readiness. Lock the game row before
-- changing a member so a competing start/advance fails its version check.
create or replace function public.set_time_league_ready(p_user_id uuid, p_league_id uuid, p_ready boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
    v_week integer;
    v_phase text;
    v_started boolean;
    v_previous integer;
    v_target integer;
begin
    select current_week, phase, draft_started into v_week, v_phase, v_started
        from time_leagues where id = p_league_id for update;
    if not found or v_phase is null or v_phase not in ('draft', 'season') then
        raise exception 'Readiness is available during the draft or season';
    end if;
    if v_phase = 'draft' and not v_started then
        raise exception 'Wait for the commissioner to open the draft room';
    end if;

    select ready_week into v_previous from time_league_members
        where league_id = p_league_id and user_id = p_user_id and joined_at is not null
        for update;
    if not found then raise exception 'You do not have a joined seat'; end if;

    v_target := case when p_ready then v_week else 0 end;
    -- Reconnects and repeated polling may send the same readiness twice. They
    -- must not invalidate an otherwise-current draft pick or bid.
    if v_previous = v_target then return; end if;
    update time_league_members set ready_week = v_target
        where league_id = p_league_id and user_id = p_user_id;
    update time_leagues set version = version + 1 where id = p_league_id;
end $$;

revoke all on function public.set_time_league_ready(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.set_time_league_ready(uuid,uuid,boolean) to service_role;

commit;
