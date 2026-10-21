'use strict';
const assert = require('node:assert/strict');
global.window = globalThis; window.App = {};
for (const name of ['roster', 'helmet', 'rules', 'draft-room', 'era-rules', 'season', 'engine', 'hidden-years', 'rivals', 'ai']) require(`../js/shared/time-league-${name}.js`);
const { TimeLeagueEngine: E, TimeLeagueSeason: S, TimeLeagueAI: AI } = App;
const stamp = '2026-10-21T00:00:00Z';
const scoring = { passTd: 4, reception: .5, rushRecYd: .1, passingYd: .04, turnover: -2 };
const settings = { hiddenYears: true, gameDeckVersion: 1, rosterSlots: { QB: 1, BN: 1 }, maxQuarterbacks: 2,
    regularSeasonWeeks: 12, scoring, eraRules: { mode: 'any-era', decades: [] }, aiDifficulty: 'veteran' };
const entry = (id, slot, position = 'QB') => ({ entryId: id, identity: `player:${position}:${id}`, name: id, position,
    drawnSeason: 2020, hiddenDecade: '2020s', editionId: `mystery:player:${position}:${id}`, slot, acquiredVia: 'draft', acquiredWeek: 1 });
const star = entry('star', 'QB'), reserve = entry('reserve', 'BN');
const cards = new Map([[star.identity, { ...star, peak: 40, seasons: [{ season: 2020, games: 1, points: 40 }] }],
    [reserve.identity, { ...reserve, peak: 140, seasons: [{ season: 2020, games: 14, points: 140 }] }]]);
const rows = [];
for (const [player, count, yards] of [[star, 1, 1000], [reserve, 14, 250]]) {
    for (let week = 1; week <= count; week++) rows.push({ identity: player.identity, name: player.name, position: player.position,
        season: 2020, week, scheduledGames: 14, stats: { ...S.emptyStatLine(), passYd: yards } });
}
const index = S.buildGameLogIndex(rows);
const create = (overrides = {}) => {
    const state = { ...E.createTimeLeague({ name: 'Hidden AI current clue', seed: 'seed0', createdAt: stamp, settings: { ...settings, ...overrides },
        seats: [{ name: 'Human', manager: 'human' }, { name: 'Rival', manager: 'ai', aiPersona: 'steward' }] }),
        phase: 'season', weekStage: 'ready', seasonsRevealed: true };
    return { ...state, teams: state.teams.map(team => ({ ...team, roster: [star, reserve] })) };
};
const slotOf = (state, id) => state.teams[1].roster.find(player => player.entryId === id)?.slot;
const publicState = (state, availability) => ({ ...state, publicSnapshotVersion: 1,
    playerReports: Object.fromEntries(state.teams[1].roster.map(player => [player.editionId,
        { week: state.currentWeek, currentAvailable: availability[player.entryId] ?? null }])) });

// The real shared clue exposes only current availability/rating. The larger
// historical average is not a reason to keep a known empty game in the lineup.
const state = create();
assert.equal(S.weeklyStarOutlook(star, 1, 12, index, scoring, null, state).schedule[0].available, false);
assert.equal(S.weeklyStarOutlook(reserve, 1, 12, index, scoring, null, state).schedule[0].available, true);
const before = JSON.stringify(state);
const prepared = AI.aiPrepareWeek(state, cards, index);
assert.equal(slotOf(prepared, 'reserve'), 'QB'); assert.equal(slotOf(prepared, 'star'), 'BN');
assert.deepEqual(prepared.teams[0], state.teams[0], 'Human lineup decisions remain untouched');
assert.equal(JSON.stringify(state), before, 'Preparation does not mutate the saved state');
assert.deepEqual(AI.aiPrepareWeek(prepared, cards, index), prepared, 'Retries settle on the same legal lineup');
assert.deepEqual(E.lineupProblems(prepared, 't2'), []);

// Missing data and stale reports remain unknown. In those cases the existing
// persona estimate still decides the lineup, without a fabricated zero.
assert.equal(slotOf(AI.aiPrepareWeek(state, cards), 'star'), 'QB');
assert.equal(slotOf(AI.aiPrepareWeek(state, cards, new Map()), 'star'), 'QB');
const unknown = publicState(state, { star: null, reserve: true });
assert.equal(slotOf(AI.aiPrepareWeek(unknown, cards), 'star'), 'QB');
const stale = publicState(state, { star: false, reserve: true });
Object.values(stale.playerReports).forEach(report => { report.week = 2; });
assert.equal(slotOf(AI.aiPrepareWeek(stale, cards), 'star'), 'QB');
const known = publicState(state, { star: false, reserve: true });
assert.equal(slotOf(AI.aiPrepareWeek(known, cards), 'reserve'), 'QB');
assert.equal(slotOf(AI.aiPrepareWeek(publicState(state, { star: true, reserve: true }), cards), 'star'), 'QB');

// Ratings may depend on era scoring. Without its data the clue stays unknown;
// with the configured factors the exact same availability rule applies.
const adjusted = create({ eraAdjusted: true });
assert.equal(slotOf(AI.aiPrepareWeek(adjusted, cards, index), 'star'), 'QB');
assert.equal(slotOf(AI.aiPrepareWeek(adjusted, cards, index, new Map([['2020:QB', 1.1]])), 'reserve'), 'QB');

// Later gates and completed games cannot turn stale or future availability into
// an actionable clue. A required position remains filled if no substitute fits.
for (const patch of [{ weekStage: 'postgame' }, { phase: 'complete' }, { phase: 'draft', seasonsRevealed: false }]) {
    assert.equal(slotOf(AI.aiPrepareWeek({ ...known, ...patch }, cards), 'star'), 'QB');
}
const noSubstitute = { ...known, teams: known.teams.map(team => ({ ...team, roster: team.roster.filter(player => player.entryId !== 'reserve') })) };
assert.equal(slotOf(AI.aiPrepareWeek(noSubstitute, cards), 'star'), 'QB');

// A public snapshot can supply the clue with no archive or secret fields.
// Throwing getters prove that AI ranking never asks for the selected season,
// private game plan, future ratings or the score behind the coarse clue.
const trapped = { ...known, teams: known.teams.map(team => ({ ...team, roster: team.roster.map(player => {
    const safe = { ...player }; delete safe.drawnSeason;
    Object.defineProperty(safe, 'drawnSeason', { get() { throw new Error('AI read the assigned hidden season'); } });
    return safe;
}) })) };
for (const key of ['privateGameSeed', 'privateGameDecks', 'privateDraws', 'hiddenYearAssignments']) {
    Object.defineProperty(trapped, key, { get() { throw new Error(`AI read private state: ${key}`); } });
}
for (const report of Object.values(trapped.playerReports)) {
    for (const key of ['points', 'currentStars', 'future', 'schedule']) Object.defineProperty(report, key, { get() { throw new Error(`AI read beyond availability: ${key}`); } });
}
assert.equal(slotOf(AI.aiPrepareWeek(trapped, cards), 'reserve'), 'QB');
assert.equal(slotOf(AI.aiPrepareWeek({ ...known, seed: 'a-different-private-seed' }, cards), 'reserve'), 'QB');

// A bounded sample answers legality/determinism across every existing persona
// and difficulty. It is not a season-balance or game-enjoyment simulation.
const mixedRoster = [], mixedCards = new Map(), mixedAvailability = {};
for (const [position, slot] of [['QB', 'QB'], ['RB', 'RB'], ['WR', 'FLEX'], ['K', 'K'], ['DEF', 'DEF']]) {
    for (const starter of [true, false]) {
        const player = entry(`${position}-${starter ? 'known-empty' : 'available'}`, starter ? slot : 'BN', position);
        mixedRoster.push(player);
        mixedCards.set(player.identity, { ...player, peak: starter ? 400 : 140,
            seasons: [{ season: 2020, games: 14, points: starter ? 400 : 140 }] });
        mixedAvailability[player.entryId] = !starter;
    }
}
let samples = 0;
for (const aiPersona of E.AI_PERSONA_IDS) for (const aiDifficulty of ['rookie', 'veteran', 'allpro']) {
    const variant = publicState({ ...state, settings: { ...state.settings, aiDifficulty,
        rosterSlots: { QB: 1, RB: 1, FLEX: 1, K: 1, DEF: 1, BN: 5 } },
        teams: state.teams.map(team => team.manager === 'ai' ? { ...team, aiPersona, roster: mixedRoster } : team) }, mixedAvailability);
    const next = AI.aiPrepareWeek(variant, mixedCards);
    assert(next.teams[1].roster.filter(player => S.isStarterSlot(player.slot)).every(player => mixedAvailability[player.entryId] === true));
    assert.deepEqual(E.lineupProblems(next, 't2'), []);
    assert.deepEqual(AI.aiPrepareWeek(variant, mixedCards), next);
    assert.deepEqual(next.teams[0], variant.teams[0]);
    samples++;
}
console.log(`PASS: Hidden Years current availability, unknown/stale/complete gates, private-data traps, unchanged human choices, era scoring and ${samples} deterministic legal persona/difficulty lineups.`);
