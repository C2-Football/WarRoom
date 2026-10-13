'use strict';
// Isolated devices use the real sync module and preference engine against one
// revisioned service fixture. No live credentials, requests or records exist.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const syncSource = fs.readFileSync('js/shared/commish-ignore-sync.js', 'utf8');
const prefsSource = fs.readFileSync('js/shared/commish-prefs.js', 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const task = { id: 'genesis:league-one', headline: 'Finish season setup', tier: 'NOW', domain: 'genesis', hub: 'genesis', leagueIds: ['league-one'], leagueNames: ['Fixture League'] };
const reply = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => clone(data) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let nonce = 0;
function service() {
    const accounts = new Map(), operations = new Map(), requests = [], hooks = [];
    const rows = id => { if (!accounts.has(id)) accounts.set(id, new Map()); return accounts.get(id); };
    const row = (id, state, revision = 1) => ({ taskId: id, state, revision, updatedAt: '2026-10-12T12:00:00.000Z', snapshot: { ...task, id } });
    const normal = (url, options) => {
        const accountId = options.headers.Authorization.slice('Bearer token:'.length).split(':')[0];
        const records = rows(accountId);
        if (options.method === 'GET') {
            const cursor = url.searchParams.get('cursor') || '';
            const page = [...records.values()].filter(record => record.taskId > cursor).sort((a, b) => a.taskId.localeCompare(b.taskId)).slice(0, 2);
            const remaining = [...records.keys()].some(id => id > (page.at(-1)?.taskId || cursor));
            return reply(200, { ok: true, accountId, records: page, nextCursor: remaining ? page.at(-1).taskId : null });
        }
        const body = JSON.parse(options.body), before = records.get(body.taskId) || null;
        const operationKey = accountId + ':' + body.operationId, previous = operations.get(operationKey);
        if (previous) {
            if (previous.body !== options.body) return reply(409, { ok: false, accountId, code: 'operation_conflict', record: before });
            return reply(200, { ok: true, accountId, record: before, duplicate: true, appliedRevision: previous.revision });
        }
        if (body.expectedRevision !== (before?.revision || 0)) return reply(409, { ok: false, accountId, code: 'revision_conflict', record: before });
        const record = { ...row(body.taskId, body.state, (before?.revision || 0) + 1), snapshot: body.snapshot };
        records.set(body.taskId, record); operations.set(operationKey, { body: options.body, revision: record.revision });
        return reply(200, { ok: true, accountId, record, duplicate: false, appliedRevision: record.revision });
    };
    return { rows, row, requests, hooks, normal, async fetch(input, options) {
        const url = new URL(input); requests.push({ url: url.href, method: options.method, body: options.body });
        const index = hooks.findIndex(hook => hook.method === options.method);
        if (index >= 0) return hooks.splice(index, 1)[0].run(url, options, normal);
        return normal(url, options);
    } };
}
function client(server, cache = new Map()) {
    let account = 'A', token = 'token:A', rejectedCache = false;
    const events = {};
    const storage = {
        owner: () => account ? 'account:' + account : null,
        get: (key, fallback) => cache.has(account + ':' + key) ? clone(cache.get(account + ':' + key)) : fallback,
        set: (key, value) => { if (rejectedCache) return false; cache.set(account + ':' + key, clone(value)); return true; },
    };
    const root = {
        URL, TextEncoder, AbortController, setTimeout, clearTimeout, console,
        crypto: { randomUUID: () => '00000000-0000-4000-8000-' + String(++nonce).padStart(12, '0') },
        localStorage: { getItem: key => key === 'fw_session_v1' && account ? JSON.stringify({ token, user: { id: account } }) : null },
        App: { CONFIG: { supabaseUrl: 'https://isolated.example.invalid', supabaseAnon: 'fixture-anon' }, AccountStorage: storage, AccountSession: { isCurrent: () => true } },
        fetch: server.fetch.bind(server),
        addEventListener: (name, fn) => { events[name] = fn; },
        document: { visibilityState: 'visible', addEventListener: (name, fn) => { events[name] = fn; } },
    };
    root.window = root;
    vm.createContext(root); vm.runInContext(syncSource, root); vm.runInContext(prefsSource, root);
    return { sync: root.App.Commish.IgnoreSync, prefs: root.App.Commish.Prefs, root, cache, events,
        session(id, replacement = 'token:' + id) { account = id; token = replacement; }, rejectCache(value) { rejectedCache = value; } };
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
(async () => {
    await test('two independent devices propagate Ignore and Restore only after server confirmation', async () => {
        const server = service(), a = client(server), b = client(server);
        await Promise.all([a.sync.load(), b.sync.load()]);
        const gate = deferred();
        server.hooks.push({ method: 'POST', run: async (...args) => { await gate.promise; return server.normal(...args.slice(0, 2)); } });
        const saving = a.sync.change(task, 'ignored');
        assert.equal(a.sync.snapshot().phase, 'saving');
        assert.equal(a.prefs.stateOf(task.id), null, 'pending Ignore cannot hide the task');
        assert.equal(a.sync.snapshot().pending.inFlight, true);
        gate.resolve(); assert.equal(await saving, true);
        assert.equal(a.prefs.stateOf(task.id).confirmed, true);
        await b.sync.refresh(); assert.equal(b.prefs.stateOf(task.id).state, 'ignored');
        assert.equal(await b.sync.change(task, 'restored'), true);
        await a.sync.refresh(); assert.equal(a.prefs.stateOf(task.id), null);
        assert.equal(a.sync.snapshot().records[task.id].state, 'restored', 'restores remain permanent tombstones');
    });
    await test('all pages load atomically; invalid or failed later pages preserve last-known choices', async () => {
        const server = service(); ['a', 'b', 'c'].forEach(id => server.rows('A').set(id, server.row(id, 'ignored')));
        const a = client(server); assert.equal(await a.sync.load(), true);
        assert.equal(Object.keys(a.sync.snapshot().records).length, 3);
        server.hooks.push({ method: 'GET', run: (url, options) => server.normal(url, options) });
        server.hooks.push({ method: 'GET', run: () => reply(503, { error: 'Unavailable' }) });
        server.rows('A').set('a', server.row('a', 'restored', 2));
        assert.equal(await a.sync.refresh(), false);
        assert.equal(a.sync.snapshot().records.a.state, 'ignored', 'partial pages never replace the full authority snapshot');
        server.hooks.push({ method: 'GET', run: () => reply(200, { ok: true, accountId: 'B', records: [], nextCursor: null }) });
        assert.equal(await a.sync.refresh(), false);
        assert.equal(a.sync.snapshot().errorCode, 'INVALID_RESPONSE');
    });
    await test('cache is unconfirmed; completed GET drops absent cache without overwriting a newer in-flight POST', async () => {
        const server = service(), cache = new Map();
        cache.set('A:commish_ignore_cloud_v1', { version: 1, owner: 'account:A', records: { ghost: server.row('ghost', 'ignored') }, pending: null });
        const a = client(server, cache);
        assert.equal(a.sync.snapshot().phase, 'checking');
        assert.equal(a.sync.snapshot().records.ghost.source, 'cache');
        assert.equal(a.sync.snapshot().records.ghost.confirmed, false);
        await a.sync.load(); assert.deepEqual(Object.keys(a.sync.snapshot().records), []);
        const gate = deferred();
        server.hooks.push({ method: 'GET', run: () => gate.promise });
        const loading = a.sync.refresh(); assert.equal(await a.sync.change(task, 'ignored'), true);
        gate.resolve(reply(200, { ok: true, accountId: 'A', records: [], nextCursor: null }));
        await loading; assert.equal(a.sync.snapshot().records[task.id].state, 'ignored');
    });
    await test('lost response retry and reopened module reuse exact operation ID, revision and payload', async () => {
        const server = service(), cache = new Map(), a = client(server, cache);
        await a.sync.load();
        server.hooks.push({ method: 'POST', run: (url, options) => { server.normal(url, options); throw new TypeError('Lost response'); } });
        assert.equal(await a.sync.change(task, 'ignored'), false);
        const firstBody = server.requests.find(request => request.method === 'POST').body;
        assert.equal(a.sync.snapshot().pending.uncertain, true);
        assert.equal(a.prefs.stateOf(task.id), null, 'unacknowledged response cannot claim a cloud save');
        const reopened = client(server, cache);
        assert.equal(await reopened.sync.change({ ...task, headline: 'A newer rendered headline' }, 'ignored'), true);
        assert.equal(server.requests.filter(request => request.method === 'POST').at(-1).body, firstBody);
        assert.equal(server.rows('A').get(task.id).revision, 1, 'idempotent retry does not create a second write');
    });
    await test('retrying an old acknowledged operation cannot resurrect an Ignore restored on another device', async () => {
        const server = service(), a = client(server), b = client(server);
        await a.sync.load();
        server.hooks.push({ method: 'POST', run: (url, options) => { server.normal(url, options); throw new TypeError('Lost response'); } });
        await a.sync.change(task, 'ignored');
        await b.sync.load(); await b.sync.change(task, 'restored');
        assert.equal(await a.sync.change(task, 'ignored'), false);
        assert.equal(a.sync.snapshot().errorCode, 'REVISION_CONFLICT');
        assert.equal(a.sync.snapshot().records[task.id].state, 'restored');
        assert.equal(server.rows('A').get(task.id).revision, 2);
    });
    await test('reload exposes a bounded pending snapshot and recovers receipt even when GET already hides the task', async () => {
        const server = service(), cache = new Map(), a = client(server, cache);
        await a.sync.load();
        server.hooks.push({ method: 'POST', run: (url, options) => { server.normal(url, options); throw new TypeError('Lost response'); } });
        await a.sync.change(task, 'ignored');
        const oldBody = server.requests.filter(request => request.method === 'POST').at(-1).body;
        const reopened = client(server, cache); await reopened.sync.load();
        const snapshot = reopened.sync.snapshot();
        assert.equal(snapshot.loaded, true); assert.equal(snapshot.phase, 'error'); assert.equal(snapshot.errorCode, 'UNCONFIRMED_CHANGE');
        assert.equal(snapshot.records[task.id].state, 'ignored');
        assert.equal(snapshot.pending.snapshot.headline, task.headline);
        assert.equal(snapshot.pending.body, undefined, 'UI does not need serialized operation internals');
        assert.equal(snapshot.pending.uncertain, true);
        assert.equal(await reopened.sync.retryPending(), true);
        assert.equal(server.requests.filter(request => request.method === 'POST').at(-1).body, oldBody);
        assert.equal(reopened.sync.snapshot().pending, null);
    });
    await test('409 applies current revision, refreshes, and requires explicit new intent with a new operation', async () => {
        const server = service(), a = client(server), b = client(server);
        await a.sync.load(); await a.sync.change(task, 'ignored'); await b.sync.load();
        await b.sync.change(task, 'restored');
        const before = server.requests.length;
        assert.equal(await a.sync.change(task, 'ignored'), false);
        assert.equal(server.requests.slice(before).filter(request => request.method === 'POST').length, 1, 'conflict never auto-rebases a write');
        const rejected = JSON.parse(server.requests.filter(request => request.method === 'POST').at(-1).body);
        assert.equal(a.sync.snapshot().records[task.id].revision, 2);
        assert.equal(a.sync.snapshot().pending, null);
        assert.equal(await a.sync.change(task, 'ignored'), true);
        const retried = JSON.parse(server.requests.filter(request => request.method === 'POST').at(-1).body);
        assert.notEqual(retried.operationId, rejected.operationId); assert.equal(retried.expectedRevision, 2);
    });
    await test('late results after account switch or exact credential rotation cannot populate cache or UI', async () => {
        for (const rotate of [false, true]) {
            const server = service(), a = client(server); await a.sync.load();
            const gate = deferred(); server.hooks.push({ method: 'POST', run: () => gate.promise });
            const saving = a.sync.change(task, 'ignored');
            a.session(rotate ? 'A' : 'B', rotate ? 'token:A:rotated' : 'token:B');
            a.sync.snapshot();
            gate.resolve(reply(200, { ok: true, accountId: 'A', record: server.row(task.id, 'ignored'), appliedRevision: 1, duplicate: false }));
            assert.equal(await saving, false);
            assert.equal(a.sync.snapshot().records[task.id], undefined);
            assert.equal(a.cache.get('B:commish_ignore_cloud_v1'), undefined);
        }
    });
    await test('double clicks sharing the initial GET start only one POST', async () => {
        const server = service(), a = client(server), gate = deferred();
        server.hooks.push({ method: 'GET', run: () => gate.promise });
        const first = a.sync.change(task, 'ignored'), second = a.sync.change(task, 'ignored');
        gate.resolve(reply(200, { ok: true, accountId: 'A', records: [], nextCursor: null }));
        const results = await Promise.all([first, second]);
        assert.equal(results.filter(Boolean).length, 1);
        assert.equal(server.requests.filter(request => request.method === 'POST').length, 1);
    });
    await test('quota failure after a real server receipt remains confirmed with an honest cache warning', async () => {
        const server = service(), a = client(server); await a.sync.load(); a.rejectCache(true);
        assert.equal(await a.sync.change(task, 'ignored'), true);
        assert.equal(a.sync.snapshot().phase, 'ready');
        assert.equal(a.sync.snapshot().records[task.id].confirmed, true);
        assert.match(a.sync.snapshot().cacheError, /could not be cached/);
    });
    await test('provider snapshots are bounded metadata and never include private follow-up fields', async () => {
        const server = service(), a = client(server);
        const huge = { ...task, headline: '😀'.repeat(1000), detail: '😀'.repeat(5000), note: 'PRIVATE NOTE', message: 'PRIVATE DRAFT',
            leagueNames: Array(70).fill('😀'.repeat(300)), leagueIds: Array(70).fill('x'.repeat(300)) };
        assert.equal(await a.sync.change(huge, 'ignored'), true);
        const body = JSON.parse(server.requests.filter(request => request.method === 'POST').at(-1).body);
        assert(new TextEncoder().encode(JSON.stringify(body.snapshot)).length <= 8192);
        assert(body.snapshot.headline.length <= 500 && body.snapshot.detail.length <= 2000);
        assert(body.snapshot.leagueIds.length <= 50 && body.snapshot.leagueNames.length <= 50);
        assert.equal(body.snapshot.note, undefined); assert.equal(body.snapshot.message, undefined);
    });
    await test('local choices never upload; cloud tombstones overlay local hides while other local prefs survive', async () => {
        const server = service(), a = client(server);
        a.prefs.hide(task); a.prefs.markDone({ id: 'other', tier: 'NOW' });
        assert.equal(a.prefs.ignoredItems([])[0].source, 'local');
        assert.equal(a.prefs.ignoredItems([])[0].confirmed, false);
        server.rows('A').set(task.id, server.row(task.id, 'restored', 2));
        await a.sync.load();
        assert.equal(server.requests.filter(request => request.method === 'POST').length, 0);
        assert.equal(a.prefs.stateOf(task.id), null);
        assert.equal(a.prefs.applyStates([task], { states: a.prefs.allItemStates() }).visible.length, 1);
        assert.equal(a.prefs._all().items[task.id].state, 'hidden', 'remote overlay does not rewrite local recovery data');
        assert.equal(a.prefs.stateOf('other').state, 'done');
        await a.sync.change(task, 'ignored');
        const row = a.prefs.ignoredItems([])[0]; assert.equal(row.source, 'cloud'); assert.equal(row.confirmed, true); assert.equal(row.missing, true);
        a.session('B'); assert.equal(a.prefs.stateOf(task.id), null, 'overlay is isolated immediately when owner changes');
    });
    await test('auth failure and malformed success never report a confirmed mutation', async () => {
        const server = service(), a = client(server);
        server.hooks.push({ method: 'GET', run: () => reply(401, { error: 'Sign in again.' }) });
        assert.equal(await a.sync.load(), false); assert.equal(a.sync.snapshot().errorCode, 'AUTH_REQUIRED');
        await a.sync.load();
        server.hooks.push({ method: 'POST', run: () => reply(200, { ok: true, accountId: 'A' }) });
        assert.equal(await a.sync.change(task, 'ignored'), false);
        assert.equal(a.sync.snapshot().pending.uncertain, true); assert.equal(a.prefs.stateOf(task.id), null);
        assert.equal(await a.sync.change(task, 'ignored'), true);
        a.session(null); assert.equal(await a.sync.change(task, 'restored'), false);
        assert.equal(a.sync.snapshot().records[task.id], undefined);
    });
    console.log('PASS ' + passed + ' real sync/preference groups; all service traffic isolated.');
})().catch(error => { console.error(error); process.exitCode = 1; });
