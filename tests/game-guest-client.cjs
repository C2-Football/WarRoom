'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), { webcrypto } = require('node:crypto');
const source = fs.readFileSync('js/shared/game-guest.js', 'utf8');
const lockManagers = new WeakMap();
const settle = () => new Promise(resolve => setImmediate(resolve));
function locksFor(storage) {
    if (!lockManagers.has(storage)) {
        const tails = new Map();
        lockManagers.set(storage, { request(name, options, callback) {
            const task = typeof options === 'function' ? options : callback;
            const pending = (tails.get(name) || Promise.resolve()).then(() => task({ name, mode: 'exclusive' }));
            tails.set(name, pending.catch(() => {}));
            return pending;
        } });
    }
    return lockManagers.get(storage);
}
function setup({ storage = new Map(), denied = false, invoke, locks = true } = {}) {
    const calls = [], listeners = new Map();
    let account = null;
    const root = {
        navigator: locks ? { locks: locksFor(storage) } : {},
        crypto: webcrypto, Event: class { constructor(type) { this.type = type; } }, setTimeout, clearTimeout,
        localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => { if (denied) throw Error('denied'); storage.set(key, value); } },
        dispatchEvent: event => { for (const fn of listeners.get(event.type) || []) fn(event); },
        addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
        removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
        App: { OD: { getCurrentUserId: () => account?.id, getSessionToken: () => account?.token,
            getClient: () => ({ functions: { invoke: async (endpoint, input) => { calls.push({ endpoint, input }); return invoke ? invoke(endpoint, input) : { data: { ok: true, guest: { userId: 'guest-user', game: endpoint === 'duat' ? 'duat' : 'vault', roomId: 'own-room', displayName: input.body.displayName || 'Guest', expiresAt: '2099-01-01T00:00:00Z' } } }; } } }),
        } },
    };
    vm.runInNewContext(source, { window: root, Uint8Array, Date, JSON, Promise, Error });
    return { api: root.App.GameGuest, storage, calls, root, setAccount: value => { account = value; } };
}
(async () => {
    const first = setup();
    const joined = await first.api.join('vault', 'seat-code', 'Friend');
    assert.equal(joined.ok, true);
    assert.match(joined.guest.token, /^dg1\.[0-9a-f]{64}$/);
    assert.equal(first.calls[0].endpoint, 'time-league');
    assert.equal(first.calls[0].input.body.guestToken, joined.guest.token);
    assert.equal(first.api.getActor('vault').kind, 'guest');
    assert.equal(first.api.getActor('duat'), null);
    assert.equal(first.storage.has('fw_session_v1'), false, 'Guest never becomes an ordinary app login');
    assert.equal(first.storage.has('od_auth_v1'), false);
    const reload = setup({ storage: first.storage });
    assert.equal(reload.api.getSession('vault').token, joined.guest.token, 'Reload keeps the exact seat credential');
    reload.setAccount({ id: 'account-user', token: 'real-account-token' });
    assert.equal(reload.api.getActor('vault').kind, 'account', 'Explicit account takes precedence without being overwritten');
    assert.equal(reload.api.guestPass('vault'), joined.guest.token, 'Guest backup survives account sign-in');
    const otherDevice = setup();
    assert.equal((await otherDevice.api.resume('vault', joined.guest.token)).ok, true);
    assert.equal(otherDevice.calls[0].input.headers.Authorization, 'Bearer ' + joined.guest.token);
    assert.equal(otherDevice.api.guestPass('vault'), joined.guest.token);
    console.log('PASS guest join, reload, other-device restore, game isolation and account precedence');

    let attempts = 0;
    const lost = setup({ invoke: async (_endpoint, input) => {
        if (++attempts === 1) throw Error('Connection lost after server claim');
        return { data: { ok: true, guest: { userId: 'same-user', game: 'vault', roomId: 'same-room', displayName: input.body.displayName, expiresAt: '2099-01-01' } } };
    } });
    assert.equal((await lost.api.join('vault', 'same-invite', 'Friend')).ok, false);
    assert.equal((await lost.api.join('vault', 'same-invite', 'Friend')).ok, true);
    assert.equal(lost.calls[0].input.body.guestToken, lost.calls[1].input.body.guestToken, 'Retry recovers the same claimed seat');
    const denied = setup({ denied: true });
    assert.equal((await denied.api.join('vault', 'seat', 'Friend')).ok, false);
    assert.equal(denied.calls.length, 0, 'Do not claim a seat without saving its recovery credential');
    assert.equal((await first.api.resume('vault', 'wrong')).ok, false);
    console.log('PASS response-loss retry, unavailable storage and malformed pass');

    // Both tabs share the origin's lock. The second join cannot overwrite
    // recovery state while the first tab is waiting for its server response.
    for (const loseFirstResponse of [false, true]) {
        const shared = new Map(), waiting = new Map(), minted = new Map();
        const success = code => ({ data: { ok: true, guest: { userId: 'guest-' + code, game: 'vault', roomId: 'room-' + code, displayName: code, expiresAt: '2099-01-01' } } });
        const invoke = async (_endpoint, input) => {
            const code=input.body.code;
            if (minted.has(code)) {
                assert.equal(input.body.guestToken,minted.get(code),'Retry must use the secret that already claimed this seat');
                return success(code);
            }
            minted.set(code,input.body.guestToken);
            return new Promise((resolve,reject)=>waiting.set(code,{resolve,reject}));
        };
        const tabA=setup({storage:shared,invoke}),tabB=setup({storage:shared,invoke});
        const firstJoin=tabA.api.join('vault','first','First friend');
        const secondJoin=tabB.api.join('vault','second','Second friend');
        await settle();
        assert.equal(tabA.calls.length,1);assert.equal(tabB.calls.length,0,'Other tabs wait before changing guest state or claiming another seat');
        if(loseFirstResponse) waiting.get('first').reject(new Error('Connection lost after claim'));
        else waiting.get('first').resolve(success('first'));
        assert.equal((await firstJoin).ok,!loseFirstResponse);
        await settle(); assert.equal(tabB.calls.length,1,'The next tab proceeds after the first operation releases its lock');
        waiting.get('second').resolve(success('second'));
        assert.equal((await secondJoin).ok,true);
        if(loseFirstResponse) assert.equal((await tabA.api.join('vault','first','First friend')).ok,true);
        assert.equal(tabA.api.getSessions('vault').length,2,'Recovering one invitation preserves the other joined room');
        assert.equal(tabA.api.getSessions('vault').find(session=>session.roomId==='room-second').token,minted.get('second'));
    }
    const unsupported=setup({locks:false});
    assert.equal((await unsupported.api.join('vault','invitation','Friend')).ok,false);
    assert.equal((await unsupported.api.resume('vault',joined.guest.token)).ok,false);
    assert.equal(unsupported.calls.length,0,'Browsers without safe cross-tab coordination fail before claiming any seat');
    assert.equal(unsupported.storage.size,0);
    console.log('PASS cross-tab serialization, lost-response retry preserving both seats, and unsupported-browser fail-closed behavior');

    let resolve;
    const raced = setup({ invoke: () => new Promise(done => { resolve = done; }) });
    const pending = raced.api.join('duat', 'faction', 'Friend');
    await settle();
    raced.setAccount({ id: 'new-account', token: 'new-token' });
    resolve({ data: { ok: true, guest: { userId: 'guest', game: 'duat', roomId: 'room', displayName: 'Friend', expiresAt: '2099-01-01' } } });
    assert.equal((await pending).ok, false);
    assert.equal(raced.api.getSession('duat'), null, 'Late guest response cannot replace a newer account context');
    const wrongGame = setup({ invoke: async () => ({ data: { ok: true, guest: { userId: 'guest', game: 'duat', roomId: 'room', expiresAt: '2099-01-01' } } }) });
    assert.equal((await wrongGame.api.join('vault', 'seat', 'Friend')).ok, false);
    const expired = setup({ invoke: async () => ({ data: { ok: true, guest: { userId: 'guest', game: 'vault', roomId: 'room', expiresAt: '2000-01-01' } } }) });
    assert.equal((await expired.api.join('vault', 'seat', 'Friend')).ok, false);
    let updates = 0; const stop = first.api.subscribe(() => updates++);
    await first.api.forget('vault'); assert.equal(updates, 1); stop();
    assert.equal(first.api.getActor('vault'), null);
    console.log('PASS account races, wrong-game/expired responses and guest session subscriptions');
})().catch(error => { console.error(error); process.exitCode = 1; });
