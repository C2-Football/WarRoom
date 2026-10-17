'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');

// Exercise the real service with persisted compare-and-swap storage. This is a
// local fixture only: it never calls Supabase or a real league.
module.exports = async function cupServiceTransitions({ Cup, code, rosters }) {
    const T = Cup.tournament;
    function harness() {
        let handler, stored = null;
        const db = { from(table) {
            assert.equal(table, 'league_cups');
            let operation = 'load', value, filters = {};
            return {
                insert(next) { operation = 'insert'; value = structuredClone(next); return this; },
                update(next) { operation = 'update'; value = structuredClone(next); return this; },
                eq(key, next) { filters[key] = next; return this; },
                select() { return this; },
                async maybeSingle() {
                    if (operation === 'insert') {
                        if (stored) return { data: null, error: { code: '23505' } };
                        stored = value;
                    } else if (operation === 'update') {
                        assert.deepEqual(Object.keys(filters).sort(), ['league_id', 'revision', 'season'], 'Every update must retain league, season and revision filters');
                        if (!stored || Object.entries(filters).some(([key, next]) => stored[key] !== next)) return { data: null, error: null };
                        stored = value;
                    } else {
                        assert.deepEqual(Object.keys(filters).sort(), ['league_id', 'season'], 'Loads must remain league and season scoped');
                        if (!stored || Object.entries(filters).some(([key, next]) => stored[key] !== next)) return { data: null, error: null };
                    }
                    return { data: structuredClone(stored), error: null };
                }
            };
        } };
        const context = { WoeppelCup: Cup, Response, console,
            fetch: async url => ({ ok: true, json: async () => url.endsWith('/users') ? [{ user_id: '1', is_owner: true }] : url.endsWith('/rosters') ? rosters : { user_id: '1' } }),
            createClient: () => db, verifyJwtPayload: async () => ({ app_metadata: { sleeper_username: 'tester' } }),
            requireActiveAppSession: async () => null, hasAdminRole: async () => false,
            Deno: { env: { get: () => '' }, serve: fn => { handler = fn; } } };
        vm.runInNewContext(code, context);
        return { get stored() { return structuredClone(stored); }, async call(state, revision, action = 'save') {
            const response = await handler(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ leagueId: '1234567890123', season: '2026', action, state, revision }) }));
            return { status: response.status, body: await response.json() };
        } };
    }
    const league = { rosters: rosters.slice(0, 4), settings: { playoff_week_start: 15 } };
    const started = { ...T.configure(league, 'points'), locked: true, enabled: true,
        startWeek: 1, groupWeeks: 2, knockoutStart: 3,
        weeks: { 1: { scores: { 1: 0, 2: -2, 3: 10, 4: 20 }, final: true }, 2: { scores: { 1: 11, 2: 12, 3: 13, 4: 14 }, final: false } },
        seedRuling: null, tieRulings: {}, survivorRulings: {} };
    const app = harness();
    let reply = await app.call(started, 0);
    assert.equal(reply.status, 200); assert.equal(reply.body.cup.revision, 1);
    const renamed = { ...started, name: 'Renamed started Cup' };
    reply = await app.call(renamed, 1);
    assert.equal(reply.status, 200); assert.equal(reply.body.cup.revision, 2);
    assert.equal(reply.body.cup.state.locked, true);
    assert.deepEqual(reply.body.cup.state.weeks, started.weeks, 'Name-only save preserves finalized and preview score evidence');
    assert.deepEqual(reply.body.cup.state.tieRulings, started.tieRulings);
    const paused = { ...renamed, enabled: false };
    assert.equal((await app.call(paused, 2)).status, 200);
    assert.equal(app.stored.revision, 3); assert.deepEqual(app.stored.state.weeks, started.weeks);
    const beforeConflict = app.stored;
    assert.equal((await app.call({ ...renamed, name: 'Stale edit' }, 1)).status, 409);
    assert.equal((await app.call(started, 0)).status, 409);
    assert.deepEqual(app.stored, beforeConflict, 'Stale edits and duplicate creation cannot overwrite confirmed state');
    assert.equal((await app.call(null, 0, 'load')).body.cup.revision, 3);
    const changed = { ...T.configure(league, 'round-robin-double', paused), locked: true, enabled: true,
        startWeek: 1, groupWeeks: 3, knockoutStart: 4,
        weeks: Object.fromEntries(Object.entries(started.weeks).map(([week, record]) => [week, { scores: record.scores, final: false }])),
        seedRuling: null, tieRulings: {}, survivorRulings: {} };
    reply = await app.call(changed, 3);
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.equal(reply.body.cup.revision, 4); assert.equal(reply.body.cup.state.locked, true);
    assert.deepEqual(reply.body.cup.state.weeks[1], { scores: started.weeks[1].scores, final: false }, 'Structural edit retains score evidence while invalidating affected final status');
    assert.equal(reply.body.cup.state.format, 'round-robin-double');
    for (const invalid of [{ ...changed, groupWeeks: 2, knockoutStart: 3 }, { ...changed, knockoutStart: 17 }]) {
        assert.equal((await app.call(invalid, 4)).status, 400, 'Double elimination must keep complete qualifying cycles and room for a reset');
    }
    assert.equal(app.stored.revision, 4, 'Invalid edits consume no revision');

    for (const forceReset of [false, true]) {
        const service = harness();
        let state = { ...changed, weeks: {} }, revision = 0, resetForced = false;
        for (let week = 1; week <= 3; week++) state.weeks[week] = { final: true, scores: { 1: 100 + week, 2: 80 + week, 3: 60 + week, 4: 40 + week } };
        assert.equal((await service.call(state, revision++)).status, 200);
        for (const week of T.schedule(state).filter(w => w >= state.knockoutStart)) {
            let ids;
            try { ids = T.requiredScoreIds(state, week); } catch { break; }
            const current = T.knockout(state).flat().filter(match => match.week === week && match.a && match.b);
            const losses = Object.fromEntries(state.teams.map(id => [id, 0]));
            for (const match of T.knockout(state).flat().filter(match => match.week < week && match.winner && match.a && match.b)) losses[match.winner === match.a ? match.b : match.a]++;
            const contested = current.flatMap(match => [match.a, match.b]);
            assert.deepEqual([...ids].sort(), [...contested].sort(), 'Required scores match actual contested games, not eliminated teams or byes');
            assert.equal(new Set(contested).size, contested.length, 'Upper and lower matches use disjoint teams within a week');
            assert(ids.every(id => losses[id] < 2), 'A two-loss team never re-enters the scoring field');
            const scores = Object.fromEntries(ids.map(id => [id, Number(id) * 10]));
            for (const missingId of ids) {
                const incomplete = { ...scores }; delete incomplete[missingId];
                const missing = { ...state, weeks: { ...state.weeks, [week]: { final: true, scores: incomplete } } };
                assert.equal((await service.call(missing, revision)).status, 400, 'Every contested participant needs a finalized score: ' + missingId);
            }
            if (current.length === 1 && [losses[current[0].a], losses[current[0].b]].sort().join(',') === '0,1') {
                const upper = losses[current[0].a] === 0 ? current[0].a : current[0].b;
                const lower = upper === current[0].a ? current[0].b : current[0].a;
                scores[upper] = forceReset ? -2 : 0; scores[lower] = forceReset ? 0 : -2;
                resetForced = forceReset;
            }
            state = { ...state, weeks: { ...state.weeks, [week]: { final: true, scores } } };
            reply = await service.call(state, revision);
            assert.equal(reply.status, 200, JSON.stringify(reply.body)); revision++;
            assert.equal(reply.body.cup.revision, revision);
        }
        const result = T.result(state);
        assert(result?.champion, 'Service accepts a complete double-elimination outcome');
        const reservedReset = T.schedule(state).at(-1);
        if (forceReset) {
            assert(resetForced, 'The lower finalist forces a bracket reset');
            assert.equal(result.week, reservedReset, 'The conditional reset result is saved');
        } else {
            assert(result.week < reservedReset, 'Undefeated finalist can end the Cup before the reserved reset');
            const unusedReset = { ...state, weeks: { ...state.weeks, [reservedReset]: { final: true, scores: { 1: 10, 2: 9 } } } };
            assert.equal((await service.call(unusedReset, revision)).status, 400, 'An unused reset cannot be finalized');
        }
    }
    console.log('Cup service transitions: started edits, retained score evidence, actual revision CAS, double-elimination participants and reset finals passed');
};
