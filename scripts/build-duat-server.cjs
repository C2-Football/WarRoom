'use strict';
// The same Duat rules run in the browser and Edge. Pack logs by season so each
// room loads only its chosen historical years, including sacred Weeks 15–17.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, 'data/duat', name), 'utf8');
const pack = value => zlib.gzipSync(Buffer.from(JSON.stringify(value))).toString('base64');
const modules = [
    'js/shared/time-league-roster.js', 'js/shared/time-league-draft-room.js',
    'js/shared/time-league-season.js', 'js/shared/time-league-player-cards.js',
    'js/duat/rules.js', 'js/duat/world.js', 'js/duat/provinces.js', 'js/duat/army-generation.js', 'js/duat/conquest.js',
    'js/duat/favors.js', 'js/duat/identity-library.js', 'js/duat/lore.js', 'js/duat/rituals.js', 'js/duat/heptad.js', 'js/duat/campaign.js', 'js/duat/dynasty.js',
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
const seasonData = Object.fromEntries(availableSeasons.map(season => [season, pack([header, ...grouped[season]].join('\n'))]));
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
export async function loadData(seasons) {
 if (!Array.isArray(seasons) || seasons.length < 1 || seasons.length > 24 || new Set(seasons).size !== seasons.length || seasons.some(year => !availableSeasons.includes(year))) throw new Error('Choose unique complete historical seasons (up to 24).');
 const cards = await (cardsPromise ||= unpack('${pack(cards)}').then(data => App.TimeLeaguePlayerCards.buildPlayerCardIndex(data)));
 const chunks = await Promise.all(seasons.map(year => {
  if (!seasonPromises.has(year)) seasonPromises.set(year, unpack(seasonData[year]).then(csv => App.TimeLeagueSeason.parseGameLogCsv(csv).logs));
  return seasonPromises.get(year);
 }));
 const logs = chunks.flat();
 return { cards, logIndex: App.TimeLeagueSeason.buildGameLogIndex(logs), manifest, availableSeasons };
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
