'use strict';
const assert = require('node:assert/strict');
const C = require('../js/shared/woeppel-cup.js'), T = C.tournament;
const clone = value => JSON.parse(JSON.stringify(value));
const league = n => ({ rosters: Array.from({ length: n }, (_, i) => ({ roster_id: i + 1 })), settings: { playoff_week_start: 15 } });
const cycle = n => n % 2 ? n : n - 1;
function state(n, qualifiers = n) {
    const s = T.configure(league(n), 'round-robin-double');
    Object.assign(s, { startWeek: 1, groupWeeks: cycle(n), knockoutStart: cycle(n) + 1, qualifierCount: qualifiers });
    for (let week = 1; week <= s.groupWeeks; week++) s.weeks[week] = { final: true, scores: Object.fromEntries(s.teams.map(id => [id, 100 - Number(id)])) };
    T.validate(s);
    return s;
}
function nextMatches(s, week) { return T.knockout(s).flat().filter(match => match.week === week); }
function scoreWeek(s, week, choose = match => Number(match.a) < Number(match.b) ? match.a : match.b) {
    const matches = nextMatches(s, week), required = T.requiredScoreIds(s, week);
    assert(matches.length, 'There must be a reachable game before scoring a week');
    assert.equal(new Set(required).size, required.length, 'A fantasy score is used for only one game per team/week');
    assert.deepEqual(required.sort(), matches.flatMap(match => [match.a, match.b]).sort());
    const scores = {};
    matches.forEach(match => { const winner = choose(match); assert([match.a, match.b].includes(winner)); scores[match.a] = winner === match.a ? 0 : -2; scores[match.b] = winner === match.b ? 0 : -2; });
    s.weeks[week] = { final: true, scores };
    return nextMatches(s, week);
}

assert.equal(T.formats.filter(format => format.id === 'round-robin-double').length, 1);
assert.equal(T.formats.length, 7);
assert.equal(C.isDoubleElimination('round-robin-double'), true);
assert.equal(C.isDoubleElimination({ format: 'round-robin' }), false);
assert.deepEqual(C.doubleElimination(T.configure(league(4), 'points')), []);
for (const [entrants, qualifiers] of [[12, 8], [14, 4], [16, 2]]) {
    const suggested = T.configure(league(entrants), 'round-robin-double');
    assert.equal(suggested.qualifierCount, qualifiers, 'Suggest the largest <=8 final field that fits a complete cycle and reset');
    assert.equal(suggested.groupWeeks, cycle(entrants)); T.validate(suggested);
    assert.equal(T.schedule(suggested).at(-1), 18);
}
const oversized = T.configure(league(18), 'round-robin-double');
assert.equal(oversized.teams.length, 18); assert.equal(oversized.groupWeeks, 17); assert.equal(oversized.qualifierCount, 2);
assert.throws(() => T.validate(oversized), /needs 20 weeks.*Choose fewer teams or fewer qualifiers.*Weeks 1–18/, 'An impossible default never truncates qualification or removes the reset');

for (const q of [2, 4, 8]) {
    for (const finish of ['upper', 'reset-upper', 'reset-lower']) {
        const s = state(q), original = clone(s), maxRounds = 2 * Math.log2(q) + 1;
        assert.equal(s.version, 2, 'Existing version2 storage remains compatible');
        assert.equal(T.roundCount(s), maxRounds);
        assert.equal(T.schedule(s).length, s.groupWeeks + maxRounds);
        assert.equal(T.schedule(s).at(-1), s.knockoutStart + maxRounds - 1, 'The calendar reserves a possible reset');
        assert.equal(T.result(s), null);
        assert.equal(C.stageLabel(s, s.knockoutStart + maxRounds - 1), 'Championship reset · if needed');
        const losses = Object.fromEntries(s.teams.map(id => [id, 0]));
        let played = 0, finalA, finalB;
        for (const week of T.schedule(s).filter(week => week >= s.knockoutStart)) {
            if (T.result(s)) break;
            const scheduled = nextMatches(s, week);
            for (const match of scheduled) {
                assert.equal(match.bye, false, 'Power-of-two qualifiers have no elimination-stage byes');
                assert(match.a && match.b && match.a !== match.b);
                assert(losses[match.a] < 2 && losses[match.b] < 2, 'A twice-beaten team cannot re-enter');
                if (match.bracket === 'upper') assert.equal(losses[match.a] + losses[match.b], 0);
                if (match.bracket === 'lower') assert.equal(losses[match.a] + losses[match.b], 2);
                if (match.bracket === 'final') { finalA = match.a; finalB = match.b; assert.equal(losses[match.a], 0); assert.equal(losses[match.b], 1); }
                if (match.bracket === 'reset') { assert.equal(losses[match.a], 1); assert.equal(losses[match.b], 1); assert.equal(match.conditional, true); }
                assert.match(match.stageLabel, /Upper bracket|Lower bracket|Championship/);
            }
            const completed = scoreWeek(s, week, match => match.bracket === 'final' ? finish === 'upper' ? match.a : match.b
                : match.bracket === 'reset' ? finish === 'reset-upper' ? match.a : match.b : Number(match.a) < Number(match.b) ? match.a : match.b);
            completed.forEach(match => { assert(match.winner && match.loser); losses[match.loser]++; assert.equal(match.blocked, false); played++; });
        }
        const result = T.result(s), rounds = T.knockout(s);
        assert(result);
        assert.equal(result.champion, finish === 'reset-lower' ? finalB : finalA);
        assert.equal(result.runnerUp, result.champion === finalA ? finalB : finalA);
        assert.equal(result.winnerScore, 0); assert.equal(result.runnerScore, -2, 'Real zero and negative final scores remain signed');
        assert.equal(played, 2 * q - (finish === 'upper' ? 2 : 1));
        assert.equal(rounds.length, maxRounds - (finish === 'upper' ? 1 : 0));
        assert.equal(result.week, s.knockoutStart + rounds.length - 1);
        assert.equal(losses[result.champion], finish === 'upper' ? 0 : 1);
        assert(s.teams.filter(id => id !== result.champion).every(id => losses[id] === 2), 'Every eliminated qualifier has exactly two losses');
        assert.equal(rounds.flat().some(match => match.bracket === 'reset'), finish !== 'upper');
        if (finish === 'upper') assert.throws(() => T.requiredScoreIds(s, T.schedule(s).at(-1)), /complete; no championship reset/, 'An unused reset has no fabricated required scores');
        assert.deepEqual(C.doubleElimination(s), rounds);
        const completedState = clone(s);
        assert.deepEqual(T.knockout(s), T.knockout(s), 'Bracket resolution is deterministic');
        T.result(s); T.requiredScoreIds(s, result.week); C.stageLabel(s, result.week);
        assert.deepEqual(s, completedState, 'Read APIs never mutate tournament evidence');
        assert.deepEqual(original.weeks[1], s.weeks[1], 'Qualification evidence is preserved');
    }
}

// Exhaust all seven possible game-result bits for a four-team final field.
// This checks lower-bracket routing independently of any favored seed.
const champions = new Set();
for (let outcomes = 0; outcomes < 128; outcomes++) {
    const s = state(4), losses = Object.fromEntries(s.teams.map(id => [id, 0]));
    let game = 0;
    for (const week of T.schedule(s).filter(week => week >= s.knockoutStart)) {
        if (T.result(s)) break;
        const matches = scoreWeek(s, week, match => (outcomes >> game++ & 1) ? match.b : match.a);
        for (const match of matches) {
            assert(losses[match.a] < 2 && losses[match.b] < 2);
            losses[match.loser]++;
        }
    }
    const result = T.result(s); assert(result);
    champions.add(result.champion);
    assert(losses[result.champion] < 2);
    assert(s.teams.filter(id => id !== result.champion).every(id => losses[id] === 2));
}
assert.deepEqual([...champions].sort(), ['1', '2', '3', '4'], 'Every qualifier can win through a valid result path');

// Full round-robin qualification is identical to the existing RR format,
// including odd-team rest weeks, Cup points, PF and explicit seeding ties.
for (const n of [3, 4, 5, 8]) {
    const q = 2 ** Math.floor(Math.log2(n)), s = state(n, q), rr = { ...clone(s), format: 'round-robin' };
    assert.deepEqual(T.fixtures(s), T.fixtures(rr));
    assert.deepEqual(T.tables(s), T.tables(rr));
    assert.deepEqual(T.qualifiers(s), T.qualifiers(rr));
    assert.equal(new Set(T.fixtures(s).map(match => [match.a, match.b].sort().join(':'))).size, n * (n - 1) / 2);
    for (let week = 1; week <= s.groupWeeks; week++) assert.deepEqual(T.requiredScoreIds(s, week), s.teams);
}
const tiedSeeds = state(4);
Object.values(tiedSeeds.weeks).forEach(record => Object.keys(record.scores).forEach(id => { record.scores[id] = 0; }));
assert.throws(() => T.qualifiers(tiedSeeds), /tied/); assert.equal(T.result(tiedSeeds), null);
tiedSeeds.seedRuling = { ids: ['4', '3', '2', '1'], reason: 'Published seeding tiebreak' };
assert.deepEqual(T.bracket(tiedSeeds), [['4', '1'], ['3', '2']]);
tiedSeeds.seedRuling.ids[1] = '4'; assert.throws(() => T.knockout(tiedSeeds), /different participating/);

const pending = state(4), firstWeek = pending.knockoutStart, first = nextMatches(pending, firstWeek);
assert(first.every(match => match.blocked && match.reason.includes('Finalize')));
assert.throws(() => T.requiredScoreIds(pending, firstWeek + 1), /prior knockout/);
pending.weeks[firstWeek] = { final: false, scores: { '1': 100, '2': 90, '3': 80, '4': 70 } };
assert(T.knockout(pending).flat().every(match => match.winner === null));
pending.weeks[firstWeek].final = true;
for (const unknown of [null, undefined, '0', NaN, Infinity]) {
    pending.weeks[firstWeek].scores[first[0].a] = unknown;
    assert.equal(nextMatches(pending, firstWeek)[0].winner, null);
    assert.match(nextMatches(pending, firstWeek)[0].reason, /missing scores/);
    assert.equal(T.result(pending), null);
    assert.throws(() => T.requiredScoreIds(pending, firstWeek + 1), /prior knockout/);
}

// Every elimination lane and both finals require exact scores or a recorded
// tied-score ruling; neither missing data nor a blank reason can pick a winner.
for (const target of ['upper', 'lower', 'final', 'reset']) {
    const s = state(4);
    for (let week = s.knockoutStart; week <= T.schedule(s).at(-1); week++) {
        const scheduled = nextMatches(s, week), match = scheduled.find(item => item.bracket === target);
        if (!match) { scoreWeek(s, week, item => item.bracket === 'final' ? item.b : Number(item.a) < Number(item.b) ? item.a : item.b); continue; }
        scoreWeek(s, week); s.weeks[week].scores[match.a] = s.weeks[week].scores[match.b] = 0;
        const resolved = () => nextMatches(s, week).find(item => item.a === match.a && item.b === match.b);
        assert.equal(resolved().winner, null); assert.match(resolved().reason, /tied/); assert.equal(T.result(s), null);
        const key = `${week}:${match.a}:${match.b}`;
        s.tieRulings = { [key]: { winner: match.b, reason: ' ' } }; assert.equal(resolved().winner, null);
        s.tieRulings[key] = { winner: 'not-in-the-match', reason: 'Published rule' }; assert.equal(resolved().winner, null);
        s.tieRulings[key] = { winner: match.b, reason: 'Published tiebreak applied' }; assert.equal(resolved().winner, match.b);
        delete s.weeks[week].scores[match.a]; assert.equal(resolved().winner, null, 'A ruling never replaces a missing score');
        s.weeks[week].scores[match.a] = 0;
        const before = clone(s); T.knockout(s); T.result(s); assert.deepEqual(s, before);
        break;
    }
}

const boundary = state(12, 8);
assert.equal(T.schedule(boundary).at(-1), 18);
assert.throws(() => T.validate({ ...boundary, knockoutStart: boundary.knockoutStart + 1 }), /possible championship reset.*Weeks 1–18/);
assert.throws(() => T.validate({ ...boundary, qualifierCount: 3 }), /Knockout field/);
assert.throws(() => T.validate({ ...boundary, groupWeeks: 10, knockoutStart: 11 }), /complete 11-week/);
assert.throws(() => T.validate({ ...boundary, knockoutStart: boundary.groupWeeks }), /non-overlapping/);
const sixteen = state(16, 2); assert.equal(T.schedule(sixteen).at(-1), 18);
assert.throws(() => T.validate({ ...sixteen, qualifierCount: 4 }), /possible championship reset/);
const waitingSeeds = state(4); waitingSeeds.weeks[1].final = false;
assert.equal(T.result(waitingSeeds), null); assert.throws(() => T.requiredScoreIds(waitingSeeds, waitingSeeds.knockoutStart), /Finalize/);
assert.throws(() => T.requiredScoreIds(state(4), 19), /not on the tournament schedule/);

console.log('PASS round-robin double elimination: q2/4/8 brackets and both finals/reset outcomes, exactly two losses, unique weekly games, standings/seeding, ties/rulings, unknown scores, calendar limits and deterministic read-only APIs');
