'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const load = require('./helpers/security-ts-loader.cjs');
const NOW = Date.parse('2026-09-29T12:00:00Z');
const MINUTE = 60 * 1000, HOUR = 60 * MINUTE;
const board = (kickoff, completed = false) => ({ events: [{ id: 'game', date: new Date(kickoff).toISOString(), status: { type: { completed } } }] });

function runtime({ payload = board(NOW - 2 * HOUR), age = MINUTE - 1, upstream, cache = true, writeFails = false, upstreamStatus = 200, fetchDelay = 0 } = {}) {
  let now = NOW, row = { payload, updated_at: new Date(now - age).toISOString() };
  let handler;
  const calls = [], writes = [];
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  load('supabase/functions/nfl-scoreboard/index.ts', {
    Date: Clock,
    Deno: { env: { get: () => cache ? 'synthetic-test-value' : '' }, serve: fn => { handler = fn; } },
    createClient: () => ({ from(table) {
      assert.equal(table, 'nfl_week_context');
      return {
        select(fields) { assert.equal(fields, 'payload, updated_at'); return this; },
        eq(field, value) { assert.equal(value, { season: 2026, seasontype: 2, week: 3 }[field]); return this; },
        async maybeSingle() { return { data: row }; },
        async upsert(value, options) {
          assert.equal(options.onConflict, 'season,seasontype,week');
          if (writeFails) throw Error('database unavailable');
          writes.push(structuredClone(value)); row = structuredClone(value);
        },
      };
    } }),
    fetch: async (url, options) => {
      calls.push({ url, options }); now += fetchDelay;
      return new Response(JSON.stringify(upstream || payload), { status: upstreamStatus });
    },
  });
  return { calls, writes, row: () => row, setNow: value => { now = value; },
    read: () => handler(new Request('https://fixture.invalid/nfl-scoreboard?week=3&season=2026&seasontype=2')) };
}

async function checkCache(payload, age, expected) {
  const fixture = runtime({ payload, age });
  const response = await fixture.read();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Wr-Cache'), expected);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(fixture.calls.length, expected === 'hit' ? 0 : 1);
  return fixture;
}

(async () => {
  // Exercise the real handler across the short-cache boundary, including a final
  // score appearing upstream and the second reader seeing that same fetch time.
  const live = board(NOW - 2 * HOUR);
  live._wire = { fetchedAt: 'untrusted upstream value' };
  const final = board(NOW - 2 * HOUR, true);
  const active = runtime({ payload: live, age: MINUTE - 1, upstream: final, fetchDelay: 1250 });
  const hit = await active.read();
  assert.equal(hit.headers.get('X-Wr-Cache'), 'hit');
  assert.equal((await hit.json())._wire.fetchedAt, new Date(NOW - MINUTE + 1).toISOString());
  active.setNow(NOW + 1);
  const refreshed = await active.read();
  const refreshedBody = await refreshed.json();
  assert.equal(refreshed.headers.get('X-Wr-Cache'), 'miss');
  assert.equal(refreshed.headers.get('Cache-Control'), 'no-store');
  assert.equal(refreshedBody.events[0].status.type.completed, true);
  assert.equal(refreshedBody._wire.fetchedAt, new Date(NOW + 1251).toISOString());
  assert.equal(active.writes[0].updated_at, refreshedBody._wire.fetchedAt);
  assert.equal(active.writes[0].payload._wire, undefined, 'relay metadata is separate from upstream payload');
  active.setNow(NOW + 30 * 1000);
  const next = await active.read();
  assert.equal(next.headers.get('X-Wr-Cache'), 'hit');
  assert.equal((await next.json())._wire.fetchedAt, refreshedBody._wire.fetchedAt);
  assert.equal(active.calls.length, 1);
  assert.equal(active.calls[0].url, 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=3&dates=2026');
  assert.equal(active.calls[0].options.headers['User-Agent'], 'FantasyWarRoom/1.0');

  await checkCache(board(NOW - 24 * HOUR, true), MINUTE - 1, 'hit');
  await checkCache(board(NOW - 24 * HOUR, true), MINUTE, 'miss');
  await checkCache(board(NOW - 48 * HOUR, true), MINUTE, 'miss');
  await checkCache(board(NOW + 6 * HOUR), MINUTE, 'miss');
  await checkCache(board(NOW + 5 * HOUR), 2 * HOUR, 'miss'); // a once-distant game is now near kickoff
  await checkCache({ events: [{ competitions: [{ date: new Date(NOW - HOUR).toISOString(), status: { type: { completed: true } } }] }] }, MINUTE, 'miss');
  for (const payload of [board(NOW + 72 * HOUR), board(NOW - 49 * HOUR, true), board(NOW - 90 * 24 * HOUR), { events: [] }]) {
    await checkCache(payload, 3 * HOUR - 1, 'hit');
    await checkCache(payload, 3 * HOUR, 'miss');
  }
  await checkCache(live, -MINUTE, 'miss'); // clock-corrupt/future rows are not fresh evidence

  const failedWrite = runtime({ age: MINUTE, writeFails: true });
  assert.equal((await failedWrite.read()).status, 200);
  assert.equal(failedWrite.writes.length, 0);
  const uncached = runtime({ cache: false });
  assert.equal((await (await uncached.read()).json())._wire.fetchedAt, new Date(NOW).toISOString());
  assert.equal(uncached.calls.length, 1);
  const failedFetch = await runtime({ age: MINUTE, upstreamStatus: 503 }).read();
  assert.equal(failedFetch.status, 502);
  assert.equal(failedFetch.headers.get('Cache-Control'), 'no-store');
  assert.equal((await failedFetch.json())._wire, undefined, 'failed refresh cannot manufacture fresh completion evidence');

  // Run the actual dev proxy in isolation, without starting the whole server.
  const devSource = fs.readFileSync('scripts/serve-static.cjs', 'utf8').split('async function handleNflScoreboard(req, res) {')[1].split('// ── Dev-time JSX compilation')[0];
  let headers, body, status;
  const dev = { URL, host: '127.0.0.1', port: 3001, Date: class extends Date { constructor() { super(NOW); } },
    sendJson: () => assert.fail('unexpected dev error'),
    fetch: async url => { assert.equal(url, active.calls[0].url); return Response.json(final); } };
  vm.createContext(dev);
  vm.runInContext('async function handleNflScoreboard(req, res) {' + devSource, dev);
  await dev.handleNflScoreboard({ url: '/api/nfl-scoreboard?week=3&season=2026&seasontype=2' }, {
    writeHead(code, values) { status = code; headers = values; }, end(value) { body = JSON.parse(value); },
  });
  assert.equal(status, 200);
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(body._wire.fetchedAt, new Date(NOW).toISOString());
  assert.deepEqual(body.events, final.events);
  console.log('PASS NFL relay: short active/recent cache, long distant/archive cache, preserved upstream freshness, final-score refresh, storage failure and dev no-store parity');
})().catch(error => { console.error(error); process.exitCode = 1; });
