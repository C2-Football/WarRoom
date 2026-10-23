'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../js/shared/dashboard-reminders.js'), 'utf8');
const clean = value => JSON.parse(JSON.stringify(value));
const token = (id = 'account-one', extra = {}) => 'header.' + Buffer.from(JSON.stringify({ sub: id, exp: Date.now() / 1000 + 3600,
    app_metadata: { user_id: id, session_version: 1 }, ...extra })).toString('base64url') + '.signature';
const scope = 'account-one:league-one';
const draft = { id: 'rem_one', viewId: 'alex_view_1', title: 'Check my roster', channel: 'email',
    schedule: { frequency: 'weekly', day: 2, time: '09:00', timeZone: 'America/Chicago' } };
const remote = (value = draft, extra = {}) => ({ ...clean(value), state: 'enabled', revision: 1, nextRunAt: '2026-11-01T15:00:00Z', ...extra });
const envelope = extra => ({ version: 1, accountId: 'account-one', leagueId: 'league-one',
    channels: { email: { available: true, recipientVerified: true }, push: { available: false } }, reminders: [], ...extra });
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
function setup() {
    const storage = new Map(), requests = [];
    const sessionToken = token();
    const root = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
        atob: value => Buffer.from(value, 'base64').toString('binary'), AbortController, TextEncoder, setTimeout, clearTimeout,
        crypto: crypto.webcrypto, OD: { getSessionToken: () => sessionToken, CONFIG: { supabaseUrl: 'https://project.invalid', supabaseAnon: 'public' } } };
    let response = envelope();
    root.fetch = async (url, options) => { requests.push({ url, ...options }); return { ok: true, status: 200, json: async () => response }; };
    vm.runInNewContext(source, { window: root, console, URL, Intl });
    return { root, storage, requests, api: root.WR.DashboardReminders, respond: value => { response = value; } };
}
async function service(fixture) { return fixture.api.checkService({ scope, leagueId: 'league-one' }); }

async function main() {
    await check('daily and weekly schedules retain explicit timezone and reject invalid values', () => {
        const { api } = setup();
        assert.deepEqual(clean(api.validateSchedule(draft.schedule)), draft.schedule);
        assert.equal(api.validateSchedule({ ...draft.schedule, frequency: 'daily', day: 9 }).day, null);
        for (const change of [{ frequency: 'hourly' }, { time: '24:00' }, { time: '9:00' }, { time: '12:70' }, { timeZone: 'Mars/Olympus' }, { day: 7 }, { day: '2' }]) {
            assert.throws(() => api.validateSchedule({ ...draft.schedule, ...change }));
        }
        assert.match(api.scheduleLabel(draft.schedule), /Tuesday.*09:00.*America\/Chicago/);
    });
    await check('draft saves persist without any network, notification permission, or active claim', () => {
        const fixture = setup(), { api, requests, storage } = fixture;
        let permissionCalls = 0;
        fixture.root.Notification = { requestPermission: () => { permissionCalls++; } };
        const saved = api.saveDraft(scope, { ...draft, state: 'enabled', recipient: 'someone@example.com' }, 0);
        assert.equal(saved.revision, 1);
        assert.deepEqual(clean(api.read(scope).reminders), [draft]);
        assert.equal(requests.length, 0); assert.equal(permissionCalls, 0);
        assert.equal(api.statusLabel(saved.reminders[0], null), 'Delivery not connected');
        assert.doesNotMatch([...storage.values()].join(), /enabled|recipient|Bearer|token/);
    });
    await check('local drafts are isolated by account and league', () => {
        const { api } = setup();
        api.saveDraft(scope, draft, 0);
        assert.equal(api.read('account-two:league-one').reminders.length, 0);
        assert.equal(api.read('account-one:league-two').reminders.length, 0);
        api.saveDraft('account-two:league-one', { ...draft, title: 'Other account' }, 0);
        assert.equal(api.read(scope).reminders[0].title, draft.title);
    });
    await check('stale tabs cannot overwrite or delete newer reminder drafts', () => {
        const { api } = setup();
        api.saveDraft(scope, draft, 0);
        assert.throws(() => api.saveDraft(scope, { ...draft, title: 'Stale' }, 0), /another tab/);
        assert.throws(() => api.removeDraft(scope, draft.id, 0), /another tab/);
        assert.equal(api.removeDraft(scope, draft.id, 1).reminders.length, 0);
    });
    await check('corrupt storage and failed persistence retain honest failure states', () => {
        const { api, storage, root } = setup();
        storage.set('wr_dashboard_reminders_v1:' + scope, 'broken');
        assert.throws(() => api.saveDraft(scope, draft, 0), /could not be read/);
        assert.equal(storage.get('wr_dashboard_reminders_v1:' + scope), 'broken');
        storage.clear(); root.localStorage.setItem = () => { throw new Error('quota'); };
        assert.throws(() => api.saveDraft(scope, draft, 0), /could not be saved/);
    });
    await check('missing, expired, inconsistent and wrong-scope accounts never contact the service', async () => {
        for (const jwt of [null, token('account-one', { exp: 1 }), token('account-one', { app_metadata: { user_id: 'account-two', session_version: 1 } }), token('account-one', { app_metadata: {} })]) {
            const fixture = setup(); fixture.root.OD.getSessionToken = () => jwt;
            assert.equal((await service(fixture)).status, 'unavailable'); assert.equal(fixture.requests.length, 0);
        }
        const fixture = setup();
        await fixture.api.checkService({ scope: 'account-two:league-one', leagueId: 'league-one' });
        assert.equal(fixture.requests.length, 0);
    });
    await check('unavailable service cannot enable and checking never sends a notification', async () => {
        const fixture = setup();
        fixture.root.fetch = async (url, options) => { fixture.requests.push({ url, ...options }); return { ok: false, status: 404, json: async () => ({}) }; };
        const result = await service(fixture);
        assert.equal(result.status, 'unavailable');
        await assert.rejects(fixture.api.configure({ scope, leagueId: 'league-one', draft, service: result, viewSaved: true }), /Check delivery status/);
        assert.equal(fixture.requests.length, 1); assert.equal(fixture.requests[0].method, 'GET');
    });
    await check('unverified email and fabricated/mutated capability state cannot authorize enable', async () => {
        const fixture = setup();
        fixture.respond(envelope({ channels: { email: { available: true, recipientVerified: false }, push: { available: false } } }));
        const result = await service(fixture);
        assert.equal(result.channels.email.ready, false);
        result.channels.email.ready = true;
        await assert.rejects(fixture.api.configure({ scope, leagueId: 'league-one', draft, service: result, viewSaved: true }), /Delivery not connected/);
        await assert.rejects(fixture.api.configure({ scope, leagueId: 'league-one', draft, service: { channels: { email: { ready: true } } }, viewSaved: true }), /Check delivery status/);
        assert.equal(fixture.requests.length, 1);
    });
    await check('an unsaved dashboard view cannot be enabled', async () => {
        const fixture = setup(), result = await service(fixture);
        await assert.rejects(fixture.api.configure({ scope, leagueId: 'league-one', draft, service: result }), /Save this view/);
        assert.equal(fixture.requests.length, 1);
    });
    await check('explicit enable needs authenticated capability and exact durable acknowledgement', async () => {
        const fixture = setup(), result = await service(fixture);
        fixture.respond(envelope({ reminder: remote() }));
        const confirmed = await fixture.api.configure({ scope, leagueId: 'league-one', draft, service: result, viewSaved: true });
        assert.equal(confirmed.state, 'enabled');
        assert.equal(fixture.requests[1].method, 'POST');
        const body = JSON.parse(fixture.requests[1].body);
        assert.equal(body.action, 'enable'); assert.equal(body.expectedRevision, 0);
        assert.deepEqual(body.reminder, draft); assert.ok(body.operationId);
        assert.equal(body.recipient, undefined); assert.equal(body.accountId, undefined);
        await assert.rejects(fixture.api.configure({ scope, leagueId: 'league-one', draft, service: result, viewSaved: true }), /Check delivery status/);
    });
    await check('partial, mismatched and wrong-account server confirmations never become active', async () => {
        for (const mutation of [envelope({ reminder: remote(draft, { nextRunAt: null }) }), envelope({ reminder: remote({ ...draft, channel: 'push' }) }),
            envelope({ accountId: 'account-two', reminder: remote() })]) {
            const fixture = setup(), result = await service(fixture);
            fixture.respond(mutation);
            await assert.rejects(fixture.api.configure({ scope, leagueId: 'league-one', draft, service: result, viewSaved: true }));
            assert.equal(fixture.api.statusLabel(draft, null), 'Delivery not connected');
        }
    });
    await check('network failure after enable consumes capability until reconciliation', async () => {
        const fixture = setup(), result = await service(fixture);
        fixture.root.fetch = async () => { throw new TypeError('Network unavailable'); };
        await assert.rejects(fixture.api.configure({ scope, leagueId: 'league-one', draft, service: result, viewSaved: true }), /not confirmed.*Check delivery status/);
        await assert.rejects(fixture.api.configure({ scope, leagueId: 'league-one', draft, service: result, viewSaved: true }), /Check delivery status/);
    });
    await check('account changes discard late capabilities and reject stale enable', async () => {
        const fixture = setup(), result = await service(fixture);
        fixture.root.OD.getSessionToken = () => token('account-two');
        await assert.rejects(fixture.api.configure({ scope, leagueId: 'league-one', draft, service: result, viewSaved: true }), /Check delivery status/);
        const late = setup();
        late.root.fetch = async () => { late.root.OD.getSessionToken = () => token('account-two'); return { ok: true, json: async () => envelope() }; };
        assert.equal((await service(late)).status, 'unavailable');
    });
    await check('push stays unavailable without a real matching browser subscription and never asks permission', async () => {
        const fixture = setup(); let prompts = 0;
        fixture.root.Notification = { permission: 'default', requestPermission: () => { prompts++; } };
        fixture.respond(envelope({ channels: { push: { available: true, subscriptionReady: true, deviceKey: 'fake' } } }));
        const result = await service(fixture);
        assert.equal(result.channels.push.ready, false); assert.equal(prompts, 0);
        await assert.rejects(fixture.api.configure({ scope, leagueId: 'league-one', draft: { ...draft, channel: 'push' }, service: result, viewSaved: true }), /Delivery not connected/);
        assert.equal(fixture.requests.length, 1);
    });
    await check('push readiness binds existing browser subscription hash to the authenticated service', async () => {
        const fixture = setup(); const endpoint = 'https://push.invalid/private-subscription';
        const deviceKey = crypto.createHash('sha256').update(endpoint).digest('hex');
        fixture.root.Notification = { permission: 'granted' };
        fixture.root.navigator = { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => ({ endpoint }) } }) } };
        fixture.respond(envelope({ channels: { push: { available: true, subscriptionReady: true, deviceKey } } }));
        const result = await service(fixture);
        assert.equal(result.channels.push.ready, true);
        assert.equal(new URL(fixture.requests[0].url).searchParams.get('deviceKey'), deviceKey);
        assert.doesNotMatch(fixture.requests[0].url, /private-subscription/);
        assert.equal(fixture.storage.size, 0);
    });
    await check('remote-only schedules stay visible after clearing local drafts and can be paused with delivery unavailable', async () => {
        const fixture = setup();
        fixture.respond(envelope({ channels: { email: { available: false }, push: { available: false } }, reminders: [remote()] }));
        const result = await service(fixture);
        assert.equal(fixture.api.read(scope).reminders.length, 0);
        assert.deepEqual(clean(fixture.api.mergeReminders([], result)), [draft]);
        assert.equal(fixture.api.statusLabel(draft, result), 'Scheduled');
        fixture.respond(envelope({ reminder: remote(draft, { state: 'paused', revision: 2, nextRunAt: null }) }));
        const paused = await fixture.api.configure({ scope, leagueId: 'league-one', draft, service: result, action: 'pause' });
        assert.equal(paused.state, 'paused'); assert.equal(JSON.parse(fixture.requests[1].body).expectedRevision, 1);
    });
    await check('local edited draft takes precedence while the earlier active schedule remains explicit', () => {
        const { api } = setup();
        const current = { ...draft, schedule: { ...draft.schedule, time: '10:00' } };
        const result = { status: 'ready', reminders: [remote()], channels: { email: { ready: true } } };
        assert.deepEqual(clean(api.mergeReminders([current], result)), [current]);
        assert.equal(api.statusLabel(current, result), 'Earlier schedule is active');
    });
    await check('component syntax is valid and touch controls and timezone fields are present', () => {
        const babel = require('@babel/standalone');
        const component = fs.readFileSync(path.join(__dirname, '../js/components/dashboard-reminders.js'), 'utf8');
        assert.doesNotThrow(() => babel.transform(component, { presets: ['react'] }));
        const css = fs.readFileSync(path.join(__dirname, '../dashboard-reminders.css'), 'utf8');
        assert.match(css, /min-height:44px/); assert.match(css, /max-width:359px/);
        assert.match(component, /Delivery not connected/); assert.match(component, /Save reminder draft/);
        assert.match(component, /savedViews/); assert.match(component, /api\.mergeReminders/);
    });
    console.log('\n' + checks + ' dashboard reminder groups passed; mocked service only, no real deliveries.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
