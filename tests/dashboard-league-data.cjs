const assert = require('node:assert/strict');
const Cup = require('../js/shared/woeppel-cup.js');
require('../js/shared/league-stats.js');
require('../js/shared/dashboard-league-data.js');
const D = globalThis.App.DashboardLeagueData;
const name = id => 'Owner ' + id;
const league = { league_id: 'test', season: '2026', rosters: [
    { roster_id: 1, settings: { wins: 2, losses: 1, ties: 0, fpts: 100, fpts_decimal: 25 } },
    { roster_id: '2', settings: { wins: 2, losses: 1, ties: 0, fpts: 100, fpts_decimal: 25 } },
    { roster_id: 3, settings: { wins: 1, losses: 1, ties: 1, fpts: 150 } },
    { roster_id: 4, settings: { wins: 0, losses: 0, ties: 0, fpts: 0 } }
] };
const standings = D.standings({ league, myRoster: { roster_id: '2' }, getOwnerName: name });
assert.deepEqual(standings.rows.map(r => r.rank), [1,1,3,null]);
assert.equal(standings.mine.id, '2'); assert.equal(standings.mine.pf, 100.25);
assert.equal(standings.rows[2].winPct, 0.5);
assert.equal(D.standings({ league: { rosters: [league.rosters[3]] } }).hasResults, false);
assert.equal(D.standings({ league: { rosters: [{ roster_id: 1, settings: {} }] } }).rows[0].pf, null);
const rows = [
    { roster_id: 1, points: 40, custom_points: 0, players_points: { a: 0, b: -2 } },
    { roster_id: '2', points: -1, players_points: { c: 5, a: 0 } },
    { roster_id: 3, players_points: { c: 6 } }
];
const live = { status: 'stale', error: 'Refresh failed', updatedAt: 123, week: 3, rows, groups: [{ key: 'matchup:1', teams: rows.slice(0,2) }, { key: 'bye:3', teams: [rows[2]] }] };
const board = D.matchups({ live, myRoster: { roster_id: '1' }, getOwnerName: name });
assert.equal(board.mine.teams[0].points, 0); assert.equal(board.mine.margin, 1);
assert.equal(board.groups[1].teams[0].points, null); assert.equal(board.groups[1].complete, false);
assert.equal(board.status, 'stale'); assert.equal(board.updatedAt, 123);
const leaders = D.stats({ live, myRoster: { roster_id: 1 }, getOwnerName: name, playersData: { a: { full_name: 'Zero', position: 'WR' }, b: { full_name: 'Negative', position: 'QB' } } });
assert.equal(leaders.leaders.length, 2, 'deduplicate equal points and exclude contradictory copies');
assert.equal(leaders.mine.pid, 'a'); assert.equal(leaders.mine.points, 0);
assert.deepEqual(leaders.mine.rosterIds, ['1','2']); assert.equal(leaders.leaders[1].points, -2);
assert.equal(D.stats({ live: {} }).hasData, false);

assert.equal(D.cup({ state: null }), null, 'caller can distinguish successful no-Cup from load errors');
for (const format of Cup.formats.map(f => f.id)) {
    const state = Cup.configure(league, format);
    assert.equal(D.cup({ state, engine: Cup, myRoster: { roster_id: 1 } }).status, 'draft');
    state.locked = true; state.enabled = true;
    let view = D.cup({ state, engine: Cup, myRoster: { roster_id: '1' }, currentWeek: 1, getOwnerName: name });
    assert.equal(view.status, 'active'); assert.ok(Number.isInteger(view.nextWeek));
    assert.equal(D.cup({ state: { ...state, enabled: false }, engine: Cup }).status, 'paused');
    for (const week of Cup.schedule(state)) state.weeks[week] = { final: true, scores: { 1: 40, 2: 30, 3: 20, 4: 10 } };
    if (['all-play','median','round-robin','points'].includes(format)) state.seedRuling = { ids: state.teams.slice(0,state.qualifierCount), reason: 'Fixture seed order' };
    view = D.cup({ state, engine: Cup, myRoster: { roster_id: 1 }, getOwnerName: name });
    assert.equal(view.status, 'complete', format); assert.equal(view.champion, 'Owner 1'); assert.equal(view.myProgress, 'Champion'); assert.equal(view.nextWeek, null);
}
const tied = Cup.configure(league, 'knockout'); tied.locked = true; tied.enabled = true;
tied.weeks[tied.startWeek] = { final: true, scores: { 1: 0, 2: 20, 3: 10, 4: 0 } };
const tieView = D.cup({ state: tied, engine: Cup, myRoster: { roster_id: 3 } });
assert.equal(tieView.status, 'blocked'); assert.equal(tieView.champion, null); assert.match(tieView.myProgress, /Knocked out/);
const legacy = { groups: { A: ['1','2','3','4'], B: ['5','6','7','8'], C: ['9','10','11','12'] }, drawMargin: 0, weeks: {}, enabled: true, locked: true };
assert.equal(D.cup({ state: legacy, engine: Cup }).nextWeek, 6);
assert.equal(D.cup({ state: legacy, engine: Cup }).format, 'legacy');

async function testClient() {
    let now = 1000, calls = 0, fail = false, malformed = false, responseCup = { state: tied }, release;
    const timers = new Map(), visibility = new Set(), focus = new Set(); let timerId = 0;
    const doc = { hidden: false, addEventListener: (_, fn) => visibility.add(fn), removeEventListener: (_, fn) => visibility.delete(fn) };
    const client = D.createCupClient({
        now: () => now, document: doc, focusTarget: { addEventListener: (_, fn) => focus.add(fn), removeEventListener: (_, fn) => focus.delete(fn) },
        setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id),
        invoke: body => { calls++; assert.equal(body.action, 'load'); assert.equal(body.season, '2026'); return new Promise(resolve => { release = () => resolve(fail ? { error: { message: 'Offline' } } : { data: malformed ? {} : { cup: responseCup, canManage: true } }); }); }
    });
    const first = [], second = [];
    const off1 = client.subscribe(league, v => first.push(v)); const off2 = client.subscribe(league, v => second.push(v));
    await Promise.resolve(); assert.equal(calls, 1, 'one request for concurrent cards');
    let pending = client.refresh(league); release(); await pending;
    assert.equal(first.at(-1).status, 'ready'); assert.equal(first.at(-1).state, tied); assert.equal(first.at(-1).canManage, true);
    focus.forEach(fn => fn()); await Promise.resolve(); assert.equal(calls, 1, 'focus is throttled');
    now += 31000; fail = true; pending = client.refresh(league); await Promise.resolve(); release(); await pending;
    assert.equal(second.at(-1).status, 'stale'); assert.equal(second.at(-1).state, tied); assert.equal(second.at(-1).updatedAt, 1000);
    fail = false; malformed = true; pending = client.refresh(league); await Promise.resolve(); release(); await pending;
    assert.equal(first.at(-1).status, 'stale', 'malformed payload never becomes no Cup');
    malformed = false; responseCup = null; pending = client.refresh(league); await Promise.resolve(); release(); await pending;
    assert.equal(first.at(-1).status, 'ready'); assert.equal(first.at(-1).state, null, 'explicit successful null means no Cup');
    doc.hidden = true; visibility.forEach(fn => fn()); assert.equal(timers.size, 0);
    off1(); off2(); assert.equal(focus.size, 0); assert.equal(visibility.size, 0); assert.equal(timers.size, 0);
    const missingClient = D.createCupClient({ document: null, focusTarget: null, invoke: async () => ({ error: { message: 'No session' } }) });
    const seen = []; const off = missingClient.subscribe(league, v => seen.push(v)); await missingClient.refresh(league); off();
    assert.equal(seen.at(-1).status, 'error'); assert.equal(seen.at(-1).updatedAt, null);
    console.log('Dashboard league data: honest ranks, zero/missing scores, deduped players, all Cup formats and read-only refresh lifecycle passed.');
}
testClient().catch(e => { console.error(e); process.exitCode = 1; });
