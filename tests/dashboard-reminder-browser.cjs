'use strict';

// Real application and real service-worker registration. Account/data/delivery
// responses and browser PushManager/permission are controlled fixtures. This
// runner never enrolls a real push endpoint or sends an email/notification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { chromium } = require('@playwright/test');
const { installReadOnlyRoutes } = require('./helpers/browser-readonly.cjs');
const { createLeagueSkinFixture } = require('./helpers/league-skin-fixture.cjs');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.DASHBOARD_REMINDER_OUTPUT || path.join(root, 'output/playwright/dashboard-reminders'));
const leagueId = '1312100327931019264';
const secondLeague = '1312100327931019265';
const account = '10000000-0000-4000-8000-000000000008';
const username = 'reminder-fixture';
const selected = process.env.DASHBOARD_REMINDER_SIZES?.split(',').filter(Boolean);
const sizes = [
    { label: 'phone-small', width: 320, height: 700, touch: true },
    { label: 'phone', width: 390, height: 844, touch: true },
    { label: 'landscape', width: 667, height: 375, touch: true },
    { label: 'desktop', width: 1365, height: 900, touch: false },
];
const matrix = selected ? sizes.filter(size => selected.includes(size.label)) : sizes;
assert(matrix.length && (!selected || matrix.length === selected.length), 'Unknown DASHBOARD_REMINDER_SIZES');
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS' };
const view = { id: 'alex_roster_count', key: 'custom-view', size: 'md', title: 'My roster count', view: {
    source: 'roster', aggregate: { op: 'count' }, columns: ['value'], limit: 1, display: 'metric', y: 'value', appearance: { accent: 'gold', density: 'comfortable' },
} };
const pair = crypto.createECDH('prime256v1'); pair.generateKeys();
const vapidPublicKey = pair.getPublicKey().toString('base64url');
const sourceFiles = ['js/shared/dashboard-reminders.js', 'js/components/dashboard-reminders.js', 'dashboard-reminder-sw.js', 'dashboard-reminders.css', 'reminder-unsubscribe.html', 'js/shared/reminder-unsubscribe.js'];
const sourceHashes = () => Object.fromEntries(sourceFiles.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));

async function startServer() {
    if (process.env.DASHBOARD_REMINDER_URL) return { url: process.env.DASHBOARD_REMINDER_URL, stop() {} };
    const port = await new Promise((resolve, reject) => {
        const probe = net.createServer(); probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => { const found = probe.address().port; probe.close(() => resolve(found)); });
    });
    const child = spawn(process.execPath, ['scripts/serve-static.cjs', '--host=127.0.0.1', '--port=' + port, '--compile'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Preview server did not start')), 15000);
        child.stdout.on('data', value => { if (String(value).includes('Serving')) { clearTimeout(timeout); resolve(); } });
        child.once('exit', code => { clearTimeout(timeout); reject(new Error('Preview server exited: ' + code)); });
    });
    return { url: `http://127.0.0.1:${port}/index.html`, stop: () => child.kill() };
}

async function prepare(context) {
    const provider = createLeagueSkinFixture({ redraftId: secondLeague, dynastyId: leagueId, user: username });
    const blocked = await installReadOnlyRoutes(context, { fixture: provider });
    const state = { verified: false, optedIn: false, pending: false, subscribed: null, reminders: new Map(), actions: [], reads: 0, fault: null };
    const envelope = data => ({ version: 1, accountId: account, leagueId, ...data });
    const nextRun = schedule => {
        const clock = new Intl.DateTimeFormat('en-US', { timeZone: schedule.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
        const start = Math.ceil((Date.now() + 60000) / 60000) * 60000;
        for (let i = 0; i < 2880; i++) {
            const date = new Date(start + i * 60000);
            if (clock.format(date) === schedule.time) return date.toISOString();
        }
        throw new Error('Fixture schedule has no next daily occurrence');
    };
    const pauseChannel = channel => state.reminders.forEach((reminder, id) => { if (reminder.channel === channel && reminder.state === 'enabled') state.reminders.set(id, { ...reminder, state: 'paused', revision: reminder.revision + 1, nextRunAt: null }); });
    await context.route('**/functions/v1/ai-analyze', route => route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ analysis: 'Fixture briefing.' }) }));
    await context.route('**/functions/v1/fw-dashboard-reminders*', async route => {
        const request = route.request();
        const respond = (status, value) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(value) });
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        const url = new URL(request.url());
        assert.equal(url.searchParams.get('leagueId'), leagueId);
        assert.match(request.headers().authorization || '', /^Bearer fixture\./);
        if (request.method() === 'GET') {
            state.reads++;
            if (state.fault === 'read-failure') { state.fault = null; return respond(503, { error: 'Fixture unavailable' }); }
            const deviceKey = url.searchParams.get('deviceKey');
            const ready = Boolean(state.subscribed && deviceKey === state.subscribed);
            return respond(200, envelope({ channels: {
                email: { available: true, recipientVerified: state.verified, optedIn: state.optedIn, maskedEmail: 'r***@example.invalid', verificationPending: state.pending },
                push: { available: true, subscriptionReady: ready, deviceKey: ready ? deviceKey : null, vapidPublicKey },
            }, reminders: [...state.reminders.values()] }));
        }
        assert.equal(request.method(), 'POST');
        const body = request.postDataJSON();
        const channelKeys = {
            'email-start': ['action'], 'email-disable': ['action'], 'email-confirm': ['action', 'code'],
            'push-subscribe': ['action', 'subscription', 'deviceKey', 'appUrl'],
            'push-unsubscribe': ['action', 'deviceKey'],
        };
        if (channelKeys[body.action]) assert.deepEqual(Object.keys(body).sort(), channelKeys[body.action].slice().sort(), 'Channel payload follows the backend strict allowlist');
        else assert(body.operationId, 'Schedule mutation carries an operation ID');
        state.actions.push(body.action);
        if (body.action === 'email-start') state.pending = true;
        else if (body.action === 'email-confirm') {
            if (body.code !== '123456') return respond(400, { error: 'Invalid verification code' });
            state.pending = false; state.verified = true; state.optedIn = true;
        } else if (body.action === 'email-disable') { state.optedIn = false; pauseChannel('email'); }
        else if (body.action === 'push-subscribe') {
            assert.match(body.subscription?.endpoint || '', /^https:\/\/fcm\.googleapis\.com\/fcm\/send\/fixture-/);
            assert.equal(body.deviceKey, crypto.createHash('sha256').update(body.subscription.endpoint).digest('hex'));
            assert(body.subscription.keys.auth && body.subscription.keys.p256dh);
            if (body.appUrl) assert.equal(new URL(body.appUrl).origin, new URL(context.pages()[0].url()).origin);
            state.subscribed = body.deviceKey;
        } else if (body.action === 'push-unsubscribe') {
            assert.equal(body.deviceKey, state.subscribed); state.subscribed = null; pauseChannel('push');
        } else if (['enable', 'pause'].includes(body.action)) {
            const old = state.reminders.get(body.reminder.id);
            assert.equal(body.expectedRevision, old?.revision || 0);
            if (body.action === 'enable') assert(body.reminder.channel === 'email' ? state.verified && state.optedIn : body.deviceKey === state.subscribed);
            const next = { ...body.reminder, state: body.action === 'enable' ? 'enabled' : 'paused', revision: (old?.revision || 0) + 1,
                nextRunAt: body.action === 'enable' ? nextRun(body.reminder.schedule) : null };
            state.reminders.set(next.id, next);
            if (state.fault === 'lost-enable-ack' && body.action === 'enable') { state.fault = null; return route.abort('failed'); }
            return respond(200, envelope({ reminder: next }));
        } else throw new Error('Unexpected fixture action: ' + body.action);
        return respond(200, envelope({ action: body.action, ok: true, ...(body.deviceKey ? { deviceKey: body.deviceKey } : {}) }));
    });
    await context.addInitScript(({ account, username, leagueId, view }) => {
        const payload = btoa(JSON.stringify({ sub: account, exp: Math.floor(Date.now() / 1000) + 3600, app_metadata: { user_id: account, session_version: 1 } }));
        localStorage.setItem('fw_session_v1', JSON.stringify({ token: 'fixture.' + payload + '.fixture', user: { id: account, email: 'reminder@example.invalid' } }));
        localStorage.setItem('od_auth_v1', JSON.stringify({ username }));
        localStorage.setItem('od_profile_v1', JSON.stringify({ onboardingComplete: true }));
        localStorage.setItem('wr_active_connection_owner_v1', 'account:' + account);
        localStorage.setItem('dynastyhq_username', username);
        localStorage.setItem('wr_tutorial_done_v1', '1');
        const layoutKey = 'wr_alex_dashboard_v1:' + account + ':' + leagueId;
        if (!localStorage.getItem(layoutKey)) localStorage.setItem(layoutKey, JSON.stringify({ version: 1, layout: [view], history: [] }));
        const fixture = window.__reminderFixture = { permission: sessionStorage.getItem('__reminderPermission') || 'default', answer: 'granted', prompts: [], subscriptions: [], unsubscriptions: 0, registrations: [] };
        Object.defineProperty(Notification, 'permission', { configurable: true, get: () => fixture.permission });
        Notification.requestPermission = () => {
            fixture.prompts.push({ userActive: navigator.userActivation.isActive });
            fixture.permission = fixture.answer;
            sessionStorage.setItem('__reminderPermission', fixture.permission);
            return Promise.resolve(fixture.permission);
        };
        const subscription = () => ({
            endpoint: 'https://fcm.googleapis.com/fcm/send/fixture-reminder-device',
            expirationTime: null,
            toJSON() { return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: 'fixture-public-key', auth: 'fixture-auth-key' } }; },
            async unsubscribe() { fixture.unsubscriptions++; sessionStorage.removeItem('__reminderSubscription'); return true; },
        });
        PushManager.prototype.getSubscription = async () => sessionStorage.getItem('__reminderSubscription') ? subscription() : null;
        PushManager.prototype.subscribe = async options => {
            fixture.subscriptions.push({ userVisibleOnly: options.userVisibleOnly, keyBytes: options.applicationServerKey?.byteLength, permission: fixture.permission });
            assertPermission();
            sessionStorage.setItem('__reminderSubscription', '1'); return subscription();
        };
        function assertPermission() { if (fixture.permission !== 'granted') throw new Error('Fixture subscribe before permission'); }
        const register = ServiceWorkerContainer.prototype.register;
        ServiceWorkerContainer.prototype.register = function (...args) { fixture.registrations.push(String(args[0])); return register.apply(this, args); };
    }, { account, username, leagueId, view });
    return { state, blocked };
}

async function run() {
    const testedSources = sourceHashes();
    fs.mkdirSync(output, { recursive: true });
    const serving = await startServer();
    let browser;
    const results = [];
    try {
        browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
        for (const size of matrix) {
            const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch, serviceWorkers: 'allow' });
            const { state, blocked } = await prepare(context);
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            const url = new URL(serving.url); url.searchParams.set('dev', 'true'); url.searchParams.set('user', username); url.hash = 'league=' + leagueId + '&tab=dashboard';
            const dialog = () => page.getByRole('dialog', { name: 'Build with Alex', exact: true });
            const panel = () => dialog().locator('.dashboard-reminders');
            const click = async locator => { await locator.scrollIntoViewIfNeeded(); return size.touch ? locator.tap() : locator.click(); };
            const button = name => panel().getByRole('button', { name, exact: true });
            const textVisible = async text => panel().getByText(text, { exact: true }).first().waitFor();
            const idle = async () => page.waitForFunction(() => {
                const panel = document.querySelector('[role="dialog"] .dashboard-reminders');
                return panel && ![...panel.querySelectorAll('button')].some(button => button.textContent.trim() === 'Checking…');
            });
            const check = async () => { await click(button('Check delivery status')); await idle(); };
            const fit = async label => {
                const dimensions = await dialog().evaluate(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
                assert(!dimensions.overflow && dimensions.left >= -1 && dimensions.right <= dimensions.width + 1, label + ' fits viewport: ' + JSON.stringify(dimensions));
            };
            const reachable = async (locator, label) => {
                await locator.scrollIntoViewIfNeeded();
                const hit = await locator.evaluate(el => { const r = el.getBoundingClientRect(); const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { width: r.width, height: r.height, receives: el === target || el.contains(target) }; });
                assert(hit.receives && (!size.touch || (hit.width >= 44 && hit.height >= 44)), label + ' reachable 44px target: ' + JSON.stringify(hit));
            };
            const open = async () => {
                await click(page.getByRole('button', { name: 'Edit lens', exact: true }).first());
                await dialog().waitFor();
                const preview = dialog().getByRole('tab', { name: 'Preview', exact: true });
                if (await preview.isVisible()) await click(preview);
                await click(panel().getByRole('button', { name: /Reminders.*Come back/ }));
                await button('Check delivery status').waitFor(); await idle();
            };
            const addDraft = async (title, channel) => {
                await click(button('Add reminder draft'));
                await panel().getByLabel('Reminder title', { exact: true }).fill(title);
                await panel().getByLabel('Delivery', { exact: true }).selectOption(channel);
                await panel().getByLabel('Repeat', { exact: true }).selectOption('daily');
                await panel().getByLabel('Time', { exact: true }).fill('08:30');
                await panel().getByLabel('Time zone', { exact: true }).fill('America/Chicago');
                await reachable(button('Save reminder draft'), 'Save reminder draft');
                await click(button('Save reminder draft'));
            };
            const workerBinding = () => page.evaluate(async () => {
                const registration = await navigator.serviceWorker.getRegistration();
                return new Promise((resolve, reject) => {
                    const channel = new MessageChannel();
                    const timer = setTimeout(() => reject(new Error('Worker binding query timed out')), 5000);
                    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
                    registration.active.postMessage({ type: 'dhq-reminder-binding' }, [channel.port2]);
                });
            });
            const row = title => panel().locator('.dashboard-reminders-list li').filter({ has: page.getByText(title, { exact: true }) });
            try {
                await page.goto(url.href, { waitUntil: 'domcontentloaded' });
                await page.getByRole('button', { name: 'Edit lens', exact: true }).first().waitFor({ timeout: 60000 });
                await open();
                await textVisible('Send verification code');
                assert.equal(state.actions.length, 0, 'Opening/checking never sends email or subscribes push');
                assert.equal(await page.evaluate(() => window.__reminderFixture.prompts.length), 0, 'No permission request on page or panel open');
                await reachable(button('Send verification code'), 'Email verification');
                await click(button('Send verification code'));
                await panel().getByLabel('Email verification code', { exact: true }).waitFor();
                assert.deepEqual(state.actions, ['email-start']);
                await panel().getByLabel('Email verification code', { exact: true }).fill('000000');
                await click(button('Verify email'));
                await panel().getByRole('alert').waitFor();
                assert(!state.verified && !state.optedIn, 'Rejected code cannot connect email');
                await panel().getByLabel('Email verification code', { exact: true }).fill('123456');
                await click(button('Verify email'));
                await button('Turn off email reminders').waitFor();
                assert(state.verified && state.optedIn, 'Confirmed code and opt-in connect email');
                await addDraft('Morning roster email', 'email');
                await click(row('Morning roster email').getByRole('button', { name: 'Enable reminder', exact: true }));
                await row('Morning roster email').getByText('Scheduled', { exact: true }).waitFor();
                await fit('Email setup');
                await page.screenshot({ path: path.join(output, size.label + '-email-scheduled.png') });
                await click(row('Morning roster email').getByRole('button', { name: 'Pause reminder', exact: true }));
                await row('Morning roster email').getByText('Paused', { exact: true }).waitFor();
                state.fault = 'lost-enable-ack';
                await click(row('Morning roster email').getByRole('button', { name: 'Enable reminder', exact: true }));
                await panel().getByRole('alert').waitFor();
                assert.equal(await row('Morning roster email').getByText('Scheduled', { exact: true }).count(), 0, 'Lost acknowledgement does not claim success');
                assert.equal([...state.reminders.values()][0].state, 'enabled', 'Fixture models server commit before connection loss');
                await check();
                await row('Morning roster email').getByText('Scheduled', { exact: true }).waitFor();
                await click(button('Turn off email reminders'));
                await button('Send verification code').waitFor();
                assert.equal(state.optedIn, false);
                await row('Morning roster email').getByText('Paused', { exact: true }).waitFor();
                assert.equal(await page.evaluate(() => window.__reminderFixture.prompts.length), 0, 'Email flow never asks for push permission');
                await reachable(button('Connect push on this device'), 'Connect push');
                await click(button('Connect push on this device'));
                await button('Disconnect push on this device').waitFor({ timeout: 20000 });
                const push = await page.evaluate(async () => ({ fixture: window.__reminderFixture, worker: (await navigator.serviceWorker.getRegistration())?.active?.scriptURL }));
                assert.equal(push.fixture.prompts.length, 1);
                assert(push.fixture.prompts[0].userActive, 'Permission request originates inside trusted click');
                assert.deepEqual(push.fixture.subscriptions, [{ userVisibleOnly: true, keyBytes: 65, permission: 'granted' }]);
                assert(push.worker?.endsWith('/dashboard-reminder-sw.js'), 'Actual notification-only service worker is installed and active');
                assert(state.subscribed, 'Authenticated service binds this device fingerprint');
                assert.deepEqual((await workerBinding()).binding, { accountId: account, deviceKey: state.subscribed }, 'Actual worker persists only the confirmed account/device binding');
                await addDraft('Morning roster push', 'push');
                await click(row('Morning roster push').getByRole('button', { name: 'Enable reminder', exact: true }));
                await row('Morning roster push').getByText('Scheduled', { exact: true }).waitFor();
                await fit('Push setup');
                await page.screenshot({ path: path.join(output, size.label + '-push-scheduled.png') });
                await click(button('Disconnect push on this device'));
                await button('Connect push on this device').waitFor();
                assert.equal(state.subscribed, null);
                assert.equal((await workerBinding()).binding, null, 'Unlink clears the actual worker account binding');
                assert.equal(await page.evaluate(() => window.__reminderFixture.unsubscriptions), 1);
                await row('Morning roster push').getByText('Paused', { exact: true }).waitFor();
                await page.evaluate(() => { window.__reminderFixture.permission = 'default'; window.__reminderFixture.answer = 'denied'; });
                await check();
                await click(button('Connect push on this device'));
                await panel().getByRole('alert').waitFor();
                assert.equal(state.subscribed, null, 'Declined permission cannot reconnect');
                assert.equal(await page.evaluate(() => window.__reminderFixture.subscriptions.length), 1, 'Decline never reaches subscribe');
                await fit('Permission declined');
                await page.screenshot({ path: path.join(output, size.label + '-permission-declined.png') });
                state.fault = 'read-failure'; await check();
                assert.equal(await panel().getByText('Scheduled', { exact: true }).count(), 0, 'Unavailable refresh cannot claim active delivery');
                await page.reload({ waitUntil: 'domcontentloaded' });
                await page.getByRole('button', { name: 'Edit lens', exact: true }).first().waitFor({ timeout: 60000 });
                await open();
                await row('Morning roster email').waitFor(); await row('Morning roster push').waitFor();
                assert.equal(await row('Morning roster push').getByText('Paused', { exact: true }).count(), 1, 'Paused delivery reconciles after reload');
                // A separate current browser state tests iOS installation gating;
                // it does not claim physical-device or native Safari evidence.
                await page.evaluate(() => { Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }); Object.defineProperty(navigator, 'standalone', { configurable: true, value: false }); });
                await check();
                assert.match(await panel().innerText(), /Home Screen/);
                assert.equal(await page.evaluate(() => window.__reminderFixture.prompts.length), 0, 'Reload/iOS availability check never asks permission');
                await fit('iOS Home Screen guidance');
                const unsubscribes = [];
                let unsubscribeReply = 'network';
                let unsubscribePage = 0;
                await context.route('**/functions/v1/fw-dashboard-reminders*', async route => {
                    const request = route.request(), target = new URL(request.url());
                    if (target.searchParams.get('action') !== 'unsubscribe') return route.fallback();
                    assert.equal(request.method(), 'POST');
                    assert.match(target.searchParams.get('token'), /^[ab]{64}$/);
                    assert.equal(request.headers().accept, 'application/json');
                    assert.equal(request.headers().referer, undefined, 'Opt-out does not forward the page URL');
                    assert.equal(request.headers().authorization, undefined, 'Email opt-out needs no signed-in account');
                    assert.equal(request.postData(), 'List-Unsubscribe=One-Click');
                    unsubscribes.push(target.searchParams.get('token'));
                    if (unsubscribeReply === 'network') return route.abort('failed');
                    const expired = unsubscribeReply === 'expired';
                    return route.fulfill({ status: expired ? 410 : 200, headers, contentType: 'application/json', body: JSON.stringify({ ok: !expired, unsubscribed: !expired }) });
                });
                const optOut = async token => {
                    const target = new URL('reminder-unsubscribe.html', serving.url);
                    // Each incoming email link is a new document; avoid treating
                    // the next fixture case as fragment-only same-page navigation.
                    target.searchParams.set('fixture', String(++unsubscribePage)); target.hash = 'token=' + token;
                    await page.goto(target.href, { waitUntil: 'domcontentloaded' });
                    await page.waitForFunction(() => location.hash === '');
                    assert.equal(new URL(page.url()).hash, '', 'Capability is removed from browser history');
                };
                await optOut('invalid');
                await page.getByRole('heading', { name: 'This link is no longer active', exact: true }).waitFor();
                assert.equal(unsubscribes.length, 0, 'Malformed token never contacts opt-out endpoint');
                await optOut('a'.repeat(64));
                const stopEmails = page.getByRole('button', { name: 'Stop email reminders', exact: true });
                await stopEmails.waitFor();
                assert.equal(unsubscribes.length, 0, 'Opening a valid email link never opts out automatically');
                await reachable(stopEmails, 'Stop email reminders');
                await click(stopEmails);
                await page.getByRole('status').filter({ hasText: 'We couldn’t confirm that reminders stopped.' }).waitFor();
                assert.equal(await page.getByRole('heading', { name: 'Email reminders stopped', exact: true }).count(), 0, 'Network failure cannot claim opt-out success');
                assert.equal(await stopEmails.isEnabled(), true, 'Failed request permits an explicit retry');
                unsubscribeReply = 'success';
                await click(stopEmails);
                await page.getByRole('heading', { name: 'Email reminders stopped', exact: true }).waitFor();
                assert.equal(unsubscribes.length, 2, 'Successful opt-out follows explicit retry');
                const optOutBounds = await page.locator('main').evaluate(el => ({ width: innerWidth, right: el.getBoundingClientRect().right, left: el.getBoundingClientRect().left, overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
                assert(!optOutBounds.overflow && optOutBounds.left >= 0 && optOutBounds.right <= optOutBounds.width + 1, 'Email opt-out fits the mobile viewport');
                await page.screenshot({ path: path.join(output, size.label + '-email-unsubscribed.png') });
                unsubscribeReply = 'expired';
                await optOut('b'.repeat(64));
                await stopEmails.waitFor();
                assert.equal(unsubscribes.length, 2, 'Expired-link check also requires explicit action');
                await click(stopEmails);
                await page.getByRole('heading', { name: 'This link is no longer active', exact: true }).waitFor();
                assert.equal(await stopEmails.count(), 0);
                assert.deepEqual(errors, [], 'No browser runtime errors');
                results.push({ viewport: size.label, dimensions: `${size.width}x${size.height}`, passed: true, deliveryActions: state.actions, serviceReads: state.reads, explicitUnsubscribeRequests: unsubscribes.length, blockedOtherWrites: blocked.length });
                console.log('PASS reminder browser ' + size.label + ': verify email, enable/pause, lost-response reconciliation, real worker registration, push consent/unlink/decline, reload, explicit email opt-out/retry and mobile fit');
            } catch (error) {
                await page.screenshot({ path: path.join(output, size.label + '-failure.png') }).catch(() => {});
                fs.writeFileSync(path.join(output, size.label + '-failure.json'), JSON.stringify({ error: error.stack, browserErrors: errors, actions: state.actions, text: await page.locator('body').innerText().catch(() => '') }, null, 2));
                throw error;
            } finally { await context.close(); }
        }
        assert.deepEqual(sourceHashes(), testedSources, 'Reminder sources remain unchanged throughout the regression run');
        fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ evidence: 'Local real-app browser and service-worker registration; provider/account/delivery API, push permission and subscription are fixtures. No live email, push transport, physical device, or production proof.', sourceHashes: testedSources, results }, null, 2) + '\n');
    } finally { if (browser) await browser.close(); serving.stop(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
