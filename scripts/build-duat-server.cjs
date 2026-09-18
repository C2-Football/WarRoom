'use strict';
// The same Duat rules run in the browser and Edge. Pack logs by season so each
// room loads only its chosen historical years, including sacred Weeks 15–17.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, 'data/duat', name), 'utf8');
const pack = value => zlib.gzipSync(Buffer.from(JSON.stringify(value))).toString('base64');
const modules = [
    'js/shared/time-league-roster.js', 'js/shared/time-league-draft-room.js',
    'js/shared/time-league-season.js', 'js/shared/time-league-player-cards.js',
    'js/duat/rules.js', 'js/duat/world.js', 'js/duat/provinces.js', 'js/duat/army-generation.js', 'js/duat/conquest.js',
    'js/duat/favors.js', 'js/duat/identity-library.js', 'js/duat/lore.js', 'js/duat/personalities.js', 'js/duat/council-state.js', 'js/duat/strategy.js', 'js/duat/rituals.js', 'js/duat/heptad.js', 'js/duat/campaign.js', 'js/duat/mystery.js', 'js/duat/dynasty.js',
];
const source = modules.map(name => {
    const code = fs.readFileSync(path.join(root, name), 'utf8');
    if (name !== 'js/duat/provinces.js') return code;
    // The Edge reducer needs the exact region metadata and routes, not drawing
    // paths. Packing this data keeps the deployment request below the API cap.
    // Await initialization before conquest captures the same lookup API.
    const start = code.indexOf('const data=') + 'const data='.length, end = code.indexOf(';const territories=', start);
    if (start < 'const data='.length || end < start || !code.includes('(function(root)')) throw new Error('Unknown generated province module format.');
    const data = JSON.parse(code.slice(start, end));
    data.TERRITORIES = data.TERRITORIES.map(({ geometry, path: drawingPath, ...territory }) => territory);
    return (code.slice(0, start) + "await unpack('" + pack(data) + "')" + code.slice(end)).replace('(function(root)', 'await (async function(root)');
}).join('\n');
const csv = read('nflverse-game-logs.csv');
const [header, ...lines] = csv.trim().split(/\r?\n/);
if (lines.some(line => line.includes('"'))) throw new Error('Duat game logs now require a quoted CSV parser.');
const columns = header.split(',');
const yearIndex = columns.indexOf('season'), weekIndex = columns.indexOf('week');
if (yearIndex < 0 || weekIndex < 0) throw new Error('Duat logs require season and week columns.');
const grouped = {}, coverage = {};
for (const line of lines) {
    const cells = line.split(',');
    const season = Number(cells[yearIndex]), week = Number(cells[weekIndex]);
    if (!Number.isInteger(season) || !Number.isInteger(week) || week < 1 || week > 17) throw new Error('Invalid historical campaign log.');
    (grouped[season] ||= []).push(line);
    (coverage[season] ||= new Set()).add(week);
}
const availableSeasons = Object.keys(coverage).map(Number).filter(season => coverage[season].size === 17).sort((a, b) => a - b);
if (availableSeasons.length < 4) throw new Error('Duat requires at least four complete seasons through Week 17.');
// Parse and normalize during the build, not in every Edge isolate. Shared
// identity strings and numeric rows avoid 24 concurrent CSV parser working sets.
const parsing = {};
vm.runInNewContext(modules.slice(0, 4).map(name => fs.readFileSync(path.join(root, name), 'utf8')).join('\n'), parsing);
const Season = parsing.App.TimeLeagueSeason;
const seasonData = Object.fromEntries(availableSeasons.map(season => {
    const { logs, skippedRows } = Season.parseGameLogCsv([header, ...grouped[season]].join('\n'));
    if (skippedRows) throw new Error('The Duat archive contains unparsed source rows.');
    const players = [], playerIds = new Map(), fields = Object.keys(Season.emptyStatLine());
    const rows = logs.map(log => {
        if (Object.keys(log).some(key => !['identity', 'name', 'position', 'season', 'week', 'stats'].includes(key))
            || Object.keys(log.stats).some(key => !fields.includes(key))
            || fields.some(key => !Number.isFinite(log.stats[key]))) throw new Error('Duat archive shape changed; extend the packed format before shipping.');
        if (!playerIds.has(log.identity)) { playerIds.set(log.identity, players.length); players.push([log.identity, log.name, log.position]); }
        return [playerIds.get(log.identity), log.week, ...fields.map(key => log.stats[key])];
    });
    return [season, pack({ players, fields, rows })];
}));
const cards = JSON.parse(read('player-cards.json'));
const manifest = JSON.parse(read('manifest.json'));
const runtime = source + `
export const App = globalThis.App;
export const availableSeasons = ${JSON.stringify(availableSeasons)};
const manifest = ${JSON.stringify(manifest)};
const seasonData = ${JSON.stringify(seasonData)};
async function unpack(base64) {
 const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
 return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}
let cardsPromise;
const seasonPromises = new Map();
const dataPromises = new Map();
async function loadSeason(year) {
 if (!seasonPromises.has(year)) {
  const promise = unpack(seasonData[year]).then(({players, fields, rows}) => {
   const index = new Map();
   for (const row of rows) {
    const [identity, name, position] = players[row[0]], week = row[1], stats = {};
    for (let i = 0; i < fields.length; i++) stats[fields[i]] = row[i + 2];
    index.set(App.TimeLeagueSeason.gameLogKey(identity, year, week), {identity, name, position, season: year, week, stats});
   }
   return index;
  }).catch(error => { seasonPromises.delete(year); throw error; });
  seasonPromises.set(year, promise);
 }
 return seasonPromises.get(year);
}
export async function loadData(seasons) {
 if (!Array.isArray(seasons) || seasons.length < 1 || seasons.length > 24 || new Set(seasons).size !== seasons.length || seasons.some(year => !availableSeasons.includes(year))) throw new Error('Choose unique complete historical seasons (up to 24).');
 const years = [...seasons].sort((a,b) => a-b), key = years.join(',');
 if (!dataPromises.has(key)) {
  const promise = (async () => {
   const cards = await (cardsPromise ||= unpack('${pack(cards)}').then(data => App.TimeLeaguePlayerCards.buildPlayerCardIndex(data)).catch(error => { cardsPromise = null; throw error; }));
   // Keep only one decompressed numeric chunk transient at a time. Reuse the
   // finished index on every action/read instead of rebuilding 127k keys.
   let logIndex;
   if (years.length === 1) logIndex = await loadSeason(years[0]);
   else { logIndex = new Map(); for (const year of years) for (const [id, log] of await loadSeason(year)) logIndex.set(id, log); }
   return { cards, logIndex, manifest, availableSeasons };
  })().catch(error => { dataPromises.delete(key); throw error; });
  dataPromises.set(key, promise);
  // Season maps share their records; cap aggregate index variants per isolate.
  if (dataPromises.size > 4) dataPromises.delete(dataPromises.keys().next().value);
 }
 return dataPromises.get(key);
}
`;
const target = path.join(root, 'supabase/functions/duat/runtime.js');
fs.mkdirSync(path.dirname(target), { recursive: true });
// Both online suites build the shared bundle concurrently. Readers must never
// observe a truncated module while another process publishes the same output.
const temporaryTarget = target + '.' + process.pid + '.tmp';
fs.writeFileSync(temporaryTarget, runtime);
fs.renameSync(temporaryTarget, target);
console.log('Duat Edge runtime built with ' + availableSeasons.length + ' complete historical seasons; each room loads its chosen years.');
