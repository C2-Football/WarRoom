'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
(async () => {
 const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-pools-'));
 try {
  const modulePath = path.join(temp, 'runtime.mjs');
  fs.copyFileSync('supabase/functions/time-league/runtime.js', modulePath);
  const { App, loadData, loadGamePools } = await import(pathToFileURL(modulePath).href);
  const data = await loadData(0, 1), S = App.TimeLeagueSeason;
  const selections = [['Patrick Mahomes', 2018], ['Josh Allen', 2023], ['Dan Marino', 1984], ['Adam Vinatieri', 2006]];
  const entries = selections.map(([name, drawnSeason]) => {
   const card = [...data.cards.values()].find(row => row.name === name);
   assert(card?.seasons.some(row => row.season === drawnSeason), name + ' fixture exists');
   return { identity: card.identity, name, position: card.position, drawnSeason };
  });
  const state = { leagueId: 'pool-test', seed: 'pool-private', phase: 'season', settings: { gameDeckVersion: 1 }, teams: [{ roster: entries.slice(0, 2) }],
   privateDraws: { waiver: { seasons: Object.fromEntries(entries.slice(2).map(row => [row.identity, row.drawnSeason])) } } };
  const pooled = await loadGamePools(data, state);
  assert(pooled.logIndex.size > 55 && pooled.logIndex.size < 75, 'Only the four selected full season pools are loaded');
  assert.equal(pooled.logIndex.dataset, 'full-regular-season-v1');
  const lines = [], reader = readline.createInterface({ input: fs.createReadStream('data/time-league/regular-season-game-logs.csv'), crlfDelay: Infinity });
  let header, yearColumn;
  for await (const line of reader) {
   if (!header) { header = line; yearColumn = line.split(',').indexOf('season'); lines.push(line); continue; }
   const cells = line.split(',');
   if (selections.some(([name, season]) => cells[0] === name && Number(cells[yearColumn]) === season)) lines.push(line);
  }
  const browser = S.buildGameLogIndex(S.parseGameLogCsv(lines.join('\n')).logs);
  assert.equal(pooled.logIndex.size, browser.size);
  const replayState = { ...state }; delete replayState.privateDraws;
  for (const entry of entries) {
   assert.deepEqual(S.gameDeck(replayState, entry, pooled.logIndex, 14).map(row => row?.week), S.gameDeck(replayState, entry, browser, 14).map(row => row?.week), 'Client and Edge select identical full-source games');
   for (const log of S.sourceGames(entry, browser)) {
    const actual = pooled.logIndex.get(S.gameLogKey(entry.identity, entry.drawnSeason, log.week));
    assert.deepEqual(actual.stats, log.stats); assert.equal(actual.scheduledGames, log.scheduledGames);
    assert.equal(actual.sourceGameId, log.sourceGameId);
   }
  }
  assert.equal(S.sourceGames(entries[0], pooled.logIndex).length, 16);
  assert.equal(S.sourceGames(entries[1], pooled.logIndex).length, 17);
  assert(S.sourceGames(entries[1], pooled.logIndex).some(row => row.week === 18), 'The Edge loader includes NFL week18');
  // Exercise the generated Edge module, not only the browser source helper.
  const clueEntry = { ...entries[0], entryId: 'p1', editionId: `mystery:${entries[0].identity}`, slot: 'QB' };
  const clueBase = App.TimeLeagueEngine.createTimeLeague({ name: 'Edge mystery clues', seed: 'edge-clue-seed',
   seats: [{ name: 'Home', manager: 'human' }, { name: 'Away', manager: 'human' }], settings: {
    gameDeckVersion: 1, hiddenYears: true, regularSeasonWeeks: 14, playoffTeams: 0, rosterSlots: { QB: 1, BN: 1 },
    scoring: { passingYd: .04, passTd: 4, reception: .5, rushRecYd: .1, turnover: -2 }, eraRules: { mode: 'any-era', decades: [] },
   } });
  const clueState = { ...clueBase, phase: 'season', seasonsRevealed: true, currentWeek: 1, weekStage: 'lineup',
   teams: clueBase.teams.map((team, i) => ({ ...team, roster: i ? [] : [clueEntry] })) };
  const clueCards = new Map([[clueEntry.identity, data.cards.get(clueEntry.identity)]]);
  const localClue = App.TimeLeaguePlayerStats.signals(clueState, clueEntry, pooled.logIndex);
  const publicClueState = App.TimeLeaguePublicState.projectPublicState(clueState, 't1', [], clueCards, '2026-09-26T12:00:00Z', pooled);
  const remoteClue = App.TimeLeaguePlayerStats.signals(publicClueState, publicClueState.teams[0].roster[0], null);
  assert.equal(remoteClue.currentAvailable, localClue.currentAvailable);
  assert.equal(remoteClue.currentStars, localClue.currentStars, 'Generated Edge snapshots expose the same authorized current clue as the local engine');
  assert(!JSON.stringify(publicClueState).includes('drawnSeason'));
  assert(!JSON.stringify(publicClueState).includes('sourceWeek'));
  assert.equal(publicClueState.playerReports[clueEntry.editionId].maxRemainingStars, null);
  const legacy = await loadData(1, 0);
  assert(legacy.logIndex.size > 0); assert([...legacy.logIndex.values()].every(log => log.week === 1));
  assert.equal(legacy.cards.get(entries[0].identity).seasons.find(row => row.season === 2018).games, 13, 'Legacy data/card history remains isolated');
  console.log('PASS: full-game Edge pools match browser scoring/decks, include late source games, and preserve legacy week/card loading.');
 } finally { fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
