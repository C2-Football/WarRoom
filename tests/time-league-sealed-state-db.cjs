'use strict';
// Runs actual PostgreSQL grants, RLS and RPCs without a production connection:
// PGLITE_MODULE=/tmp/vault-community-qa/node_modules/@electric-sql/pglite node tests/time-league-sealed-state-db.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

(async () => {
    const db = new PGlite();
    try {
        await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
            create table app_users(id uuid primary key);
            create function current_app_user_id() returns uuid language sql as
                $$select nullif(current_setting('test.app_user_id', true), '')::uuid$$;
            create function gen_random_bytes(n integer) returns bytea language sql as
                $$select substring(decode(repeat(md5(random()::text),n),'hex') from 1 for n)$$;`);
        for (const file of [
            '20260907193000_time_league_multiplayer.sql',
            '20260908010000_time_league_community.sql',
            '20260908020000_time_league_draft_readiness.sql',
            '20260908030000_time_league_messages.sql',
            '20260908040000_time_league_message_week.sql',
        ]) await db.exec(fs.readFileSync(`supabase/migrations/${file}`, 'utf8'));
        const q = async (sql, values = []) => (await db.query(sql, values)).rows;
        const users = (await q('insert into app_users select gen_random_uuid() from generate_series(1,4) returning id')).map(row => row.id);
        const state = {
            leagueId: 'tl-public-derived-identifier', name: 'Sealed draft QA', seed: 'previously-exposed-seed',
            phase: 'draft', currentWeek: 1, seasonsRevealed: false,
            settings: { eraRules: { mode: 'position-roulette', positionDecades: { QB: [2010], RB: [1980] } } },
            teams: [
                { teamId: 't1', manager: 'human', name: 'Commissioner', queue: ['private-host-target'], roster: [{ entryId: 'e1', identity: 'historical-qb', drawnSeason: 2018 }] },
                { teamId: 't2', manager: 'human', name: 'Other seat', queue: ['private-guest-target'], roster: [{ entryId: 'e2', identity: 'historical-rb', drawnSeason: 1986 }] },
                { teamId: 't3', manager: 'ai', name: 'Computer', queue: [], roster: [] },
            ],
            draftPicks: [{ entryId: 'e1', identity: 'historical-qb' }, { entryId: 'e2', identity: 'historical-rb' }],
            pendingClaims: [], trades: [], activity: [], finalizedWeeks: [],
        };
        const create = async value => (await q('select public.create_time_league($1,$2) as id', [users[0], value]))[0].id;
        const league = await create(state);
        const inviteCode = (await q("select invite_code from time_league_members where league_id=$1 and seat_team_id='t2'", [league]))[0].invite_code;
        await q('select public.claim_time_league_invite($1,$2)', [users[1], inviteCode]);
        const savedBefore = (await q('select * from time_leagues where id=$1', [league]))[0];
        const completedState = { ...state, leagueId: 'tl-completed-identifier', phase: 'complete', seasonsRevealed: true,
            currentWeek: 15, championTeamId: 't1', finalizedWeeks: [{ week: 14, matchups: [{ home: 't1', away: 't2', homePoints: 101.7, awayPoints: 99.3, winner: 't1' }] }] };
        const completed = await create(completedState);
        await q('insert into time_league_verified_records(league_id,user_id,wins,games,points_for,championships,leagues_completed) values($1,$2,1,1,101.7,1,1)', [completed, users[0]]);
        const recordedBefore = await q('select * from time_league_verified_records order by league_id,user_id');

        // A stale permissive grant is removed by this migration; the legacy
        // member read policy must also disappear instead of merely hiding it.
        await db.exec('grant select on public.time_leagues, public.time_league_members to public');
        const migration = fs.readFileSync('supabase/migrations/20260908050000_time_league_sealed_state.sql', 'utf8');
        await db.exec(migration);
        const migrated = await q('select * from time_leagues order by id');
        await db.exec(migration);
        assert.deepEqual(await q('select * from time_leagues order by id'), migrated, 'migration retries do not change existing league state');
        assert.deepEqual(await q('select * from time_league_verified_records order by league_id,user_id'), recordedBefore, 'seed rotation does not recompute or erase verified career records');
        for (const [id, original, originalVersion] of [[league, state, savedBefore.version], [completed, completedState, 1]]) {
            const next = migrated.find(row => row.id === id);
            assert.match(next.state.seed, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
            assert.notEqual(next.state.seed, original.seed, 'previously exposed random input is retired');
            assert.deepEqual({ ...next.state, seed: original.seed }, original, 'all editions, eras, picks, records and champion stay unchanged');
            assert.equal(next.version, originalVersion + 1, 'in-flight actions based on exposed seed conflict instead of overwriting the migration');
            assert.equal(next.sealed_seed_version, 1);
            assert.match(next.sealed_draw_secret, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
            assert.notEqual(next.sealed_draw_secret, next.state.seed, 'draw security is independent of simulation randomness');
            assert(!JSON.stringify(next.state).includes(next.sealed_draw_secret), 'even an old endpoint returning JSON state cannot disclose the new HMAC secret');
        }
        assert.notEqual(migrated[0].state.seed, migrated[1].state.seed, 'every league receives its own private seed');
        assert.notEqual(migrated[0].sealed_draw_secret, migrated[1].sealed_draw_secret, 'draw secrets are independent across leagues');
        const newState = { ...state, leagueId: 'tl-new-server-identifier', seed: 'new-server-private-seed' };
        const newLeague = await create(newState);
        await db.exec(migration);
        const newRow = (await q('select state,version,sealed_seed_version from time_leagues where id=$1', [newLeague]))[0];
        assert.deepEqual(newRow, { state: newState, version: 1, sealed_seed_version: 1 }, 'new server leagues do not get rotated on a migration retry');
        assert.equal((await q("select count(*)::int as count from pg_policies where schemaname='public' and tablename in ('time_leagues','time_league_members')"))[0].count, 0);
        console.log('ok sealed state migration is repeatable and leaves existing game records intact');

        const protectedTables = ['time_leagues', 'time_league_members', 'time_league_messages'];
        const roles = [
            ['anon', ''],
            ['authenticated', users[2]], // Signed in, no seat.
            ['authenticated', users[1]], // Another joined seat in this league.
            ['authenticated', users[0]], // Commissioner also receives only a projection.
        ];
        const rpcCalls = [
            ['select create_time_league($1,$2)', [users[0], state]],
            ['select claim_time_league_invite($1,$2)', [users[2], inviteCode]],
            ['select set_time_league_ready($1,$2,true)', [users[0], league]],
            ['select apply_time_league_profile($1,$2,$3)', [league, users[0], 't1']],
            ['select refresh_time_league_verified_records($1)', [league]],
            ['select send_time_league_community_invite($1,$2,$3,$4)', [users[0], league, 't2', users[3]]],
            ['select respond_time_league_community_invite($1,$2,true)', [users[0], users[3]]],
            ['select load_time_league_messages($1,$2)', [users[0], league]],
            ['select send_time_league_message($1,$2,$3,$4,$5)', [users[0], league, savedBefore.version, [], null]],
        ];
        for (const [role, user] of roles) {
            await q("select set_config('test.app_user_id',$1,false)", [user]);
            await db.exec(`set role ${role}`);
            for (const table of protectedTables) {
                await assert.rejects(() => q(`select * from public.${table}`), /permission denied/, `${role}/${user} cannot select ${table}`);
            }
            await assert.rejects(() => q("select state->>'seed', state #> '{teams,0,roster}', state #> '{settings,eraRules}' from public.time_leagues where id=$1", [league]), /permission denied/);
            await assert.rejects(() => q('select sealed_draw_secret from public.time_leagues where id=$1', [league]), /permission denied/);
            await assert.rejects(() => q('select to_jsonb(l) from public.time_leagues l where id=$1', [league]), /permission denied/);
            await assert.rejects(() => q('select l.state from public.time_league_members m join public.time_leagues l on l.id=m.league_id where m.user_id=$1', [users[0]]), /permission denied/);
            for (const [sql, values] of rpcCalls) await assert.rejects(() => q(sql, values), /permission denied/);
            await db.exec('reset role');
        }
        console.log('ok anonymous, nonmember, other-seat member and commissioner cannot bypass the Edge projection through table, JSON, join or RPC reads');

        // Check every installed Vault RPC, including helpers not called above.
        // The sole client-callable helper answers only membership for the real
        // app identity; it neither accepts a caller id nor returns league data.
        const functions = await q(`select p.oid::text, p.proname,
            has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated,
            has_function_privilege('anon',p.oid,'EXECUTE') as anon
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname like '%time_league%'`);
        assert(functions.length >= 11);
        for (const fn of functions) {
            assert.equal(fn.anon, false, `${fn.proname} must not run as anon`);
            assert.equal(fn.authenticated, fn.proname === 'is_time_league_member', `${fn.proname} must be server-only`);
        }
        for (const [user, member] of [[users[2], false], [users[1], true], [users[0], true]]) {
            await q("select set_config('test.app_user_id',$1,false)", [user]);
            await db.exec('set role authenticated');
            assert.deepEqual((await q('select is_time_league_member($1) as member', [league]))[0], { member });
            await db.exec('reset role');
        }

        // Direct API permission changes must not turn membership into access to
        // hidden eras or player editions. RLS stays closed independently.
        await db.exec('grant select on public.time_leagues, public.time_league_members, public.time_league_messages to authenticated');
        for (const user of users.slice(0, 3)) {
            await q("select set_config('test.app_user_id',$1,false)", [user]);
            await db.exec('set role authenticated');
            for (const table of protectedTables) assert.deepEqual(await q(`select * from public.${table}`), []);
            await db.exec('reset role');
        }
        await db.exec('revoke select on public.time_leagues, public.time_league_members, public.time_league_messages from authenticated');
        console.log('ok RLS independently denies raw snapshots even if a future change accidentally grants table SELECT');

        await db.exec('set role service_role');
        const serverState = (await q('select state from time_leagues where id=$1', [league]))[0].state;
        assert.equal(serverState.teams[0].roster[0].drawnSeason, 2018);
        assert.equal(serverState.teams[1].roster[0].drawnSeason, 1986);
        assert.deepEqual(serverState.settings, state.settings);
        assert(serverState.seed, 'server keeps the private draw input');
        const serverCreated = (await q('select create_time_league($1,$2) as id', [users[0], { ...state, leagueId: 'tl-service-created', seed: 'fresh-server-simulation-seed' }]))[0].id;
        const serverSecret = (await q('select sealed_draw_secret from time_leagues where id=$1', [serverCreated]))[0].sealed_draw_secret;
        const serverCode = (await q("select invite_code from time_league_members where league_id=$1 and seat_team_id='t2'", [serverCreated]))[0].invite_code;
        await q('select claim_time_league_invite($1,$2)', [users[1], serverCode]);
        await q('update time_leagues set draft_started=true where id=$1', [serverCreated]);
        await q('select set_time_league_ready($1,$2,true)', [users[0], serverCreated]);
        const serverVersion = (await q('select version from time_leagues where id=$1', [serverCreated]))[0].version;
        const envelope = [{ id: 'chat:sealed001', fromTeamId: 't1', toTeamId: 't2', text: 'Ready for the draft?', tone: 'friendly', week: 1, sequence: 1, createdAt: '2026-09-08T00:00:00Z' }];
        assert.equal((await q('select send_time_league_message($1,$2,$3,$4,$5) as result', [users[0], serverCreated, serverVersion, envelope, null]))[0].result.ok, true);
        assert.equal((await q('select load_time_league_messages($1,$2) as messages', [users[1], serverCreated]))[0].messages[0].text, envelope[0].text);
        await q('select refresh_time_league_verified_records($1)', [serverCreated]);
        assert.equal((await q('select sealed_draw_secret from time_leagues where id=$1', [serverCreated]))[0].sealed_draw_secret, serverSecret, 'join, readiness, messages and community records preserve the draw secret');

        const invitationLeague = (await q('select create_time_league($1,$2) as id', [users[0], { ...state, leagueId: 'tl-community-service' }]))[0].id;
        const identity = { displayName: 'Manager', teamName: 'Manager Club', primaryColor: '#112233', secondaryColor: '#ffffff', backdrop: 'stadium', helmet: { color: 'royal' } };
        await q('insert into time_league_profiles(user_id,identity,public_profile,looking_for_league) values($1,$2,true,true)', [users[0], identity]);
        const publicProfile = (await q('insert into time_league_profiles(user_id,identity,public_profile,looking_for_league) values($1,$2,true,true) returning profile_id', [users[3], identity]))[0].profile_id;
        const communityInvite = (await q("select send_time_league_community_invite($1,$2,'t2',$3) as id", [users[0], invitationLeague, publicProfile]))[0].id;
        assert.equal((await q('select respond_time_league_community_invite($1,$2,true) as id', [users[3], communityInvite]))[0].id, invitationLeague);
        assert.equal((await q('select state from time_leagues where id=$1', [invitationLeague]))[0].state.teams[1].name, identity.teamName, 'internal profile helper still works through the trusted invitation RPC');
        await db.exec('reset role');
        console.log('ok trusted server retains authoritative draws and still creates leagues, joins seats, readies, chats and accepts community invitations');
        console.log('PASS: Vault sealed state database integration');
    } finally {
        await db.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
