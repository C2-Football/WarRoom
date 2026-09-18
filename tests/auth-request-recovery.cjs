'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../login.html'), 'utf8');
const source = html.match(/<script>\s*(const FW_API_BASE[\s\S]*?)<\/script>/)[1];

function harness(fetchImpl, oauth, kind = 'login', restore = async () => ({ data: { session: null } })) {
  const elements = new Map();
  const stored = new Map();
  const timers = new Map();
  let nextTimer = 0;
  let failWriteKey = '';
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        value: '', textContent: '', disabled: false, events: {},
        classList: {
          add: (...names) => names.forEach(n => classes.add(n)),
          remove: (...names) => names.forEach(n => classes.delete(n)),
          toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
          contains: name => classes.has(name),
        },
        addEventListener(name, fn) { this.events[name] = fn; },
        setAttribute() {}, focus() {},
      });
    }
    return elements.get(id);
  };
  element('identifier').value = 'isolated@example.test';
  element('password').value = 'synthetic-password';
  element('signupEmail').value = 'isolated@example.test';
  element('signupPassword').value = 'synthetic-password';
  element('displayName').value = 'Isolated test';
  element('btnSignin').textContent = 'Sign in';
  element('btnSignup').textContent = 'Create free account';
  element('btnReset').textContent = 'Forgot password?';
  element('confirm').value = 'synthetic-password';
  const window = { location: { search: kind === 'reset' ? '?token=synthetic-reset' : '', href: 'login.html', origin: 'https://example.test', pathname: '/login.html' } };
  if (oauth) window.supabase = { createClient: () => ({ auth: {
    getSession: restore, signInWithOAuth: oauth,
  } }) };
  const script = kind === 'reset'
    ? fs.readFileSync(path.join(__dirname, '../reset-password.html'), 'utf8').match(/<script>\s*(const FW_API_BASE[\s\S]*?)<\/script>/)[1]
    : source;
  const context = {
    window, document: { getElementById: element }, URL, URLSearchParams, AbortController,
    localStorage: {
      get length() { return stored.size; },
      key: index => [...stored.keys()][index] ?? null,
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => {
        if (key === failWriteKey) throw new DOMException('Storage full', 'QuotaExceededError');
        return stored.set(key, value);
      }, removeItem: key => stored.delete(key),
    },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: (...args) => fetchImpl(...args),
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
  };
  Object.assign(window, { localStorage: context.localStorage, sessionStorage: context.sessionStorage, document: context.document,
    atob: value => Buffer.from(value, 'base64').toString('utf8') });
  vm.createContext(context);
  if (kind === 'login') vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/shared/account-storage.js'), 'utf8'), context);
  vm.runInContext(script, context);
  return {
    element, stored, window, timers,
    failWriteOn: key => { failWriteKey = key; },
    fire: (id, name) => element(id).events[name]({ preventDefault() {}, currentTarget: element(id) }),
    message: () => element('message').textContent,
    success: () => element('message').classList.contains('success'),
  };
}

const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, json: async () => data });

(async () => {
  for (const [label, fetchImpl] of [
    ['offline', async () => { throw new TypeError('Failed to fetch'); }],
    ['server error', async () => response({ error: 'Temporarily unavailable' }, 503)],
    ['missing acknowledgement', async () => response({})],
    ['invalid response', async () => ({ ok: true, json: async () => { throw new SyntaxError(); } })],
  ]) {
    const h = harness(fetchImpl);
    await h.fire('btnReset', 'click');
    assert.equal(h.success(), false, `${label}: must not claim reset success`);
    assert.equal(h.element('btnReset').disabled, false, `${label}: retry stays available`);
    assert.equal(h.stored.size, 0);
  }

  let fail = true, calls = 0;
  const retry = harness(async () => { calls++; if (fail) throw new Error('Offline'); return response({ ok: true }); });
  await retry.fire('btnReset', 'click');
  fail = false;
  await retry.fire('btnReset', 'click');
  assert.equal(calls, 2);
  assert.equal(retry.success(), true);
  assert.match(retry.message(), /request received/i);
  assert.doesNotMatch(retry.message(), /on the way|sent|delivered/i, 'accepted request is not email delivery proof');

  for (const body of [{}, { token: '' }, { token: 'synthetic' }, { token: 'synthetic', user: { email: 'isolated@example.test' } }]) {
    const h = harness(async () => response(body));
    await h.fire('panelSignin', 'submit');
    assert.equal(h.stored.size, 0, 'unconfirmed sign-in must not persist a session');
    assert.equal(h.success(), false);
    assert.equal(h.element('btnSignin').disabled, false);
    assert.equal(h.window.location.href, 'login.html');
  }

  let resolveFetch;
  calls = 0;
  const concurrent = harness(() => { calls++; return new Promise(resolve => { resolveFetch = resolve; }); });
  const pending = concurrent.fire('panelSignin', 'submit');
  await concurrent.fire('panelSignin', 'submit');
  await concurrent.fire('panelSignup', 'submit');
  assert.equal(calls, 1, 'repeated submit and mode changes cannot start competing identity requests');
  resolveFetch(response({ token: 'synthetic', user: { id: 'account-a', email: 'isolated@example.test' } }));
  await pending;
  assert.equal(JSON.parse(concurrent.stored.get('fw_session_v1')).user.id, 'account-a');
  assert.equal(concurrent.success(), true);
  await concurrent.fire('panelSignin', 'submit');
  assert.equal(calls, 1, 'hold the submission lock until navigation after success');

  const timeout = harness((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  const slow = timeout.fire('panelSignin', 'submit');
  [...timeout.timers.values()].find(t => t.ms === 15000).fn();
  await slow;
  assert.match(timeout.message(), /timed out/i);
  assert.equal(timeout.element('btnSignin').disabled, false);
  assert.equal(timeout.stored.size, 0);

  const oauth = harness(async () => response({}), async () => { throw new Error('Provider connection failed'); });
  await oauth.fire('btnGoogle', 'click');
  assert.equal(oauth.success(), false);
  assert.equal(oauth.element('btnGoogle').disabled, false, 'a rejected OAuth request must be retryable');
  for (const data of [{ url: null }, { url: 'https://unrelated.example.test' }]) {
    const invalid = harness(async () => response({}), async () => ({ data, error: null }));
    await invalid.fire('btnGoogle', 'click');
    assert.equal(invalid.element('btnGoogle').disabled, false);
    assert.equal(invalid.window.location.href, 'login.html');
  }
  let finishOAuth;
  const hanging = harness(async () => response({ token: 'new-email-token', user: { id: 'b', email: 'b@example.test' } }),
    (_provider) => new Promise(resolve => { finishOAuth = resolve; }));
  const providerRequest = hanging.fire('btnGoogle', 'click');
  [...hanging.timers.values()].find(t => t.ms === 15000).fn();
  await providerRequest;
  assert.match(hanging.message(), /timed out/i);
  assert.equal(hanging.element('btnGoogle').disabled, false);
  await hanging.fire('panelSignin', 'submit');
  assert.equal(JSON.parse(hanging.stored.get('fw_session_v1')).user.id, 'b', 'email login can recover after OAuth timeout');
  finishOAuth({ data: { url: 'https://sxshiqyxhhifvtfqawbq.supabase.co/auth/v1/authorize?provider=google' }, error: null });
  await Promise.resolve();
  assert.equal(hanging.window.location.href, 'login.html', 'late OAuth response must not navigate over a new sign-in');

  const oldOAuth = { data: { session: {
    access_token: 'test.' + Buffer.from(JSON.stringify({ sub: 'old-oauth-a', exp: 4102444800 })).toString('base64url') + '.signature',
    user: { email: 'a@example.test', user_metadata: { full_name: 'Account A' } },
  } } };
  const flushRestore = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  for (const lateOutcome of ['session', 'error']) {
    let resolveRestore, rejectRestore;
    const restoration = new Promise((resolve, reject) => { resolveRestore = resolve; rejectRestore = reject; });
    const h = harness(async () => response({ token: 'email-b', user: { id: 'b', email: 'b@example.test' } }), async () => ({}), 'login', () => restoration);
    await h.fire('panelSignin', 'submit');
    const message = h.message();
    if (lateOutcome === 'error') rejectRestore(new Error('Old OAuth refresh failed'));
    else resolveRestore(oldOAuth);
    await flushRestore();
    assert.equal(JSON.parse(h.stored.get('fw_session_v1')).user.id, 'b', `${lateOutcome}: explicit account must survive delayed restoration`);
    assert.equal(h.stored.get('wr_active_connection_owner_v1'), 'account:b');
    assert.equal(h.message(), message, `${lateOutcome}: delayed restoration must not overwrite sign-in result`);
    assert.equal(h.success(), true);
    assert.equal(h.window.location.href, 'login.html', `${lateOutcome}: only explicit sign-in owns navigation`);
  }
  // Cancellation starts with the user's attempt, before its fetch resolves.
  // A failed request must not let the old restoration revive an unwanted user.
  for (const failed of [false, true]) {
    let finishRestore, finishSignin;
    const h = harness(() => new Promise(resolve => { finishSignin = resolve; }), async () => ({}), 'login',
      () => new Promise(resolve => { finishRestore = resolve; }));
    const signin = h.fire('panelSignin', 'submit');
    finishRestore(oldOAuth); await flushRestore();
    assert.equal(h.stored.has('fw_session_v1'), false, 'pending explicit sign-in must cancel restore before either identity is stored');
    finishSignin(failed ? response({ error: 'Wrong password' }, 401) : response({ token: 'email-b', user: { id: 'b', email: 'b@example.test' } }));
    await signin;
    assert.equal(h.stored.has('fw_session_v1'), !failed);
    if (failed) assert.match(h.message(), /Wrong password/);
  }
  let finishOldRestore;
  const providerUrl = 'https://sxshiqyxhhifvtfqawbq.supabase.co/auth/v1/authorize?provider=google';
  const explicitOAuth = harness(async () => response({}), async () => ({ data: { url: providerUrl }, error: null }), 'login',
    () => new Promise(resolve => { finishOldRestore = resolve; }));
  await explicitOAuth.fire('btnGoogle', 'click');
  finishOldRestore(oldOAuth); await flushRestore();
  assert.equal(explicitOAuth.window.location.href, providerUrl, 'new OAuth request owns navigation over an older restore');
  assert.equal(explicitOAuth.stored.has('fw_session_v1'), false);

  let finishCrossTab;
  const crossTab = harness(async () => response({}), async () => ({}), 'login', () => new Promise(resolve => { finishCrossTab = resolve; }));
  const otherSession = { token: 'other-tab-b', user: { id: 'b', email: 'b@example.test' } };
  crossTab.window.App.AccountStorage.prepareSignIn(otherSession, [['fw_session_v1', JSON.stringify(otherSession)]]);
  finishCrossTab(oldOAuth); await flushRestore();
  assert.equal(JSON.parse(crossTab.stored.get('fw_session_v1')).user.id, 'b', 'session changed by another tab must not be overwritten by restore');

  let finishOldSignin;
  const staleSignin = harness(() => new Promise(resolve => { finishOldSignin = resolve; }));
  const oldSignin = staleSignin.fire('panelSignin', 'submit');
  staleSignin.window.App.AccountStorage.prepareSignIn(otherSession, [['fw_session_v1', JSON.stringify(otherSession)]]);
  finishOldSignin(response({ token: 'late-email-a', user: { id: 'a', email: 'a@example.test' } }));
  await oldSignin;
  assert.equal(JSON.parse(staleSignin.stored.get('fw_session_v1')).user.id, 'b', 'pending explicit sign-in must not overwrite a newer account from another tab');
  assert.equal(staleSignin.success(), false);
  assert.equal(staleSignin.element('btnSignin').disabled, false, 'stale explicit request can be deliberately retried');
  assert.equal(staleSignin.window.location.href, 'login.html');
  assert.match(staleSignin.message(), /account changed/i);
  const deliberateRetry = staleSignin.fire('panelSignin', 'submit');
  finishOldSignin(response({ token: 'retry-email-a', user: { id: 'a', email: 'a@example.test' } }));
  await deliberateRetry;
  assert.equal(JSON.parse(staleSignin.stored.get('fw_session_v1')).user.id, 'a', 'fresh explicit retry may deliberately switch accounts');

  let finishCrossTabOAuth;
  const staleOAuth = harness(async () => response({}), () => new Promise(resolve => { finishCrossTabOAuth = resolve; }));
  const oldProviderRequest = staleOAuth.fire('btnGoogle', 'click');
  staleOAuth.window.App.AccountStorage.prepareSignIn(otherSession, [['fw_session_v1', JSON.stringify(otherSession)]]);
  finishCrossTabOAuth({ data: { url: providerUrl }, error: null });
  await oldProviderRequest;
  assert.equal(staleOAuth.window.location.href, 'login.html', 'old provider startup must not redirect after a newer cross-tab session');
  assert.equal(JSON.parse(staleOAuth.stored.get('fw_session_v1')).user.id, 'b');
  assert.equal(staleOAuth.element('btnGoogle').disabled, false);
  assert.match(staleOAuth.message(), /account changed/i);

  let rejectOldRestore;
  const crossTabError = harness(async () => response({}), async () => ({}), 'login', () => new Promise((_resolve, reject) => { rejectOldRestore = reject; }));
  crossTabError.window.App.AccountStorage.prepareSignIn(otherSession, [['fw_session_v1', JSON.stringify(otherSession)]]);
  rejectOldRestore(new Error('Stale OAuth failure')); await flushRestore();
  assert.equal(crossTabError.message(), '', 'obsolete restoration error must not publish after a cross-tab account change');

  for (const key of ['od_session_v1', 'od_auth_v1', 'od_locked_username_v2', 'fw_session_v1']) {
    const h = harness(async () => response({ token: 'replacement-token', user: { id: 'b', email: 'b@example.test' } }));
    if (key !== 'fw_session_v1') h.element('identifier').value = 'isolated-sleeper';
    h.stored.set('fw_session_v1', JSON.stringify({ token: 'previous-token', user: { id: 'a' } }));
    h.failWriteOn(key);
    await h.fire('panelSignin', 'submit');
    assert.equal(h.success(), false);
    assert.equal(h.element('btnSignin').disabled, false, `${key}: storage failure must allow retry`);
    assert.match(h.message(), /could not save the session/);
    assert.equal(JSON.parse(h.stored.get('fw_session_v1')).token, 'previous-token', 'failed replacement must preserve old account session');
    assert.equal(h.stored.has('od_session_v1'), false);
    h.failWriteOn('');
    await h.fire('panelSignin', 'submit');
    assert.equal(h.success(), true, 'storage recovery can retry');
  }

  const switched = harness(async () => response({token:'account-b-token',user:{id:'b',email:'b@example.test'}}));
  switched.stored.set('fw_session_v1',JSON.stringify({token:'account-a-token',user:{id:'a',email:'a@example.test'}}));
  switched.stored.set('wr_active_connection_owner_v1','account:a');
  switched.stored.set('od_auth_v1',JSON.stringify({username:'account-a-leagues'}));
  switched.stored.set('od_profile_v1',JSON.stringify({onboardingComplete:true,displayName:'Account A'}));
  switched.stored.set('wr_account_v1:account%3Aa:empire_decisions_v1','private plans stay stored');
  await switched.fire('panelSignin','submit');
  assert.equal(switched.success(),true);
  assert.equal(JSON.parse(switched.stored.get('fw_session_v1')).user.id,'b');
  assert.equal(switched.stored.has('od_auth_v1'),false,'new account cannot inherit previous league connection');
  assert.equal(switched.stored.has('od_profile_v1'),false,'new account cannot inherit completed onboarding');
  assert([...switched.stored].some(([key,value])=>key.startsWith('wr_account_context_v1:account%3Aa:')&&value.includes('account-a-leagues')),'old connection remains recoverable');
  assert.equal(switched.stored.get('wr_account_v1:account%3Aa:empire_decisions_v1'),'private plans stay stored');

  const legacyToken='test.'+Buffer.from(JSON.stringify({app_metadata:{sleeper_username:'legacy-owner'}})).toString('base64url')+'.signature';
  const legacy=harness(async()=>response({token:legacyToken}));
  legacy.element('identifier').value='legacy-owner';
  await legacy.fire('panelSignin','submit');
  assert.equal(legacy.success(),true,'signed legacy token supplies its isolated account identity');
  assert.equal(legacy.stored.get('wr_active_connection_owner_v1'),'legacy:legacy-owner');
  assert.equal(JSON.parse(legacy.stored.get('od_auth_v1')).username,'legacy-owner');

  for (const [body, status] of [[{}, 200], [{ error: 'Expired link' }, 400]]) {
    const h = harness(async () => response(body, status), null, 'reset');
    await h.fire('resetForm', 'submit');
    assert.match(h.element('alert').className, /alert-error/);
    assert.equal(h.element('resetForm').classList.contains('hidden'), false);
    assert.equal(h.element('submitBtn').disabled, false);
  }
  const reset = harness(async () => response({ ok: true }), null, 'reset');
  await reset.fire('resetForm', 'submit');
  assert.match(reset.element('alert').className, /alert-success/);
  assert.equal(reset.element('resetForm').classList.contains('hidden'), true);

  console.log('PASS auth request recovery: offline/server/malformed reset, retry, session validation, duplicate submissions, timeout, OAuth rejection and confirmed password changes');
})().catch(err => { console.error(err); process.exitCode = 1; });
