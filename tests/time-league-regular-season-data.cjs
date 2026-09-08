#!/usr/bin/env node
'use strict';
// Validate the shipped historical archive, rather than reimplementing its importer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const data = path.resolve(process.argv[2] || path.join(root, 'data/time-league'));
global.App = {};
for (const name of ['roster', 'draft-room', 'season', 'player-cards']) require(path.join(root, `js/shared/time-league-${name}.js`));
const S = App.TimeLeagueSeason, P = App.TimeLeaguePlayerCards;
const manifest = JSON.parse(fs.readFileSync(path.join(data, 'regular-season-manifest.json')));
const payload = JSON.parse(fs.readFileSync(path.join(data, 'player-cards.json')));
const cards = P.buildPlayerCardIndex(payload);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const legacyRoot = path.join(root, 'data/time-league');
assert.equal(hash(path.join(legacyRoot, 'legacy-player-cards.json')), 'e085e014140cd98ad6ed89cef991b27f289bbeb205349cedb7a7ba956852c537');
assert.equal(hash(path.join(legacyRoot, 'nflverse-game-logs.csv')), 'ef44cb85bde16f72a53f4d7c979b981048e912996bcc4c5c08511a95f8142be5');
assert.equal(hash(path.join(legacyRoot, 'era-factors.json')), 'f970630eea9fe943f59a181309bff335e8361ca4290807ffac8b7e1ca3adb7c7');
assert.equal(payload.datasetVersion, 1);
assert.equal(cards.size, manifest.players);
assert(cards.size >= 3500, 'Retain the supported draftable pool');
assert([...cards.values()].every(card => ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(card.position)), 'No IDP in the new archive');
const csvFile = path.join(data, 'regular-season-game-logs.csv');
assert.equal(hash(csvFile), manifest.outputs.gameLogsSha256);
const parsed = S.parseGameLogCsv(fs.readFileSync(csvFile, 'utf8'));
assert.equal(parsed.skippedRows, 0);
assert.equal(parsed.logs.length, manifest.logRows, 'Parser must not silently truncate past the old 250k cap');
assert(parsed.logs.length > 270000);
const index = S.buildGameLogIndex(parsed.logs);
assert.equal(index.size, parsed.logs.length);
const sums = new Map();
const scoring = { passTd: 4, reception: 0.5, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 };
for (const log of parsed.logs) {
    assert(log.sourceGameId && log.team && log.opponent);
    assert.notEqual(log.team, log.opponent, `Player cannot oppose own team: ${log.sourceGameId}`);
    assert(log.scheduledGames >= 9 && log.scheduledGames <= 18);
    const key = `${log.identity}:${log.season}`;
    const sum = sums.get(key) || { games: 0, points: 0, passYd: 0, rushYd: 0, recYd: 0, sourceGames: new Set(), weeks: [] };
    assert(!sum.sourceGames.has(log.sourceGameId), `Source game repeats in ${key}`);
    sum.sourceGames.add(log.sourceGameId); sum.weeks.push(log.week); sum.games++;
    sum.points += S.scoreStatLine(log.stats, scoring, S.REFERENCE_EXTENDED_SCORING);
    for (const stat of ['passYd', 'rushYd', 'recYd']) sum[stat] += log.stats[stat];
    sums.set(key, sum);
    if (log.season < 1999) {
        assert(log.gameDate && log.historicalWeek);
        if (log.season === 1982) assert(log.gameDate <= '1983-01-03', '1982 postseason must not enter the regular archive');
        if (log.season === 1998) assert(log.gameDate <= '1999-01-03', '1998 postseason must not enter the regular archive');
    }
}
let seasonCount = 0;
for (const card of cards.values()) {
    assert.equal(card.peak, Math.max(...card.seasons.map(season => season.points)));
    for (const season of card.seasons) {
        seasonCount++;
        const sum = sums.get(`${card.identity}:${season.season}`);
        assert(sum, `Missing logs for ${card.identity}/${season.season}`);
        assert.equal(season.games, sum.games);
        assert.equal(season.recordedGames, sum.games);
        assert(season.scheduledGames >= season.recordedGames);
        assert.equal(Math.round(sum.points * 100) / 100, season.points, `Reference score mismatch ${card.identity}/${season.season}`);
        assert.deepEqual(season.sourceWeeks, sum.weeks.sort((a, b) => a - b));
        for (const stat of ['passYd', 'rushYd', 'recYd']) assert.equal(season[stat], sum[stat]);
        assert(season.source && season.sourcePlayerId && season.teams.length);
        if (season.season < 1999) {
            assert.equal(season.coverage, 'regular-season-missing-stats');
            assert.equal(season.sourceWeekKind, 'player-game-ordinal');
        } else {
            assert.equal(season.coverage, 'recorded-regular-season');
            assert.equal(season.sourceWeekKind, 'nfl-week');
        }
    }
}
assert.equal(seasonCount, manifest.playerSeasons);
const card = name => [...cards.values()].find(player => player.name === name);
const season = (name, year) => card(name).seasons.find(row => row.season === year);
assert.equal(season('O.J. Simpson', 1973).games, 14);
assert.equal(season('O.J. Simpson', 1973).rushYd, 2003);
assert.equal(season('Dan Marino', 1984).games, 16);
assert.equal(season('Dan Marino', 1984).passYd, 5084);
assert.equal(season('Marcus Allen', 1982).games, 9);
assert.equal(season('Marcus Allen', 1982).scheduledGames, 9);
assert.equal(season('Walter Payton', 1985).rushYd, 1551);
assert.equal(season('Patrick Mahomes', 2018).games, 16);
assert.equal(season('Patrick Mahomes', 2018).passYd, 5097);
assert.equal(season('Patrick Mahomes', 2022).games, 17);
assert.equal(season('Josh Allen', 2023).games, 17);
assert.equal(season('Josh Allen', 2022).scheduledGames, 16, 'Cancelled BUF/CIN game is not a phantom appearance');
assert.equal(season('Justin Tucker', 2021).games, 17);
assert.equal(season('Justin Tucker', 2021).extra.fgm, 35);
assert.equal(season('CHI Defense', 2006).games, 16);
assert.equal(season('CHI Defense', 2006).extra.sack, 38);
assert.equal(season('Mike Alstott', 2001).games, 16, 'FB-labelled rows belong to the existing RB career');
assert.equal(season('Mike Alstott', 2001).rushYd, 680);
assert(!season('Kurt Warner', 1999), 'Known missing source game must not become a presumed missed appearance');
assert(season('Kurt Warner', 2001), 'Quarantine is limited to affected seasons');
assert(manifest.excludedPlayerSeasons.some(row => row.identity === 'player:QB:kurtwarner' && row.season === 1999));
assert(card('Adrian Peterson').seasons.every(row => row.season >= 2007), 'Do not merge Bears and Vikings Adrian Peterson');
assert.equal(card('Adrian Peterson').bio.birthDate, '1985-03-21');
assert.equal(card('Steve Smith').bio.college, 'Utah');
assert(card('Mike Williams').seasons.every(row => row.season >= 2017));
assert.equal(card('Mike Williams').bio.college, 'Clemson');
assert(season('Dan Marino', 1999) && season('Terrell Fletcher', 1995) && season('Terrell Fletcher', 2002), 'Same career stays intact across source boundary');
assert(!cards.has('player:TE:derekbrown'), 'Conflicting source career is quarantined, not silently merged');
assert(manifest.quarantinedCareers.some(row => row.identity === 'player:TE:derekbrown'));
assert(manifest.historical.teamSeasons >= 808);
assert(manifest.modern.correctedOpponentRows > 0);
console.log(`Full REG archive passed: ${cards.size} players, ${seasonCount} seasons, ${parsed.logs.length} unique scoring lines; legacy hashes unchanged.`);
