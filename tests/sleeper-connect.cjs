const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const start = source.indexOf('    async function saveSleeperConnection(');
const end = source.indexOf('    // Read-only ownership context', start);
assert(start >= 0 && end > start, 'connection implementation is present');
const context = vm.createContext({ setTimeout, clearTimeout, window: { AbortController } });
vm.runInContext(source.slice(start, end), context);
const connect = context.saveSleeperConnection;
const previous = JSON.stringify({ sleeperUsername: 'old-profile', username: 'legacy-profile', isGifted: true });
const emailSession = JSON.stringify({ token: 'test-session', user: { id: 'test-account' } });
function store() {
    const rows = new Map([['od_auth_v1', previous], ['fw_session_v1', emailSession]]);
    return { rows, getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value) };
}
function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }

test('validated canonical username preserves account session and connection metadata', async () => {
    const storage = store();
    let called;
    const user = await connect('  New Profile  ', { storage, fetcher: async (url, options) => {
        called = { url, options };
        return response({ user_id: 'verified-user', username: 'new-profile' });
    } });
    assert.equal(called.url, 'https://api.sleeper.app/v1/user/New%20Profile');
    assert(called.options.signal instanceof AbortSignal);
    assert.equal(user.user_id, 'verified-user');
    assert.deepEqual(JSON.parse(storage.rows.get('od_auth_v1')), { sleeperUsername: 'new-profile', username: 'legacy-profile', isGifted: true });
    assert.equal(storage.rows.get('fw_session_v1'), emailSession);
});

for (const [label, result, message] of [
    ['unknown profile', response(null), /Couldn.t find/],
    ['provider 404', response({}, 404), /Couldn.t find/],
    ['provider outage', response({}, 503), /Could not reach/],
    ['malformed provider body', response({}), /Could not reach/],
]) {
    test(`${label} leaves saved connection intact and can retry`, async () => {
        const storage = store();
        await assert.rejects(connect('wrong', { storage, fetcher: async () => result }), message);
        assert.equal(storage.rows.get('od_auth_v1'), previous);
        await connect('correct', { storage, fetcher: async () => response({ user_id: '2', username: 'correct' }) });
        assert.equal(JSON.parse(storage.rows.get('od_auth_v1')).sleeperUsername, 'correct');
    });
}

test('offline and timeout failures leave identity intact and release retry', async () => {
    const storage = store();
    await assert.rejects(connect('name', { storage, fetcher: async () => { throw new TypeError('Network failed'); } }), /Could not reach/);
    await assert.rejects(connect('name', { storage, timeoutMs: 5, fetcher: (_, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Aborted')));
    }) }), /too long/);
    assert.equal(storage.rows.get('od_auth_v1'), previous);
});

test('empty input and rejected browser persistence never report a saved connection', async () => {
    const storage = store();
    let calls = 0;
    const fetcher = async () => { calls++; return response({ user_id: '2', username: 'correct' }); };
    await assert.rejects(connect('  ', { storage, fetcher }), /Enter your/);
    assert.equal(calls, 0);
    storage.setItem = () => { throw new Error('QuotaExceededError'); };
    await assert.rejects(connect('correct', { storage, fetcher }), /Could not save/);
    assert.equal(storage.rows.get('od_auth_v1'), previous);
    storage.setItem = () => {};
    await assert.rejects(connect('correct', { storage, fetcher }), /Could not save/);
});

test('account or connection changes during lookup cannot overwrite the new context', async () => {
    for (const key of ['fw_session_v1', 'od_auth_v1']) {
        const storage = store();
        await assert.rejects(connect('name', { storage, fetcher: async () => {
            storage.setItem(key, JSON.stringify({ changed: true }));
            return response({ user_id: '2', username: 'name' });
        } }), /changed while checking/);
        assert.equal(storage.rows.get('od_auth_v1'), key === 'od_auth_v1' ? JSON.stringify({ changed: true }) : previous);
    }
});

test('form blocks competing submissions and stays editable after failure', async () => {
    const handlerStart = source.indexOf('        async function handleSleeperConnect(event)');
    const handlerEnd = source.indexOf('        // Display name state', handlerStart);
    let settle, calls = 0, reloads = 0;
    const states = { busy: false, error: null };
    const handlerContext = vm.createContext({
        sleeperConnectPendingRef: { current: false }, sleeperConnectInput: 'typo',
        setSleeperConnecting: value => { states.busy = value; },
        setSleeperConnectError: value => { states.error = value; },
        saveSleeperConnection: () => { calls++; return new Promise((resolve, reject) => { settle = { resolve, reject }; }); },
        window: { location: { reload: () => { reloads++; } } },
    });
    vm.runInContext(source.slice(handlerStart, handlerEnd), handlerContext);
    const first = handlerContext.handleSleeperConnect();
    await handlerContext.handleSleeperConnect();
    assert.equal(calls, 1);
    assert.equal(states.busy, true);
    settle.reject(new Error('Check username'));
    await first;
    assert.equal(states.busy, false);
    assert.equal(states.error, 'Check username');
    assert.equal(reloads, 0);
    const retry = handlerContext.handleSleeperConnect();
    settle.resolve({ user_id: '2' });
    await retry;
    assert.equal(calls, 2);
    assert.equal(reloads, 1);
});
