'use strict';

// Fixture-assisted acceptance in the real app. The AI response and provider
// data are isolated fixtures; this does not establish live model or device QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium, webkit } = require('@playwright/test');
const { installReadOnlyRoutes } = require('./helpers/browser-readonly.cjs');
const { createLeagueSkinFixture } = require('./helpers/league-skin-fixture.cjs');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.ALEX_BUILDER_OUTPUT || path.join(root, 'output/playwright/dashboard-builder'));
const leagueA = '1312100327931019264';
const leagueB = '1312100327931019265';
const username = 'builder-fixture';
const account = '10000000-0000-4000-8000-000000000007';
const sizes = [
    { label: 'phone-small', width: 320, height: 700, touch: true },
    { label: 'phone', width: 390, height: 844, touch: true },
    { label: 'landscape', width: 667, height: 375, touch: true },
    { label: 'desktop', width: 1365, height: 900, touch: false },
];
const selected = process.env.ALEX_BUILDER_SIZES?.split(',').filter(Boolean);
const matrix = selected ? sizes.filter(size => selected.includes(size.label)) : sizes;
assert(matrix.length && (!selected || matrix.length === selected.length), 'Unknown ALEX_BUILDER_SIZES entry');
const initialPlan = [
    { id: 'alex_matchup', key: 'weekly-matchups', size: 'lg' },
    { id: 'alex_roster', key: 'roster-pulse', size: 'md', primaryMetric: 'health-score' },
    { id: 'alex_calendar', key: 'league-calendar', size: 'md' },
];
const revisedPlan = [initialPlan[2], { ...initialPlan[0], size: 'md' }, initialPlan[1]];
const equalLayout = (actual, expected, label) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, label);
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS' };

async function server() {
    if (process.env.ALEX_BUILDER_URL) return { url: process.env.ALEX_BUILDER_URL, stop() {} };
    const port = await new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => { const found = probe.address().port; probe.close(() => resolve(found)); });
    });
    const processHandle = spawn(process.execPath, ['scripts/serve-static.cjs', '--host=127.0.0.1', '--port=' + port, '--compile'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Preview server did not become ready')), 15000);
        processHandle.stdout.on('data', chunk => { if (String(chunk).includes('Serving')) { clearTimeout(timeout); resolve(); } });
        processHandle.once('exit', code => { clearTimeout(timeout); reject(new Error('Preview server exited: ' + code)); });
    });
    return { url: `http://127.0.0.1:${port}/index.html`, stop: () => processHandle.kill() };
}

async function run() {
    fs.mkdirSync(output, { recursive: true });
    const serving = await server();
    const browserName = process.env.ALEX_BUILDER_BROWSER || 'chromium';
    assert(['chromium', 'webkit'].includes(browserName), 'Unsupported ALEX_BUILDER_BROWSER');
    let browser;
    const results = [];
    try {
        browser = await (browserName === 'webkit' ? webkit : chromium).launch({ headless: true,
            ...(browserName === 'chromium' ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
        for (const size of matrix) {
            const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch, serviceWorkers: 'block' });
            const provider = createLeagueSkinFixture({ redraftId: leagueB, dynastyId: leagueA, user: username });
            const blocked = await installReadOnlyRoutes(context, { fixture: url => {
                const value = provider(url);
                const upgrade = league => league?.league_id === leagueB && league.settings
                    ? { ...league, name: 'QA Second Dynasty', settings: { ...league.settings, type: 2 } } : league;
                return Array.isArray(value) ? value.map(upgrade) : upgrade(value);
            } });
            const plans = [];
            const requests = [];
            await context.route('**/functions/v1/ai-analyze', async route => {
                if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
                const body = route.request().postDataJSON();
                const ctx = typeof body.context === 'string' ? JSON.parse(body.context) : body.context;
                const builder = /dashboard[-_ ]builder/i.test(ctx?.callType || '') || /dashboard (?:builder|layout)/i.test(ctx?.system || '');
                if (!builder) return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ analysis: 'Fixture briefing.' }) });
                requests.push(body);
                const response = plans.shift();
                assert(response, 'Every builder response must be explicitly queued by the acceptance test');
                if (response.hold) await response.hold;
                const analysis = response.raw ?? JSON.stringify({ version: 1, reply: response.reply || 'Your dashboard preview is ready.', layout: response.layout });
                try {
                    await route.fulfill({ status: response.status || 200, headers, contentType: 'application/json',
                        body: response.status ? JSON.stringify({ error: 'Fixture AI temporarily unavailable.' }) : JSON.stringify({ analysis }) });
                } catch (error) {
                    if (!/closed|disposed|cancel|aborted/i.test(error.message)) throw error;
                }
            });
            await context.addInitScript(({ account, username }) => {
                if (!localStorage.getItem('fw_session_v1')) {
                    const payload = btoa(JSON.stringify({ sub: account, exp: Math.floor(Date.now() / 1000) + 3600 }));
                    localStorage.setItem('fw_session_v1', JSON.stringify({ token: 'fixture.' + payload + '.fixture', user: { id: account, email: 'builder@example.invalid' } }));
                    localStorage.setItem('od_auth_v1', JSON.stringify({ username }));
                    localStorage.setItem('od_profile_v1', JSON.stringify({ onboardingComplete: true }));
                    localStorage.setItem('wr_active_connection_owner_v1', 'account:' + account);
                }
                localStorage.setItem('dynastyhq_username', username);
                localStorage.setItem('wr_tutorial_done_v1', '1');
                window.__builderQuotaFailure = false;
                const original = Storage.prototype.setItem;
                Storage.prototype.setItem = function (key, value) {
                    if (window.__builderQuotaFailure && String(key).startsWith('wr_alex_dashboard_v1:')) throw new DOMException('Fixture storage full', 'QuotaExceededError');
                    return original.call(this, key, value);
                };
            }, { account, username });
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            const entry = id => {
                const url = new URL(serving.url);
                url.searchParams.set('dev', 'true'); url.searchParams.set('user', username);
                url.hash = 'league=' + id + '&tab=dashboard';
                return url.href;
            };
            const load = async id => {
                await page.goto(entry(id), { waitUntil: 'domcontentloaded' });
                await page.getByRole('button', { name: 'Build with Alex', exact: true }).first().waitFor({ timeout: 60000 });
            };
            const click = locator => size.touch ? locator.tap() : locator.click();
            const dialog = () => page.getByRole('dialog', { name: 'Build with Alex', exact: true });
            const open = async () => { await click(page.getByRole('button', { name: 'Build with Alex', exact: true }).first()); await dialog().waitFor(); };
            const tab = async name => {
                const control = dialog().getByRole('tab', { name, exact: true });
                if (await control.isVisible()) await click(control);
            };
            const saved = id => page.evaluate(id => {
                const builder = window.WR.DashboardBuilder;
                return builder.readSaved(builder.scopeFor(id, 'qa-format-owner'));
            }, id || leagueA);
            const fit = async label => {
                const dimensions = await dialog().evaluate(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
                assert(!dimensions.overflow && dimensions.left >= -1 && dimensions.right <= dimensions.width + 1, label + ' must fit: ' + JSON.stringify(dimensions));
            };
            const reachable = async (locator, label) => {
                await locator.scrollIntoViewIfNeeded();
                const state = await locator.evaluate(el => {
                    const rect = el.getBoundingClientRect();
                    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
                    return { width: rect.width, height: rect.height, hit: el === hit || el.contains(hit), coarse: matchMedia('(pointer:coarse)').matches };
                });
                assert(state.hit, label + ' must receive the click/tap: ' + JSON.stringify(state));
                if (size.touch) assert(state.width >= 44 && state.height >= 44 && state.coarse, label + ' must have a 44px touch target: ' + JSON.stringify(state));
            };
            const submit = async (prompt, response) => {
                await tab('Edit');
                plans.push(response);
                await dialog().getByRole('textbox', { name: 'Describe your dashboard', exact: true }).fill(prompt);
                await reachable(dialog().getByRole('button', { name: 'Update preview', exact: true }), 'Update preview');
                await click(dialog().getByRole('button', { name: 'Update preview', exact: true }));
            };
            const ready = async () => {
                await dialog().getByRole('button', { name: 'Save dashboard', exact: true }).waitFor();
                await page.waitForFunction(() => {
                    const root = [...document.querySelectorAll('[role="dialog"]')].find(el => el.getAttribute('aria-label') === 'Build with Alex' || /Build with Alex/.test(el.textContent));
                    return root && ![...root.querySelectorAll('button')].some(button => button.textContent.trim() === 'Cancel request');
                });
            };
            const previewKeys = async () => {
                await tab('Preview');
                return dialog().locator('[data-widget-key]').evaluateAll(nodes => nodes.map(node => node.dataset.widgetKey));
            };
            try {
                await load(leagueA);
                assert.equal(await page.getByRole('button', { name: 'Add Widget', exact: true }).count(), 0, 'The old picker must be replaced');
                await open();
                await fit('Initial builder');
                await submit('Put my matchup first, then roster health and the calendar.', { layout: initialPlan });
                await ready();
                const startingLayout = JSON.parse(requests[0].context.messages.at(-1).content).currentLayout;
                await page.screenshot({ path: path.join(output, size.label + '-conversation.png'), fullPage: false });
                assert(await dialog().getByRole('textbox', { name: 'Describe your dashboard', exact: true }).evaluate(el => parseFloat(getComputedStyle(el).fontSize)) >= 16, 'Input text must avoid phone focus zoom');
                assert.equal(await saved(), null, 'A preview must not persist before Save');
                equalLayout(await previewKeys(), initialPlan.map(item => item.key), 'Preview renders real dashboard components in requested order');
                await fit('Generated preview');
                await page.screenshot({ path: path.join(output, size.label + '-preview.png'), fullPage: false });
                await reachable(dialog().getByRole('button', { name: 'Save dashboard', exact: true }), 'Save dashboard');
                if (!size.touch) {
                    await dialog().getByRole('button', { name: 'Save dashboard', exact: true }).focus();
                    await page.keyboard.press('Tab');
                    assert.equal(await dialog().getByRole('button', { name: 'Close builder', exact: true }).evaluate(el => document.activeElement === el), true, 'Tab wraps to the first dialog control');
                    await page.keyboard.press('Shift+Tab');
                    assert.equal(await dialog().getByRole('button', { name: 'Save dashboard', exact: true }).evaluate(el => document.activeElement === el), true, 'Shift+Tab wraps to the last dialog control');
                }
                if (size.label === 'phone') {
                    await page.setViewportSize({ width: 390, height: 360 });
                    await tab('Edit');
                    await fit('Reduced-height phone builder');
                    await reachable(dialog().getByRole('textbox', { name: 'Describe your dashboard', exact: true }), 'Reduced-height composer');
                    await reachable(dialog().getByRole('button', { name: 'Save dashboard', exact: true }), 'Reduced-height Save');
                    await page.screenshot({ path: path.join(output, 'phone-reduced-height.png') });
                    await page.setViewportSize({ width: size.width, height: size.height });
                }
                await page.evaluate(() => { window.__builderQuotaFailure = true; });
                await click(dialog().getByRole('button', { name: 'Save dashboard', exact: true }));
                await dialog().getByRole('alert').waitFor();
                assert.equal(await saved(), null, 'Storage failure must not report a successful save');
                equalLayout(await previewKeys(), initialPlan.map(item => item.key), 'Storage failure retains the full preview');
                await page.evaluate(() => { window.__builderQuotaFailure = false; });
                await click(dialog().getByRole('button', { name: 'Save dashboard', exact: true }));
                await dialog().getByText('Saved on this device.', { exact: true }).waitFor();
                equalLayout((await saved()).layout, initialPlan, 'Save persists the validated dashboard');
                await click(dialog().getByRole('button', { name: 'Close builder', exact: true }));
                await dialog().waitFor({ state: 'hidden' });
                if (!size.touch) await page.waitForFunction(() => document.activeElement?.classList.contains('dhq-builder-launch'), null, { timeout: 3000 });
                if (!size.touch) assert.equal(await page.getByRole('button', { name: 'Build with Alex', exact: true }).first().evaluate(el => document.activeElement === el), true, 'Closing returns keyboard focus to the entry control: ' + await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 250)));
                const countAfterSave = requests.length;
                await page.reload({ waitUntil: 'domcontentloaded' });
                await page.getByRole('button', { name: 'Build with Alex', exact: true }).first().waitFor({ timeout: 60000 });
                equalLayout((await saved()).layout, initialPlan, 'Reload preserves the exact dashboard');
                await open();
                equalLayout(await previewKeys(), initialPlan.map(item => item.key), 'Reopened preview matches saved dashboard');
                assert.equal(requests.length, countAfterSave, 'Opening saved dashboard does not call AI');
                await submit('Move the calendar first and make the matchup smaller.', { layout: revisedPlan });
                await ready();
                equalLayout(await previewKeys(), revisedPlan.map(item => item.key), 'Conversation applies the follow-up to the preview');
                await click(dialog().getByRole('button', { name: 'Undo', exact: true }));
                equalLayout(await previewKeys(), initialPlan.map(item => item.key), 'Undo restores the previous draft without AI');
                await submit('Move the calendar first and make the matchup smaller.', { layout: revisedPlan });
                await ready();
                await click(dialog().getByRole('button', { name: 'Close builder', exact: true }));
                await click(dialog().getByRole('button', { name: 'Discard changes', exact: true }));
                equalLayout((await saved()).layout, initialPlan, 'Discard leaves the saved dashboard intact');

                await open();
                await submit('Put the calendar first.', { status: 503 });
                await dialog().getByRole('alert').waitFor();
                equalLayout((await saved()).layout, initialPlan, 'Provider failure preserves saved dashboard');
                await submit('Put the calendar first.', { raw: '{"version":1,"reply":"invalid","layout":[{"id":"x","key":"run-code","size":"md"}]}' });
                await dialog().getByRole('alert').waitFor();
                equalLayout(await previewKeys(), initialPlan.map(item => item.key), 'Invalid AI output preserves the draft');
                equalLayout((await saved()).layout, initialPlan, 'Invalid AI output cannot write storage');

                let release;
                const hold = new Promise(resolve => { release = resolve; });
                await submit('Move calendar first.', { layout: revisedPlan, hold });
                await dialog().getByRole('button', { name: 'Cancel request', exact: true }).waitFor();
                await click(dialog().getByRole('button', { name: 'Cancel request', exact: true }));
                release();
                await ready();
                await page.waitForTimeout(100);
                equalLayout(await previewKeys(), initialPlan.map(item => item.key), 'Canceled late reply must not replace the draft');
                await click(dialog().getByRole('button', { name: 'Close builder', exact: true }));
                if (await dialog().getByRole('button', { name: 'Discard changes', exact: true }).isVisible()) await click(dialog().getByRole('button', { name: 'Discard changes', exact: true }));

                await load(leagueB);
                assert.equal(await saved(leagueB), null, 'Second league must not inherit the first league dashboard');
                await open();
                assert.notDeepEqual(await previewKeys(), initialPlan.map(item => item.key), 'Second league renders its own starting layout');
                await click(dialog().getByRole('button', { name: 'Close builder', exact: true }));
                await load(leagueA);
                equalLayout((await saved()).layout, initialPlan, 'Returning to the first league restores its saved dashboard');
                const requestsBeforeUndo = requests.length;
                await click(page.getByRole('button', { name: 'Undo last save', exact: true }));
                equalLayout((await saved()).layout, startingLayout, 'Undo last save restores the original dashboard after a reload');
                assert.equal(requests.length, requestsBeforeUndo, 'Persistent Undo does not call AI');
                await page.reload({ waitUntil: 'domcontentloaded' });
                await page.getByRole('button', { name: 'Build with Alex', exact: true }).first().waitFor({ timeout: 60000 });
                await open();
                equalLayout(await previewKeys(), startingLayout.map(item => item.key), 'Reload retains the undone dashboard');
                await click(dialog().getByRole('button', { name: 'Close builder', exact: true }));
                assert.equal(errors.length, 0, 'No browser runtime errors: ' + errors.join(' | '));
                assert.equal(plans.length, 0, 'All queued fixture responses were consumed');
                results.push({ viewport: size.label, dimensions: `${size.width}x${size.height}`, touch: size.touch, passed: true, aiFixtureRequests: requests.length, blockedExternalWrites: blocked.length });
                console.log('PASS dashboard builder ' + size.label + ': preview, save/reload, conversation, draft/persistent undo, discard, storage/AI failures, cancel, league isolation, focus');
            } catch (error) {
                await page.screenshot({ path: path.join(output, size.label + '-failure.png'), fullPage: false }).catch(() => {});
                fs.writeFileSync(path.join(output, size.label + '-failure.json'), JSON.stringify({ error: error.stack, browserErrors: errors, url: page.url(), text: await page.locator('body').innerText().catch(() => ''), requests }, null, 2));
                throw error;
            } finally { await context.close(); }
        }
        fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ evidence: 'Local browser emulation with provider and AI response fixtures; no live AI, physical device, or hosted deployment proof.', browser: browserName, results }, null, 2));
    } finally { await browser?.close(); serving.stop(); }
}

run().catch(error => { console.error(error.stack); process.exitCode = 1; });
