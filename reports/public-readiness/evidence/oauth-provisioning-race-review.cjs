'use strict';
// Read-only independent review: execute the target's actual handler with a
// controlled in-memory database. Never contacts a backend or handles secrets.
const assert = require('node:assert/strict');
const path = require('node:path');
const target = path.resolve(process.argv[2] || '/Users/jacobc/Projects/warroom-readiness-hosted-reconcile');
const load = require(path.join(target, 'tests/helpers/security-ts-loader.cjs'));
const email = 'oauth-provisioning-race@example.invalid';
const state = { user: null, minted: [], deleted: 0 };
let releaseSubscription, subscriptionStarted;
const started = new Promise(resolve => { subscriptionStarted = resolve; });
const subscription = new Promise(resolve => { releaseSubscription = resolve; });
const admin = {
  auth: { getUser: async () => ({data: {user: {id: 'fixture-auth', email, email_confirmed_at: '2026-09-20T00:00:00Z', app_metadata: {provider: 'google'}}}}) },
  from(table) {
    const q = {
      mode: 'read', values: null,
      select() { return this; }, eq() { return this; }, in() { return this; },
      insert(values) { this.mode = 'insert'; this.values = values; return this; },
      update(values) { this.mode = 'update'; this.values = values; return this; },
      delete() { this.mode = 'delete'; return this; },
      async execute(single) {
        if (table === 'subscriptions') {
          if (this.mode === 'insert') { subscriptionStarted(); return subscription; }
          return {data: []};
        }
        assert.equal(table, 'app_users');
        if (this.mode === 'insert') state.user = {id: 'fixture-app', session_version: 1, ...this.values};
        if (this.mode === 'delete') { state.deleted++; state.user = null; }
        if (this.mode === 'update') Object.assign(state.user, this.values);
        return {data: single ? (state.user ? {...state.user} : null) : []};
      },
      maybeSingle() { return this.execute(true); }, single() { return this.execute(true); },
      then(resolve, reject) { return this.execute(false).then(resolve, reject); },
    };
    return q;
  },
};
const security = load('supabase/functions/_shared/security.ts').context;
const entitlements = load('supabase/functions/_shared/entitlements.ts').context;
const handler = load('supabase/functions/fw-oauth-sync/index.ts', {
  createClient: () => admin, handleOptions: () => null,
  json: (_req, body, status = 200) => ({body, status}),
  normalizeEmail: security.normalizeEmail, bearerToken: security.bearerToken, decodeJwtPayload: security.decodeJwtPayload,
  auditEvent: async () => {}, checkRateLimit: async () => ({allowed: true}), clientIp: () => 'fixture-ip',
  resolveEntitlements: entitlements.resolveEntitlements,
  mintAppSessionJWT: async args => { state.minted.push(args); return 'fixture-token'; },
  console: {error: () => {}},
}).handler;
const token = 'header.' + Buffer.from(JSON.stringify({sub: 'fixture-auth', app_metadata: {provider: 'google'}})).toString('base64url') + '.signature';
const request = () => new Request('https://example.invalid/fw-oauth-sync', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token}, body: '{}'});
(async () => {
  const first = handler(request());
  await started;
  const concurrent = await handler(request());
  assert.equal(concurrent.status, 200, 'the exposed account is resumable before initial subscription completes');
  assert.equal(concurrent.body.user.id, 'fixture-app');
  releaseSubscription({error: {message: 'controlled initial subscription failure'}});
  const failed = await first;
  console.log(JSON.stringify({firstStatus: failed.status, concurrentStatus: concurrent.status, concurrentId: concurrent.body.user.id, issuedTokens: state.minted.length, deletedAccounts: state.deleted, accountStillPresent: !!state.user}));
  assert.equal(state.user?.id, 'fixture-app', 'Failed original provisioning must not delete an account already resumed by another successful sign-in');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
