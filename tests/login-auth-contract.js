#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'login.html'), 'utf8');

assert(html.includes('fw-signin'), 'login must use the current email sign-in function');
assert(html.includes('get-session-token'), 'login must preserve password-backed Sleeper username sign-in');
assert(html.includes('fw-signup'), 'login must offer current account creation');
assert(html.includes("const SESSION_KEY = 'fw_session_v1'"), 'login must store the current app session');
assert(html.includes("const LEGACY_SESSION_KEY = 'od_session_v1'"), 'login must store legacy sessions where the shared data layer expects them');
assert(html.includes("const LEGACY_AUTH_KEY = 'od_auth_v1'"), 'login must preserve the Sleeper username for the app');
assert(html.includes('signInWithOAuth'), 'login must support current OAuth sign-in');
assert(html.includes("startOAuth('google'"), 'login must support Google');
assert(html.includes("startOAuth('apple'"), 'login must support Apple');
assert(html.includes('Email or Sleeper username'), 'sign-in must clearly accept either account identifier');
assert(html.includes("const isEmail = identifier.includes('@')"), 'sign-in must route email and username accounts separately');
assert(!html.includes('passwordHash'), 'login must never store a password-derived value in browser storage');

// Execute the real restoration and routing code with isolated browser state.
// Game entry needs an app-account ID; an unrelated Supabase OAuth session must
// neither overwrite that identity nor let an OAuth-only user skip email login.
const sessionConfig = html.slice(html.indexOf('    const SESSION_KEY ='), html.indexOf('    const messageEl ='));
const destinationSource = html.slice(html.indexOf('    function destination()'), html.indexOf('    function showMessage('));
const restoreSource = html.match(/\(async function restoreSession\(\) \{[\s\S]*?\}\)\(\);/)?.[0];
assert(sessionConfig.includes('const GAME_LOGIN'), 'the actual game-entry configuration must be available to the behavior harness');
assert(destinationSource.includes('return WARROOM_URL'), 'the actual destination router must be available to the behavior harness');
assert(restoreSource, 'the actual session restoration function must be available to the behavior harness');

async function restore({ search = '', appSession, legacySession, legacyAuth, oauthSession = null, profile, pendingInvite = false, clientAvailable = true }) {
  const stored = new Map();
  for (const [key, value] of [
    ['fw_session_v1', appSession], ['od_session_v1', legacySession],
    ['od_auth_v1', legacyAuth], ['od_profile_v1', profile],
  ]) if (value !== undefined) stored.set(key, JSON.stringify(value));
  const writes = [];
  let oauthReads = 0;
  const location = { search, href: 'login.html' + search };
  const context = {
    URLSearchParams,
    window: { location },
    localStorage: {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => { writes.push({ key, value }); stored.set(key, String(value)); },
    },
    sessionStorage: { getItem: key => key === 'tl-pending-invite-v1' && pendingInvite ? 'pending-invite' : null },
    getSbClient: () => clientAvailable ? { auth: { getSession: async () => {
      oauthReads += 1;
      return { data: { session: oauthSession } };
    } } } : null,
  };
  await vm.runInNewContext(sessionConfig + '\n' + destinationSource + '\n' + restoreSource, context, { timeout: 1000 });
  return { href: location.href, writes, oauthReads, session: JSON.parse(stored.get('fw_session_v1') || 'null') };
}

(async () => {
  let scenarios = 0;
  const appSession = { token: 'app-account-token', user: { id: 'app-user-123', email: 'owner@example.test', displayName: 'Owner' } };
  const oauthSession = { access_token: 'oauth-only-token', user: { id: 'supabase-user-456', email: 'other@example.test', user_metadata: { full_name: 'Other Account' } } };
  const oauthShapedAppSession = { token: 'oauth-only-token', user: { email: 'other@example.test', displayName: 'Other Account' } };
  const gameEntries = [
    { label: 'Duat', search: '?duat=1', destination: 'index.html?duat=1' },
    { label: 'Vault', search: '?vault=1', destination: 'index.html?vault=1' },
    { label: 'pending Vault invitation', search: '', pendingInvite: true, destination: 'index.html?vault=1' },
  ];
  for (const entry of gameEntries) {
    const restored = await restore({ ...entry, appSession, oauthSession });
    assert.strictEqual(restored.href, entry.destination, `${entry.label}: an app-account session returns to the requested game`);
    assert.deepStrictEqual(restored.session, appSession, `${entry.label}: OAuth must not replace the app-account identity`);
    assert.strictEqual(restored.oauthReads, 0, `${entry.label}: game restoration must not query an unrelated OAuth session`);
    assert.deepStrictEqual(restored.writes, [], `${entry.label}: restoring the app-account session must not rewrite it`);
    scenarios += 1;

    const oauthOnly = await restore({ ...entry, oauthSession });
    assert.strictEqual(oauthOnly.href, 'login.html' + entry.search, `${entry.label}: OAuth alone cannot skip game account sign-in`);
    assert.strictEqual(oauthOnly.session, null, `${entry.label}: OAuth must not manufacture an app-account session`);
    assert.strictEqual(oauthOnly.oauthReads, 0);
    scenarios += 1;

    const cachedWithoutId = await restore({ ...entry, appSession: oauthShapedAppSession, oauthSession,
      legacySession: { token: 'legacy-token' }, legacyAuth: { username: 'sleeper-only-user' } });
    assert.strictEqual(cachedWithoutId.href, 'login.html' + entry.search, `${entry.label}: cached OAuth and Sleeper-only sessions still require an app-account ID`);
    assert.deepStrictEqual(cachedWithoutId.session, oauthShapedAppSession);
    assert.deepStrictEqual(cachedWithoutId.writes, []);
    scenarios += 1;

    const missingToken = await restore({ ...entry, appSession: { user: appSession.user } });
    assert.strictEqual(missingToken.href, 'login.html' + entry.search, `${entry.label}: a user ID without an app token is not a session`);
    scenarios += 1;
  }

  const genericOAuth = await restore({ oauthSession });
  assert.strictEqual(genericOAuth.oauthReads, 1, 'ordinary sign-in retains OAuth session restoration');
  assert.strictEqual(genericOAuth.href, 'onboarding.html', 'ordinary OAuth users without a profile continue to onboarding');
  assert.deepStrictEqual(genericOAuth.session, { token: 'oauth-only-token', user: { email: 'other@example.test', displayName: 'Other Account' } });
  assert.strictEqual(genericOAuth.writes.length, 1);
  scenarios += 1;

  const genericReturningOAuth = await restore({ oauthSession, profile: { onboardingComplete: true } });
  assert.strictEqual(genericReturningOAuth.href, 'index.html', 'ordinary returning OAuth users continue to Dynasty HQ');
  assert.strictEqual(genericReturningOAuth.oauthReads, 1);
  scenarios += 1;

  const genericApp = await restore({ appSession, profile: { onboardingComplete: true } });
  assert.strictEqual(genericApp.href, 'index.html', 'ordinary email-account sessions remain restorable');
  assert.deepStrictEqual(genericApp.session, appSession);
  scenarios += 1;

  const genericLegacy = await restore({ clientAvailable: false, legacySession: { token: 'legacy-token' }, legacyAuth: { username: 'sleeper-owner' } });
  assert.strictEqual(genericLegacy.href, 'index.html', 'ordinary Sleeper username session restoration remains supported');
  scenarios += 1;

  console.log(`login auth contract ok (${scenarios} session restoration scenarios)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
