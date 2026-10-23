'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const { MessageChannel } = require('node:worker_threads');
const source = fs.readFileSync(path.join(__dirname, '../js/shared/dashboard-reminders.js'), 'utf8');
const clean = value => JSON.parse(JSON.stringify(value));
const token = (id = 'account-one', extra = {}) => 'header.' + Buffer.from(JSON.stringify({ sub: id, exp: Date.now() / 1000 + 3600,
    app_metadata: { user_id: id, session_version: 1 }, ...extra })).toString('base64url') + '.signature';
const scope = 'account-one:league-one';
const draft = { id: 'rem_one', viewId: 'alex_view_1', title: 'Check my roster', channel: 'email',
    schedule: { frequency: 'weekly', day: 2, time: '09:00', timeZone: 'America/Chicago' } };
const remote = (value = draft, extra = {}) => ({ ...clean(value), state: 'enabled', revision: 1, nextRunAt: '2026-11-01T15:00:00Z', ...extra });
const envelope = extra => ({ version: 1, accountId: 'account-one', leagueId: 'league-one',
    channels: { email: { available: true, recipientVerified: true, optedIn: true }, push: { available: false } }, reminders: [], ...extra });
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
function assertChannelPayload(body) {
    const fields = { 'email-start': ['action'], 'email-confirm': ['action', 'code'], 'email-disable': ['action'],
        'push-subscribe': ['action', 'subscription', 'deviceKey', 'appUrl'], 'push-unsubscribe': ['action', 'deviceKey'] };
    if (fields[body.action]) assert.deepEqual(Object.keys(body).sort(), fields[body.action].sort(), 'channel payload matches the strict backend contract');
}
function setup() {
    const storage = new Map(), requests = [];
    const sessionToken = token();
    const root = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
        atob: value => Buffer.from(value, 'base64').toString('binary'), AbortController, TextEncoder, MessageChannel, setTimeout, clearTimeout,
        isSecureContext: true, location: { href: 'https://dhqfootball.com/index.html' },
        crypto: crypto.webcrypto, OD: { getSessionToken: () => sessionToken, CONFIG: { supabaseUrl: 'https://project.invalid', supabaseAnon: 'public' } } };
    let response = envelope();
    root.fetch = async (url, options) => { if (options.method === 'POST') assertChannelPayload(JSON.parse(options.body)); requests.push({ url, ...options }); return { ok: true, status: 200, json: async () => response }; };
    vm.runInNewContext(source, { window: root, console, URL, Intl });
    return { root, storage, requests, api: root.WR.DashboardReminders, respond: value => { response = value; } };
}
async function service(fixture) { return fixture.api.checkService({ scope, leagueId: 'league-one' }); }


function pushFixture() {
    const fixture = setup();
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    const vapidPublicKey = ecdh.getPublicKey().toString('base64url');
    const state = { prompts: 0, subscribed: 0, unsubscribed: 0, registrations: 0, binding: null, remoteKey: null, events: [] };
    const endpoint = 'https://fcm.googleapis.com/fcm/send/test-device';
    const deviceKey = crypto.createHash('sha256').update(endpoint).digest('hex');
    const subscription = { endpoint, toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: vapidPublicKey, auth: Buffer.alloc(16, 1).toString('base64url') } }),
        unsubscribe: async () => { state.unsubscribed++; state.events.push('unsubscribe'); state.current = null; return true; } };
    const worker = { scriptURL: 'https://dhqfootball.com/dashboard-reminder-sw.js', postMessage: (message, ports) => {
        let response = { ok: true };
        if (message.type === 'dhq-reminder-bind') { state.binding = { accountId: message.accountId, deviceKey: message.deviceKey }; response.binding = state.binding; }
        if (message.type === 'dhq-reminder-binding') response.binding = state.binding;
        if (message.type === 'dhq-reminder-clear') {
            const previous = state.binding, cleared = previous?.accountId === message.accountId;
            if (cleared) state.binding = null;
            response = { ok: true, cleared, previous: cleared ? previous : null, binding: state.binding };
        }
        ports[0].postMessage(response);
    } };
    const registration = { active: worker, pushManager: { getSubscription: async () => state.current || null,
        subscribe: async options => { state.options = options; state.subscribed++; state.current = subscription; state.events.push('subscribe'); return subscription; } } };
    fixture.root.PushManager = function () {};
    fixture.root.Notification = { permission: 'default', requestPermission: () => { state.prompts++; state.events.push('permission'); fixture.root.Notification.permission = 'granted'; return Promise.resolve('granted'); } };
    fixture.root.navigator = { serviceWorker: { getRegistration: async () => registration, register: async (url, options) => { state.registrations++; state.registrationOptions = { url, options }; return registration; } } };
    fixture.root.fetch = async (url, options) => {
        fixture.requests.push({ url, ...options });
        if (options.method === 'GET') return { ok: true, status: 200, json: async () => envelope({ channels: { email: { available: true, recipientVerified: false, optedIn: false }, push: { available: true, vapidPublicKey, subscriptionReady: !!state.remoteKey, deviceKey: state.remoteKey } } }) };
        const body = JSON.parse(options.body); assertChannelPayload(body); state.events.push(body.action);
        if (body.action === 'push-subscribe') state.remoteKey = body.deviceKey;
        if (body.action === 'push-unsubscribe') state.remoteKey = null;
        return { ok: true, status: 200, json: async () => envelope({ leagueId: new URL(url).searchParams.get('leagueId'), action: body.action, ok: true, deviceKey: body.deviceKey }) };
    };
    return { ...fixture, state, registration, subscription, deviceKey, vapidPublicKey };
}

function workerFixture() {
    const listeners = {}, shown = [], opened = [], records = new Map(), notices = [];
    const db = { objectStoreNames: { contains: () => true }, close() {}, transaction() {
        const tx = { objectStore: () => ({ get(key) { const read = {}; queueMicrotask(() => { read.result = records.get(key); read.onsuccess(); queueMicrotask(() => tx.oncomplete()); }); return read; }, put(value,key) { records.set(key,value); }, delete(key) { records.delete(key); } }) }; return tx;
    } };
    const self = { addEventListener: (name, handler) => { listeners[name] = handler; }, skipWaiting() {}, registration: { scope: 'https://dhqfootball.com/',
        getNotifications: async () => notices, showNotification: async (title,options) => { shown.push({title,options}); } },
        clients: { claim: async () => {}, matchAll: async () => [], openWindow: async url => { opened.push(url); } } };
    const indexedDB = { open() { const request={ result:db }; queueMicrotask(()=>request.onsuccess()); return request; } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dashboard-reminder-sw.js'),'utf8'), { self, indexedDB, URL });
    async function dispatch(name,event) { let operation; listeners[name]({...event,waitUntil:promise=>{operation=promise;}}); await operation; }
    async function message(data,origin='https://dhqfootball.com/index.html') { let result; await dispatch('message',{data,source:{url:origin},ports:[{postMessage:value=>{result=value;}}]}); return result; }
    return { listeners,shown,opened,records,notices,self,dispatch,message };
}

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
        fixture.root.navigator = { serviceWorker: { getRegistration: async () => ({ active: { scriptURL: 'https://dhqfootball.com/dashboard-reminder-sw.js', postMessage: (_, ports) => ports[0].postMessage({ ok: true, binding: { accountId: 'account-one', deviceKey } }) }, pushManager: { getSubscription: async () => ({ endpoint }) } }) } };
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
    await check('email opt-in requires explicit verified acknowledgement and never submits a recipient', async () => {
        const fixture=setup(); fixture.respond(envelope({channels:{email:{available:true,recipientVerified:false,optedIn:false,maskedEmail:'j***@example.com',verificationPending:false},push:{available:false}}}));
        const fresh=await service(fixture);
        fixture.respond(envelope({action:'email-start',ok:true}));
        await fixture.api.channelAction({scope,leagueId:'league-one',service:fresh,action:'email-start'});
        const body=JSON.parse(fixture.requests.at(-1).body);
        assert.equal(body.action,'email-start'); assert.equal(body.email,undefined); assert.equal(body.recipient,undefined);
        await assert.rejects(fixture.api.channelAction({scope,leagueId:'league-one',service:fresh,action:'email-start'}),/Check delivery status/);
        fixture.respond(envelope({channels:{email:{available:true,verificationPending:true},push:{available:false}}}));
        const pending=await service(fixture);
        await assert.rejects(fixture.api.channelAction({scope,leagueId:'league-one',service:pending,action:'email-confirm',code:'12a456'}),/six-digit/);
        fixture.respond(envelope({action:'email-confirm',ok:true}));
        await fixture.api.channelAction({scope,leagueId:'league-one',service:pending,action:'email-confirm',code:'123456'});
        assert.equal(JSON.parse(fixture.requests.at(-1).body).code,'123456');
        assert.equal(fixture.storage.size,0,'confirmation code is never persisted');
    });
    await check('verified email without reminder opt-in stays unavailable and disabling needs acknowledgement', async () => {
        const fixture=setup(); fixture.respond(envelope({channels:{email:{available:true,recipientVerified:true,optedIn:false},push:{available:false}}}));
        const fresh=await service(fixture); assert.equal(fresh.channels.email.ready,false);
        fixture.respond(envelope({action:'email-disable',ok:true}));
        await fixture.api.channelAction({scope,leagueId:'league-one',service:fresh,action:'email-disable'});
        const unconfirmed=await service(setup());
        const other=setup();
        await assert.rejects(other.api.channelAction({scope,leagueId:'league-one',service:unconfirmed,action:'email-disable'}),/Check delivery status/);
    });
    await check('push support distinguishes insecure, blocked and iOS installation requirements', () => {
        const fixture=pushFixture(); assert.equal(fixture.api.pushSupport().supported,true);
        fixture.root.isSecureContext=false; assert.match(fixture.api.pushSupport().reason,/secure connection/);
        fixture.root.isSecureContext=true; fixture.root.navigator.userAgent='iPhone';
        assert.match(fixture.api.pushSupport().reason,/Home Screen/);
        fixture.root.navigator.standalone=true; assert.equal(fixture.api.pushSupport().supported,true);
        fixture.root.Notification.permission='denied'; assert.match(fixture.api.pushSupport().reason,/browser settings/);
        assert.equal(fixture.state.prompts,0);
    });
    await check('connect push requests permission in the click then registers and binds authenticated device', async () => {
        const fixture=pushFixture(), fresh=await service(fixture);
        const operation=fixture.api.connectPush({scope,leagueId:'league-one',service:fresh});
        assert.equal(fixture.state.prompts,1,'requestPermission is called synchronously before returning');
        await operation;
        assert.equal(fixture.state.subscribed,1); assert.equal(fixture.state.options.userVisibleOnly,true); assert.equal(fixture.state.options.applicationServerKey.length,65);
        assert.equal(fixture.state.registrationOptions.url,'https://dhqfootball.com/dashboard-reminder-sw.js');
        assert.equal(fixture.state.registrationOptions.options.updateViaCache,'none');
        assert.deepEqual(clean(fixture.state.binding),{accountId:'account-one',deviceKey:fixture.deviceKey});
        const body=JSON.parse(fixture.requests.find(request=>request.method==='POST').body);
        assert.equal(body.appUrl,'https://dhqfootball.com/index.html'); assert.equal(body.deviceKey,fixture.deviceKey);
        assert.equal(fixture.storage.size,0,'no endpoint or credentials in localStorage');
    });
    await check('push readiness requires matching worker identity and can be repaired by explicit reconnect', async () => {
        const fixture=pushFixture(); await fixture.api.connectPush({scope,leagueId:'league-one',service:await service(fixture)});
        fixture.state.binding=null;
        const disconnected=await service(fixture); assert.equal(disconnected.channels.push.ready,false); assert.equal(disconnected.channels.push.subscriptionReady,false);
        await fixture.api.connectPush({scope,leagueId:'league-one',service:disconnected});
        assert.equal(fixture.state.subscribed,1,'existing subscription is reused'); assert.equal((await service(fixture)).channels.push.ready,true);
        fixture.state.binding={accountId:'account-two',deviceKey:fixture.deviceKey};
        assert.equal((await service(fixture)).channels.push.ready,false);
    });
    await check('declined or invalid push setup never subscribes or sends a registration', async () => {
        const fixture=pushFixture(), fresh=await service(fixture);
        fixture.root.Notification.requestPermission=()=>Promise.resolve('denied');
        await assert.rejects(fixture.api.connectPush({scope,leagueId:'league-one',service:fresh}),/not connected/);
        assert.equal(fixture.state.subscribed,0); assert.equal(fixture.requests.filter(request=>request.method==='POST').length,0);
        const invalid=pushFixture(); const invalidService=await service(invalid); invalidService.channels.push.vapidPublicKey='bad';
        await invalid.api.connectPush({scope,leagueId:'league-one',service:invalidService});
        assert.equal(invalid.state.subscribed,1,'client-mutated key does not replace authenticated proof');
    });
    await check('account change after permission discards push connection before registration', async () => {
        const fixture=pushFixture(), fresh=await service(fixture);
        fixture.root.Notification.requestPermission=()=>{fixture.root.OD.getSessionToken=()=>token('account-two');return Promise.resolve('granted');};
        await assert.rejects(fixture.api.connectPush({scope,leagueId:'league-one',service:fresh}),/account changed/);
        assert.equal(fixture.state.registrations,0); assert.equal(fixture.state.subscribed,0);
    });
    await check('failed registration acknowledgement rolls back a newly-created browser subscription', async () => {
        const fixture=pushFixture(), original=fixture.root.fetch;
        fixture.root.fetch=async(url,options)=>options.method==='POST'?{ok:true,status:200,json:async()=>envelope({action:'push-subscribe',ok:true,deviceKey:'wrong'})}:original(url,options);
        const fresh=await service(fixture);
        await assert.rejects(fixture.api.connectPush({scope,leagueId:'league-one',service:fresh}),/did not confirm/);
        assert.equal(fixture.state.unsubscribed,1); assert.equal(fixture.state.binding,null);
    });
    await check('disconnect revokes service binding before local unsubscribe and clears old notices', async () => {
        const fixture=pushFixture(); await fixture.api.connectPush({scope,leagueId:'league-one',service:await service(fixture)});
        await fixture.api.disconnectPush({scope,leagueId:'league-one',service:await service(fixture)});
        assert.equal(fixture.state.binding,null); assert.equal(fixture.state.unsubscribed,1);
        assert(fixture.state.events.indexOf('push-unsubscribe')<fixture.state.events.indexOf('unsubscribe'));
    });
    await check('signout captures account before teardown and always clears local push on revoke failure', async () => {
        const fixture=pushFixture(); await fixture.api.connectPush({scope,leagueId:'league-one',service:await service(fixture)});
        fixture.root.fetch=async(url,options)=>{fixture.requests.push({url,...options});throw new TypeError('Offline');};
        const operation=fixture.api.disconnectForSignOut();
        fixture.root.OD.getSessionToken=()=>null;
        await operation;
        assert.equal(fixture.state.binding,null); assert.equal(fixture.state.unsubscribed,1);
        assert.equal(new URL(fixture.requests.at(-1).url).searchParams.get('leagueId'),'device');
    });
    await check('account-change cleanup cannot unsubscribe a newer account binding', async () => {
        const fixture=pushFixture(); await fixture.api.connectPush({scope,leagueId:'league-one',service:await service(fixture)});
        fixture.state.binding={accountId:'account-two',deviceKey:fixture.deviceKey};
        assert.equal(await fixture.api.clearPushForAccountChange('account:account-one'),false);
        assert.equal(fixture.state.unsubscribed,0); assert.equal(fixture.state.binding.accountId,'account-two');
    });
    await check('worker stores identity only, rejects foreign binding and has no fetch cache handler', async () => {
        const fixture=workerFixture(), deviceKey='a'.repeat(64);
        const rejected=await fixture.message({type:'dhq-reminder-bind',accountId:'account-one',deviceKey},'https://evil.invalid/');
        assert.equal(rejected,undefined); assert.equal(fixture.records.size,0);
        const bound=await fixture.message({type:'dhq-reminder-bind',accountId:'account-one',deviceKey});
        assert.deepEqual(clean(bound.binding),{accountId:'account-one',deviceKey}); assert.equal(fixture.listeners.fetch,undefined);
        assert.equal((await fixture.message({type:'dhq-reminder-clear',accountId:'account-two'})).cleared,false);
    });
    await check('worker push and click protect signed-out or mismatched account content and URLs', async () => {
        const fixture=workerFixture(), deviceKey='a'.repeat(64), privatePayload={version:1,accountId:'account-one',title:'Private roster plan',body:'Review roster',url:'https://dhqfootball.com/index.html#league=one&tab=dashboard',tag:'rem_one'};
        await fixture.dispatch('push',{data:{json:()=>privatePayload}});
        assert.equal(fixture.shown[0].title,'Dynasty HQ reminder'); assert.doesNotMatch(fixture.shown[0].options.data.url,/league=/);
        await fixture.message({type:'dhq-reminder-bind',accountId:'account-one',deviceKey});
        await fixture.dispatch('push',{data:{json:()=>privatePayload}}); assert.equal(fixture.shown[1].title,privatePayload.title);
        assert.equal(fixture.shown[1].options.tag,'rem_one'); assert.equal(fixture.shown[1].options.renotify,false);
        await fixture.dispatch('push',{data:{json:()=>({...privatePayload,url:'https://evil.invalid/phish'})}});
        assert.equal(fixture.shown[2].options.data.url,'https://dhqfootball.com/index.html');
        let closed=0; fixture.notices.push({close:()=>closed++});
        await fixture.message({type:'dhq-reminder-clear',accountId:'account-one'}); assert.equal(closed,1);
        await fixture.dispatch('notificationclick',{notification:{data:fixture.shown[1].options.data,close:()=>{}}});
        assert.equal(fixture.opened[0],'https://dhqfootball.com/index.html','old private deep link is discarded after logout');
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
