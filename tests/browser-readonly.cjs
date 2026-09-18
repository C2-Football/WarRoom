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
  console.log('PASS browser mutation isolation: all external write methods denied before fixtures, local preflight, sanitized diagnostics');
})().catch(error => { console.error(error); process.exitCode = 1; });
