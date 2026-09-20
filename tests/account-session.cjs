'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const helper = fs.readFileSync('js/shared/account-storage.js', 'utf8');
const core = fs.readFileSync('js/core.js', 'utf8');
const logout = core.slice(core.indexOf('    async function handleLogout()'), core.indexOf('    // ===== SLEEPER API'));
const session = id => ({ token: 'app-test-token', user: { id } });
function storage() {
    const values = new Map();
    return { values, get length() { return values.size; }, key: i => [...values.keys()][i] ?? null,
        getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
function browser({ mounted = true, sdkRejects = false, knownContext = true } = {}) {
    const local = storage(), temporary = storage(), events = {}, log = [];
    local.setItem('fw_session_v1', JSON.stringify(session('a')));
    for (const key of ['od_auth_v1', 'od_profile_v1', 'od_display_name', 'od_locked_username_v2', 'mfl_league_id', 'mfl_franchise_id']) local.setItem(key, JSON.stringify({ private: 'account-a' }));
    if (knownContext) local.setItem('wr_active_connection_owner_v1', 'account:a');
    local.setItem('offline-duat', 'keep-this-save'); local.setItem('commish_tasks_v1', 'preserve-unassigned');
    local.setItem('sb-project-auth-token', 'oauth-token');
    local.setItem('mfl_creds_corrupt', '{"apiKey":"malformed-secret"');
    local.setItem('dynastyhq_apikey', 'legacy-ai-secret');
    local.setItem('mfl_creds_l1', JSON.stringify({ leagueId: 'l1', apiKey: 'old-inline-secret' }));
    for (const key of ['mfl_api_key', 'espn_s2', 'espn_swid', 'yahoo_session_id']) { local.setItem(key, 'old-secret'); temporary.setItem(key, 'active-secret'); }
    const element = { textContent: 'A confidential account view', replaceChildren() { this.textContent = ''; log.push('hide'); } };
    const context = vm.createContext({ console, atob, URL, setTimeout, clearTimeout, localStorage: local, sessionStorage: temporary,
        confirm: () => true, App: { SUPABASE_URL: 'https://project.supabase.co', OD: { getClient: () => ({ auth: { signOut: async options => { log.push(['oauth-signout', options]); if (sdkRejects) throw Error('offline'); } } }) } },
        document: { getElementById: () => mounted ? element : null, addEventListener: (name, callback) => { events[name] = callback; }, visibilityState: 'visible' },
        addEventListener: (name, callback) => { events[name] = callback; },
        ReactDOM: { unmountComponentAtNode: () => { log.push('unmount'); } },
        DHQAI: { clear: () => { temporary.removeItem('ai-personal'); log.push('ai-clear'); } },
        location: { href: 'index.html', reload: () => { log.push('reload'); } },
    });
    temporary.setItem('ai-personal', 'private-key');
    context.window = context;
    vm.runInContext(helper, context); vm.runInContext(logout, context);
    return { context, local, temporary, log, events, element };
}
(async () => {
    for (const sdkRejects of [false, true]) {
        const b = browser({ sdkRejects });
        await b.context.handleLogout();
        assert.equal(b.context.location.href, 'landing.html');
        for (const key of ['fw_session_v1', 'od_session_v1', 'od_auth_v1', 'od_profile_v1', 'od_display_name', 'od_locked_username_v2', 'mfl_league_id', 'mfl_franchise_id', 'sb-project-auth-token']) assert.equal(b.local.getItem(key), null, key);
        for (const key of ['mfl_api_key', 'espn_s2', 'espn_swid', 'yahoo_session_id']) { assert.equal(b.local.getItem(key), null); assert.equal(b.temporary.getItem(key), null); }
        assert.equal(JSON.parse(b.local.getItem('mfl_creds_l1')).apiKey, undefined);
        assert.equal(b.local.getItem('mfl_creds_corrupt'), null);
        assert.equal(b.local.getItem('dynastyhq_apikey'), null);
        assert.equal(b.temporary.getItem('ai-personal'), null);
        assert.equal(b.local.getItem('offline-duat'), 'keep-this-save'); assert.equal(b.local.getItem('commish_tasks_v1'), 'preserve-unassigned');
        const archiveKey = [...b.local.values.keys()].find(key => key.startsWith('wr_account_context_v1:account%3Aa:'));
        const archived = JSON.parse(b.local.getItem(archiveKey));
        assert.equal(JSON.parse(archived.od_profile_v1).private, 'account-a');
        assert(b.log.includes('unmount')); assert(!b.element.textContent.includes('confidential'));
        assert(b.log.some(value => Array.isArray(value) && value[0] === 'oauth-signout' && value[1].scope === 'local'));
    }
    const changedPassword = browser();
    changedPassword.context.location.pathname = '/dist-preview/index.html';
    await changedPassword.context.App.AccountSession.signOut('login.html?password=changed');
    assert.equal(changedPassword.context.location.href, '../login.html?password=changed');
    assert.equal(changedPassword.local.getItem('fw_session_v1'), null);
    const redirect = browser();
    await redirect.context.App.AccountSession.signOut('https://untrusted.invalid');
    assert.equal(redirect.context.location.href, 'landing.html');
    const b = browser();
    b.local.setItem('fw_session_v1', JSON.stringify(session('b')));
    // A delayed callback can run before the browser dispatches `storage`.
    assert.equal(b.context.App.AccountStorage.set('commish_tasks_v1', ['A stale callback']), false);
    assert.equal(b.context.App.AccountStorage.owner(), null);
    assert(b.log.includes('unmount')); assert(b.log.includes('reload'));
    assert.equal(b.local.getItem('fw_session_v1'), JSON.stringify(session('b')), 'Invalidating A must preserve the newer B session');
    b.events.storage({ key: 'fw_session_v1' });
    assert.equal(b.log.filter(value => value === 'reload').length, 1, 'Only one reload is scheduled');
    assert(![...b.local.values.values()].some(value => value.includes('A stale callback')));
    const same = browser();
    same.local.setItem('fw_session_v1', JSON.stringify({ ...session('a'), token: 'refreshed-token' }));
    same.events.storage({ key: 'fw_session_v1' });
    assert(!same.log.includes('reload'), 'Token refresh does not discard the current account view');
    same.local.setItem('od_auth_v1', JSON.stringify({ sleeperUsername: 'different-connected-league-owner' }));
    same.events.storage({ key: 'od_auth_v1' });
    assert(!same.log.includes('reload'), 'Changing league connection does not change the signed app account');
    const focus = browser(); focus.local.removeItem('fw_session_v1'); focus.events.focus(); assert(focus.log.includes('unmount'));
    const login = browser({ mounted: false, knownContext: false });
    login.context.App.AccountStorage.prepareSignIn(session('b'), [['fw_session_v1', JSON.stringify(session('b'))]]);
    assert.equal(login.local.getItem('od_profile_v1'), null); assert.equal(login.local.getItem('od_auth_v1'), null);
    assert.equal(login.local.getItem('wr_active_connection_owner_v1'), 'account:b');
    assert(![...login.local.values.keys()].some(key => key.startsWith('wr_account_context_v1:account%3Aa:')), 'Unmarked older metadata cannot be attributed automatically');
    assert([...login.local.values].some(([key, value]) => key.startsWith('wr_account_context_v1:unassigned:') && value.includes('account-a')));
    login.local.setItem('fw_session_v1', JSON.stringify(session('b')));
    login.local.setItem('od_profile_v1', JSON.stringify({ private: 'account-b' }));
    login.context.App.AccountStorage.prepareSignIn(session('b'), [['fw_session_v1', JSON.stringify(session('b'))]]);
    assert.equal(JSON.parse(login.local.getItem('od_profile_v1')).private, 'account-b', 'Same-account sign-in preserves its current profile');
    const returning = browser({ mounted: false });
    returning.context.App.AccountStorage.prepareSignIn(session('b'), [['fw_session_v1', JSON.stringify(session('b'))], ['od_profile_v1', JSON.stringify({ private: 'account-b' })]]);
    assert.equal(JSON.parse(returning.local.getItem('od_profile_v1')).private, 'account-b');
    returning.context.App.AccountStorage.prepareSignIn(session('a'), [['fw_session_v1', JSON.stringify(session('a'))]]);
    assert.equal(JSON.parse(returning.local.getItem('od_profile_v1')).private, 'account-a', 'Returning account restores only its known-owner connection context');
    returning.context.App.AccountStorage.prepareSignIn(session('b'), [['fw_session_v1', JSON.stringify(session('b'))]]);
    assert.equal(JSON.parse(returning.local.getItem('od_profile_v1')).private, 'account-b');
    const quota = browser({ mounted: false });
    const original = [...quota.local.values];
    const quotaSet = quota.local.setItem;
    quota.local.setItem = () => { throw Error('QuotaExceededError'); };
    assert.throws(() => quota.context.App.AccountStorage.prepareSignIn(session('b'), [['fw_session_v1', JSON.stringify(session('b'))]]), /Quota/);
    assert.deepEqual([...quota.local.values], original, 'A failed archive leaves auth and every profile pointer unchanged');
    await quota.context.handleLogout();
    assert.equal(quota.local.getItem('fw_session_v1'), null, 'Logout still removes authentication when backup storage is full');
    assert.equal(JSON.parse(quota.local.getItem('od_profile_v1')).private, 'account-a', 'Failed logout backup preserves recoverable profile data');
    assert.equal(quota.local.getItem('offline-duat'), 'keep-this-save');
    quota.local.setItem = quotaSet;
    quota.context.App.AccountStorage.prepareSignIn(session('a'), [['fw_session_v1', JSON.stringify(session('a'))]]);
    assert.equal(JSON.parse(quota.local.getItem('od_profile_v1')).private, 'account-a', 'After quota recovery, returning A recovers the marked context preserved by logout');
    const partial = browser({ mounted: false });
    const partialOriginal = [...partial.local.values];
    const partialSet = partial.local.setItem;
    let writes = 0;
    partial.local.setItem = (key, value) => { if (++writes === 4) throw Error('QuotaExceededError'); partialSet(key, value); };
    assert.throws(() => partial.context.App.AccountStorage.prepareSignIn(session('b'), [['fw_session_v1', JSON.stringify(session('b'))], ['od_profile_v1', JSON.stringify({ private: 'account-b' })]]), /Quota/);
    assert.deepEqual([...partial.local.values].sort(), partialOriginal.sort(), 'Failure after one new write restores the original account and profile');
    const brokenRollback = browser({ mounted: false });
    const workingSet = brokenRollback.local.setItem;
    let count = 0;
    brokenRollback.local.setItem = (key, value) => { if (++count > 3) throw Error('Storage became unavailable'); workingSet(key, value); };
    assert.throws(() => brokenRollback.context.App.AccountStorage.prepareSignIn(session('b'), [['od_profile_v1', JSON.stringify({ private: 'account-b' })], ['fw_session_v1', JSON.stringify(session('b'))]]), /unavailable/);
    assert([...brokenRollback.local.values.keys()].some(key => key.startsWith('wr_account_context_v1:account%3Aa:')), 'A durable backup remains if the browser rejects rollback too');
    brokenRollback.local.setItem = workingSet;
    brokenRollback.local.removeItem('fw_session_v1');
    brokenRollback.context.App.AccountStorage.prepareSignIn(session('a'), [['fw_session_v1', JSON.stringify(session('a'))]]);
    assert.equal(JSON.parse(brokenRollback.local.getItem('od_profile_v1')).private, 'account-a', 'After storage recovery, A original work remains recoverable');
    const oauth = 'head.' + Buffer.from(JSON.stringify({ sub: 'oauth-id', exp: Math.floor(Date.now() / 1000) + 100 })).toString('base64url') + '.sig';
    assert.equal(login.context.App.AccountSession.identityOf({ token: oauth, user: { email: 'synthetic@test.invalid' } }), 'oauth:oauth-id');
    console.log('PASS real logout, OAuth failure recovery, volatile secrets, preserved saves, identity changes before storage event, mounted-view reset, same-account refresh and safe sign-in preparation');
})().catch(error => { console.error(error); process.exitCode = 1; });
