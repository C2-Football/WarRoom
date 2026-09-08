const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
require('../js/shared/time-league-roster.js');
const Draft = require('../js/shared/time-league-draft-room.js');
const Season = require('../js/shared/time-league-season.js');

const directory = path.join(__dirname, '../data/duat');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
const cards = JSON.parse(fs.readFileSync(path.join(directory, 'player-cards.json'), 'utf8')).players;
const parsed = Season.parseGameLogCsv(fs.readFileSync(path.join(directory, 'nflverse-game-logs.csv'), 'utf8'));
const logs = parsed.logs;
const index = Season.buildGameLogIndex(logs);
const cardIndex = new Map(cards.map(card => [card.identity, card]));
const scoring = { passTd: 4, reception: 0.5, rushRecYd: 0.1, passingYd: 0.04, turnover: -1 };
const statKeys = ['passYd', 'passTd', 'passInt', 'rushYd', 'rushTd', 'rec', 'recYd', 'recTd', 'fumblesLost', 'twoPointConversions'];
const identity = (name, position) => Draft.canonicalPlayerIdentity({ name, position });
const get = (name, position, season, week) => index.get(Season.gameLogKey(identity(name, position), season, week));
const rounded = value => Math.round(value * 100) / 100;

// Independently transcribed from the named REG game rows in nflverse's
// stats_player_week_YEAR.csv releases. Fixed values include neither preseason
// nor NFL postseason. Source-file hashes are recorded here so a later source
// revision prompts explicit review instead of silently rewriting the fixtures.
// These tests never open another checkout or require a download/source cache.
const sourceHashes = {
    2002: '1ddf9b0b4357f494e42a65f5e2d2512e69b522d32bf0b60fd62e25df311b5d9a',
    2006: '5d1c0d28e50cde695fa808d53e773890bfdaf9fa43448c9944a50a2b57e25026',
    2010: '57faf093bc81f755449a1c1aa0e04f87a515a58c988fa7aa258e0c2108435558',
    2013: '76513314bcbd18ad1bc007ecfb886b2c7bf42f74613342d4fc232a820c2021c7',
    2020: '54d9274dfda5637daf5675b41f682959b442ae94e9ea95bc0a779c2024e52d81',
    2021: '63cc3e2400307ee8c1fc5c6283c6c4223471111c0f4aedecd60c8db75c96a06d',
    2025: '40b67b296fda02c7f628741d4aa471208352dd42fb670d4854e7ba95295af1a6'
};
const sourceCases = [
    // name, position, season, week, the ten stat columns above, expected Duat points
    ['Mark Brunell', 'QB', 2002, 1, [228, 2, 1, 19, 0, 0, 0, 0, 0, 1], 20.02], // 2002_01_IND_JAX; passing conversion
    ['Eddie George', 'RB', 2002, 1, [0, 0, 0, 42, 1, 4, 38, 1, 0, 1], 24], // 2002_01_PHI_TEN; rushing conversion
    ['Jimmy Smith', 'WR', 2002, 1, [0, 0, 0, 0, 0, 8, 104, 0, 0, 1], 16.4], // 2002_01_IND_JAX; receiving conversion
    ['Damon Gibson', 'WR', 2002, 1, [0, 0, 0, 0, 0, 0, 0, 0, 1, 0], -1], // return fumble: every offense-specific lost-fumble field is zero
    ['Daunte Culpepper', 'QB', 2002, 2, [281, 3, 0, 20, 1, 0, 0, 0, 3, 0], 28.24], // 2002_02_BUF_MIN; 2 sack + 1 rushing fumbles lost
    ['LaDainian Tomlinson', 'RB', 2006, 14, [0, 0, 0, 103, 3, 1, 9, 0, 0, 0], 29.7], // 2006_14_DEN_SD
    ['Mike Vick', 'QB', 2010, 10, [333, 4, 0, 80, 2, 0, 0, 0, 0, 0], 49.32], // 2010_10_PHI_WAS
    ['Peyton Manning', 'QB', 2013, 1, [462, 7, 0, -2, 0, 0, 0, 0, 0, 0], 46.28], // 2013_01_BAL_DEN
    ['Alvin Kamara', 'RB', 2020, 16, [0, 0, 0, 155, 6, 3, 17, 0, 0, 0], 54.7], // 2020_16_MIN_NO
    ["Ja'Marr Chase", 'WR', 2021, 17, [0, 0, 0, 0, 0, 11, 266, 3, 0, 0], 50.1], // 2021_17_KC_CIN
    ['Joe Burrow', 'QB', 2025, 17, [305, 2, 0, 2, 0, 0, 0, 0, 0, 0], 20.4] // 2025_17_ARI_CIN
];

test('Duat historical data covers every regular-season calendar week in 2002–2025', () => {
    assert.deepEqual(manifest.seasons, Array.from({ length: 24 }, (_, i) => 2002 + i));
    assert.deepEqual(manifest.weeks, Array.from({ length: 17 }, (_, i) => i + 1));
    assert.equal(parsed.skippedRows, 0);
    assert.equal(logs.length, manifest.rows);
    assert.equal(index.size, logs.length);
    assert.equal(cards.length, manifest.players);
    assert.equal(cardIndex.size, cards.length);
    const counts = new Map();
    for (const log of logs) {
        assert.ok(log.season >= 2002 && log.season <= 2025);
        assert.ok(log.week >= 1 && log.week <= 17, 'Week 18 and postseason must be absent');
        assert.ok(['QB', 'RB', 'WR', 'TE'].includes(log.position));
        const key = `${log.season}:${log.week}`;
        counts.set(key, (counts.get(key) || 0) + 1);
        assert.ok(statKeys.every(key => Number.isFinite(log.stats[key])), `Nonfinite stats for ${log.name}`);
    }
    assert.equal(counts.size, 24 * 17);
    assert.equal(manifest.sources.length, 24);
    for (const source of manifest.sources) {
        let yearTotal = 0;
        for (const week of manifest.weeks) {
            const actual = counts.get(`${source.season}:${week}`);
            assert.ok(actual >= 100, `${source.season} Week ${week} unexpectedly sparse`);
            assert.equal(actual, source.weekCounts[week]);
            yearTotal += actual;
        }
        assert.equal(yearTotal, source.rows);
        assert.match(source.url, new RegExp(`stats_player_week_${source.season}\\.csv$`));
        assert.match(source.sha256, /^[a-f0-9]{64}$/);
    }
});

test('fixed original-source games preserve points, total fumbles and every two-point play type', () => {
    for (const [year, hash] of Object.entries(sourceHashes)) assert.equal(manifest.sources.find(source => source.season === Number(year)).sha256, hash);
    for (const [name, position, year, week, expected, points] of sourceCases) {
        const log = get(name, position, year, week);
        assert.ok(log, `${name} ${year} Week ${week} missing`);
        assert.deepEqual(statKeys.map(key => log.stats[key]), expected, `${name} ${year} Week ${week}`);
        assert.equal(Season.scoreStatLine(log.stats, scoring), points, `${name} original Duat points`);
    }
});

test('canceled Buffalo–Cincinnati Week 17 stays absent while real Week 17 games remain available', () => {
    for (const [name, position] of [['Josh Allen', 'QB'], ['Joe Burrow', 'QB'], ["Ja'Marr Chase", 'WR'], ['Stefon Diggs', 'WR']]) {
        assert.equal(get(name, position, 2022, 17), undefined);
        assert.ok(get(name, position, 2022, 16), `${name} has a completed Week 16 game`);
    }
    assert.ok(get('Patrick Mahomes', 'QB', 2022, 17));
    assert.equal(get('Patrick Mahomes', 'QB', 2022, 18), undefined);
});

test('father and son and same-name NFL players retain distinct historical cards', () => {
    const cases = [
        ['Marvin Harrison', 'Marvin Harrison Jr. (ARI)', 'WR', 2002, 2024],
        ['Cedrick Wilson', 'Cedrick Wilson Jr. (DAL)', 'WR', 2002, 2024],
        ['Adrian Peterson (CHI)', 'Adrian Peterson', 'RB', 2003, 2012],
        ['Mike Williams (DET)', 'Mike Williams (TB)', 'WR', 2005, 2012]
    ];
    for (const [firstName, secondName, position, firstYear, secondYear] of cases) {
        const first = cardIndex.get(identity(firstName, position));
        const second = cardIndex.get(identity(secondName, position));
        assert.ok(first && second, `${firstName} and ${secondName} each need a card`);
        assert.notEqual(first.identity, second.identity);
        assert.ok(first.seasons.some(season => season.season === firstYear));
        assert.ok(second.seasons.some(season => season.season === secondYear));
        assert.equal(first.seasons.some(season => season.season === secondYear), false);
        assert.equal(second.seasons.some(season => season.season === firstYear), false);
    }
});

test('every card season reconciles to its actual W1–17 logs and original Duat scoring', () => {
    const aggregates = new Map();
    for (const log of logs) {
        assert.ok(cardIndex.has(log.identity), `Missing card for ${log.identity}`);
        const key = `${log.identity}:${log.season}`;
        const aggregate = aggregates.get(key) || { games: 0, points: 0, stats: {} };
        aggregate.games += 1;
        aggregate.points += Season.scoreStatLine(log.stats, scoring);
        for (const stat of statKeys.slice(0, 8)) aggregate.stats[stat] = (aggregate.stats[stat] || 0) + log.stats[stat];
        aggregates.set(key, aggregate);
    }
    let seasons = 0;
    for (const card of cards) {
        assert.equal(card.identity, identity(card.name, card.position));
        assert.equal(new Set(card.seasons.map(season => season.season)).size, card.seasons.length);
        assert.equal(card.peak, Math.max(...card.seasons.map(season => season.points)));
        for (const season of card.seasons) {
            const aggregate = aggregates.get(`${card.identity}:${season.season}`);
            assert.ok(aggregate, `Card without game logs: ${card.name} ${season.season}`);
            assert.equal(season.games, aggregate.games);
            assert.equal(season.points || 0, rounded(aggregate.points) || 0, `${card.name} ${season.season} points`);
            for (const stat of statKeys.slice(0, 8)) assert.equal(season[stat], aggregate.stats[stat], `${card.name} ${season.season} ${stat}`);
            seasons += 1;
        }
    }
    assert.equal(seasons, aggregates.size);
});
