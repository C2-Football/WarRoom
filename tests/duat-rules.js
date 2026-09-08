#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const Rules = require('../js/duat/rules.js');

test('original defaults retain four eight-player armies, sacred weeks, all-play and seven playoff seeds', () => {
    assert.deepEqual(Rules.ORIGINAL_DEFAULTS.rosterSlots, { QB: 1, FLEX: 4, BN: 3 });
    assert.equal(Rules.ORIGINAL_DEFAULTS.teamCount, 14);
    assert.equal(Rules.DUAT_ORIGINAL_ARMY_COUNT, 4);
    assert.deepEqual(Rules.DUAT_ORIGINAL_D20_BANDS.map(band => [band.min, band.max]), [[1, 5], [6, 10], [11, 15], [16, 20]]);
    assert.deepEqual(Rules.SACRED_WEEKS, [5, 7, 10, 14, 15, 16, 17]);
    assert.equal(Rules.ORIGINAL_DEFAULTS.matchupFormat, 'all-play');
    assert.equal(Rules.ORIGINAL_DEFAULTS.regularSeasonWeeks, 14);
    assert.equal(Rules.ORIGINAL_DEFAULTS.playoffTeams, 7);
    assert.equal(Rules.ORIGINAL_DEFAULTS.playoffStartWeek, 15);
    assert.equal(Object.isFrozen(Rules.ORIGINAL_DEFAULTS.rosterSlots), true);
});

test('fourteen original factions have unique sacred homelands in the supplied route graph', () => {
    const factionIds = new Set(Rules.FACTIONS.map(faction => faction.id));
    const territoryIds = new Set(Rules.TERRITORIES.map(territory => territory.id));
    assert.equal(factionIds.size, 14);
    assert.equal(new Set(Rules.FACTIONS.map(faction => faction.homeTerritoryId)).size, 14);
    for (const faction of Rules.FACTIONS) {
        const home = Rules.TERRITORIES.find(territory => territory.id === faction.homeTerritoryId);
        assert.equal(home?.homelandOf, faction.id);
        assert.ok(Rules.ROUTES.some(route => route.from === home.id || route.to === home.id));
        assert.equal(faction.record, undefined, 'New campaigns must not inherit archive wins');
        assert.equal(faction.territory, undefined, 'New campaigns must not inherit archive conquests');
    }
    for (const route of Rules.ROUTES) {
        assert.ok(territoryIds.has(route.from) && territoryIds.has(route.to));
        assert.notEqual(route.from, route.to);
        assert.ok(['land', 'sea', 'passage'].includes(route.type));
    }
    assert.equal(territoryIds.size, Rules.TERRITORIES.length);
    assert.ok(Rules.ROUTES.some(route => route.type === 'passage'));
    assert.ok(Rules.FAVORS.some(favor => favor.id === 'shiva'));
});

test('actual original faction identities form seven repeatable paired alliances', () => {
    const ids = Rules.FACTIONS.map(faction => faction.id);
    const originalIds = [...ids];
    const settings = Rules.defaultHeptadSettings(ids.length);
    const alliances = Rules.buildHeptadAlliances(ids, settings, 'the-first-duat');
    assert.equal(alliances.length, 7);
    assert.ok(alliances.every(alliance => alliance.teamIds.length === 2));
    assert.deepEqual(alliances, Rules.buildHeptadAlliances(ids, settings, 'the-first-duat'));
    assert.deepEqual([...alliances.flatMap(alliance => alliance.teamIds)].sort(), [...ids].sort());
    assert.notDeepEqual(alliances, Rules.buildHeptadAlliances(ids, settings, 'another-duat'));
    assert.deepEqual(ids, originalIds, 'The draw cannot reorder the caller roster');
});

test('both tournaments pause on absent or invalid JavaScript score inputs', () => {
    const alliances = Rules.buildHeptadAlliances(Rules.FACTIONS.map(faction => faction.id), Rules.defaultHeptadSettings(14), 'no-results');
    for (const missing of [null, undefined, NaN, Infinity, '42']) {
        const heptad = Rules.runHeptadGauntlet(alliances, () => missing, 2);
        const heavenly = Rules.runHeavenlyBattle(Rules.FACTIONS.slice(0, 7).map(faction => faction.id), () => missing);
        for (const result of [heptad, heavenly]) {
            assert.equal(result.matches.length, 0);
            assert.equal(result.championId, null);
            assert.equal(result.complete, false);
            assert.ok(result.next);
        }
    }
});

test('browser module publishes the same API without Node or the original Duat checkout', () => {
    const source = fs.readFileSync(require.resolve('../js/duat/rules.js'), 'utf8');
    const context = { window: { App: { preserved: true } } };
    vm.runInNewContext(source, context);
    assert.equal(context.window.App.preserved, true);
    const browserRules = context.window.App.DuatRules;
    assert.equal(browserRules.FACTIONS.length, 14);
    assert.deepEqual(JSON.parse(JSON.stringify(browserRules.heavenlyBattleSchedule(7))), Rules.heavenlyBattleSchedule(7));
    assert.equal(typeof browserRules.runHeptadGauntlet, 'function');
});

// Canon regression cases ported from The Duat tests/heptad.test.mjs.
{

const {
  allianceSizeOptions,
  buildHeptadAlliances,
  canRunHeptad,
  defaultAllianceSize,
  defaultHeptadSettings,
  describeHeptad,
  heptadSchedule,
  heptadShape,
  normalizeHeptadSettings,
  runHeptadGauntlet,
  scoreHeptadWeek,
} = Rules;

const teamIds = (count) => Array.from({ length: count }, (_, index) => `t${index + 1}`);

/** Seven alliances entering in order, with scores scripted per week. */
function sevenAlliances() {
  return Array.from({ length: 7 }, (_, index) => ({
    id: `h${index + 1}`,
    name: `Alliance ${index + 1}`,
    teamIds: [`a${index + 1}`, `b${index + 1}`],
    entry: index + 1,
  }));
}

test("fourteen factions in pairs is the original seven-alliance Heptad", () => {
  const shape = heptadShape(14, 2);
  assert.equal(shape.allianceCount, 7);
  assert.deepEqual(shape.sizes, [2, 2, 2, 2, 2, 2, 2]);
  assert.equal(shape.isTrueHeptad, true);
  assert.equal(defaultAllianceSize(14), 2);
  assert.equal(describeHeptad(14, 2), "7 alliances of 2. A true Heptad.");
});

test("the shape adapts to any league size without benching a faction", () => {
  const thirteen = heptadShape(13, 2);
  assert.deepEqual(thirteen.sizes, [3, 2, 2, 2, 2, 2]);
  assert.equal(thirteen.sizes.reduce((sum, size) => sum + size, 0), 13);

  assert.deepEqual(allianceSizeOptions(10), [2, 3, 4, 5]);
  assert.deepEqual(heptadShape(10, 3).sizes, [4, 3, 3]);

  assert.deepEqual(allianceSizeOptions(4), [2]);
  assert.equal(canRunHeptad(4, 3), false);
  assert.deepEqual(allianceSizeOptions(3), []);
  assert.match(describeHeptad(3, 2), /cannot field two alliances/);

  // 21 teams defaults to trios because that lands on seven alliances.
  assert.equal(defaultAllianceSize(21), 3);
  assert.equal(defaultAllianceSize(12), 2);
});

test("the canon calendar: top W2-7, bottom W4-8, championship W9, rematch W10, Pinnacle W11", () => {
  const schedule = heptadSchedule(7, 2);
  assert.deepEqual(schedule.topWeeks, [2, 7]);
  assert.deepEqual(schedule.bottomWeeks, [4, 8]);
  assert.equal(schedule.championshipWeek, 9);
  assert.equal(schedule.rematchWeek, 10);
  assert.equal(schedule.pinnacleWeek, 11);
  assert.equal(schedule.fixtures.filter((f) => f.bracket === "top").length, 6);
  assert.equal(schedule.fixtures.filter((f) => f.bracket === "bottom").length, 5);

  // A smaller field compresses the gauntlet.
  const five = heptadSchedule(5, 2);
  assert.deepEqual(five.topWeeks, [2, 5]);
  assert.deepEqual(five.bottomWeeks, [4, 6]);
  assert.equal(five.championshipWeek, 7);
});

test("the entry draw is deterministic, covers everyone, and holds all season", () => {
  const ids = teamIds(14);
  const settings = defaultHeptadSettings(14);
  const drawA = buildHeptadAlliances(ids, settings, "league-1");
  const drawB = buildHeptadAlliances(ids, settings, "league-1");
  assert.deepEqual(drawA, drawB);
  assert.equal(new Set(drawA.flatMap((a) => a.teamIds)).size, 14);
  assert.deepEqual(drawA.map((a) => a.entry), [1, 2, 3, 4, 5, 6, 7]);
  assert.notDeepEqual(drawA.map((a) => a.teamIds), buildHeptadAlliances(ids, settings, "league-2").map((a) => a.teamIds));
});

test("the gauntlet runs the full double-elimination shape", () => {
  // Script: entry 3 wins the top bracket; entry 1 climbs back through the
  // bottom bracket; the top side takes the championship in one game.
  const alliances = sevenAlliances();
  // Simple scoring: the scripted winner of a matchup scores 100, others 50 —
  // but bottom and top share weeks, so score by (allianceId, week) table.
  const table = {};
  const score = (id, week, value) => { table[`${id}:${week}`] = value; };
  // Top bracket: h1 beats h2 (W2); h3 beats h1 (W3); h3 beats h4 (W4);
  // h3 beats h5 (W5); h3 beats h6 (W6); h3 beats h7 (W7).
  score("h1", 2, 100); score("h2", 2, 50);
  score("h3", 3, 100); score("h1", 3, 50);
  score("h3", 4, 100); score("h4", 4, 50);
  score("h3", 5, 100); score("h5", 5, 50);
  score("h3", 6, 100); score("h6", 6, 50);
  score("h3", 7, 100); score("h7", 7, 50);
  // Bottom bracket: W4 h2 vs h1 -> h1; W5 h1 vs h4 -> h1; W6 h1 vs h5 -> h1;
  // W7 h1 vs h6 -> h1; W8 h1 vs h7 -> h1.
  score("h2", 4, 40); score("h1", 4, 90);
  score("h1", 5, 90); score("h4", 5, 40);
  score("h1", 6, 90); score("h5", 6, 40);
  score("h1", 7, 90); score("h6", 7, 40);
  score("h1", 8, 90); score("h7", 8, 40);
  // Championship W9: h3 beats h1 -> done in one game.
  score("h3", 9, 120); score("h1", 9, 110);

  const state = runHeptadGauntlet(alliances, (id, week) => table[`${id}:${week}`] ?? null, 2);
  assert.equal(state.complete, true);
  assert.equal(state.championId, "h3");
  assert.equal(state.runnerUpId, "h1");
  assert.equal(state.matches.length, 6 + 5 + 1);
  // Everyone but the champion took two losses — the runner-up's championship
  // defeat is their second, since they already fell out of the top bracket.
  assert.deepEqual([...state.eliminatedIds].sort(), ["h1", "h2", "h4", "h5", "h6", "h7"]);
  // Pinnacle challenger: best non-finalist by wins (all had 0 bottom wins
  // except none — h2..h7 each lost twice with no wins except h2? no: h2 won
  // nothing). Ties break by points, then id.
  assert.ok(state.pinnacleChallengerId);
  assert.notEqual(state.pinnacleChallengerId, "h3");
  assert.notEqual(state.pinnacleChallengerId, "h1");
});

test("the top-bracket survivor must be beaten twice", () => {
  const alliances = sevenAlliances().slice(0, 2); // two alliances: one top game, no bottom bracket
  const table = {
    "h1:2": 100, "h2:2": 50,   // top round 1: h1 wins, h2 drops
    "h1:4": 60, "h2:4": 80,    // championship (start + count = 4): h2 wins game one
    "h1:5": 90, "h2:5": 70,    // rematch: h1 holds the title
  };
  const state = runHeptadGauntlet(alliances, (id, week) => table[`${id}:${week}`] ?? null, 2);
  assert.equal(state.complete, true);
  assert.equal(state.championId, "h1");
  assert.equal(state.matches.at(-1).bracket, "rematch");

  // And if the bottom side wins the rematch too, the crown changes hands.
  const upset = { ...table, "h1:5": 70, "h2:5": 90 };
  const flipped = runHeptadGauntlet(alliances, (id, week) => upset[`${id}:${week}`] ?? null, 2);
  assert.equal(flipped.championId, "h2");
});

test("an unplayed week pauses the gauntlet and names the next fixture", () => {
  const alliances = sevenAlliances().slice(0, 3);
  const table = { "h1:2": 100, "h2:2": 50 }; // only top round 1 played
  const state = runHeptadGauntlet(alliances, (id, week) => table[`${id}:${week}`] ?? null, 2);
  assert.equal(state.complete, false);
  assert.equal(state.championId, null);
  assert.equal(state.matches.length, 1);
  assert.deepEqual(state.next, { bracket: "top", round: 2, week: 3, homeId: "h1", awayId: "h3" });
});

test("a pause mid-top-bracket still shows the bottom-bracket games already played", () => {
  // Regression: the old two-pass walk played all top rounds before any bottom
  // round, so stalling in the top bracket hid finished bottom games. Scores
  // exist through week 5 only: top rounds 1-4 (W2-5) and bottom rounds 1-2
  // (W4-5) are all decided; the pause is top round 5 in week 6.
  const alliances = sevenAlliances();
  const table = {};
  const score = (id, week, value) => { table[`${id}:${week}`] = value; };
  score("h1", 2, 100); score("h2", 2, 50);
  score("h3", 3, 100); score("h1", 3, 50);
  score("h3", 4, 100); score("h4", 4, 50); score("h2", 4, 60); score("h1", 4, 90);
  score("h3", 5, 100); score("h5", 5, 50); score("h1", 5, 90); score("h4", 5, 40);
  const state = runHeptadGauntlet(alliances, (id, week) => table[`${id}:${week}`] ?? null, 2);
  assert.equal(state.complete, false);
  assert.equal(state.matches.filter((m) => m.bracket === "top").length, 4);
  assert.equal(state.matches.filter((m) => m.bracket === "bottom").length, 2);
  assert.deepEqual(state.next, { bracket: "top", round: 5, week: 6, homeId: "h3", awayId: "h6" });
});

test("alliance sizes that cannot fit the season are not offered", () => {
  // Forty teams in pairs would be twenty alliances — a gauntlet past week 17.
  assert.equal(allianceSizeOptions(40).includes(2), false);
  assert.deepEqual(allianceSizeOptions(40), [3, 4, 5]);
  assert.deepEqual(allianceSizeOptions(64), [5]); // 12 alliances fits; 16 does not
  assert.deepEqual(allianceSizeOptions(30), [2, 3, 4, 5]); // 15 alliances is the exact cap
  // Every offered size leaves the rematch inside the season from some start.
  for (const teams of [4, 14, 30, 40, 64]) {
    for (const size of allianceSizeOptions(teams)) {
      const settings = normalizeHeptadSettings({ allianceSize: size, startWeek: 99 }, teams);
      const schedule = heptadSchedule(heptadShape(teams, size).allianceCount, settings.startWeek);
      assert.ok(schedule.rematchWeek <= 17, `${teams} teams size ${size}: rematch W${schedule.rematchWeek}`);
    }
  }
});

test("the defaults path clamps startWeek exactly like the explicit path", () => {
  // Regression: normalize used to hand back raw defaults unclamped, so the
  // function disagreed with itself for the same league. Now every path is
  // idempotent, and an explicit max-size field clamps to the only legal start.
  for (const teams of [4, 14, 21, 30, 40, 64]) {
    const once = normalizeHeptadSettings(null, teams);
    assert.deepEqual(normalizeHeptadSettings(once, teams), once, `teams ${teams} not idempotent`);
  }
  assert.equal(normalizeHeptadSettings({ allianceSize: 2, startWeek: 2 }, 30).startWeek, 1); // 15 alliances → only week 1 fits
  assert.equal(normalizeHeptadSettings(null, 30).allianceSize, 4); // 30/4 = 7: the true-Heptad default
});

test("best ball fields one lineup per alliance and credits who supplied it", () => {
  const alliances = [
    { id: "h1", name: "A", teamIds: ["t1", "t2"], entry: 1 },
    { id: "h2", name: "B", teamIds: ["t3", "t4"], entry: 2 },
  ];
  const weeks = [
    { teamId: "t1", total: 100, starters: [{ slot: "QB", points: 30 }, { slot: "RB", points: 20 }, { slot: "RB", points: 15 }] },
    { teamId: "t2", total: 90, starters: [{ slot: "QB", points: 25 }, { slot: "RB", points: 22 }, { slot: "RB", points: 10 }] },
    { teamId: "t3", total: 80, starters: [{ slot: "QB", points: 40 }, { slot: "RB", points: 5 }, { slot: "RB", points: 4 }] },
    { teamId: "t4", total: 70, starters: [{ slot: "QB", points: 10 }, { slot: "RB", points: 8 }, { slot: "RB", points: 6 }] },
  ];
  const [first, second] = scoreHeptadWeek(alliances, weeks, "best-ball");
  assert.equal(first.allianceId, "h1");
  assert.equal(first.total, 72); // QB 30 + RB 22 + RB 20
  assert.deepEqual(first.members.map((m) => m.counted), [2, 1]);
  assert.equal(second.total, 40 + 8 + 6); // capacity stays at one roster's worth
});

test("combined scoring simply adds the members' totals", () => {
  const alliances = [{ id: "h1", name: "A", teamIds: ["t1", "t2"], entry: 1 }];
  const weeks = [
    { teamId: "t1", total: 101.55, starters: [] },
    { teamId: "t2", total: 98.46, starters: [] },
  ];
  assert.equal(scoreHeptadWeek(alliances, weeks, "combined")[0].total, 200.01);
});

test("normalize survives garbage and clamps to what the league can field", () => {
  const defaults = defaultHeptadSettings(14);
  assert.deepEqual(defaults, { allianceSize: 2, scoring: "best-ball", startWeek: 2 });
  assert.deepEqual(normalizeHeptadSettings(null, 14), defaults);
  assert.deepEqual(normalizeHeptadSettings("nope", 14), defaults);

  const wild = normalizeHeptadSettings({ allianceSize: 99, scoring: "chaos", startWeek: 99 }, 12);
  assert.equal(wild.allianceSize, 5); // 99 clamps to the cap, which 12 teams can field
  assert.equal(wild.scoring, "best-ball");
  // Start week clamps so the championship still fits inside 17 weeks.
  assert.equal(wild.startWeek, 16 - heptadShape(12, 5).allianceCount);

  assert.equal(normalizeHeptadSettings({ allianceSize: 99 }, 4).allianceSize, 2);
  // Old saved settings from the previous shape (weeks/rotatePartners) fall
  // back to a sound gauntlet instead of breaking.
  const legacy = normalizeHeptadSettings({ allianceSize: 2, scoring: "combined", weeks: [7, 14], rotatePartners: true }, 14);
  assert.deepEqual(legacy, { allianceSize: 2, scoring: "combined", startWeek: 2 });
});

}

// Canon regression cases ported from The Duat tests/heavenly-battle.test.mjs.
{
const {
  HEAVENLY_PAYOUTS,
  heavenlyBattleSchedule,
  heavenlyByeCount,
  runHeavenlyBattle,
} = Rules;

/** totalFor backed by a plain lookup: `${teamId}:${week}` → score. */
const totals = (table) => (teamId, week) => table[`${teamId}:${week}`] ?? null;

const seeds7 = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"];

/**
 * The canon week 15, scripted with two upsets: 7 beats 2, 6 beats 3, 4 holds
 * off 5. Survivors are seeds 1, 4, 6, 7.
 */
const week15 = {
  "s2:15": 80, "s7:15": 90,
  "s3:15": 70, "s6:15": 75,
  "s4:15": 88, "s5:15": 60,
};

/** Semifinals under re-seeding: 1v7 and 4v6. Seed 1 and seed 6 advance. */
const week16 = {
  "s1:16": 100, "s7:16": 50,
  "s4:16": 66, "s6:16": 77,
};

/** Championship: 6 upsets 1. Camel: 4 and 7 tie — the better seed takes it. */
const week17 = {
  "s1:17": 90, "s6:17": 95,
  "s4:17": 80, "s7:17": 80,
};

test("canon 7-team week 15: seed 1 byes while 2v7, 3v6, 4v5 play", () => {
  const state = runHeavenlyBattle(seeds7, totals(week15), 15);
  const quarters = state.matches.filter((match) => match.round === "quarterfinal");
  assert.equal(quarters.length, 3);
  assert.ok(quarters.every((match) => match.week === 15));
  assert.deepEqual(
    quarters.map((match) => [match.homeSeed, match.awaySeed]),
    [[2, 7], [3, 6], [4, 5]],
  );
  // The one seed rests: it appears in no week-15 match.
  assert.ok(quarters.every((match) => match.homeId !== "s1" && match.awayId !== "s1"));
});

test("pauses mid-bracket: with only week 15 recorded, the semifinal is named next", () => {
  const state = runHeavenlyBattle(seeds7, totals(week15), 15);
  assert.equal(state.complete, false);
  assert.equal(state.championId, null);
  assert.ok(state.next);
  assert.equal(state.next.round, "semifinal");
  assert.equal(state.next.week, 16);
  // NFL re-seeding over survivors {1, 4, 6, 7}: best (1) meets worst (7).
  assert.equal(state.next.homeId, "s1");
  assert.equal(state.next.awayId, "s7");
});

test("week 16 re-seeds NFL-style: 1v7 and 4v6 after the scripted upsets", () => {
  const state = runHeavenlyBattle(seeds7, totals({ ...week15, ...week16 }), 15);
  const semis = state.matches.filter((match) => match.round === "semifinal");
  assert.equal(semis.length, 2);
  assert.ok(semis.every((match) => match.week === 16));
  assert.deepEqual(
    semis.map((match) => [match.homeId, match.awayId]),
    [["s1", "s7"], ["s4", "s6"]],
  );
  // The final week is now owed, championship first.
  assert.equal(state.next?.round, "championship");
  assert.equal(state.next?.week, 17);
});

test("week 17 holds the championship and the Camel; podium and tie rule verified", () => {
  const state = runHeavenlyBattle(seeds7, totals({ ...week15, ...week16, ...week17 }), 15);
  const finale = state.matches.filter((match) => match.week === 17);
  assert.deepEqual(finale.map((match) => match.round).sort(), ["championship", "third-place"]);

  const championship = finale.find((match) => match.round === "championship");
  assert.equal(championship.homeId, "s1"); // better remaining seed is home
  assert.equal(championship.awayId, "s6");
  assert.equal(state.championId, "s6"); // Lord of the Duat, by upset
  assert.equal(state.runnerUpId, "s1");

  // The Camel: seeds 4 and 7 tied at 80 — the better (lower-number) seed advances.
  const camel = finale.find((match) => match.round === "third-place");
  assert.equal(camel.homeScore, camel.awayScore);
  assert.equal(state.thirdPlaceId, "s4");

  assert.equal(state.next, null);
  assert.equal(state.complete, true);
});

test("a recorded championship crowns its winner while the Camel waits", () => {
  // Week 17 scores exist only for the finalists; the third-place pair is null.
  const partial = { ...week15, ...week16, "s1:17": 90, "s6:17": 95 };
  const state = runHeavenlyBattle(seeds7, totals(partial), 15);
  assert.equal(state.championId, "s6");
  assert.equal(state.runnerUpId, "s1");
  assert.equal(state.thirdPlaceId, null);
  assert.equal(state.next?.round, "third-place");
  assert.equal(state.next?.week, 17);
  assert.equal(state.complete, false);
});

test("quarterfinal tie advances the better seed", () => {
  const tied = { ...week15, "s2:15": 90, "s7:15": 90 }; // 2 and 7 dead even
  const state = runHeavenlyBattle(seeds7, totals(tied), 15);
  const opener = state.matches.find((match) => match.homeSeed === 2 && match.awaySeed === 7);
  assert.equal(opener.winnerId, "s2");
});

test("6-team field: two byes, quarterfinals 3v6 and 4v5, three weeks total", () => {
  assert.equal(heavenlyByeCount(6), 2);
  const table = {
    "s3:15": 70, "s6:15": 60, // 3 holds
    "s4:15": 50, "s5:15": 65, // 5 upsets 4
    "s1:16": 90, "s5:16": 40, // re-seeded semis: 1v5, 2v3
    "s2:16": 55, "s3:16": 80,
    "s1:17": 99, "s3:17": 77, // championship
    "s2:17": 60, "s5:17": 61, // the Camel
  };
  const state = runHeavenlyBattle(seeds7.slice(0, 6), totals(table), 15);
  const quarters = state.matches.filter((match) => match.round === "quarterfinal");
  assert.deepEqual(quarters.map((match) => [match.homeSeed, match.awaySeed]), [[3, 6], [4, 5]]);
  assert.ok(quarters.every((match) => match.week === 15));

  const semis = state.matches.filter((match) => match.round === "semifinal");
  assert.deepEqual(semis.map((match) => [match.homeId, match.awayId]), [["s1", "s5"], ["s2", "s3"]]);

  assert.equal(state.championId, "s1");
  assert.equal(state.runnerUpId, "s3");
  assert.equal(state.thirdPlaceId, "s5");
  assert.equal(state.complete, true);
});

test("4-team field compresses to two weeks: semis at 15, finale at 16", () => {
  assert.equal(heavenlyByeCount(4), 0);
  const table = {
    "s1:15": 90, "s4:15": 40,
    "s2:15": 50, "s3:15": 70,
    "s1:16": 88, "s3:16": 60, // championship, week 16
    "s2:16": 30, "s4:16": 45, // third place, week 16
  };
  const state = runHeavenlyBattle(seeds7.slice(0, 4), totals(table), 15);
  const semis = state.matches.filter((match) => match.round === "semifinal");
  assert.deepEqual(semis.map((match) => [match.homeSeed, match.awaySeed, match.week]), [[1, 4, 15], [2, 3, 15]]);
  const finale = state.matches.filter((match) => match.week === 16);
  assert.deepEqual(finale.map((match) => match.round).sort(), ["championship", "third-place"]);
  assert.equal(state.championId, "s1");
  assert.equal(state.runnerUpId, "s3");
  assert.equal(state.thirdPlaceId, "s4");
  assert.equal(state.complete, true);
});

test("schedule mirrors the canon calendar and the compressed shapes", () => {
  assert.deepEqual(heavenlyBattleSchedule(7, 15), [
    { round: "quarterfinal", week: 15, games: 3 },
    { round: "semifinal", week: 16, games: 2 },
    { round: "championship", week: 17, games: 1 },
    { round: "third-place", week: 17, games: 1 },
  ]);
  assert.deepEqual(heavenlyBattleSchedule(4, 15).map((entry) => entry.week), [15, 16, 16]);
  assert.deepEqual(heavenlyBattleSchedule(2, 15), [{ round: "championship", week: 15, games: 1 }]);
  assert.equal(heavenlyByeCount(7), 1);
  assert.equal(heavenlyByeCount(8), 0);
  assert.equal(heavenlyByeCount(3), 1);
});

test("fields below two return the same inert state reference", () => {
  const noScores = () => null;
  const empty = runHeavenlyBattle([], noScores, 15);
  assert.equal(runHeavenlyBattle(["s1"], noScores, 15), empty);
  assert.equal(empty.complete, false);
  assert.equal(empty.next, null);
  assert.equal(empty.matches.length, 0);
});

test("canon payouts stand: 135 / 60 / 35", () => {
  assert.deepEqual(HEAVENLY_PAYOUTS, { champion: 135, runnerUp: 60, third: 35 });
});

}
