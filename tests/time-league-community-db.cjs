'use strict';
// Database integration test without a production connection:
// npm install --prefix /tmp/vault-community-qa --no-save @electric-sql/pglite
// PGLITE_MODULE=/tmp/vault-community-qa/node_modules/@electric-sql/pglite node tests/time-league-community-db.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
(async () => {
    const db = new PGlite();
    await db.exec(`create role anon;create role authenticated;create role service_role;
        create table app_users(id uuid primary key);
        create function current_app_user_id() returns uuid language sql as $$select null::uuid$$;
        create function gen_random_bytes(n integer) returns bytea language sql as $$select substring(decode(repeat(md5(random()::text),n),'hex') from 1 for n)$$;`);
    await db.exec(fs.readFileSync('supabase/migrations/20260907193000_time_league_multiplayer.sql', 'utf8'));
    const migration = fs.readFileSync('supabase/migrations/20260908010000_time_league_community.sql', 'utf8');
    await db.exec(migration);
    await db.exec(migration); // Migration allowlist requires safe reapplication.
    const q = async (sql, values = []) => (await db.query(sql, values)).rows;
    const users = (await q("insert into app_users select gen_random_uuid() from generate_series(1,5) returning id")).map(r => r.id);
    const identity = name => ({ displayName: name, teamName: name + ' Club', primaryColor: '#112233', secondaryColor: '#ffffff', backdrop: 'stadium', helmet: { color: 'royal' } });
    const profile = async (u, name, pub = true, looking = true) => (await q('insert into time_league_profiles(user_id,identity,public_profile,looking_for_league) values($1,$2,$3,$4) returning profile_id', [u, identity(name), pub, looking]))[0].profile_id;
    await profile(users[0], 'Host'); const target = await profile(users[1], 'Guest');
    const privateTarget = await profile(users[2], 'Private', false, false);
    const uninterested = await profile(users[3], 'Settled', true, false);
    await profile(users[4], 'Rival');
    const state = () => ({ leagueId: 'test-' + Math.random(), name: 'Community QA', phase: 'draft', currentWeek: 1,
        teams: [{ teamId: 't1', name: 'Host', manager: 'human' }, { teamId: 't2', name: 'Open', manager: 'human' }, { teamId: 't3', name: 'CPU', manager: 'ai' }], finalizedWeeks: [] });
    const create = async () => (await q('select create_time_league($1,$2) as id', [users[0], state()]))[0].id;
    const league = await create();
    const send = (actor, profileId = target, rowId = league) => q("select send_time_league_community_invite($1,$2,'t2',$3) as id", [actor, rowId, profileId]);
    const reject = async (fn, pattern) => assert.rejects(fn, pattern);
    await reject(() => send(users[4]), /commissioner/);
    await reject(() => send(users[0], privateTarget), /not available/);
    await reject(() => send(users[0], uninterested), /not available/);
    const invite = (await send(users[0]))[0].id;
    await reject(() => send(users[0]), /already invited/);
    await reject(() => q('select respond_time_league_community_invite($1,$2,true)', [users[4], invite]), /not addressed/);
    await q('select respond_time_league_community_invite($1,$2,true)', [users[1], invite]);
    assert.equal((await q("select user_id from time_league_members where league_id=$1 and seat_team_id='t2'", [league]))[0].user_id, users[1]);
    const joined = (await q('select state,version from time_leagues where id=$1', [league]))[0];
    assert.equal(joined.state.teams[1].name, 'Guest Club');
    assert.equal(joined.state.teams[1].primaryColor, '#112233');
    assert.equal(joined.state.teams[1].backdrop, 'stadium');
    assert.equal(joined.state.teams[0].name, 'Host');
    assert.equal(joined.version, 2);
    // Response retries are idempotent, not an extra join or identity overwrite.
    await q('select respond_time_league_community_invite($1,$2,true)', [users[1], invite]);
    assert.equal((await q('select version from time_leagues where id=$1', [league]))[0].version, 2);
    console.log('ok invitations enforce commissioner, consent, recipient and atomic seat ownership');
    const completed = { ...joined.state, phase: 'complete', championTeamId: 't1', currentWeek: 4, finalizedWeeks: [
        { week: 1, matchups: [{ home: 't1', away: 't2', homePoints: 100, awayPoints: 90, winner: 't1' }] },
        { week: 2, matchups: [{ home: 't1', away: 't3', homePoints: 9000, awayPoints: 2, winner: 't1' }] },
        { week: 3, matchups: [{ home: 't1', away: 't2', homePoints: 80, awayPoints: 80, winner: null }] },
    ] };
    await q('update time_leagues set draft_started=true,state=$2 where id=$1', [league, completed]);
    const records = await q('select * from time_league_verified_records where league_id=$1 order by wins desc', [league]);
    assert.equal(records.length, 2); assert.equal(records[0].wins, 1); assert.equal(records[0].ties, 1); assert.equal(records[0].games, 2);
    assert.equal(Number(records[0].points_for), 180); assert.equal(Number(records[0].best_game), 100); assert.equal(records[0].championships, 1);
    assert.equal(records[1].losses, 1);
    await q('select refresh_time_league_verified_records($1)', [league]);
    assert.equal((await q('select sum(games)::int as games from time_league_verified_records where league_id=$1', [league]))[0].games, 4);
    const directory = await q('select * from time_league_public_directory');
    assert.equal(directory.length, 4); assert(!directory.some(p => p.profile_id === privateTarget));
    assert(directory.every(p => !('user_id' in p) && !('invite_code' in p)));
    await q('update time_league_profiles set public_profile=false,looking_for_league=false where user_id=$1', [users[0]]);
    assert.equal((await q('select * from time_league_public_directory')).length, 3);
    console.log('ok verified leaderboard excludes AI games, deduplicates snapshots and honors opt-out');
    await db.exec('set role authenticated');
    await reject(() => q('select * from time_league_public_directory'), /permission denied/);
    await reject(() => q('select * from time_league_profiles'), /permission denied/);
    await reject(() => q('select refresh_time_league_verified_records($1)', [league]), /permission denied/);
    await reject(() => q('select respond_time_league_community_invite($1,$2,true)', [users[1], invite]), /permission denied/);
    await db.exec('reset role');
    console.log('ok raw community tables, leaderboard view and privileged RPCs deny client database access');
    const late = await create(); const lateInvite = (await send(users[0], target, late))[0].id;
    await q('update time_leagues set draft_started=true where id=$1', [late]);
    await reject(() => q('select respond_time_league_community_invite($1,$2,true)', [users[1], lateInvite]), /already started/);
    const code = (await q("select invite_code from time_league_members where league_id=$1 and seat_team_id='t2'", [late]))[0].invite_code;
    await reject(() => q('select claim_time_league_invite($1,$2)', [users[1], code]), /already started/);
    const raced = await create(); const racedInvite = (await send(users[0], target, raced))[0].id;
    const raceCode = (await q("select invite_code from time_league_members where league_id=$1 and seat_team_id='t2'", [raced]))[0].invite_code;
    await q('select claim_time_league_invite($1,$2)', [users[4], raceCode]);
    await reject(() => q('select respond_time_league_community_invite($1,$2,true)', [users[1], racedInvite]), /already been claimed/);
    console.log('ok late and competing invitation claims never steal or join an active seat');
    for (let i = 0; i < 21; i++) { const id = await create(); await send(users[0], target, id); }
    const excess = await create();
    await reject(() => send(users[0], target, excess), /daily limit/);
    console.log('ok cross-league daily invitation limit prevents repeated solicitation');
    await db.close();
    console.log('PASS: Vault community database integration');
})().catch(error => { console.error(error); process.exitCode = 1; });
