'use strict';
const assert = require('node:assert/strict');
global.window = globalThis; window.App = {};
for (const name of ['roster', 'helmet', 'rules', 'draft-room', 'era-rules', 'season', 'engine', 'hidden-years', 'ai', 'actions']) require(`../js/shared/time-league-${name}.js`);
const { TimeLeagueEngine: E, TimeLeagueSeason: S, TimeLeagueActions: A } = App;
const stamp = '2026-10-21T00:00:00Z';
const scoring = { passTd: 4, reception: .5, rushRecYd: .1, passingYd: .04, turnover: -2 };
const entry = (teamId, index = 0, position = 'QB', slot = position) => ({ entryId: `entry-${teamId}-${index}`,
    identity: `player:${position}:${teamId}-${index}`, name: `${teamId} ${position} ${index}`, position, slot,
    drawnSeason: 2020, acquiredVia: 'draft', acquiredWeek: 1 });
const create = (count = 3, overrides = {}) => {
    const initial = E.createTimeLeague({ name: 'Readiness fixture', seed: 'readiness-fixture', createdAt: stamp,
        settings: { gameDeckVersion: 0, hiddenYears: false, rosterSlots: { QB: 1 }, maxQuarterbacks: 2,
            regularSeasonWeeks: 2, playoffTeams: 0, scoring, eraRules: { mode: 'any-era', decades: [] }, ...overrides },
        seats: Array.from({ length: count }, (_, index) => ({ name: `Team ${index + 1}`, manager: 'human' })) });
    return { ...initial, phase: 'season', weekStage: 'lineup', seasonsRevealed: true,
        teams: initial.teams.map(team => ({ ...team, roster: [entry(team.teamId)] })) };
};
const dataFor = state => ({ cards: new Map(), eraFactors: new Map(), logIndex: S.buildGameLogIndex(state.teams.flatMap((team, index) =>
    team.roster.flatMap(player => [1, 2, 3, 4].map(week => ({ identity: player.identity, position: player.position, season: 2020, week,
        stats: { ...S.emptyStatLine(), passYd: 100 * (index + 1) } })))) ) });
const host = { role: 'commissioner', seat_team_id: 't1' };
const act = (state, action, data = dataFor(state)) => A.applyOnlineAction(state, action, host, data, stamp);
let passed = 0;
const test = (name, run) => { run(); passed++; console.log(`  ok ${name}`); };

test('regular matchups and a bye all require human lineups; returned pairs are independent', () => {
    const state = create(), bye = state.teams.find(team => !state.schedule[0].pairs.some(pair => pair.includes(team.teamId)));
    assert.deepEqual(E.weekParticipation(state, bye.teamId), { kind: 'bye', pair: null, requiresLineup: true });
    const active = state.teams.find(team => team.teamId !== bye.teamId);
    const read = E.weekParticipation(state, active.teamId);
    assert.equal(read.kind, 'matchup'); assert.equal(read.requiresLineup, true);
    assert.deepEqual(read.pair, state.schedule[0].pairs[0]);
    read.pair.reverse();
    assert.notDeepEqual(read.pair, state.schedule[0].pairs[0], 'Reading participation cannot mutate the saved schedule');
    const readiness = E.lineupReadiness(state);
    assert.equal(readiness.teams.length, 3); assert.deepEqual(readiness.blockers, []); assert.equal(readiness.ready, true);
    assert.equal(readiness.teams.find(team => team.teamId === bye.teamId).kind, 'bye');
    const oneAi = { ...state, teams: state.teams.map((team, index) => index === 2 ? { ...team, manager: 'ai', roster: [] } : team) };
    assert.equal(E.lineupReadiness(oneAi).teams.length, 2, 'AI teams are not human readiness blockers');
});

test('a missing bye lineup blocks the real lock action and names the manager', () => {
    const state = create(), bye = state.teams.find(team => E.weekParticipation(state, team.teamId).kind === 'bye');
    const missing = { ...state, teams: state.teams.map(team => team.teamId === bye.teamId ? { ...team, roster: [] } : team) };
    const before = JSON.stringify(missing), readiness = E.lineupReadiness(missing);
    assert.equal(readiness.ready, false); assert.equal(readiness.blockers.length, 1);
    assert.deepEqual(readiness.blockers[0], { teamId: bye.teamId, name: bye.name, kind: 'bye', problems: ['QB slot is empty'] });
    assert.throws(() => act(missing, { type: 'finalize-rosters' }), new RegExp(`Check ${bye.name}`));
    assert.equal(JSON.stringify(missing), before);
});

test('a regular bye keeps its scored total, PF and all-play without adding an H2H result', () => {
    const state = create(), bye = state.teams.find(team => E.weekParticipation(state, team.teamId).kind === 'bye');
    assert.equal(bye.teamId, 't1', 'The known fixture has a Week 1 bye for Team 1');
    const data = dataFor(state), ready = act(state, { type: 'finalize-rosters' }, data), settled = act(ready, { type: 'week' }, data);
    const saved = settled.finalizedWeeks[0], result = saved.results.find(row => row.teamId === bye.teamId);
    const standing = E.computeStandings(settled).find(row => row.teamId === bye.teamId);
    assert.equal(result.total, 4); assert.equal(standing.pointsFor, 4);
    assert.deepEqual([standing.wins, standing.losses, standing.ties, standing.pointsAgainst], [0, 0, 0, 0]);
    assert.deepEqual([standing.allPlayWins, standing.allPlayLosses], [0, 2]);
    assert(!saved.matchups.some(match => match.home === bye.teamId || match.away === bye.teamId));
    assert.deepEqual(E.weekParticipation(settled, bye.teamId, 1), { kind: 'bye', pair: null, requiresLineup: false });
    const restored = E.normalizeTimeLeague(JSON.parse(JSON.stringify(settled)));
    assert.deepEqual(E.weekParticipation(restored, bye.teamId, 1), E.weekParticipation(settled, bye.teamId, 1));
    assert.deepEqual(restored.finalizedWeeks, settled.finalizedWeeks);
});

test('occupied no-record starters are legal; readiness never reads hidden years or source games', () => {
    const state = create(), noLogs = { cards: new Map(), eraFactors: new Map(), logIndex: new Map() };
    const ready = act(state, { type: 'finalize-rosters' }, noLogs);
    assert.equal(ready.weekStage, 'ready'); assert.equal(E.lineupReadiness(ready).ready, true);
    const settled = act(ready, { type: 'week' }, noLogs);
    assert(settled.finalizedWeeks[0].results.every(result => result.total === 0));
    const trapped = { ...state, settings: { ...state.settings, hiddenYears: true }, teams: state.teams.map(team => ({ ...team,
        roster: team.roster.map(player => {
            const safe = { ...player }; delete safe.drawnSeason;
            Object.defineProperty(safe, 'drawnSeason', { get() { throw new Error('Readiness consulted a hidden year'); } });
            return safe;
        }) })) };
    for (const key of ['seed', 'playerReports', 'privateGameDecks', 'privateDraws']) {
        Object.defineProperty(trapped, key, { get() { throw new Error(`Readiness consulted ${key}`); } });
    }
    assert.equal(E.lineupReadiness(trapped).ready, true);
});

test('missing schedules remain unknown while the regular-week lock requirement is preserved', () => {
    const state = create(), missingSchedule = { ...state, schedule: [], teams: state.teams.map((team, index) => index ? team : { ...team, roster: [] }) };
    assert.deepEqual(E.weekParticipation(missingSchedule, 't1'), { kind: 'unknown', pair: null, requiresLineup: true });
    assert.equal(E.lineupReadiness(missingSchedule).teams.length, 3);
    assert.equal(E.lineupReadiness(missingSchedule).blockers[0].kind, 'unknown');
    assert.throws(() => act(missingSchedule, { type: 'finalize-rosters' }), /Check Team 1/);
    const brokenRow = { ...create(4), schedule: [{ week: 1, pairs: [['t2', 't3']] }] };
    assert.deepEqual(E.weekParticipation(brokenRow, 't1'), { kind: 'unknown', pair: null, requiresLineup: true }, 'A partial even-team schedule cannot invent a bye');
    const missingResult = { ...state, finalizedWeeks: [{ week: 1, results: [], matchups: [] }] };
    assert.equal(E.weekParticipation(missingResult, 't1').kind, 'unknown', 'A saved week without this team result is not proof of a bye');
});

const playoffFixture = () => {
    const regular = create(4, { regularSeasonWeeks: 1, playoffTeams: 2 });
    return { ...E.finalizeCurrentWeek(regular, dataFor(regular).logIndex, null, stamp), weekStage: 'lineup' };
};

test('only teams in the current playoff round can block lineup locking', () => {
    const state = playoffFixture(), pair = E.playoffPairs(state, state.currentWeek)[0];
    const observer = state.teams.find(team => !pair.includes(team.teamId));
    const spectator = { ...state, teams: state.teams.map(team => pair.includes(team.teamId) ? team : { ...team, roster: [] }) };
    assert.deepEqual(E.weekParticipation(spectator, observer.teamId), { kind: 'observer', pair: null, requiresLineup: false });
    assert.deepEqual(E.lineupReadiness(spectator).teams.map(team => team.teamId).sort(), [...pair].sort());
    assert.equal(act(spectator, { type: 'finalize-rosters' }).weekStage, 'ready');
    const missing = { ...spectator, teams: spectator.teams.map(team => team.teamId === pair[0] ? { ...team, roster: [] } : team) };
    assert.deepEqual(E.lineupReadiness(missing).blockers.map(team => team.teamId), [pair[0]]);
    assert.throws(() => act(missing, { type: 'finalize-rosters' }), new RegExp(`Check ${missing.teams.find(team => team.teamId === pair[0]).name}`));
});

test('the established ready-stage force behavior is preserved, without weakening lock validation', () => {
    const state = playoffFixture(), activeId = E.playoffPairs(state, state.currentWeek)[0][0];
    const missing = { ...state, weekStage: 'ready', teams: state.teams.map(team => team.teamId === activeId ? { ...team, roster: [] } : team) };
    assert.throws(() => act(missing, { type: 'week' }), /Managers still need to set their lineups/);
    const forced = act(missing, { type: 'week', force: true });
    assert.equal(forced.phase, 'complete');
    assert.equal(forced.finalizedWeeks.at(-1).results.find(row => row.teamId === activeId).total, 0);
    assert.throws(() => act({ ...missing, weekStage: 'lineup' }, { type: 'finalize-rosters', force: true }), /Managers still need to fill/);
});

test('custom slots retain missing, over-capacity and positional eligibility checks', () => {
    const base = create(2, { rosterSlots: { QB: 1, RB: 2, REC_FLEX: 1, SUPER_FLEX: 1, K: 1, DEF: 1, BN: 2 } });
    const positions = [['QB', 'QB'], ['RB', 'RB'], ['RB', 'RB'], ['WR', 'REC_FLEX'], ['TE', 'SUPER_FLEX'], ['K', 'K'], ['DEF', 'DEF']];
    const legal = { ...base, teams: base.teams.map(team => ({ ...team, roster: positions.map(([position, slot], index) => entry(team.teamId, index, position, slot)) })) };
    assert.equal(E.lineupReadiness(legal).ready, true);
    const broken = { ...legal, teams: legal.teams.map((team, index) => index ? team : { ...team, roster: [
        ...team.roster.filter(player => player.slot !== 'RB').map(player => player.slot === 'REC_FLEX' ? { ...player, position: 'QB' } : player),
        entry(team.teamId, 8, 'QB', 'QB'),
    ] }) };
    const problems = E.lineupReadiness(broken).blockers[0].problems;
    assert(problems.includes('RB has 2 empty slots'));
    assert(problems.includes('QB is over capacity (2/1)'));
    assert(problems.some(problem => problem.includes('is not eligible at REC_FLEX')));
});

test('saved old finals override reconstructed schedules and preserve observer/bye distinctions', () => {
    const regular = create(), scored = E.finalizeCurrentWeek(regular, dataFor(regular).logIndex, null, stamp);
    const changedSchedule = { ...scored, schedule: scored.schedule.map(row => row.week === 1 ? { ...row, pairs: [['t1', 't2']] } : row) };
    assert.equal(E.weekParticipation(changedSchedule, 't1', 1).kind, 'bye');
    assert.deepEqual(E.weekParticipation(changedSchedule, 't2', 1).pair, ['t2', 't3']);
    const playoff = playoffFixture(), ready = act(playoff, { type: 'finalize-rosters' }), complete = act(ready, { type: 'week' });
    const final = complete.finalizedWeeks.at(-1), pair = [final.matchups[0].home, final.matchups[0].away];
    const observer = complete.teams.find(team => !pair.includes(team.teamId));
    assert.deepEqual(E.weekParticipation(complete, pair[0], final.week), { kind: 'matchup', pair, requiresLineup: false });
    assert.deepEqual(E.weekParticipation(complete, observer.teamId, final.week), { kind: 'observer', pair: null, requiresLineup: false });
    assert.deepEqual(E.weekParticipation(complete, pair[0]), { kind: 'inactive', pair: null, requiresLineup: false });
    assert.deepEqual(E.lineupReadiness(complete), { teams: [], blockers: [], ready: true });
    const oldFinal = { ...complete, settings: { ...complete.settings, playoffTeams: 0 } };
    assert.equal(E.weekParticipation(oldFinal, pair[0], final.week).kind, 'matchup', 'An explicitly saved old final remains readable even if current settings no longer reconstruct its range');
});

test('drafts, invalid requests and unsettled future playoff rounds never invent a bye', () => {
    const state = create(4, { playoffTeams: 4 });
    assert.deepEqual(E.weekParticipation({ ...state, phase: 'draft' }, 't1'), { kind: 'inactive', pair: null, requiresLineup: false });
    for (const week of [0, -1, 1.5, '1', NaN]) assert.deepEqual(E.weekParticipation(state, 't1', week), { kind: 'unknown', pair: null, requiresLineup: false });
    assert.equal(E.weekParticipation(state, 'unknown-team').kind, 'unknown');
    assert.deepEqual(E.weekParticipation(state, 't1', 3), { kind: 'unknown', pair: null, requiresLineup: false });
    assert.deepEqual(E.weekParticipation(state, 't1', 5), { kind: 'inactive', pair: null, requiresLineup: false });
    const futureRegular = E.weekParticipation(state, 't1', 2);
    assert.equal(futureRegular.kind, 'matchup'); assert.equal(futureRegular.requiresLineup, false);
});

console.log(`PASS: ${passed} week participation/readiness fixtures; bye PF/all-play and H2H, named blockers, playoff observers, custom legality, hidden-data independence, saved finals and force compatibility.`);
