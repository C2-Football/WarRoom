'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
global.window = globalThis; window.App = {};
for (const name of ['roster', 'helmet', 'rules', 'draft-room', 'era-rules', 'types', 'season', 'player-cards', 'engine', 'rivals', 'ai', 'actions', 'storage']) require(`../js/shared/time-league-${name}.js`);
const { TimeLeagueEngine: E, TimeLeagueActions: A, TimeLeagueAI: AI, TimeLeaguePlayerCards: P, TimeLeagueSeason: S, TimeLeagueStorage: Store, TimeLeagueTypes: T } = App;
const stamp = '2026-09-15T12:00:00Z';
const data = {
    cards: P.buildPlayerCardIndex(JSON.parse(fs.readFileSync('data/time-league/player-cards.json'))),
    logIndex: S.buildGameLogIndex(S.parseGameLogCsv(fs.readFileSync('data/time-league/regular-season-game-logs.csv', 'utf8')).logs),
    eraFactors: new Map(),
};
const disk = new Map();
let limit = Infinity, blockedKey = null, blockedName = 'QuotaExceededError', quotaFailures = 0;
const size = () => [...disk].reduce((total, [key, value]) => total + key.length + value.length, 0);
window.localStorage = {
    getItem: key => disk.get(key) ?? null,
    setItem(key, value) {
        if (key === blockedKey || size() - (disk.has(key) ? key.length + disk.get(key).length : 0) + key.length + value.length > limit) {
            quotaFailures++;
            throw new DOMException('Storage rejected write', key === blockedKey ? blockedName : 'QuotaExceededError');
        }
        disk.set(key, value);
    },
    removeItem: key => disk.delete(key),
};
const entry = state => ({ leagueId: state.leagueId, name: state.name, phase: state.phase, teamCount: state.teams.length, currentWeek: state.currentWeek, createdAt: state.createdAt });
let state = E.normalizeTimeLeague(E.createTimeLeague({
    name: 'My Vault Season · Núbia 龍 𓂀', seed: 'phone-quota-week-nine', createdAt: stamp,
    seats: [{ name: 'Commander', manager: 'human' }, ...Array.from({ length: 5 }, (_, i) => E.defaultAiSeat(i + 1))],
    settings: { gameDeckVersion: 1, rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 3 }, maxQuarterbacks: 2,
        regularSeasonWeeks: 14, playoffTeams: 0, scoring: { passTd: 4, reception: .5, rushRecYd: .1, passingYd: .04, turnover: -2 },
        eraRules: { mode: 'position-roulette', decades: [] }, waiversEnabled: true, tradesEnabled: true, aiDifficulty: 'veteran', draftPickSeconds: 0 },
}));
const key = T.timeLeagueStorageKey(state.leagueId), indexKey = T.TIME_LEAGUE_INDEX_KEY;
const host = { seat_team_id: 't1', role: 'commissioner' };
let actions = 0, recovered = false, weekNineRawLength;
const act = action => {
    const previous = JSON.stringify(state);
    const next = E.normalizeTimeLeague(A.applyOnlineAction(state, action, host, data, stamp));
    assert.equal(JSON.stringify(state), previous, 'An action cannot mutate the prior save');
    if (state.currentWeek === 9 && state.weekStage === 'ready' && action.type === 'week') {
        // Reproduce an old phone save at the origin quota, including unrelated
        // user data. Week 10 adds a digit to the shelf before the game write.
        disk.set(key, previous);
        disk.set(indexKey, JSON.stringify([entry(state)]));
        limit = 5 * 1024 * 1024 / 2;
        const fillerKey = 'another-app-user-data';
        disk.set(fillerKey, 'x'.repeat(limit - size() - fillerKey.length));
        assert.equal(size(), limit);
        assert.throws(() => localStorage.setItem(key, JSON.stringify(next)), { name: 'QuotaExceededError' });
        const failures = quotaFailures;
        const unrelated = disk.get(fillerKey);
        Store.writeSnapshot(next, [entry(next)]);
        assert(quotaFailures > failures, 'The full shelf write must fail before compaction recovers');
        assert.equal(disk.get(fillerKey), unrelated, 'Quota recovery never deletes other app or user data');
        assert.deepEqual(Store.decode(disk.get(key)), next);
        weekNineRawLength = previous.length;
        recovered = true;
    } else Store.writeSnapshot(next, [entry(next)]);
    const restored = Store.decode(disk.get(key));
    assert.deepEqual(restored, next, 'Every field, score, draw and historical result survives compact persistence');
    state = E.normalizeTimeLeague(restored);
    assert(state); actions++;
};
Store.writeSnapshot(state, [entry(state)]);
assert.deepEqual(Store.decode(JSON.stringify(state)), state, 'Existing plain JSON saves remain readable');
act({ type: 'draft-clock-start' });
while (state.phase === 'draft' && actions < 100) {
    if (E.currentDraftSeat(state).teamId === 't1') act({ type: 'draft', identity: AI.aiDraftChoice(state, data.cards).identity });
    else act({ type: 'ai-run' });
}
assert.equal(state.phase, 'season');
while (state.phase === 'season' && actions < 180) {
    if (state.weekStage === 'claims') act({ type: 'process-claims' });
    else if (state.weekStage === 'lineup') { act({ type: 'auto-lineup', teamId: 't1' }); act({ type: 'finalize-rosters' }); }
    else if (state.weekStage === 'ready') act({ type: 'week' });
    else act({ type: 'advance-week' });
}
assert(recovered); assert.equal(state.phase, 'complete'); assert.equal(state.finalizedWeeks.length, 14);
assert.equal(new Set(state.finalizedWeeks.map(week => week.week)).size, 14, 'Recovery does not replay or skip a week');
const encoded = disk.get(key), raw = JSON.stringify(state);
assert(encoded.startsWith('VAULT1:LZ16:')); assert(encoded.length < raw.length / 4);
const before = new Map(disk);
for (const [blocked, name] of [[key, 'QuotaExceededError'], [indexKey, 'QuotaExceededError'], [key, 'SecurityError']]) {
    blockedKey = blocked; blockedName = name;
    assert.throws(() => Store.writeSnapshot({ ...state, name: 'Unsaved change' }, [entry({ ...state, name: 'Unsaved change' })]), { name });
    assert.deepEqual(disk, before, 'Rejected saves retain the exact last durable game and shelf');
}
blockedKey = null;
assert.throws(() => Store.decode(encoded.replace('VAULT1:LZ16:', 'VAULT1:LZ16:00')), /damaged/);
assert.equal(disk.get(key), encoded, 'Damaged reads never rewrite the record');
const finalSize = encoded.length;
console.log(`PASS: ${actions} durable actions, legacy Week 9 quota recovery, exact 14-week scores/editions/history, Unicode, atomic failure, corruption guard, and unrelated-data preservation. Week 9 raw ${weekNineRawLength}; complete season raw ${raw.length} vs compact ${finalSize} characters (${Math.round(100 * finalSize / raw.length)}%).`);
