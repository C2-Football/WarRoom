'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { App: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/shared/league-live-standings.js', 'utf8'), context);
const picture = context.App.LeagueLiveStandings.playoffPicture;
const plain = value => JSON.parse(JSON.stringify(value));
const team = (rosterId, wins, losses, pointsFor, pointsAgainst = 100, extra = {}) => ({ rosterId, wins, losses, ties: 0, pointsFor, pointsAgainst, ...extra });
const rows = [team(0, 10, 0, 1000), team(1, 9, 1, 900), team(2, 8, 2, 800), team(3, 7, 3, 700),
    team(4, 2, 8, 600), team(5, 1, 9, 500), team(6, 0, 10, 400), team(7, 0, 10, 300)];
const league = { league_id: '1234567890123456', season: 2026, settings: { playoff_teams: 4, playoff_seed_type: 0, divisions: 2 },
    rosters: rows.map(row => ({ roster_id: row.rosterId, settings: { division: row.rosterId < 4 ? 0 : 1 } })),
    metadata: { division_0_name: 'First division', division_1: 'Second division' } };
const run = extra => picture({ league, rows, ...extra });
const find = (value, id) => value.leagueRows.find(row => row.rosterId === id);
const identities = values => Array.from(values, row => row.rosterId);

const original = JSON.stringify({ league, rows });
let value = run();
assert.equal(value.mode, 'standard');
assert.equal(value.slots, 4);
assert.equal(value.hasDivisions, true);
assert.deepEqual(identities(value.leagueRows), [0, 4, 1, 2, 3, 5, 6, 7], 'division winners are seeded before stronger wildcards');
assert.equal(find(value, 4).playoffState, 'division', 'division leader outside raw top four still qualifies');
assert.equal(find(value, 1).playoffState, 'wildcard');
assert.equal(find(value, 2).playoffState, 'wildcard', 'wildcards can both come from the same division');
assert.equal(find(value, 3).playoffState, 'outside');
assert.equal(value.divisions[0].key, '0', 'a real zero division is preserved');
assert.equal(value.divisions[0].name, 'First division');
assert.equal(value.divisions[1].name, 'Second division');
assert.deepEqual(identities(value.divisions[0].rows), [0, 1, 2, 3]);
assert.equal(find(value, 0).displayRank, 1, 'roster ID zero is usable');
assert.equal(value.divisions[0].rows[1].displayRank, 2, 'division rows have local ranks rather than seeds');
assert.equal(value.cutlineLabel, 'Playoff cutline');
assert.equal(JSON.stringify({ league, rows }), original, 'the helper never mutates provider rows or league metadata');
assert.notEqual(value.leagueRows[0], rows[0], 'returned rows are clones');

const noDiv = { ...league, rosters: [], settings: { ...league.settings, divisions: 0, playoff_teams: 2 } };
value = picture({ league: noDiv, rows: [team(1, 3, 1, 50), team(2, 7, 3, 100), team(3, 5, 5, 100)] });
assert.deepEqual(identities(value.leagueRows), [1, 2, 3], 'record percentage precedes total wins or PF');
assert.equal(value.leagueRows[0].playoffState, 'field');
value = picture({ league: noDiv, rows: [team(1, 5, 4, 100, 50, { ties: 1 }), team(2, 5, 5, 100, 80), team(3, 4, 6, 100)] });
assert.equal(value.leagueRows[0].rosterId, 1, 'a tie counts as half a win in record percentage');
value = picture({ league: noDiv, rows: [team(1, 6, 4, 100, 50), team(2, 6, 4, 100, 80), team(3, 4, 6, 100)] });
assert.deepEqual(identities(value.leagueRows), [2, 1, 3], 'higher points against is the third standard tiebreak');

const tiedRows = [team(1, 7, 3, 100, 100), team(2, 6, 4, 100, 100), team(3, 6, 4, 100, 100), team(4, 3, 7, 100, 100)];
value = picture({ league: noDiv, rows: tiedRows });
assert.equal(find(value, 2).playoffState, 'tied');
assert.equal(find(value, 3).playoffState, 'tied', 'a tie across the last place is never split by roster ID');
assert.equal(find(value, 2).displayRank, find(value, 3).displayRank);
assert.equal(find(value, 4).displayRank, 4, 'competition ranks leave a gap after tied teams');
assert.equal(value.cutlineLabel, 'Playoff cutline', 'presentation chooses tied-boundary labels locally');
value = picture({ league: noDiv, rows: tiedRows.map(row => row.rosterId === 2 ? { ...row, pointsAgainst: null } : row) });
assert.equal(find(value, 2).playoffState, 'tied');
assert.equal(find(value, 3).playoffState, 'tied', 'missing PA leaves the record/PF tie unresolved');
value = picture({ league: noDiv, rows: [team(1, 7, 3, 150), team(2, 6, 4, 100, 200), team(3, 6, 4, 100, null), team(4, 6, 4, 100, 50)] });
assert.deepEqual(Array.from(value.leagueRows.slice(1), row => row.playoffState), ['tied', 'tied', 'tied'], 'one missing PA leaves the whole equal-record/PF group unresolved');

const tiedLeader = rows.map(row => row.rosterId === 5 ? { ...row, wins: 2, losses: 8, pointsFor: 600 } : row);
value = run({ rows: tiedLeader });
assert.equal(value.mode, 'record', 'unresolved division winner tie safely falls back to record order');
assert.match(value.note, /division lead is tied/);
assert(value.leagueRows.every(row => !['division', 'wildcard'].includes(row.playoffState)));
assert.equal(value.cutlineLabel, 'Top 4 by record');
value = run({ rows: tiedLeader.map(row => row.rosterId === 4 ? { ...row, pointsAgainst: null } : row) });
assert.equal(value.mode, 'record', 'unknown PA cannot arbitrarily select a division winner');

for (const seedType of [undefined, null, 1, '0']) {
    value = run({ league: { ...league, settings: { ...league.settings, playoff_seed_type: seedType } } });
    assert.equal(value.mode, 'record', 'only explicit numeric standard seeding qualifies: ' + seedType);
    assert.match(value.note, /[Uu]nverified|[Cc]ustom/);
    assert(value.leagueRows.every(row => !['division', 'wildcard'].includes(row.playoffState)));
}
value = run({ league: { ...league, bracket_overrides_id: '99' } });
assert.equal(value.mode, 'record');
value = run({ league: { ...league, bracket_overrides_id: '0' } });
assert.equal(value.mode, 'standard');
value = run({ league: { ...league, rosters: league.rosters.map(roster => roster.roster_id === 7 ? { ...roster, settings: {} } : roster) } });
assert.equal(value.mode, 'record');
assert.equal(value.hasDivisions, false);
assert.equal(value.divisions.length, 0);
assert.match(value.note, /Division data is incomplete/);
value = run({ league: { ...league, settings: { ...league.settings, divisions: 3 } } });
assert.equal(value.hasDivisions, false, 'actual distinct groups must match the declaration');
assert.equal(value.mode, 'record');
value = run({ league: { ...league, settings: { ...league.settings, playoff_teams: 1 } } });
assert.equal(value.mode, 'record', 'fewer places than declared divisions needs verified rules');

for (const settings of [{}, { playoff_teams: 0 }, { playoff_teams: 8 }, { playoff_teams: 20 }, { playoff_teams: 2.5 }]) {
    value = run({ league: { ...league, settings } });
    assert.equal(value.mode, 'none');
    assert.equal(value.slots, null);
    assert(value.leagueRows.every(row => row.playoffState === null));
}
value = run({ league: { ...league, settings: { ...league.settings, playoff_week_start: 0 } } });
assert.equal(value.mode, 'none', 'disabled playoff start overrides a stale positive field size');
assert.equal(value.cutlineLabel, '');
assert.equal(value.note, '', 'known disabled playoffs do not show a verification warning');
value = run({ league: { ...league, settings: { ...league.settings, playoff_teams: 0 } } });
assert.equal(value.note, '', 'known zero-slot leagues do not show a verification warning');
value = run({ league: { ...league, settings: { ...league.settings, playoff_teams: rows.length } } });
assert.equal(value.note, 'All teams qualify.');
for (const extra of [{ provider: 'mfl' }, { _mfl: true }, { _espn: true }, { _yahoo: true }, { type: 'chopped' }, { leagueSkin: { type: 'chopped' } }, { league_id: 'demo_1' }]) {
    assert.equal(run({ league: { ...league, ...extra } }).mode, 'none', 'unsupported format cannot acquire a playoff field');
}
assert.equal(run({ league: { ...league, leagueSkin: { features: { showPlayoffOdds: false } } } }).mode, 'standard', 'hiding simulations alone does not remove known playoff places');
assert.equal(run({ rows: rows.map(row => row.rosterId === 7 ? { ...row, wins: null } : row) }).mode, 'none', 'missing records cannot manufacture a field');
value = run({ rows: rows.slice(0, -1) });
assert.equal(value.mode, 'none', 'missing one known roster cannot shrink the field and produce qualifiers');
assert.equal(value.cutlineLabel, '');
assert(value.leagueRows.every(row => row.playoffState === null));
value = run({ rows: rows.map(row => row.rosterId === 7 ? { ...row, rosterId: 99 } : row) });
assert.equal(value.mode, 'none', 'a foreign team cannot replace an actual league roster');
assert.match(value.note, /Every league team/);
value = run({ league: { ...league, rosters: [...league.rosters.slice(0, -1), league.rosters[0]] } });
assert.equal(value.mode, 'none', 'duplicate provider roster IDs cannot produce a playoff field');
value = run({ league: { ...league, rosters: [...league.rosters.slice(0, -1), { settings: { division: 1 } }] } });
assert.equal(value.mode, 'none', 'missing provider roster identity cannot produce a playoff field');

const baselineRows = rows.map(row => row.rosterId === 0 ? { ...row, wins: 8, losses: 2, pointsFor: 700 }
    : row.rosterId === 1 ? { ...row, wins: 9, losses: 1, pointsFor: 900 } : row);
value = run({ baselineRows });
assert.equal(find(value, 0).displayBaselineRank, 4, 'baseline league rank applies division winner seeding too');
assert.equal(find(value, 0).displayRank, 1);
assert.equal(value.divisions[0].rows.find(row => row.rosterId === 0).displayBaselineRank, 3, 'baseline division rank uses its local record scope');
assert.equal(value.divisions[0].rows.find(row => row.rosterId === 0).displayRank, 1);
value = run({ baselineRows: rows.map(row => ({ ...row, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 })) });
assert(value.leagueRows.every(row => row.displayBaselineRank === null), 'an unresolved preseason division lead has no invented baseline seed');
assert(value.divisions.flatMap(division => division.rows).every(row => row.displayBaselineRank === null));
value = run({ baselineRows: baselineRows.slice(1) });
assert(value.leagueRows.every(row => row.displayBaselineRank === null), 'movement is unavailable for an incomplete baseline');
value = run({ league: { ...league, settings: { ...league.settings, playoff_teams: 8 } }, baselineRows });
assert.equal(value.mode, 'none');
assert.equal(find(value, 0).displayRank, 1, 'a league without a cutline retains its record rank');
assert.equal(value.divisions[0].rows.find(row => row.rosterId === 0).displayBaselineRank, 3, 'no-cutline division rows retain local movement');
value = run({ league: { ...league, settings: { ...league.settings, playoff_teams: 8 } }, rows: rows.map(row => ({ ...row, rank: row.rosterId + 1 })) });
assert.equal(find(value, 0).displayRank, 1, 'known source ranks survive a no-cutline view');
assert.deepEqual(plain(picture({ league: noDiv, rows: [] }).leagueRows), []);
console.log('PASS live playoff picture: verified standard/division seeding, wildcard concentration, record/PF/PA tiebreaks, unresolved cutoffs, custom/incomplete metadata, zero IDs, baseline scope and pure data.');
