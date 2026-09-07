'use strict';
// Run without production access:
// PGLITE_MODULE=/tmp/vault-community-qa/node_modules/@electric-sql/pglite node tests/time-league-draft-readiness-db.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
(async () => {
    const db = new PGlite();
    try {
        await db.exec(`create role anon; create role authenticated; create role service_role;
            create table app_users(id uuid primary key);
            create function current_app_user_id() returns uuid language sql as $$select null::uuid$$;
            create function gen_random_bytes(n integer) returns bytea language sql as $$select substring(decode(repeat(md5(random()::text),n),'hex') from 1 for n)$$;`);
        await db.exec(fs.readFileSync('supabase/migrations/20260907193000_time_league_multiplayer.sql', 'utf8'));
        const q = async (sql, values = []) => (await db.query(sql, values)).rows;
        const users = (await q('insert into app_users select gen_random_uuid() from generate_series(1,4) returning id')).map(row => row.id);
        const initial = { leagueId: 'readiness-qa', name: 'Draft readiness QA', phase: 'draft', currentWeek: 1,
            teams: [{ teamId: 't1', manager: 'human' }, { teamId: 't2', manager: 'human' }, { teamId: 't3', manager: 'human' }] };
        const league = (await q('select create_time_league($1,$2) as id', [users[0], initial]))[0].id;
        const ready = (user = users[0], value = true) => q('select set_time_league_ready($1,$2,$3)', [user, league, value]);
        const version = async () => (await q('select version from time_leagues where id=$1', [league]))[0].version;
        const readyWeek = async user => (await q('select ready_week from time_league_members where league_id=$1 and user_id=$2', [league, user]))[0]?.ready_week;
        const reject = async (fn, pattern) => assert.rejects(fn, pattern);
        await q('update time_leagues set draft_started=true where id=$1', [league]);
        await reject(() => ready(), /Lineups open during the season/);
        console.log('ok old readiness RPC reproduces the blocked draft start');

        const migration = fs.readFileSync('supabase/migrations/20260908020000_time_league_draft_readiness.sql', 'utf8');
        await db.exec(migration);
        await db.exec(migration);
        await q('update time_leagues set draft_started=false where id=$1', [league]);
        await reject(() => ready(), /commissioner.*open/);
        const code = (await q("select invite_code from time_league_members where league_id=$1 and seat_team_id='t2'", [league]))[0].invite_code;
        await q('select claim_time_league_invite($1,$2)', [users[1], code]);
        // A partially provisioned seat is not a joined manager.
        await q("update time_league_members set user_id=$2,joined_at=null where league_id=$1 and seat_team_id='t3'", [league, users[2]]);
        await q('update time_leagues set draft_started=true where id=$1', [league]);
        await reject(() => ready(users[3]), /joined seat/);
        await reject(() => ready(users[2]), /joined seat/);
        await reject(() => ready(null), /joined seat/);
        console.log('ok closed rooms, outsiders and unjoined seats cannot mark draft readiness');

        const before = await version();
        await db.exec('set role service_role');
        await ready();
        await db.exec('reset role');
        assert.equal(await version(), before + 1);
        assert.equal(await readyWeek(users[0]), 1);
        await ready();
        assert.equal(await version(), before + 1, 'an identical readiness retry must preserve the draft version');
        await ready(users[1]);
        assert.equal(await version(), before + 2);
        const staleStart = await q('update time_leagues set version=version+1 where id=$1 and version=$2 returning id', [league, before + 1]);
        assert.equal(staleStart.length, 0, 'a concurrent readiness change invalidates a stale start');
        await ready(users[1], false);
        assert.equal(await readyWeek(users[1]), 0);
        assert.equal(await version(), before + 3);
        await ready(users[1], false);
        assert.equal(await version(), before + 3, 'an identical unready retry is also idempotent');
        console.log('ok joined managers become ready atomically, retries are idempotent and stale writes fail');

        const season = { ...initial, phase: 'season', currentWeek: 3 };
        await q('update time_leagues set state=$2 where id=$1', [league, season]);
        const seasonBefore = await version();
        await ready(users[1]);
        assert.equal(await readyWeek(users[1]), 3);
        assert.equal(await version(), seasonBefore + 1);
        await ready(users[1]);
        assert.equal(await version(), seasonBefore + 1);
        await q('update time_leagues set state=$2 where id=$1', [league, { ...season, phase: 'complete' }]);
        await reject(() => ready(), /during the draft or season/);
        console.log('ok season readiness still records the current week and completed leagues reject changes');

        for (const role of ['authenticated', 'anon']) {
            await db.exec(`set role ${role}`);
            await reject(() => ready(), /permission denied/);
            await db.exec('reset role');
        }
        const grants = (await q("select has_function_privilege('service_role','public.set_time_league_ready(uuid,uuid,boolean)','EXECUTE') as service_allowed,has_function_privilege('authenticated','public.set_time_league_ready(uuid,uuid,boolean)','EXECUTE') as client_allowed"))[0];
        assert.equal(grants.service_allowed, true); assert.equal(grants.client_allowed, false);
        console.log('ok readiness remains a service-role-only operation');
        console.log('PASS: draft readiness database integration');
    } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
