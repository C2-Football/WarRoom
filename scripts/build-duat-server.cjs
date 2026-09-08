'use strict';
// The same Duat rules run in the browser and Edge. Pack logs by season so each
// room loads only its four historical years, including sacred Weeks 15–17.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, 'data/duat', name), 'utf8');
const modules = [
    'js/shared/time-league-roster.js', 'js/shared/time-league-draft-room.js',
    'js/shared/time-league-season.js', 'js/shared/time-league-player-cards.js',
    'js/duat/rules.js', 'js/duat/world.js', 'js/duat/army-generation.js', 'js/duat/conquest.js',
    'js/duat/favors.js', 'js/duat/campaign.js',
];
const source = modules.map(name => fs.readFileSync(path.join(root, name), 'utf8')).join('\n');
const pack = value => zlib.gzipSync(Buffer.from(JSON.stringify(value))).toString('base64');
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
export async function loadData(seasons) {
 if (!Array.isArray(seasons) || seasons.length !== 4 || new Set(seasons).size !== 4 || seasons.some(year => !availableSeasons.includes(year))) throw new Error('Choose four complete historical seasons.');
 const cards = await (cardsPromise ||= unpack('${pack(cards)}').then(data => App.TimeLeaguePlayerCards.buildPlayerCardIndex(data)));
 const chunks = await Promise.all(seasons.map(year => unpack(seasonData[year])));
 const logs = chunks.flatMap(csv => App.TimeLeagueSeason.parseGameLogCsv(csv).logs);
 return { cards, logIndex: App.TimeLeagueSeason.buildGameLogIndex(logs), manifest, availableSeasons };
}
`;
const target = path.join(root, 'supabase/functions/duat/runtime.js');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, runtime);
console.log('Duat Edge runtime built with ' + availableSeasons.length + ' complete historical seasons; each room loads four.');
