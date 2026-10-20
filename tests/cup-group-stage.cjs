'use strict';
const assert = require('node:assert/strict');
const C = require('../js/shared/woeppel-cup.js'), T = C.tournament;
const clone = value => JSON.parse(JSON.stringify(value));
const league = count => ({ rosters: Array.from({ length: count }, (_, index) => ({ roster_id: index + 1 })), settings: { playoff_week_start: 15 } });
const qualifyWeeks = state => Array.from({ length: state.groupWeeks }, (_, index) => state.startWeek + index);
function fillGroups(state, value = id => 100 - Number(id)) {
    for (const week of qualifyWeeks(state)) state.weeks[week] = { final: true, scores: Object.fromEntries(T.requiredScoreIds(state, week).map(id => [id, value(id, week)])) };
    return state;
}
function scoreKnockout(state, week, pick = match => Number(match.a) < Number(match.b) ? match.a : match.b) {
    const matches = T.knockout(state).flat().filter(match => match.week === week), ids = T.requiredScoreIds(state, week);
    assert.equal(ids.length, new Set(ids).size, 'A team uses its score only once each week');
    assert.deepEqual(ids.slice().sort(), matches.flatMap(match => [match.a, match.b]).sort());
    const scores = {};
    for (const match of matches) {
        const winner = pick(match);
        scores[match.a] = winner === match.a ? 0 : -1;
        scores[match.b] = winner === match.b ? 0 : -1;
    }
    state.weeks[week] = { final: true, scores };
}

assert.equal(C.formats.filter(format => format.id === 'groups').length, 1);
assert.equal(C.formats.find(format => format.id === 'groups').name, 'Group stage + knockout');
assert.equal(C.groupConfig(T.defaults(league(8))), null, 'Old formats need no new required fields');
for (let count = 4; count <= 64; count++) {
    const state = T.configure(league(count), 'groups'), config = C.groupConfig(state);
    T.validate(state);
    assert.equal(C.championshipWeek(state), 14);
    assert.equal(config.qualifierCount, config.groupCount * config.qualifiersPerGroup);
    assert(Number.isInteger(Math.log2(config.qualifierCount)));
    assert(config.minGroupSize >= 2 && config.maxGroupSize - config.minGroupSize <= 1);
    assert.equal(state.startWeek + state.groupWeeks, state.knockoutStart);
    const fixtures = T.fixtures(state);
    for (const week of qualifyWeeks(state)) {
        const required = T.requiredScoreIds(state, week), actual = fixtures.filter(fixture => fixture.week === week).flatMap(fixture => [fixture.a, fixture.b]);
        assert.equal(required.length, new Set(required).size);
        assert.deepEqual(required, actual);
    }
    for (const key of config.groupKeys) {
        const matches = fixtures.filter(fixture => fixture.group === key), members = state.groups[key];
        assert(matches.every(fixture => members.includes(fixture.a) && members.includes(fixture.b)));
        assert.equal(matches.length, members.length * (members.length - 1) / 2);
        assert.equal(new Set(matches.map(fixture => [fixture.a, fixture.b].sort().join(':'))).size, matches.length, 'One full cycle contains every within-group pairing exactly once');
    }
    fillGroups(state);
    const tables = C.groupTables(state), qualifiers = T.qualifiers(state);
    assert.equal(qualifiers.length, state.qualifierCount);
    for (const key of config.groupKeys) {
        assert(tables[key].every(row => row.played === state.groups[key].length - 1));
        assert.equal(qualifiers.filter(row => row.group === key).length, config.qualifiersPerGroup);
        assert.deepEqual(qualifiers.filter(row => row.group === key).map(row => row.id).sort(), tables[key].slice(0, config.qualifiersPerGroup).map(row => row.id).sort());
    }
    const bracket = T.bracket(state), group = id => qualifiers.find(row => row.id === id).group;
    assert(bracket.every(([left, right]) => group(left) !== group(right)), 'Opening round avoids group rematches');
    assert.equal(new Set(bracket.flat()).size, state.qualifierCount);
}

// Uneven four/five-team groups complete their own cycles, then rest. Rest
// scores neither inflate PF nor become mandatory score-import requirements.
const uneven = T.configure(league(9), 'groups');
assert.equal(uneven.groupCount, 2); assert.equal(uneven.groupWeeks, 5);
const smallKey = Object.keys(uneven.groups).find(key => uneven.groups[key].length === 4), smallTeams = uneven.groups[smallKey];
for (const week of qualifyWeeks(uneven).slice(3)) assert(smallTeams.every(id => !T.requiredScoreIds(uneven, week).includes(id)));
fillGroups(uneven);
let table = C.groupTables(uneven)[smallKey];
const restWeek = uneven.startWeek + 4;
for (const id of smallTeams) uneven.weeks[restWeek].scores[id] = 100000;
assert.deepEqual(C.groupTables(uneven)[smallKey], table, 'Rest-week scores never enter group PF');
for (const row of table) assert.equal(row.pf, (100 - Number(row.id)) * 3);
// Seed tiers compare rates, not unequal raw group totals.
fillGroups(uneven, id => uneven.groups[smallKey].includes(id) ? 200 - Number(id) : 100 - Number(id));
const unevenQualifiers = T.qualifiers(uneven);
assert.equal(unevenQualifiers[0].group, smallKey, 'Three wins at three points/game are not penalized against four wins');
assert(unevenQualifiers.slice(0, 2).every(row => row.groupRank === 1));

const repeated = C.withGroupConfig(uneven, { groupWeeks: 10 });
assert.equal(repeated.groupWeeks, 10); assert.equal(C.championshipWeek(repeated), 14);
fillGroups(repeated);
for (const [key, rows] of Object.entries(C.groupTables(repeated))) assert(rows.every(row => row.played === (repeated.groups[key].length - 1) * 2));
assert.throws(() => T.validate({ ...uneven, groupWeeks: 4 }), /complete 5-week block/);

// A tied group qualifying position requires a reasoned ruling, never team ID
// order. The ruling must preserve each group's quota and clear qualifiers.
const tied = fillGroups(T.configure(league(8), 'groups'), () => 0);
assert.throws(() => T.qualifiers(tied), /Group A qualifying standings are tied/);
assert.equal(T.result(tied), null);
tied.seedRuling = { ids: [...tied.groups.A.slice(0, 2), ...tied.groups.B.slice(0, 2)], reason: 'Published group tiebreak applied' };
assert.equal(T.qualifiers(tied).length, 4);
tied.seedRuling.ids = [...tied.groups.A.slice(0, 3), tied.groups.B[0]];
assert.throws(() => T.qualifiers(tied), /top 2 from every group/);
const clear = fillGroups(T.configure(league(8), 'groups'));
clear.seedRuling = { ids: [...clear.groups.A.slice(1, 3), ...clear.groups.B.slice(0, 2)], reason: 'Cannot promote an untied eliminated team' };
assert.throws(() => T.qualifiers(clear), /resolve only tied places/);

const missing = fillGroups(T.configure(league(8), 'groups'));
const required = T.requiredScoreIds(missing, missing.startWeek);
for (const unknown of [null, undefined, NaN, Infinity, '0']) {
    missing.weeks[missing.startWeek].scores[required[0]] = unknown;
    assert.throws(() => T.groupTables(missing), /missing scores/);
    assert.equal(T.result(missing), null);
}
missing.weeks[missing.startWeek].scores[required[0]] = 0;
assert(Number.isFinite(T.groupTables(missing).A.find(row => row.id === required[0])?.pf ?? T.tables(missing).find(row => row.id === required[0]).pf));
missing.weeks[missing.startWeek].final = false;
assert.throws(() => T.qualifiers(missing), /Finalize all qualifying weeks/);
assert.equal(T.groupTables(missing).A.reduce((sum, row) => sum + row.played, 0), 8, 'Unfinalized matches are excluded');

for (const count of [4, 8, 12, 32, 64]) for (const finish of ['upper', 'reset']) {
    let state = T.configure(league(count), 'groups');
    state = C.withGroupConfig(state, { knockoutStyle: 'double' });
    state = C.withChampionshipWeek(state, 17);
    assert.equal(C.isDoubleElimination(state), true);
    assert.deepEqual(C.championshipWeeks(state), [17, 18]);
    assert.equal(T.schedule(state).at(-1), 18);
    fillGroups(state);
    const losses = Object.fromEntries(T.qualifiers(state).map(row => [row.id, 0]));
    for (const week of T.schedule(state).filter(week => week >= state.knockoutStart)) {
        if (T.result(state)) break;
        const scheduled = T.knockout(state).flat().filter(match => match.week === week);
        assert(scheduled.every(match => losses[match.a] < 2 && losses[match.b] < 2));
        scoreKnockout(state, week, match => match.bracket === 'final' && finish === 'reset' ? match.b : match.a);
        for (const match of T.knockout(state).flat().filter(match => match.week === week)) losses[match.loser]++;
    }
    const result = T.result(state); assert(result);
    assert.equal(result.week, finish === 'upper' ? 17 : 18);
    assert(Object.entries(losses).filter(([id]) => id !== result.champion).every(([, count]) => count === 2));
    assert.equal(result.winnerScore, 0); assert.equal(result.runnerScore, -1);
}
const singleFinal = C.withChampionshipWeek(T.configure(league(12), 'groups'), 16);
fillGroups(singleFinal);
for (const week of T.schedule(singleFinal).filter(week => week >= singleFinal.knockoutStart)) scoreKnockout(singleFinal, week);
assert.equal(T.result(singleFinal).week, 16, 'The single-elimination final is played in the exact requested week');
assert.equal(C.stageLabel(singleFinal, singleFinal.startWeek), 'Group stage');

// Final-week selection schedules backward without truncating qualification,
// while retaining an explicitly requested break between stages.
for (const format of C.formats.map(format => format.id)) {
    let state = T.configure(league(8), format);
    if (format === 'round-robin-double') state = T.configure(league(4), format);
    const final = C.championshipWeek(state), source = clone(state);
    const moved = C.withChampionshipWeek(state, final + 1);
    assert.equal(C.championshipWeek(moved), final + 1);
    assert.equal(moved.startWeek, state.startWeek + 1);
    assert.equal(moved.knockoutStart, state.knockoutStart + 1);
    assert.equal(moved.groupWeeks, state.groupWeeks);
    assert.deepEqual(state, source, 'Schedule helpers do not mutate saved evidence');
    assert.throws(() => C.withChampionshipWeek(state, 0), /championship week/);
    assert.throws(() => C.withChampionshipWeek(state, 19), /championship week/);
    assert.throws(() => C.withChampionshipWeek(state, 1), /does not fit|Weeks 1/);
}
const double = C.withGroupConfig(T.configure(league(8), 'groups'), { knockoutStyle: 'double' });
assert.throws(() => C.withChampionshipWeek(double, 18), /following week reserved/);
const gapped = T.configure(league(8), 'groups'); gapped.knockoutStart++;
const movedGap = C.withChampionshipWeek(gapped, 16);
assert.equal(movedGap.knockoutStart - movedGap.startWeek - movedGap.groupWeeks, 1);
assert.equal(C.championshipWeek(movedGap), 16);
const regroupedGap = C.withGroupConfig(gapped, { qualifiersPerGroup: 1 });
assert.equal(regroupedGap.knockoutStart - regroupedGap.startWeek - regroupedGap.groupWeeks, 1);
assert.equal(C.championshipWeek(regroupedGap), C.championshipWeek(gapped));
const changing = T.configure(league(12), 'groups'), changingBefore = clone(changing);
const changed = C.withGroupConfig(changing, { groupCount: 2, qualifiersPerGroup: 2 });
assert.equal(changed.groupCount, 2); assert.equal(changed.qualifierCount, 4); assert.equal(C.championshipWeek(changed), C.championshipWeek(changing));
assert.deepEqual(changing, changingBefore);
assert.throws(() => C.withGroupConfig(C.withChampionshipWeek(T.configure(league(16), 'groups'), 5), { groupCount: 2, qualifiersPerGroup: 2 }), /does not fit/);
for (const extra of [{ groupCount: 3 }, { qualifiersPerGroup: 3 }, { qualifierCount: 2 }, { knockoutStyle: 'triple' }, { groups: { A: ['1', '1', '3', '4'], B: ['2', '5', '6', '7'] } }]) {
    assert.throws(() => T.validate({ ...T.configure(league(8), 'groups'), ...extra }));
}
for (const count of [2, 3]) assert.throws(() => T.validate(T.configure(league(count), 'groups')), /at least two teams/);

console.log('PASS Cup groups: complete balanced/uneven RR cycles, rest-score provenance, per-group qualification and tied rulings, normalized seed tiers, rematch-free draws, single/double finals/reset and backward calendar validation');
