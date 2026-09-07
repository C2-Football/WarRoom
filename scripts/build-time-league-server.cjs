// Bundle the SAME engine/data for Edge. Index logs at build time and compress
// each week separately: a draft request must not parse 216,000 historical logs.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const root = path.resolve(__dirname, '..');
const modules = ['roster', 'helmet', 'rules', 'draft-room', 'era-rules', 'season', 'player-cards', 'engine', 'ai', 'actions'];
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
const factors = JSON.parse(read('era-factors.json')).factors;
fs.writeFileSync(path.join(root, 'supabase/functions/time-league/runtime.js'), source + `
export const App = globalThis.App;
const weekData = ${JSON.stringify(packedWeeks)};
const eraFactors = new Map(Object.entries(${JSON.stringify(factors)}));
async function unpack(base64) {
 const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
 return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}
let cardsPromise;
export async function loadData(week = 0) {
 const cards = await (cardsPromise ||= unpack('${packedCards}').then(data => App.TimeLeaguePlayerCards.buildPlayerCardIndex(data)));
 const logIndex = weekData[week] ? App.TimeLeagueSeason.buildGameLogIndex(App.TimeLeagueSeason.parseGameLogCsv(await unpack(weekData[week])).logs) : new Map();
 return { cards, logIndex, eraFactors };
}
`);
console.log('Vault server runtime built with historical logs indexed by week.');
