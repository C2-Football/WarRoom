// Bundle the SAME engine/data for Edge. Index logs at build time and compress
// each week separately: a draft request must not parse 216,000 historical logs.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const root = path.resolve(__dirname, '..');
const modules = ['roster', 'helmet', 'rules', 'draft-room', 'era-rules', 'season', 'player-cards', 'engine', 'player-stats', 'rivals', 'ai', 'actions', 'public-state'];
const source = modules.map(name => fs.readFileSync(path.join(root, `js/shared/time-league-${name}.js`), 'utf8')).join('\n');
const pack = value => zlib.gzipSync(Buffer.from(JSON.stringify(value))).toString('base64');
const read = file => fs.readFileSync(path.join(root, 'data/time-league', file), 'utf8');
const [header, ...lines] = read('nflverse-game-logs.csv').trim().split(/\r?\n/);
// This vendored export contains no quoted/multiline cells. Fail explicitly if
// its format changes instead of silently grouping a log into the wrong week.
if (lines.some(line => line.includes('"'))) throw new Error('Game-log export now needs a quoted CSV parser.');
const weekColumn = header.split(',').indexOf('week');
if (weekColumn < 0) throw new Error('Game-log week column is missing.');
const weeks = {};
for (const line of lines) (weeks[line.split(',')[weekColumn]] ||= []).push(line);
const packedWeeks = Object.fromEntries(Object.entries(weeks).map(([week, rows]) => [week, pack([header, ...rows].join('\n'))]));
const packedCards = pack(JSON.parse(read('player-cards.json')));
const packedLegacyCards = pack(JSON.parse(read('legacy-player-cards.json')));
global.window = globalThis;
for (const moduleName of ['roster', 'draft-room', 'season']) require(path.join(root, `js/shared/time-league-${moduleName}.js`));
const fullLogs = global.App.TimeLeagueSeason.parseGameLogCsv(read('regular-season-game-logs.csv')).logs;
const pools = new Map();
for (const log of fullLogs) {
 const key = `${log.identity}:${log.season}`;
 if (!pools.has(key)) pools.set(key, []);
 pools.get(key).push(log);
}
const coreStats = ['passYd', 'passTd', 'passInt', 'rushYd', 'rushTd', 'rec', 'recYd', 'recTd', 'fumblesLost', 'twoPointConversions'];
// Edition identity and ten fixed stat names need not be repeated in every
// compressed game row. Expand only the requested editions inside the worker.
const packedPools = Object.fromEntries([...pools].map(([key, logs]) => [key, pack({
 p: logs[0].position, g: Math.max(...logs.map(log => log.scheduledGames || 0)),
 r: logs.map(log => [log.week, coreStats.map(stat => log.stats[stat] || 0), log.stats.extra || null,
  log.sourceGameId || '', log.team || '', log.opponent || '', log.gameDate || '', log.historicalWeek || null]),
})]));
const fullFactors = JSON.parse(read('regular-season-era-factors.json')).factors;
const factors = JSON.parse(read('era-factors.json')).factors;
fs.writeFileSync(path.join(root, 'supabase/functions/time-league/runtime.js'), source + `
export const App = globalThis.App;
const weekData = ${JSON.stringify(packedWeeks)};
const eraFactors = new Map(Object.entries(${JSON.stringify(factors)}));
const fullEraFactors = new Map(Object.entries(${JSON.stringify(fullFactors)}));
const gamePools = ${JSON.stringify(packedPools)};
const coreStats = ${JSON.stringify(coreStats)};
async function unpack(base64) {
 const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
 return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}
const cardPromises = new Map();
const poolCache = new Map();
export async function loadData(week = 0, gameDeckVersion = 0) {
 if (!cardPromises.has(gameDeckVersion)) cardPromises.set(gameDeckVersion, unpack(gameDeckVersion === 1 ? '${packedCards}' : '${packedLegacyCards}').then(data => App.TimeLeaguePlayerCards.buildPlayerCardIndex(data)));
 const cards = await cardPromises.get(gameDeckVersion);
 const logIndex = gameDeckVersion !== 1 && weekData[week] ? App.TimeLeagueSeason.buildGameLogIndex(App.TimeLeagueSeason.parseGameLogCsv(await unpack(weekData[week])).logs) : new Map();
 return { cards, logIndex, eraFactors: gameDeckVersion === 1 ? fullEraFactors : eraFactors };
}
export async function loadGamePools(data, state) {
 if (state.settings.gameDeckVersion !== 1 || state.phase === 'draft') return data;
 const keys = new Set(state.teams.flatMap(team => team.roster).map(entry => App.TimeLeagueSeason.editionKey(entry)));
 for (const [identity, season] of Object.entries(state.privateDraws?.waiver?.seasons || {})) keys.add(identity + ':' + season);
 const logs = [];
 // Bounded parallelism keeps decompression buffers small on the Edge runtime.
 const pending = [...keys];
 for (let offset = 0; offset < pending.length; offset += 20) {
  const batch = await Promise.all(pending.slice(offset, offset + 20).map(async key => {
   if (!gamePools[key]) return [];
   if (!poolCache.has(key)) {
    const packed = await unpack(gamePools[key]);
    const split = key.lastIndexOf(':'), identity = key.slice(0, split), season = Number(key.slice(split + 1));
    poolCache.set(key, packed.r.map(row => ({ identity, season, position: packed.p, week: row[0], scheduledGames: packed.g,
     stats: { ...Object.fromEntries(coreStats.map((stat, i) => [stat, row[1][i]])), ...(row[2] ? { extra: row[2] } : {}) },
     sourceGameId: row[3], team: row[4], opponent: row[5], gameDate: row[6], historicalWeek: row[7] })));
   }
   return poolCache.get(key);
  }));
  for (const pool of batch) logs.push(...pool);
 }
 while (poolCache.size > 1500) poolCache.delete(poolCache.keys().next().value);
 const logIndex = App.TimeLeagueSeason.buildGameLogIndex(logs);
 logIndex.dataset = 'full-regular-season-v1';
 return { ...data, logIndex };
}
`);
console.log('Vault server runtime built with legacy weeks and full regular-season pools by player edition.');
