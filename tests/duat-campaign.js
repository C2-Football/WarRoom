'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Campaign = require('../js/duat/campaign.js');
const Conquest = require('../js/duat/conquest.js');
const Rules = require('../js/duat/rules.js');
const Season = globalThis.App.TimeLeagueSeason;
const copy = value => JSON.parse(JSON.stringify(value));
const root = path.resolve(__dirname, '..');
const cards = JSON.parse(fs.readFileSync(path.join(root, 'data/duat/player-cards.json'), 'utf8'));
const logs = Season.parseGameLogCsv(fs.readFileSync(path.join(root, 'data/duat/nflverse-game-logs.csv'), 'utf8')).logs;
const data = { cards, logIndex: Season.buildGameLogIndex(logs) };
const now = '2026-09-08T16:00:00.000Z';
const input = { version: 1, id: 'duat-test', name: 'The first historical Duat', seed: 'historical-duat-test', createdAt: now,
    seasons: [2025, 2024, 2023, 2022], hostFactionId: 'mesopotamia' };
const create = overrides => Campaign.createCampaign({ ...input, ...overrides }, data);
const reveal = state => Campaign.applyAction(state, { type: 'reveal-rulers', createdAt: now }, data);
function claimHumans(state) {
    for (const factionId of state.humanFactionIds) {
        while (state.conquest.pendingClaims[factionId] > 0) {
            const territoryId = Conquest.eligibleTerritories(state.conquest, factionId)[0];
            if (!territoryId) break;
            state = Campaign.applyAction(state, { type: 'claim', factionId, territoryId, createdAt: now }, data);
        }
    }
    return state;
}
function advance(state, source = data) {
    return Campaign.applyAction(claimHumans(state), { type: 'advance-week', createdAt: now }, source);
}
function through(week) {
    let state = reveal(create());
    while (state.week <= week) state = advance(state);
    return state;
}
function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.values(value).forEach(freeze); Object.freeze(value);
    }
    return value;
}

test('actual historical sources supply complete seasons and strict seventeen-week coverage', () => {
    assert.equal(logs.length, 127055);
    assert.deepEqual(Campaign.availableSeasons(data).slice(0, 4), [2025, 2024, 2023, 2022]);
    const truncated = new Map([...data.logIndex].filter(([, row]) => row.week <= 14));
    assert.deepEqual(Campaign.availableSeasons({ cards, logIndex: truncated }), []);
    assert.throws(() => Campaign.createCampaign(input, { cards, logIndex: truncated }), { code: 'INCOMPLETE_DATA' });
    const missing = new Map([...data.logIndex].filter(([, row]) => row.season !== 2023 || row.week !== 17));
    assert.throws(() => Campaign.createCampaign(input, { cards, logIndex: missing }), { code: 'INCOMPLETE_DATA' });
    assert.throws(() => create({ seasons: [2025, 2025, 2024, 2023] }), { code: 'INVALID_SEASONS' });
});

test('four real eight-player armies per faction and exact seeded d20 walking rulers', () => {
    const founded = create(), duplicate = create();
    assert.deepEqual(founded, duplicate);
    assert.equal(Campaign.validateCampaign(founded), true);
    assert.equal(founded.factions.length, 14);
    assert.equal(founded.factions.filter(faction => faction.controller === 'human').length, 1);
    assert.equal(founded.factions.flatMap(faction => faction.armies).length, 56);
    for (const faction of founded.factions) for (const army of faction.armies) {
        assert.equal(army.players.length, 8);
        for (const player of army.players) {
            assert.equal(player.referenceSeason === null || player.referenceSeason < army.season, true);
            assert.equal(player.peak, undefined);
            assert.equal(player.stats, undefined);
            assert.equal(player.fantasyPoints, undefined);
        }
    }
    const played = reveal(freeze(founded));
    for (const faction of played.factions) {
        const army = Campaign.activeArmy(faction);
        assert.ok(faction.rulerRoll >= army.rollBand.min && faction.rulerRoll <= army.rollBand.max);
        assert.equal(Campaign.legalLineup(faction, faction.lineup), true);
    }
    assert.equal(founded.phase, 'preseason');
    assert.throws(() => reveal(played), { code: 'INVALID_PHASE' });
});

test('human lineup legality rejects duplicates, foreign players, wrong size and wrong QB count without mutation', () => {
    const state = freeze(reveal(create()));
    const faction = state.factions[0], ids = faction.lineup;
    for (const playerIds of [[...ids, ids[0]], ids.slice(1), [ids[0], ids[0], ...ids.slice(2)], ['outsider', ...ids.slice(1)]]) {
        assert.equal(Campaign.legalLineup(faction, playerIds), false);
        assert.throws(() => Campaign.applyAction(state, { type: 'set-lineup', factionId: faction.id, playerIds }, data), { code: 'INVALID_LINEUP' });
    }
    const next = Campaign.applyAction(state, { type: 'set-lineup', factionId: faction.id, playerIds: [...ids].reverse() }, data);
    assert.deepEqual(next.factions[0].lineup, [...ids].reverse());
    assert.deepEqual(state.factions[0].lineup, ids);
});

test('one real week scores every active roster directly, including absent games as explicit zero', () => {
    const state = advance(reveal(create()));
    for (const result of state.completedWeeks[0].factions) for (const player of result.players) {
        const log = data.logIndex.get(Season.gameLogKey(player.identity, result.season, 1));
        assert.equal(player.basePoints, log ? Season.scoreStatLine(log.stats, Campaign.SCORING, {}) : 0);
        assert.equal(player.hasRecordedGame, Boolean(log));
        assert.deepEqual(player.stats, log ? log.stats : null);
    }
    assert.ok(state.completedWeeks[0].factions.flatMap(result => result.players).some(player => !player.hasRecordedGame));
    assert.equal(Campaign.validateCampaign(state), true);
});

test('unplayed future logs cannot affect present AI decisions, estimates or results', () => {
    const ready = reveal(create());
    const altered = new Map([...data.logIndex].map(([key, row]) => [key, row.week > 1 ? { ...row,
        stats: { ...row.stats, passYd: 99999, rushTd: 200, recTd: 200 } } : row]));
    const alteredCards = copy(cards);
    for (const card of alteredCards.players) for (const season of card.seasons) if (season.season >= 2022) season.points = 99999;
    const normal = advance(ready);
    const changed = advance(ready, { cards: alteredCards, logIndex: altered });
    assert.deepEqual(changed, normal);
    for (const faction of normal.factions) for (const id of faction.lineup) {
        assert.deepEqual(Campaign.estimatePlayer(normal, faction.id, id), Campaign.estimatePlayer(changed, faction.id, id));
    }
});

test('AI starter decisions do not inspect the current week even when a bench player has a huge result', () => {
    const ready = reveal(create()), rival = ready.factions.find(faction => faction.controller === 'ai');
    const bench = Campaign.activeArmy(rival).players.find(player => !rival.lineup.includes(player.id) && player.position !== 'QB');
    assert.ok(bench);
    const key = Season.gameLogKey(bench.identity, Campaign.activeArmy(rival).season, 1);
    const old = data.logIndex.get(key);
    const altered = new Map(data.logIndex);
    altered.set(key, { ...(old || { identity: bench.identity, name: bench.name, position: bench.position,
        season: Campaign.activeArmy(rival).season, week: 1 }), stats: { ...(old?.stats || {}), recTd: 1000 } });
    const changed = advance(ready, { cards, logIndex: altered });
    const snapshot = changed.completedWeeks[0].factions.find(result => result.factionId === rival.id);
    assert.equal(snapshot.players.find(player => player.id === bench.id).starter, false);
});

test('supported sacred favors spend treasury and do not change the unfavored Heptad lineup', () => {
    let plain = claimHumans(through(4));
    const faction = plain.factions.find(item => item.id === plain.hostFactionId);
    const playerId = faction.lineup[0];
    const declared = Campaign.applyAction(plain, { type: 'declare-favor', factionId: faction.id, favorId: 'kratos-1', playerId }, data);
    assert.equal(declared.factions.find(item => item.id === faction.id).favorBalance, 100);
    const favored = advance(declared), ordinary = advance(plain);
    const ours = favored.completedWeeks.at(-1).factions.find(item => item.factionId === faction.id);
    const theirs = ordinary.completedWeeks.at(-1).factions.find(item => item.factionId === faction.id);
    assert.equal(ours.favorCost, 10);
    assert.equal(ours.favorBalance, 90);
    assert.equal(ours.baseTotal, theirs.baseTotal);
    assert.equal(Math.round(ours.total * 100), Math.round((theirs.total + theirs.players.find(player => player.id === playerId).basePoints) * 100));
    assert.deepEqual(favored.completedWeeks.at(-1).allianceScores, ordinary.completedWeeks.at(-1).allianceScores);
    assert.equal(favored.factions.find(item => item.id === faction.id).declaredFavor, null);
    assert.equal(Campaign.validateCampaign(favored), true);
    const cancelled = Campaign.applyAction(declared, { type: 'clear-favor', factionId: faction.id }, data);
    assert.equal(cancelled.factions.find(item => item.id === faction.id).favorBalance, 100);
});

test('favor planning rejects non-sacred weeks and protects declared starters from benching', () => {
    const early = reveal(create()), own = early.factions[0];
    assert.throws(() => Campaign.applyAction(early, { type: 'declare-favor', factionId: own.id, favorId: 'kratos-1', playerId: own.lineup[0] }, data));
    const sacred = claimHumans(through(4)), faction = sacred.factions[0], army = Campaign.activeArmy(faction);
    const target = faction.lineup.find(id => army.players.find(player => player.id === id).position !== 'QB');
    const bench = army.players.find(player => !faction.lineup.includes(player.id) && player.position !== 'QB');
    const declared = Campaign.applyAction(sacred, { type: 'declare-favor', factionId: faction.id, favorId: 'horus-1', playerId: target }, data);
    assert.throws(() => Campaign.applyAction(declared, { type: 'set-lineup', factionId: faction.id,
        playerIds: faction.lineup.map(id => id === target ? bench.id : id) }, data), { code: 'FAVOR_TARGET_BENCHED' });
});

test('all-play ties earn half results and deterministic faction ranking', () => {
    const state = create();
    state.completedWeeks = [{ week: 1, factions: state.factions.map(faction => ({ factionId: faction.id, total: 100 })) }];
    const standings = Campaign.computeStandings(state);
    assert.ok(standings.every(row => row.wins === 6.5 && row.losses === 6.5 && row.ties === 13));
    assert.deepEqual(standings.map(row => row.factionId), state.factions.map(faction => faction.id).sort());
});

test('all seventeen actual-data weeks resolve Heptad, conquest and the seven-team Heavenly Battle', () => {
    const completed = through(17);
    assert.equal(completed.phase, 'complete');
    assert.equal(completed.week, 18);
    assert.equal(completed.completedWeeks.length, 17);
    assert.equal(completed.heptad.complete, true);
    assert.equal(completed.heavenly.complete, true);
    assert.equal(completed.championId, completed.heavenly.championId);
    assert.equal(completed.playoffField.length, 7);
    assert.equal(completed.heavenly.matches.filter(match => match.round === 'quarterfinal').length, 3);
    assert.equal(completed.heavenly.matches.filter(match => match.round === 'semifinal').length, 2);
    assert.equal(completed.heavenly.matches.filter(match => match.round === 'third-place').length, 1);
    assert.equal(completed.conquest.events.filter(event => event.type === 'result').length, 14 * 14);
    const seeds = Campaign.computeStandings(completed).slice(0, 7).map(row => row.factionId);
    assert.deepEqual(completed.playoffField, seeds);
    for (const row of Campaign.computeStandings(completed)) assert.equal(row.wins + row.losses, 14 * 13);
    for (const week of completed.completedWeeks) {
        assert.equal(week.factions.length, 14);
        assert.equal(week.allianceScores.length, 7);
        assert.equal(week.factions.flatMap(result => result.players).length, 14 * 8);
    }
    const restored = copy(completed);
    assert.equal(Campaign.validateCampaign(restored), true);
    assert.deepEqual(Campaign.computeStandings(restored), Campaign.computeStandings(completed));
    assert.throws(() => advance(restored), { code: 'INVALID_PHASE' });
});

test('projection hides pending opponent choices and sealed ruler decks without mutating the save', () => {
    const sealed = freeze(create()), projected = Campaign.projectCampaign(sealed, sealed.hostFactionId);
    assert.equal(projected.seed, undefined);
    assert.equal(projected.factions.find(faction => faction.id === sealed.hostFactionId).armies.length, 4);
    assert.ok(projected.factions.filter(faction => faction.id !== sealed.hostFactionId).every(faction => faction.armies.length === 0));
    const live = reveal(sealed), view = Campaign.projectCampaign(live, live.hostFactionId);
    assert.ok(view.factions.filter(faction => faction.id !== live.hostFactionId).every(faction => faction.lineup.length === 0 && faction.declaredFavor === null));
    assert.ok(live.factions.every(faction => faction.lineup.length === 5));
    assert.throws(() => Campaign.projectCampaign(live, 'outsider'), { code: 'UNKNOWN_FACTION' });
});

test('malformed imported saves fail structural validation before any action', () => {
    const live = reveal(create());
    const variants = [
        state => { state.factions.pop(); },
        state => { state.factions[0].armies[0] = null; },
        state => { state.factions[0].armies[0].players[0].id = 'outsider'; },
        state => { state.factions[0].favorBalance = 100000; },
        state => { state.week = 17; },
        state => { state.conquest.owners[state.conquest.homes.rome] = 'china'; },
        state => { state.factions[0].lineup = []; },
    ];
    for (const alter of variants) {
        const broken = copy(live); alter(broken);
        assert.throws(() => Campaign.validateCampaign(broken), { code: 'INVALID_CAMPAIGN' });
        assert.throws(() => Campaign.applyAction(broken, { type: 'advance-week' }, data), { code: 'INVALID_CAMPAIGN' });
    }
});
