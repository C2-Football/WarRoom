-- Run against a database with the Vault migration applied. All test changes roll back.
begin;
do $$
declare u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid(); league uuid; code text; n integer;
begin
 insert into app_users(id,email,password_hash) values (u1,u1::text || '@vault-qa.invalid','not-a-login'),(u2,u2::text || '@vault-qa.invalid','not-a-login'),(u3,u3::text || '@vault-qa.invalid','not-a-login');
 league := create_time_league(u1, '{"leagueId":"qa", "name":"QA", "phase":"draft", "currentWeek":1,"teams":[{"teamId":"t1","manager":"human"},{"teamId":"t2","manager":"human"},{"teamId":"t3","manager":"human"}]}'::jsonb);
 select count(*) into n from time_league_members where league_id = league;
 assert n = 3, 'atomic creation must create all seats';
 select invite_code into code from time_league_members where league_id = league and seat_team_id = 't2';
 assert claim_time_league_invite(u2, code) = league, 'claim succeeds';
 assert claim_time_league_invite(u2, code) = league, 'claim is idempotent';
 begin
  perform claim_time_league_invite(u3,code);
  raise exception 'test failed: stole claimed seat';
 exception when raise_exception then
  if sqlerrm not like '%already been claimed%' then raise; end if;
 end;
 select invite_code into code from time_league_members where league_id = league and seat_team_id = 't3';
 begin
  perform claim_time_league_invite(u2,code);
  raise exception 'test failed: claimed second seat';
 exception when raise_exception then
  if sqlerrm not like '%already have a seat%' then raise; end if;
 end;
 assert not has_table_privilege('authenticated','public.time_leagues','UPDATE'), 'clients cannot overwrite game state';
 assert not has_table_privilege('authenticated','public.time_league_members','SELECT'), 'clients cannot read invite secrets';
 assert not has_function_privilege('authenticated','public.create_time_league(uuid,jsonb)','EXECUTE'), 'clients cannot impersonate a creator';
 update time_leagues set state = jsonb_set(state,'{phase}','"season"') where id = league;
 select version into n from time_leagues where id = league;
 perform set_time_league_ready(u2, league, true);
 assert (select version from time_leagues where id = league) = n + 1, 'readiness bumps CAS version';
 assert (select ready_week from time_league_members where league_id = league and user_id = u2) = 1, 'readiness persisted';
end $$;
rollback;
select 'PASS: create, claim, idempotency, seat theft, duplicate ownership, grants and readiness; all test changes rolled back' as result;
