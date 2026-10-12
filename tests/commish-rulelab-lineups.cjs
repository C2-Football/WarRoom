'use strict';

// Exercise the real shared Sleeper helper over local HTTP. No live service
// requests: only the origin is redirected; its 404/error parsing is retained.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const RuleLab = require('../js/shared/commish-rulelab.js');
const nativeFetch = globalThis.fetch;
const previousMatchups = globalThis.fetchMatchups;
const sharedSource = fs.readFileSync(path.join(__dirname, '..', 'reconai-shared', 'sleeper-api.js'), 'utf8');
const rows = [
    { roster_id: 1, matchup_id: 1, points: 10, starters: ['p1'], players: ['p1', 'p3'] },
    { roster_id: 2, matchup_id: 1, points: 11, starters: ['p2'], players: ['p2'] },
];
let mode = 'healthy', requests = [], passed = 0;
const server = http.createServer((request, response) => {
    const week = Number(request.url.split('/').pop());
    requests.push(week);
    if (week === 2 && mode === 'network') { response.destroy(); return; }
    response.setHeader('content-type', 'application/json');
    if (week === 2 && mode === 'http') { response.statusCode = 503; response.end('{}'); return; }
    if (week === 2 && mode === 'not-found') { response.statusCode = 404; response.end('{}'); return; }
    response.end(JSON.stringify(week === 2 && mode === 'malformed' ? { error: 'unavailable' }
        : week === 2 && mode === 'bad-row' ? [{ points: 100 }]
            : week > 2 ? [] : rows));
});

async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const context = vm.createContext({ window: { App: {} }, console, URL, Date,
        fetch: url => nativeFetch(origin + new URL(url).pathname),
    });
    vm.runInContext(sharedSource, context);
    globalThis.fetchMatchups = context.window.fetchMatchups;
    try {
        await test('one failed weekly HTTP request rejects the full lineup load; retry returns every played week', async () => {
            mode = 'http';
            await assert.rejects(RuleLab.loadSeasonLineups('fixture', [1, 2]), /Sleeper API error: 503/);
            mode = 'healthy';
            const recovered = await RuleLab.loadSeasonLineups('fixture', [1, 2]);
            assert.deepEqual(Object.keys(recovered).sort(), ['1', '2']);
            assert.deepEqual(JSON.parse(JSON.stringify(recovered[2][0])), {
                rosterId: 1, matchupId: 1, points: 10, starters: ['p1'], players: ['p1', 'p3'],
            });
        });
        await test('a network failure rejects rather than turning the failed week into unplayed data', async () => {
            mode = 'network';
            await assert.rejects(RuleLab.loadSeasonLineups('fixture', [1, 2]), /fetch failed/);
        });
        await test('a 404 parsed as null by the actual shared helper is unavailable, not an empty week', async () => {
            mode = 'not-found';
            await assert.rejects(RuleLab.loadSeasonLineups('fixture', [1, 2]), /Week 2 lineups are unavailable/);
        });
        await test('malformed HTTP200 payloads and matchup rows reject the season load', async () => {
            mode = 'malformed';
            await assert.rejects(RuleLab.loadSeasonLineups('fixture', [1, 2]), /Week 2 lineups are unavailable/);
            mode = 'bad-row';
            await assert.rejects(RuleLab.loadSeasonLineups('fixture', [1, 2]), /Week 2 lineups were not valid matchup rows/);
        });
        await test('valid HTTP200 empty arrays remain unplayed and do not prevent a healthy replay load', async () => {
            mode = 'healthy';
            const data = await RuleLab.loadSeasonLineups('fixture', [1, 2, 3]);
            assert.deepEqual(Object.keys(data).sort(), ['1', '2']);
        });
        await test('explicit empty week selection makes no requests; omitted selection retains the18-week default', async () => {
            requests = [];
            assert.deepEqual(await RuleLab.loadSeasonLineups('fixture', []), {});
            assert.equal(requests.length, 0);
            await RuleLab.loadSeasonLineups('fixture');
            assert.deepEqual(requests.sort((a, b) => a - b), Array.from({ length: 18 }, (_, i) => i + 1));
        });
        await test('missing global fetcher retains the existing empty result contract', async () => {
            delete globalThis.fetchMatchups;
            assert.deepEqual(await RuleLab.loadSeasonLineups('fixture', [1]), {});
        });
        console.log('PASS ' + passed + ' lineup recovery groups');
    } finally {
        if (previousMatchups === undefined) delete globalThis.fetchMatchups; else globalThis.fetchMatchups = previousMatchups;
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
