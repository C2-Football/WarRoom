'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

test('packed Duat Edge archive preserves every normalized source record and reuses indexes', async () => {
    const root = path.resolve(__dirname, '..');
    execFileSync(process.execPath, ['scripts/build-duat-server.cjs'], { cwd: root, stdio: 'pipe' });
    const runtime = await import(pathToFileURL(path.join(root, 'supabase/functions/duat/runtime.js')));
    const full = await runtime.loadData(runtime.availableSeasons);
    const parsed = runtime.App.TimeLeagueSeason.parseGameLogCsv(fs.readFileSync(path.join(root, 'data/duat/nflverse-game-logs.csv'), 'utf8'));
    assert.equal(parsed.skippedRows, 0);
    assert.equal(full.logIndex.size, parsed.logs.length);
    for (const log of parsed.logs) {
        const key = runtime.App.TimeLeagueSeason.gameLogKey(log.identity, log.season, log.week);
        assert.deepEqual(full.logIndex.get(key), log, key + ' must preserve stats, identity and source week');
    }
    const again = await runtime.loadData([...runtime.availableSeasons].reverse());
    assert.equal(again.logIndex, full.logIndex, 'a repeated room read must reuse the completed index');
    const selected = await runtime.loadData([2025]);
    assert([...selected.logIndex.values()].every(log => log.season === 2025));
    assert.equal(selected.logIndex.size, parsed.logs.filter(log => log.season === 2025).length);
    assert.equal((await runtime.loadData([2025])).logIndex, selected.logIndex);
    await assert.rejects(() => runtime.loadData([2025, 2025]), /unique/);
    await assert.rejects(() => runtime.loadData([2026]), /complete/);
    assert.equal((await runtime.loadData(runtime.availableSeasons)).logIndex, full.logIndex, 'other room years cannot corrupt the full archive');
});
