// Regression tests preserved from the Duat ruler engine at ada801d.
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DUAT_ORIGINAL_D20_BANDS,
  ROSTER_PRESETS,
  createArmyRollBands,
  createLotteryRevealOrder,
  createRosterRevealSequence,
  generateProportionalArmies,
  importArchivedArmies,
  importProviderArmies,
  normalizePriorArmyCount,
  normalizeRosterSlots,
  summarizeRosterSlots,
} = require("../js/duat/army-generation.js");

const teams = Array.from({ length: 4 }, (_, index) => ({
  id: `team-${index + 1}`,
  name: `Faction ${index + 1}`,
}));

function playerPool(seasons = [2025, 2024, 2023, 2022]) {
  const shape = { QB: 8, RB: 30, WR: 36, TE: 20 };
  return seasons.flatMap((season) => Object.entries(shape).flatMap(([position, count]) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${season}-${position}-${index}`,
      name: `${position} ${index}`,
      position,
      season,
      fantasyPoints: count - index + 1,
    })),
  ));
}

test("authentic Original Duat formation is four eight-player armies with exact d20 bands", () => {
  assert.deepEqual(DUAT_ORIGINAL_D20_BANDS, [
    { min: 1, max: 5, label: "1–5" },
    { min: 6, max: 10, label: "6–10" },
    { min: 11, max: 15, label: "11–15" },
    { min: 16, max: 20, label: "16–20" },
  ]);
  assert.deepEqual(createArmyRollBands(4), DUAT_ORIGINAL_D20_BANDS);
  assert.equal(normalizePriorArmyCount(100), 8);
  assert.deepEqual(summarizeRosterSlots(ROSTER_PRESETS["duat-original"]), {
    starters: 5,
    bench: 3,
    injuredReserve: 0,
    taxi: 0,
    activeRoster: 8,
    totalCapacity: 8,
  });
  assert.equal(ROSTER_PRESETS["duat-original"].QB, 1);
  assert.equal(ROSTER_PRESETS["duat-original"].FLEX, 4);
  assert.equal(ROSTER_PRESETS["duat-original"].BN, 3);
});

test("provider position aliases normalize to canonical configurable slots", () => {
  const slots = normalizeRosterSlots(["QB", "RB", "RB", "WR", "TE", "W/R/T", "OP", "BE", "D/ST", "TAXI"]);
  assert.equal(slots.QB, 1);
  assert.equal(slots.RB, 2);
  assert.equal(slots.FLEX, 1);
  assert.equal(slots.SUPER_FLEX, 1);
  assert.equal(slots.BN, 1);
  assert.equal(slots.DEF, 1);
  assert.equal(slots.TAXI, 1);
});

test("provider history preserves player position labels in ruler rosters", () => {
  const result = importProviderArmies([teams[0]], [{
    provider: "sleeper",
    leagueId: "123456",
    season: 2025,
    rosters: [{ teamId: teams[0].id, teamName: teams[0].name, players: [
      { id: "qb-1", name: "Quarterback", position: "QB" },
      { id: "db-1", name: "Defensive Back", position: "DB" },
    ] }],
  }], { historyCount: 2, seed: "provider-slots" });
  assert.deepEqual(result.armies[0].roster.map((player) => player.assignedSlot), ["QB", "DB"]);
});

test("lottery order is a deterministic weighted permutation", () => {
  const first = createLotteryRevealOrder(teams, "opening-night");
  const repeat = createLotteryRevealOrder(teams, "opening-night");
  const changed = createLotteryRevealOrder(teams, "another-season");
  assert.deepEqual(first, repeat);
  assert.notDeepEqual(first, changed);
  assert.deepEqual([...first.map((entry) => entry.teamId)].sort(), teams.map((team) => team.id).sort());
  assert.equal(first.reduce((total, entry) => total + entry.initialOdds, 0), 1);
});

test("proportional generator produces deterministic, exclusive four-army decks", () => {
  const input = {
    teams,
    players: playerPool(),
    rosterSlots: ROSTER_PRESETS["duat-original"],
    historyCount: 4,
    seed: "buried-rulers-2026",
    currentSeason: 2026,
  };
  const first = generateProportionalArmies(input);
  const repeat = generateProportionalArmies(input);
  const changed = generateProportionalArmies({ ...input, seed: "buried-rulers-2027" });

  assert.deepEqual(first, repeat);
  assert.notDeepEqual(first.armies, changed.armies);
  assert.deepEqual(first.seasons, [2025, 2024, 2023, 2022]);
  assert.equal(first.armies.length, teams.length * 4);
  assert.equal(first.shortfalls.length, 0);
  for (const army of first.armies) {
    assert.equal(army.roster.length, 8);
    assert.equal(army.roster.filter((player) => player.assignedSlot === "QB").length, 1);
    assert.equal(army.roster.filter((player) => player.assignedSlot === "FLEX").length, 4);
    assert.equal(army.roster.filter((player) => player.assignedSlot === "BN").length, 3);
  }
  for (const season of first.seasons) {
    const ids = first.armies.filter((army) => army.season === season).flatMap((army) => army.roster.map((player) => player.id));
    assert.equal(new Set(ids).size, ids.length, `players are exclusive within ${season}`);
  }
  assert.equal(createRosterRevealSequence(first).length, teams.length);
});

test("prior army count clamps to 0-8 so the feature can be turned off", () => {
  assert.equal(normalizePriorArmyCount(-3), 0);
  assert.equal(normalizePriorArmyCount(0), 0);
  assert.equal(normalizePriorArmyCount(1), 1);
  assert.equal(normalizePriorArmyCount(2.7), 2);
  assert.equal(normalizePriorArmyCount(99), 8);
  assert.equal(normalizePriorArmyCount(Number.NaN), 4);
  assert.equal(normalizePriorArmyCount(undefined), 4);
  assert.equal(normalizePriorArmyCount("not a number"), 4);
  // Counts 2-8 keep their existing meaning exactly.
  for (const count of [2, 3, 4, 5, 6, 7, 8]) assert.equal(normalizePriorArmyCount(count), count);
});

test("roll bands cover 0, 1, and every supported multi-army deck", () => {
  assert.deepEqual(createArmyRollBands(0), []);
  assert.deepEqual(createArmyRollBands(-1), []);
  assert.deepEqual(createArmyRollBands(1), [{ min: 1, max: 20, label: "1–20" }]);
  assert.deepEqual(createArmyRollBands(2), [
    { min: 1, max: 10, label: "1–10" },
    { min: 11, max: 20, label: "11–20" },
  ]);
  assert.deepEqual(createArmyRollBands(4), DUAT_ORIGINAL_D20_BANDS);
  const eight = createArmyRollBands(8);
  assert.equal(eight.length, 8);
  for (const count of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const bands = createArmyRollBands(count);
    assert.equal(bands.length, count);
    assert.equal(bands[0].min, 1);
    assert.equal(bands[bands.length - 1].max, 20);
    for (let roll = 1; roll <= 20; roll += 1) {
      const matches = bands.filter((band) => roll >= band.min && roll <= band.max);
      assert.equal(matches.length, 1, `roll ${roll} maps to exactly one of ${count} bands`);
    }
  }
});

test("a single buried army owns the whole d20 for every roll", () => {
  const result = generateProportionalArmies({
    teams,
    players: playerPool(),
    rosterSlots: ROSTER_PRESETS["duat-original"],
    historyCount: 1,
    seed: "lone-ruler",
    currentSeason: 2026,
  });
  assert.equal(result.seasons.length, 1);
  assert.equal(result.armies.length, teams.length);
  for (const army of result.armies) {
    assert.deepEqual(army.rollBand, { min: 1, max: 20, label: "1–20" });
    for (let roll = 1; roll <= 20; roll += 1) {
      const selected = result.armies.filter((candidate) => candidate.teamId === army.teamId)
        .filter((candidate) => candidate.rollBand && roll >= candidate.rollBand.min && roll <= candidate.rollBand.max);
      assert.equal(selected.length, 1, `roll ${roll} still selects the lone army`);
      assert.equal(selected[0].id, army.id);
    }
  }
  assert.equal(createRosterRevealSequence(result).length, teams.length);
});

test("zero buried armies turns the feature off without reporting a data problem", () => {
  const off = generateProportionalArmies({
    teams,
    players: playerPool(),
    rosterSlots: ROSTER_PRESETS["duat-original"],
    historyCount: 0,
    seed: "no-rulers",
    currentSeason: 2026,
  });
  assert.deepEqual(off.armies, []);
  assert.deepEqual(off.seasons, []);
  assert.deepEqual(off.revealOrder, []);
  assert.deepEqual(off.shortfalls, []);
  assert.deepEqual(off.warnings, []);
  assert.equal(off.source, "custom");
  assert.equal(off.seed, "no-rulers");
  assert.deepEqual(createRosterRevealSequence(off), []);

  // An empty roster would normally warn; with the feature off it must not.
  const offWithoutPlayers = generateProportionalArmies({
    teams: [...teams, teams[0]],
    players: [],
    rosterSlots: {},
    historyCount: 0,
    seed: "no-rulers",
  });
  assert.deepEqual(offWithoutPlayers.warnings, []);
  assert.deepEqual(offWithoutPlayers.armies, []);
  assert.deepEqual(offWithoutPlayers.revealOrder, []);
});

test("provider and archive imports honor the off switch", () => {
  const provider = importProviderArmies(teams, [{
    provider: "sleeper",
    leagueId: "123456",
    season: 2025,
    rosters: [{ teamId: teams[0].id, teamName: teams[0].name, players: [{ id: "qb-1", name: "Quarterback", position: "QB" }] }],
  }], { historyCount: 0, seed: "provider-off" });
  assert.equal(provider.source, "sleeper");
  assert.deepEqual(provider.armies, []);
  assert.deepEqual(provider.seasons, []);
  assert.deepEqual(provider.revealOrder, []);
  assert.deepEqual(provider.warnings, []);
  assert.deepEqual(createRosterRevealSequence(provider), []);

  const archive = importArchivedArmies(teams, [{
    id: "team-1-ruler-1",
    teamId: "team-1",
    rulerNumber: 1,
    rulerName: "The First Ruler",
    kingdom: "The Buried Kingdom",
    season: 2025,
    roster: [{ id: "2025-qb-1", name: "Quarterback One", position: "QB", season: 2025, assignedSlot: "QB" }],
  }], { historyCount: 0, seed: "archive-off" });
  assert.equal(archive.source, "archive");
  assert.deepEqual(archive.armies, []);
  assert.deepEqual(archive.seasons, []);
  assert.deepEqual(archive.revealOrder, []);
  assert.deepEqual(archive.warnings, []);
  assert.deepEqual(createRosterRevealSequence(archive), []);
});

test("reveal sequence is empty whenever no armies exist", () => {
  assert.deepEqual(createRosterRevealSequence({ revealOrder: [], armies: [] }), []);
  assert.deepEqual(createRosterRevealSequence({
    revealOrder: createLotteryRevealOrder(teams, "orphan-lottery"),
    armies: [],
  }), []);
});

test("single-army provider and archive imports still band the full die", () => {
  const provider = importProviderArmies([teams[0]], [{
    provider: "sleeper",
    leagueId: "123456",
    season: 2025,
    rosters: [{ teamId: teams[0].id, teamName: teams[0].name, players: [{ id: "qb-1", name: "Quarterback", position: "QB" }] }],
  }], { historyCount: 1, seed: "provider-single" });
  assert.equal(provider.armies.length, 1);
  assert.deepEqual(provider.armies[0].rollBand, { min: 1, max: 20, label: "1–20" });

  const archive = importArchivedArmies([teams[0]], [{
    id: "team-1-ruler-1",
    teamId: "team-1",
    rulerNumber: 1,
    rulerName: "The First Ruler",
    kingdom: "The Buried Kingdom",
    season: 2025,
    roster: [{ id: "2025-qb-1", name: "Quarterback One", position: "QB", season: 2025, assignedSlot: "QB" }],
  }], { historyCount: 1, seed: "archive-single" });
  assert.equal(archive.armies.length, 1);
  assert.deepEqual(archive.armies[0].rollBand, { min: 1, max: 20, label: "1–20" });
});

test("exact archive import preserves ruler, kingdom, slot, year, and d20 band", () => {
  const deck = {
    id: "team-1-ruler-1",
    teamId: "team-1",
    rulerNumber: 1,
    rulerName: "The First Ruler",
    kingdom: "The Buried Kingdom",
    season: 2025,
    rollBand: { min: 1, max: 5, label: "1–5" },
    roster: [{
      id: "2025-qb-1",
      name: "Quarterback One",
      position: "QB",
      season: 2025,
      assignedSlot: "QB",
      fantasyPoints: 300,
    }],
  };
  const result = importArchivedArmies([teams[0]], [deck], { historyCount: 2, seed: "archive" });
  assert.equal(result.source, "archive");
  assert.equal(result.armies[0].rulerName, deck.rulerName);
  assert.equal(result.armies[0].kingdom, deck.kingdom);
  assert.deepEqual(result.armies[0].rollBand, deck.rollBand);
  assert.equal(result.armies[0].roster[0].assignedSlot, "QB");
});

test("archive import keeps each faction's own seasons instead of forcing a shared year set", () => {
  const deck = (teamId, rulerNumber, season) => ({
    id: `${teamId}-${season}`,
    teamId,
    rulerNumber,
    rulerName: `${teamId} ruler ${rulerNumber}`,
    kingdom: `${teamId} kingdom`,
    season,
    roster: [{ id: `${teamId}-${season}-qb`, name: "Quarterback", position: "QB", season, assignedSlot: "QB" }],
  });
  const decks = [deck("team-1", 1, 2017), deck("team-1", 2, 2021), deck("team-2", 1, 2018), deck("team-2", 2, 2023)];
  const result = importArchivedArmies(teams.slice(0, 2), decks, { historyCount: 2, seed: "mixed-years" });
  assert.equal(result.armies.length, 4);
  assert.deepEqual(result.armies.filter((army) => army.teamId === "team-1").map((army) => army.season), [2017, 2021]);
  assert.deepEqual(result.armies.filter((army) => army.teamId === "team-2").map((army) => army.season), [2018, 2023]);
});
