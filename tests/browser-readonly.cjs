'use strict';
const assert = require('node:assert/strict');
const { installReadOnlyRoutes } = require('./helpers/browser-readonly.cjs');
(async () => {
  let handler;
  const blocked = await installReadOnlyRoutes({ route: async (_glob, callback) => { handler = callback; } }, { fixture: () => ({ fixture: true }) });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    let response;
    await handler({ request: () => ({ url: () => 'https://example.test/functions/v1/game?secret=do-not-record', method: () => method, resourceType: () => 'fetch' }), fulfill: async value => { response = value; }, continue: () => { throw new Error('external mutation escaped'); } });
    assert.equal(response.status, 403, method + ' is denied even when a fixture exists');
  }
  assert.equal(blocked.length, 4);
  assert(blocked.every(row => row.url === 'https://example.test/functions/v1/game'), 'diagnostics exclude query strings');
  let preflight;
  await handler({ request: () => ({ url: () => 'https://example.test/api', method: () => 'OPTIONS' }), fulfill: async value => { preflight = value; }, continue: () => { throw new Error('preflight escaped'); } });
  assert.equal(preflight.status, 204);
  let read;
  await handler({ request: () => ({ url: () => 'https://example.test/api', method: () => 'GET' }), fulfill: async value => { read = value; } });
  assert.deepEqual(JSON.parse(read.body), { fixture: true });
  let snapshotHandler, fetches = 0;
  await installReadOnlyRoutes({ route: async (_glob, callback) => { snapshotHandler = callback; } }, { cachePublicReads: true });
  const sample = status => ({
    request: () => ({ url: () => 'https://api.sleeper.app/v1/state/nfl', method: () => 'GET', resourceType: () => 'fetch' }),
    fetch: async () => { fetches++; return { status: () => status, headers: () => ({ 'content-type': 'application/json', 'content-encoding': 'gzip' }), body: async () => Buffer.from('{}') }; },
    fulfill: async value => { assert.equal(value.headers['content-encoding'], undefined); }, abort: () => { throw new Error('unexpected read failure'); },
  });
  await snapshotHandler(sample(503));
  await snapshotHandler(sample(200));
  await snapshotHandler(sample(200));
  assert.equal(fetches, 2, 'failed reads retry; successful public snapshot is reused');
  console.log('PASS browser mutation isolation: external writes denied before fixtures, local preflight, sanitized diagnostics; public read failures retry');
})().catch(error => { console.error(error); process.exitCode = 1; });
