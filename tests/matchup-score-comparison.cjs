'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { window: {} };
vm.createContext(context);
for (const file of ['js/shared/lineup-forecast-snapshots.js', 'js/shared/matchup-score-comparison.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
const { build } = context.window.App.MatchupScoreComparison;
const clone = value => JSON.parse(JSON.stringify(value));
const league = { league_id: '1356311207652360192', season: 2026, roster_positions: ['QB', 'RB', 'FLEX', 'BN', 'IR'], scoring_settings: { rec: 0.5 } };
const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
const pregame = { a: 10, b: 8, c: 9, d: 7, e: 11, f: 12 };
const store = context.window.App.LineupForecastSnapshots.createStore();
store.capture({ league, week: 5, projections: pregame, statuses: Object.fromEntries(ids.map(pid => [pid, 'upcoming'])), now: 1000 });
function fixture(overrides = {}) {
    return {
        league: clone(league), week: 5, myRosterId: 1,
        rows: [
            { roster_id: 1, matchup_id: 20, starters: ['a', 'b', 'c'], players_points: { a: 0, b: -2.5, c: 12, bench: 99 }, points: 99, custom_points: 0 },
            { roster_id: 2, matchup_id: 20, starters: ['d', 'e', 'f'], players_points: { d: 8, e: 10, f: 11 }, points: 29 },
            { roster_id: 3, matchup_id: 30, starters: ['unrelated'], players_points: { unrelated: 500 }, points: 500 },
        ],
        scoreStatus: 'ready', scoreError: null, scoresSupported: true, gamesFresh: true,
        gameState: () => 'final', forecasts: store.read(league, 5), projections: { a: 900, bench: 1000 },
        currentSeason: 2026, currentWeek: 5, scope: { leagueId: league.league_id, season: 2026, week: 5 },
        ...overrides,
    };
}

const input = fixture();
const before = JSON.stringify(input);
const final = build(input);
assert.equal(JSON.stringify(input), before, 'the model does not mutate submitted rows, snapshots, or caller options');
assert.equal(final.available, true);
assert.equal(final.hasStarted, true);
assert.equal(final.ready, true);
assert.equal(final.headerLabel, 'Final points');
assert.equal(final.allFinal, true);
assert.deepEqual(clone(final.rosterIds), ['1', '2'], 'only the exact same matchup opponent is included');
assert.equal(final.totalMine, 0, 'a custom zero team total overrides the provider base points');
assert.equal(final.totalTheirs, 29);
assert.equal(final.projectedMine, 27, 'saved submitted-player projections override recomputed estimates');
assert.equal(final.baselineMine, 27);
assert.equal(final.myDelta, -27, 'team variance uses the provider custom total, never a sum of individual points');
assert.match(final.sourceNote, /custom league scoring/);
assert.equal(final.h2h.length, 3);
assert.deepEqual(clone(final.h2h.map(row => [row.slot, row.myPid, row.theirPid])), [['QB', 'a', 'd'], ['RB', 'b', 'e'], ['FLEX', 'c', 'f']]);
assert(!JSON.stringify(final.h2h).includes('bench'), 'bench, draft, and optimal players never replace submitted slots');
assert.equal(final.h2h[0].myActual, 0, 'true actual zero stays zero');
assert.equal(final.h2h[1].myActual, -2.5, 'negative fantasy scoring stays signed');
assert.equal(final.h2h[0].myComplete, true);
assert.equal(final.h2h[0].myComparable, true);
assert.equal(final.h2h[0].myBaseline, 10);
assert.equal(final.h2h[0].myDelta, -10);
assert.equal(final.h2h[0].myTone, 'quiet');
assert.equal(final.h2h[0].myProjectionKind, 'pregame');
assert.equal(final.positionTotals.find(row => row.slot === 'FLEX').players.length, 1, 'flex stays in its submitted slot instead of duplicating a position');

const pre = fixture({ gameState: () => 'upcoming' });
pre.rows[0].points = 0; pre.rows[0].custom_points = 0;
pre.rows[1].points = 0;
pre.rows[0].players_points = { a: 0, b: 0, c: 0 };
pre.rows[1].players_points = { d: 0, e: 0, f: 0 };
const pregameModel = build(pre);
assert.equal(pregameModel.hasStarted, false, 'provider pregame zeroes do not start the scoring view');
assert.equal(pregameModel.totalMine, null);
assert.equal(pregameModel.totalTheirs, null);
assert.equal(pregameModel.headerLabel, 'Pregame projection');
assert(pregameModel.h2h.every(row => row.myActual === null && row.theirActual === null));
assert(pregameModel.h2h.every(row => !row.myComplete && !row.theirComplete && row.myTone === 'neutral' && row.theirTone === 'neutral'));
assert.equal(pregameModel.projectedMine, 27, 'the pregame projection remains available before actuals exist');

const live = fixture({ league: { ...league, roster_positions: ['QB', 'RB', 'RB', 'BN'] }, gameState: pid => pid === 'c' ? 'upcoming' : pid === 'b' ? 'live' : 'final' });
const underway = build(live);
assert.equal(underway.headerLabel, 'Actual points');
assert.equal(underway.h2h[1].myActual, -2.5);
assert.equal(underway.h2h[1].myComplete, false);
assert.equal(underway.h2h[1].myDelta, null, 'an in-progress player is never compared with a full-game forecast');
assert.equal(underway.h2h[1].myTone, 'neutral');
assert.equal(underway.h2h[2].myActual, null);
assert.equal(underway.positionTotals.find(row => row.slot === 'RB').myActual, -2.5, 'unstarted players contribute zero to points so far without displaying an individual fake zero');
assert.equal(underway.myDelta, null, 'a team comparison waits until the complete matchup is final');
delete live.rows[0].players_points.b;
assert.equal(build(live).positionTotals.find(row => row.slot === 'RB').myActual, null, 'a missing started-player score makes the entire position actual unknown');

const absent = fixture();
delete absent.rows[0].players_points.b;
const missingIndividual = build(absent);
assert.equal(missingIndividual.totalMine, 0, 'a known provider team total remains visible when individual actuals are unavailable');
assert.equal(missingIndividual.h2h[1].myActual, null);
assert.equal(missingIndividual.h2h[1].myComplete, false);
assert.equal(missingIndividual.positionTotals.find(row => row.slot === 'RB').myActual, null);
assert.equal(missingIndividual.myDelta, null, 'missing player evidence cannot produce a team forecast grade');

const later = fixture({ forecasts: { players: { ...store.read(league, 5).players, a: { kind: 'first-view', points: 15, capturedAt: 5000 } } } });
const firstView = build(later);
assert.equal(firstView.h2h[0].myProjection, 15);
assert.equal(firstView.h2h[0].myProjectionKind, 'first-view');
assert.equal(firstView.h2h[0].myBaseline, null, 'a frozen first-view estimate is not relabeled pregame');
assert.equal(firstView.h2h[0].myComparable, false);
assert.equal(firstView.h2h[0].myDelta, null);
assert.equal(firstView.h2h[0].myTone, 'neutral');
assert.match(firstView.h2h[0].myProjectionLabel, /first view/);
assert.equal(firstView.baselineMine, null, 'incomplete pregame coverage does not become a partial team baseline');
delete later.forecasts.players.a;
assert.equal(build(later).h2h[0].myProjectionKind, 'current');
assert.equal(build(later).h2h[0].myProjection, 900);
delete later.projections.a;
assert.equal(build(later).h2h[0].myProjectionKind, 'missing');
assert.equal(build(later).h2h[0].myProjection, null);

for (const overrides of [{ scoreStatus: 'stale', scoreError: 'Could not refresh' }, { scoreStatus: 'refreshing' }, { scoreStatus: 'error' }, { scoreStatus: 'ready', scoreError: 'Failed' }, { gamesFresh: false }]) {
    const stale = build(fixture(overrides));
    assert.equal(stale.available, true, 'last available rows remain readable');
    assert.equal(stale.ready, false);
    assert.equal(stale.totalMine, 0);
    assert(stale.h2h.every(row => !row.myComplete && !row.theirComplete && row.myDelta === null && row.theirDelta === null && row.myTone === 'neutral' && row.theirTone === 'neutral'), 'stale NFL or fantasy data cannot grade a player');
    assert.equal(stale.myDelta, null);
    assert.equal(stale.theirDelta, null);
}
assert.equal(build(fixture({ scoreStatus: 'stale', scoreError: 'Failed' })).headerLabel, 'Last available points');
assert.equal(build(fixture({ scoresSupported: false })).reason, 'unsupported');

const unknown = fixture({ gameState: () => 'unknown' });
const unknownModel = build(unknown);
assert.equal(unknownModel.hasStarted, true, 'nonzero submitted score evidence can show actuals with unverified NFL status');
assert.equal(unknownModel.h2h[0].myActual, null, 'an unverified provider zero is not treated as an earned zero');
assert.equal(unknownModel.h2h[1].myActual, -2.5);
assert.equal(unknownModel.h2h[1].myComplete, false);
unknown.rows[0].players_points = {}; unknown.rows[0].custom_points = -3;
assert.equal(build(unknown).totalMine, -3, 'authoritative nonzero team actuals can stand alone without inventing individual scores');

for (const scope of [{ leagueId: 'another' }, { season: 2025 }, { week: 6 }]) assert.equal(build(fixture({ scope })).reason, 'scope-mismatch');
assert.equal(build(fixture({ forecasts: { players: {}, scope: { leagueId: 'another', season: 2026, week: 5 } } })).reason, 'scope-mismatch');
const future = build(fixture({ currentWeek: 4 }));
assert.equal(future.phase, 'future');
assert.equal(future.hasStarted, false, 'a future scope cannot inherit present actual scoring or finality');
assert.equal(future.allFinal, false);
assert.equal(future.totalMine, null);
assert(future.h2h.every(row => row.myActual === null && row.theirActual === null && !row.myComplete && !row.theirComplete));
const historical = build(fixture({ currentWeek: 6, projections: {} }));
assert.equal(historical.phase, 'past');
assert.equal(historical.h2h[0].myProjectionKind, 'pregame');
assert.equal(historical.h2h[0].myBaseline, 10, 'a historical review uses only its week-scoped saved estimate');
assert.equal(store.read(league, 4).players.a, undefined, 'the snapshot store does not borrow another week baseline');
const historicalMissing = build(fixture({ currentWeek: 6, forecasts: store.read(league, 4), projections: {} }));
assert.equal(historicalMissing.h2h[0].myProjection, null, 'no historical baseline means unavailable rather than a recomputation');
assert.equal(build(fixture({ currentWeek: 6, forecasts: { players: {} }, projections: { a: 900 } })).h2h[0].myProjection, null, 'a historical scope rejects an accidental current-estimate fallback');

const bye = fixture(); bye.rows[0].matchup_id = null;
assert.equal(build(bye).reason, 'bye');
const unrelated = fixture(); unrelated.rows[1].matchup_id = 99;
assert.equal(build(unrelated).reason, 'missing-opponent');
const bad = fixture(); bad.rows[0].starters = ['a', 'a', 'c'];
assert.equal(build(bad).reason, 'duplicate-submitted-player', 'invalid duplicate slots cannot double-count a score');
const explicit = build(fixture({ slots: [{ idx: 0, slotName: 'QB' }, { idx: 1, slotName: 'D/ST' }, { idx: 2, slotName: 'OP' }] }));
assert.deepEqual(clone(explicit.h2h.map(row => row.slot)), ['QB', 'DEF', 'SUPER_FLEX']);
const gapSlot = build(fixture({ league: { ...league, roster_positions: ['QB', 'UNKNOWN_SLOT', 'FLEX', 'BN'] }, slots: [{ idx: 0, slotName: 'QB' }, { idx: 2, slotName: 'FLEX' }] }));
assert.equal(gapSlot.h2h[1].myPid, 'b', 'unrecognized slot labels cannot shift the submitted array alignment');
assert.equal(gapSlot.h2h[1].slot, 'UNKNOWN_SLOT');
const truncated = fixture(); truncated.rows[0].starters = ['a'];
const missingSlots = build(truncated);
assert.equal(missingSlots.h2h[0].myReported, true);
assert.equal(missingSlots.h2h[1].myReported, false, 'a truncated provider lineup does not claim an explicitly empty slot');
assert.equal(missingSlots.h2h[1].myActual, null);
assert.equal(missingSlots.h2h[1].myProjection, null);
assert.equal(missingSlots.h2h[1].myBaseline, null);
assert.equal(missingSlots.h2h[1].myState, 'unknown');
assert.equal(missingSlots.projectedMine, null);
assert.equal(missingSlots.baselineMine, null);
assert.equal(missingSlots.myComplete, false);
assert.equal(missingSlots.allFinal, false);
assert.equal(missingSlots.totalMine, 0, 'a reported team total survives an incomplete starter list');
truncated.rows[0].starters = ['a', '0', null];
const explicitEmpty = build(truncated);
assert.equal(explicitEmpty.h2h[1].myReported, true);
assert.equal(explicitEmpty.h2h[1].myActual, 0);
assert.equal(explicitEmpty.h2h[2].myActual, 0);
assert.equal(explicitEmpty.projectedMine, 10);
assert.equal(build(fixture({ gamesFresh: false })).headerLabel, 'Actual points · status unverified');
const byePlayer = build(fixture({ gameState: pid => pid === 'c' ? 'bye' : 'final' }));
assert.equal(byePlayer.h2h[2].myState, 'bye');
assert.equal(byePlayer.h2h[2].myActual, 0, 'a verified bye contributes zero actual without a grade');
assert.equal(byePlayer.h2h[2].myComplete, false);
assert.equal(byePlayer.h2h[2].myDelta, null);
assert.equal(byePlayer.h2h[2].myTone, 'neutral');

console.log('PASS submitted matchup score review: scoped saved forecasts, custom totals, signed and missing actuals, strict final variance, neutral stale data, and exact slot alignment');
