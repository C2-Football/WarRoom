'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { candidates } = require('../js/shared/roster-review.js');

const row = (pid, dhq, extra = {}) => ({ pid, dhq, p: { years_exp: 3 }, ...extra });
const league = (active = 4, extra = {}) => ({ roster_positions: ['WR', ...Array(Math.max(0, active - 1)).fill('BN')], settings: {}, ...extra });
const ids = set => [...set];
const near = (activeSlots, taxiSlots = 0) => ({ rule: { activeSlots, taxiSlots }, status: { isNear: true } });

test('useful redraft bench players do not become automatic drops on a full roster', () => {
    const rows = [row('starter', 200, { isStarter: true }), row('tre', 121, { rec: 'START' }), row('marvin', 84, { rec: 'DEPTH' }), row('wandale', 113, { rec: 'START' })];
    const result = candidates({ rows, league: league(), leagueType: 'redraft' });
    assert.equal(result.activeOver, 0);
    assert.deepEqual(ids(result.dropCandidatePids), []);
    assert.deepEqual(ids(result.taxiCandidatePids), []);
});

test('open roster spots and a satisfied cutdown do not create cut choices', () => {
    const rows = [row('starter', 200, { isStarter: true }), row('bench', 100)];
    for (const cutdownInfo of [null, near(3)]) {
        const result = candidates({ rows, league: league(4), leagueType: 'dynasty', cutdownInfo });
        assert.equal(result.activeOver, 0);
        assert.deepEqual(ids(result.dropCandidatePids), []);
    }
});

test('positive active overage selects only the required eligible bench choices', () => {
    const rows = [row('starter', 1, { isStarter: true }), row('ir', 0, { isIR: true }), row('core', 2, { gmIsUntouchable: true }), row('locked', 3), row('bench1', 4), row('bench2', 5), row('bench3', 6)];
    const result = candidates({ rows, league: league(8), leagueType: 'dynasty', cutdownInfo: near(4), roster: { players: rows.map(r => r.pid), locked_players: ['locked'] } });
    assert.equal(result.activeOver, 2);
    assert.deepEqual(ids(result.dropCandidatePids), ['bench1', 'bench2']);
    assert.match(result.reasons.bench1, /2 over its 4-player limit/);
});

test('actual league active capacity can demonstrate an overage without a cutdown', () => {
    const rows = [row('starter', 100, { isStarter: true }), row('bench1', 10), row('bench2', 20)];
    const result = candidates({ rows, league: league(2), leagueType: 'chopped' });
    assert.equal(result.activeOver, 1);
    assert.deepEqual(ids(result.dropCandidatePids), ['bench1']);
});

test('taxi-only overage stays separate from unused active capacity', () => {
    const rows = [row('starter', 100, { isStarter: true }), row('taxi1', 10, { isTaxi: true }), row('taxi2', 20, { isTaxi: true })];
    const result = candidates({ rows, league: league(5, { settings: { taxi_slots: 4, taxi_years: 1 } }), leagueType: 'dynasty', cutdownInfo: near(5, 1) });
    assert.equal(result.activeOver, 0);
    assert.equal(result.taxiOver, 1);
    assert.deepEqual(ids(result.dropCandidatePids), ['taxi1']);
    assert.match(result.reasons.taxi1, /Taxi squad is 1 over its 1-player limit/);
});

test('known eligible dynasty and keeper bench players use verified taxi room', () => {
    const rows = [row('starter', 100, { isStarter: true }), row('rookie', 10, { p: { years_exp: 0 } }), row('vet', 20)];
    for (const leagueType of ['dynasty', 'keeper']) {
        const result = candidates({ rows, league: league(2, { settings: { taxi_slots: 1, taxi_years: 1 } }), leagueType, showTaxi: true });
        assert.equal(result.activeOver, 1);
        assert.deepEqual(ids(result.dropCandidatePids), []);
        assert.deepEqual(ids(result.taxiCandidatePids), ['rookie']);
        assert.match(result.reasons.rookie, /Taxi eligible with 1 open taxi spot/);
    }
});

test('seasonal formats and disabled taxi features do not offer taxi moves', () => {
    const rows = [row('starter', 100, { isStarter: true }), row('rookie', 10, { p: { years_exp: 0 } })];
    for (const leagueType of ['redraft', 'chopped', 'best_ball', 'unknown']) {
        const result = candidates({ rows, league: league(3, { settings: { taxi_slots: 1, taxi_years: 1 } }), leagueType });
        assert.deepEqual(ids(result.dropCandidatePids), []);
        assert.deepEqual(ids(result.taxiCandidatePids), []);
    }
    assert.equal(candidates({ rows, league: league(3, { settings: { taxi_slots: 1, taxi_years: 1 } }), leagueType: 'dynasty', showTaxi: false }).taxiCandidatePids.size, 0);
});

test('standing dynasty taxi suggestions are limited to three and create no cuts', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row('rookie' + i, i, { p: { years_exp: 0 } }));
    const result = candidates({ rows, league: league(5, { settings: { taxi_slots: 5, taxi_years: 1 } }), leagueType: 'dynasty' });
    assert.deepEqual(ids(result.taxiCandidatePids), ['rookie0', 'rookie1', 'rookie2']);
    assert.equal(result.dropCandidatePids.size, 0);
});

test('unknown limits, unknown values and unknown eligibility do not become invented evidence', () => {
    const rows = [row('unknown', null, { p: {} }), row('known', 0, { p: { years_exp: 0 } })];
    const noCaps = candidates({ rows, league: {}, leagueType: 'dynasty', cutdownInfo: { rule: { activeSlots: 1, taxiSlots: 1 }, status: { isNear: false } } });
    assert.equal(noCaps.activeOver, null);
    assert.equal(noCaps.taxiOver, null);
    assert.equal(noCaps.dropCandidatePids.size, 0);
    assert.equal(noCaps.taxiCandidatePids.size, 0);
    const unknownValue = candidates({ rows, league: league(1), leagueType: 'redraft' });
    assert.equal(unknownValue.activeOver, 1);
    assert.deepEqual(ids(unknownValue.dropCandidatePids), ['known'], 'Known zero remains a valid value; missing does not sort as zero');
    const unknownEligibility = candidates({ rows, league: league(4, { settings: { taxi_slots: 2 } }), leagueType: 'dynasty' });
    assert.equal(unknownEligibility.taxiCandidatePids.size, 0);
    const pendingRoomOnly = candidates({ rows, league: league(4), leagueType: 'dynasty', cutdownInfo: near(1, 2) });
    assert.equal(pendingRoomOnly.taxiCandidatePids.size, 0, 'A pending limit does not establish current taxi room');
});

test('roster membership and reserve counts remain authoritative when player metadata is incomplete', () => {
    const result = candidates({ rows: [row('bench', 10)], league: league(1), leagueType: 'redraft', roster: { players: ['bench', 'missing', 'reserve'], reserve: ['reserve'] } });
    assert.equal(result.activeOver, 1);
    assert.deepEqual(ids(result.dropCandidatePids), ['bench']);
    const stale = candidates({ rows: [row('stale', 10)], league: league(1), leagueType: 'redraft', roster: { players: [] } });
    assert.equal(stale.dropCandidatePids.size, 0);
    assert.equal(stale.activeOver, 0);
});

test('adjusted ranking is optional, pure, and never mutates inputs', () => {
    const rows = [row('bench1', 10), row('bench2', 20)];
    const before = JSON.stringify(rows);
    const result = candidates({ rows, league: league(1), leagueType: 'dynasty', adjustedValue: r => r.pid === 'bench2' ? 5 : r.dhq });
    assert.deepEqual(ids(result.dropCandidatePids), ['bench2']);
    assert.equal(JSON.stringify(rows), before);
    assert.equal(candidates({ rows, league: league(1), adjustedValue: () => NaN }).dropCandidatePids.size, 0);
});
