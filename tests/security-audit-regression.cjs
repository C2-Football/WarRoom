'use strict';
const assert = require('node:assert/strict');
const { createHash, pbkdf2Sync } = require('node:crypto');
const load = require('./helpers/security-ts-loader.cjs');
const sha256Hex = async text => createHash('sha256').update(text).digest('hex');
const base = {
  handleOptions: () => null,
  json: (_req, body, status = 200) => ({ body, status }),
  auditEvent: async () => {}, checkRateLimit: async () => ({ allowed: true }),
  clientIp: () => 'test-ip',
};

async function gifts() {
  let isAdmin = false, session = { userId: 'ordinary-user' }, legacy = null;
  let existing = null, rpcCalls = 0, canCreate = true, changed = true, fetches = 0;
  const db = {
    from() { return {
      select() { return this; }, eq() { return this; },
      update() { this.changing = true; return this; },
      async maybeSingle() { return { data: this.changing ? (changed ? { sleeper_username: 'target' } : null) : existing }; },
    }; },
    async rpc(name, args) {
      assert.equal(name, 'provision_gift_password');
      assert.equal(args.p_actor, session.userId);
      rpcCalls++;
      return { data: canCreate, error: null };
    },
  };
  const { handler } = load('supabase/functions/set-password/index.ts', {
    ...base, createClient: () => db, requireActiveAppSession: async () => session,
    requireSleeperSession: async () => legacy, hasAdminRole: async () => isAdmin,
    bcrypt: { hash: async () => 'synthetic-bcrypt' },
    fetch: async () => { fetches++; return { ok: true, json: async () => ({ user_id: 'target-sleeper' }) }; },
  });
  const call = (patch = {}, method = 'POST') => handler({ method, json: async () => ({ username: 'target', password: 'synthetic-password', ...patch }) });
  assert.equal((await call()).status, 403);
  assert.equal(rpcCalls, 0); assert.equal(fetches, 0);
  session = null;
  assert.equal((await call()).status, 401);
  session = { userId: 'admin-user' }; isAdmin = true;
  assert.equal((await call()).status, 200); assert.equal(rpcCalls, 1);
  canCreate = false; // A competing request set the password after the lookup.
  assert.equal((await call()).status, 409);
  existing = { sleeper_username: 'target', password_hash: 'existing-hash' };
  assert.equal((await call()).status, 409);
  session = null; legacy = { username: 'different-user' };
  assert.equal((await call()).status, 403);
  legacy = { username: 'target' };
  assert.equal((await call()).status, 200);
  changed = false;
  assert.equal((await call()).status, 409);
  assert.equal((await call({}, 'GET')).status, 405);
  assert.equal((await call({ password: { length: 12 } })).status, 400);
  console.log('PASS gift authorization, administrator provisioning, self-change and conflicting writes');
}

async function plans() {
  const salt = Buffer.alloc(16, 1), password = 'synthetic-password';
  const hash = salt.toString('hex') + ':' + pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  let claims;
  class JWT {
    constructor(payload) { claims = payload; }
    setProtectedHeader() { return this; } setIssuer() { return this; } setSubject() { return this; }
    setIssuedAt() { return this; } setExpirationTime() { return this; }
    async sign() { return 'synthetic-token'; }
  }
  const signDb = { from(table) { return {
    select() { return this; }, eq() { return this; }, update() { return this; },
    async maybeSingle() { return { data: { id: 'free-user', email: 'test@example.invalid', password_hash: hash, session_version: 1 } }; },
    then(resolve) { resolve({ data: table === 'subscriptions' ? [{ product_slug: 'bundle', tier: 'free', status: 'active' }] : null, error: null }); },
  }; } };
  const signin = load('supabase/functions/fw-signin/index.ts', {
    ...base, createClient: () => signDb, normalizeEmail: s => s.toLowerCase(), clearRateLimit: async () => {}, SignJWT: JWT,
  });
  assert.equal((await signin.handler({ method: 'POST', json: async () => ({ email: 'test@example.invalid', password }) })).status, 200);
  assert.equal(claims.app_metadata.tier, 'free');
  assert.deepEqual(Array.from(claims.app_metadata.products), ['war_room', 'dynast_hq']);
  let rows = [{ product_slug: 'bundle', tier: 'free', status: 'active' }], admin = false;
  const db = { from() { return { select() { return this; }, eq() { return this; }, in() { return this; } }; } };
  const ai = load('supabase/functions/ai-analyze/index.ts', {
    hasAdminRole: async () => admin, safeSupabaseData: async () => rows,
  }, ['loadAppAIPlan']);
  const resolve = payload => ai.context.loadAppAIPlan(db, 'free-user', payload || claims);
  assert.equal((await resolve()).plan, 'free');
  rows = [];
  assert.equal((await resolve({ app_metadata: { tier: 'pro', products: ['war_room', 'dynast_hq'] } })).plan, 'free');
  rows = null; // Database lookup failure cannot resurrect the JWT tier.
  assert.equal((await resolve({ app_metadata: { tier: 'pro' } })).plan, 'free');
  for (const [product, plan] of [['bundle', 'pro'], ['war_room', 'warroom'], ['dynast_hq', 'scout']]) {
    rows = [{ product_slug: product, tier: 'pro', status: 'active' }];
    assert.equal((await resolve()).plan, 'free');
  }
  admin = true;
  assert.equal((await resolve()).plan, 'free');
  console.log('PASS free-bundle signin claims stay free; old paid claims do not change free AI policy');
}

async function rateFailure() {
  const { context } = load('supabase/functions/_shared/security.ts', {}, ['checkRateLimit']);
  for (const rpc of [async () => ({ error: { message: 'offline' } }), async () => { throw Error('offline'); }, async () => ({ data: null })]) {
    assert.equal((await context.checkRateLimit({ rpc }, 'test', 'user', { limit: 8, windowSeconds: 900 })).allowed, false);
  }
  console.log('PASS authentication rate limiter denies requests when storage fails');
}

async function yahoo() {
  const states = new Map(), savedTokens = new Map();
  let active = true, sessionVersion = 1, exchanges = 0;
  const db = { from(table) {
    const filters = [], q = { verb: 'read', value: null,
      select() { return this; },
      eq(key, val) { filters.push(r => r[key] === val); return this; },
      is(key, val) { filters.push(r => (r[key] ?? null) === val); return this; },
      gt(key, val) { filters.push(r => r[key] > val); return this; },
      lt(key, val) { filters.push(r => r[key] < val); return this; },
      update(value) { this.verb = 'update'; this.value = value; return this; },
      delete() { this.verb = 'delete'; return this; },
      async insert(row) { states.set(row.state_hash, { ...row, browser_hash: null }); return { error: null }; },
      async upsert(row) { savedTokens.set(row.session_id, row); return { error: null }; },
      async maybeSingle() {
        if (table === 'app_users') return { data: { session_version: sessionVersion } };
        const row = [...states.values()].find(row => filters.every(f => f(row)));
        if (!row) return { data: null };
        if (this.verb === 'delete') states.delete(row.state_hash);
        if (this.verb === 'update') Object.assign(row, this.value);
        return { data: { ...row }, error: null };
      },
      then(resolve) { this.maybeSingle().then(resolve); },
    }; return q;
  } };
  const { handler } = load('supabase/functions/yahoo-proxy/index.ts', {
    ...base, sha256Hex, createClient: () => db, corsHeaders: () => ({}),
    requireActiveAppSession: async () => active ? { userId: 'owner', sessionVersion } : null,
    requireSleeperSession: async () => null,
    isAllowedBrowserUrl: value => new URL(value).origin === 'https://warroom.skjjcruz.com',
    fetch: async () => { exchanges++; return { ok: true, json: async () => ({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' }) }; },
  });
  const endpoint = 'https://example.test/yahoo';
  const post = body => handler(new Request(endpoint, { method: 'POST', body: JSON.stringify(body) }));
  async function start() {
    const response = await post({ action: 'auth_url', return_url: 'https://warroom.skjjcruz.com/index.html?vault=1' });
    assert.equal(response.status, 200);
    const url = (await response.json()).auth_url;
    const first = await handler(new Request(url));
    assert.equal(first.status, 302);
    assert.match(first.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
    const state = new URL(first.headers.get('location')).searchParams.get('state');
    assert.match(state, /^[a-f0-9]{64}$/);
    return { state, cookie: first.headers.get('set-cookie').split(';')[0], url };
  }
  const callback = (flow, cookie = flow.cookie) => handler(new Request(endpoint + '?code=synthetic-code&state=' + flow.state, { headers: cookie ? { Cookie: cookie } : {} }));
  const forged = btoa(JSON.stringify({ ownerKey: 'app:victim', nonce: 'never-issued' }));
  assert.equal((await handler(new Request(endpoint + '?code=x&state=' + encodeURIComponent(forged)))).status, 400);
  assert.equal(exchanges, 0);
  const good = await start();
  assert.equal((await handler(new Request(good.url))).status, 400, 'start token cannot rebind the browser');
  assert.equal((await callback(good, '')).status, 400);
  assert.equal((await callback(good, good.cookie.split('=')[0] + '=wrong')).status, 400);
  assert.equal(exchanges, 0);
  const success = await callback(good);
  assert.equal(success.status, 302);
  const redirect = new URL(success.headers.get('location'));
  assert.equal(redirect.searchParams.get('vault'), '1');
  assert.equal(savedTokens.get(redirect.searchParams.get('yahoo_session')).owner_key, 'app:owner');
  assert.equal((await callback(good)).status, 400, 'callback cannot replay');
  const concurrent = await start();
  const responses = await Promise.all([callback(concurrent), callback(concurrent)]);
  assert.equal(responses.filter(r => r.status === 302).length, 1);
  const expired = await start();
  states.get(await sha256Hex(expired.state)).expires_at = new Date(0).toISOString();
  assert.equal((await callback(expired)).status, 400);
  const revoked = await start(); sessionVersion++;
  assert.equal((await callback(revoked)).status, 401);
  active = false;
  for (const action of ['auth_url', 'api', 'refresh']) assert.equal((await post({ action, endpoint: '/users', session_id: 'known' })).status, 401);
  console.log('PASS Yahoo valid flow, browser binding, forged/expired/replayed state, concurrent callbacks and revoked sessions');
}

(async () => { await gifts(); await plans(); await rateFailure(); await yahoo(); })().catch(error => { console.error(error); process.exitCode = 1; });
