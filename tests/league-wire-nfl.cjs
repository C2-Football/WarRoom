'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const context = { AbortController, Date, Intl, setTimeout, clearTimeout, App: { NflContext: { endpoint: () => '/api/nfl-scoreboard', parseScores: d => d.events } } };
vm.createContext(context); vm.runInContext(fs.readFileSync('js/shared/league-wire-nfl.js', 'utf8'), context);
const api = context.WrWireNfl;
const game = { id: '401772510', season: '2025', week: 1, seasontype: 2, kickoff: '2025-09-05T00:20Z', home: 'PHI', away: 'DAL', homeName: 'Philadelphia Eagles', awayName: 'Dallas Cowboys', homeScore: 24, awayScore: 20, completed: true, state: 'post', shortDetail: 'Final', homePeriods: [7, 14, 3, 0].map((value, i) => ({ period: i + 1, value })), awayPeriods: [7, 13, 0, 0].map((value, i) => ({ period: i + 1, value })) };
// Fields and nonzero lines independently checked against public ESPN/Sleeper
// game 401772510 (2025 opener). Missing keys remain missing in the fixture.
const athlete = (id, displayName, stats) => ({ athlete: { id, displayName }, stats });
const summary = { header: { id: game.id, competitions: [{ status: { type: { completed: true, state: 'post', shortDetail: 'Final' } }, competitors: [{ id: '21', homeAway: 'home', score: '24', team: { id: '21', abbreviation: 'PHI', displayName: game.homeName } }, { id: '6', homeAway: 'away', score: '20', team: { id: '6', abbreviation: 'DAL', displayName: game.awayName } }] }] }, boxscore: { players: [
    { team: { id: '21' }, statistics: [{ name: 'rushing', keys: ['rushingAttempts', 'rushingYards', 'rushingTouchdowns'], labels: ['CAR', 'YDS', 'TD'], descriptions: ['Carries', 'Rushing yards', 'Touchdowns'], athletes: [athlete('4040715', 'Jalen Hurts', ['14', '62', '2'])] }] },
    { team: { id: '6' }, statistics: [{ name: 'receiving', keys: ['receptions', 'receivingYards', 'receivingTouchdowns', 'receivingTargets'], labels: ['REC', 'YDS', 'TD', 'TGTS'], athletes: [athlete('4241389', 'CeeDee Lamb', ['7', '110', '0', '13'])] }] },
] } };
const player = (id, first, last, team, opponent, stats) => ({ category: 'stat', date: '2025-09-04', week: 1, season: '2025', season_type: 'regular', team, opponent, game_id: '202510126', player_id: id, player: { first_name: first, last_name: last, position: 'QB', team: 'NYJ' }, stats });
const rows = [player('6904', 'Jalen', 'Hurts', 'PHI', 'DAL', { pass_att: 23, pass_cmp: 19, pass_yd: 152, rush_att: 14, rush_yd: 62, rush_td: 2 }), player('6786', 'CeeDee', 'Lamb', 'DAL', 'PHI', { rec: 7, rec_tgt: 13, rec_yd: 110 })];
const clone = value => JSON.parse(JSON.stringify(value));
const box = api.parseSummary(summary, game);
assert.equal(box.teams[0].abbr, 'DAL');
assert.equal(box.teams[0].groups[0].players[0].stats.receivingTouchdowns, '0');
assert.match(api.recap(game, box).spotlight.join(' '), /Jalen Hurts ran for 62 yards and 2 touchdowns on 14 carries/);
assert.match(api.recap(game, box).spotlight.join(' '), /7 passes for 110 yards on 13 targets/);
const missing = clone(summary); missing.boxscore.players[0].statistics[0].athletes[0].stats = ['14', '62'];
assert.equal(api.parseSummary(missing, game).teams[1].groups[0].players[0].values[2], null);
assert.throws(() => api.parseSummary(summary, { ...game, id: '401772511' }), /unavailable/);
assert.throws(() => api.parseSummary(summary, { ...game, away: 'NYG' }), /does not match/);
const duplicate = clone(summary); duplicate.boxscore.players.push(duplicate.boxscore.players[0]);
assert.throws(() => api.parseSummary(duplicate, game), /duplicate teams/);
const sleeper = api.parseSleeper(rows, game);
assert.equal(sleeper.statsSource, 'Sleeper');
assert.equal(sleeper.teams[1].abbr, 'PHI', 'original game team overrides current player team');
assert.equal(sleeper.teams[0].groups.find(g => g.id === 'receiving').players[0].stats.receivingTouchdowns, null, 'omitted zero values are unavailable, never invented');
assert.equal(sleeper.teams[0].groups.find(g => g.id === 'passing').players.length, 0);
assert.throws(() => api.parseSleeper(rows, { ...game, week: 2 }), /matched/);
assert.throws(() => api.parseSleeper(rows, { ...game, season: '2026' }), /matched/);
assert.throws(() => api.parseSleeper(rows, { ...game, seasontype: 3 }), /matched/);
assert.throws(() => api.parseSleeper(rows, { ...game, kickoff: '2025-09-12T00:20Z' }), /matched/);
assert.throws(() => api.parseSleeper(rows.slice(0, 1), game), /both teams/);
assert.throws(() => api.parseSleeper([...rows, { ...rows[0], game_id: 'other' }], game), /matched/);
assert.throws(() => api.parseSleeper([...rows, { ...rows[0], stats: { pass_yd: 900 } }], game), /Conflicting/);
assert.equal(api.recap({ ...game, completed: false }).headline, '');
assert.equal(api.recap({ ...game, homeScore: null }).headline, '');
assert.match(api.recap({ ...game, homeScore: 20 }).headline, /20–20 tie/);
assert.equal(api.recap({ ...game, homeScore: 20 }).body, '');
const comeback = { ...game, homeScore: 24, awayScore: 17, homePeriods: [0, 0, 7, 17].map((value, i) => ({ value, period: i + 1 })), awayPeriods: [7, 3, 7, 0].map((value, i) => ({ value, period: i + 1 })) };
assert.match(api.recap(comeback).body, /10-point deficit after three quarters/);
assert.equal(api.recap({ ...comeback, homeScore: 25 }).body, '', 'incomplete or inconsistent quarter totals cannot support a swing');
assert.equal(api.recap({ ...comeback, homePeriods: comeback.homePeriods.slice(1) }).body, '');
assert.equal(api.recap({ ...game, homeScore: 25 }, box).spotlight.length, 0, 'mismatched score snapshots never enrich the result');

(async () => {
    let calls = 0, time = 100000;
    const fetcher = async (url, options) => { calls++; assert.equal(options.credentials, 'omit'); return { ok: true, json: async () => url.includes('api.sleeper.com') ? rows : summary }; };
    const a = await api.loadBoxScore({ game, fetcher, now: () => time });
    assert.equal(a.statsSource, 'Sleeper'); assert.equal(calls, 1);
    time += 10; const b = await api.loadBoxScore({ game, fetcher, now: () => time });
    assert.equal(calls, 1); assert.equal(b.checkedAt, a.checkedAt, 'cached reads retain actual request timestamp');
    await api.loadBoxScore({ game, fetcher, force: true, now: () => time }); assert.equal(calls, 2);
    const fallback = await api.loadBoxScore({ game, fetcher: async url => ({ ok: true, json: async () => url.includes('api.sleeper.com') ? [] : summary }) });
    assert.equal(fallback.statsSource, 'ESPN');
    await assert.rejects(api.loadBoxScore({ game, fetcher: async () => ({ ok: true, json: async () => ({ events: [] }) }) }), /unavailable/);
    await assert.rejects(api.loadBoxScore({ game: { ...game, id: 'bad' }, fetcher }), /verified game ID/);
    let finish, abortCalls = 0; const controller = new AbortController();
    const slow = () => { abortCalls++; return new Promise(resolve => { finish = () => resolve({ ok: true, json: async () => rows }); }); };
    const pending = api.loadBoxScore({ game, fetcher: slow, signal: controller.signal }); controller.abort(); finish();
    await assert.rejects(pending, { name: 'AbortError' });
    const next = api.loadBoxScore({ game, fetcher: slow }); finish(); await next;
    assert.equal(abortCalls, 2, 'aborted response did not poison cache');
    const week = await api.loadWeek({ phase: { season: '2025', week: 1, seasontype: 2 }, now: () => time, fetcher: async () => ({ ok: true, json: async () => ({ events: [game] }) }) });
    assert.equal(week.updatedAt, null, 'checking an old relay does not imply upstream scores just updated');
    assert.equal(week.checkedAt, time);
    await assert.rejects(api.loadWeek({ phase: { season: '2025', week: 0, seasontype: 2 }, fetcher }), /week could not be verified/);
    console.log('PASS NFL reporting: verified event/team/date/phase joins, original player teams, missing/zero stats, substantive recaps, lazy caching, cancellation, retry and source freshness');
})().catch(error => { console.error(error); process.exitCode = 1; });
