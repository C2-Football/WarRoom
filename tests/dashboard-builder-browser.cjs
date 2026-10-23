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
const customPlan = [
    { id: 'alex_age', key: 'custom-view', size: 'lg', title: 'Average age by position', view: {
        source: 'roster', groupBy: 'position', aggregate: { op: 'avg', field: 'age' }, columns: ['position', 'value'],
        sort: { field: 'value', direction: 'desc' }, limit: 20, display: 'bar', x: 'position', y: 'value', appearance: { accent: 'gold', density: 'comfortable' },
    } },
    { id: 'alex_roster_details', key: 'custom-view', size: 'xl', title: 'Detailed roster', view: {
        source: 'roster', columns: ['name', 'position', 'nflTeam', 'age', 'slot', 'teamName', 'gamesPlayed', 'fantasyPoints', 'ppg'],
        limit: 20, display: 'table', appearance: { accent: 'gold', density: 'comfortable' },
    } },
];
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
            const reminderWrites = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/fw-dashboard-reminders')) reminderWrites.push(request.url()); });
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

                await open();
                await submit('Replace Home with average roster age by position as a bar chart, plus a detailed roster table.', { layout: customPlan });
                await ready();
                const dataRequest = JSON.parse(requests.at(-1).context.messages.at(-1).content);
                assert(dataRequest.dataCatalog.some(source => source.id === 'roster'), 'Alex receives an actual data catalog for new views');
                equalLayout(await previewKeys(), ['custom-view', 'custom-view'], 'Custom data views render without existing widget recipes');
                const ageView = () => dialog().locator('.alex-data-view').first();
                await ageView().getByRole('listitem').first().waitFor();
                assert.equal(await ageView().getByRole('listitem').count(), 9, 'Grouped view is calculated from all nine fixture positions');
                assert.equal(await ageView().getByRole('listitem').first().locator('strong').innerText(), '25', 'Chart displays calculated fixture age');
                await dialog().locator('.alex-builder-preview').evaluate(el => { el.scrollTop = 0; });
                await page.screenshot({ path: path.join(output, size.label + '-custom-overview.png'), fullPage: false });
                const directRequestCount = requests.length;
                const visualSummary = dialog().locator('.alex-builder-visual-options summary');
                await reachable(visualSummary, 'Visual options');
                await click(visualSummary);
                await dialog().locator('.alex-builder-preview').evaluate(el => { el.scrollTop = 0; });
                await page.screenshot({ path: path.join(output, size.label + '-visual-options.png'), fullPage: false });
                await reachable(dialog().getByRole('button', { name: 'Teal accent', exact: true }), 'Accent option');
                await click(dialog().getByRole('button', { name: 'Teal accent', exact: true }));
                assert(await ageView().evaluate(el => el.classList.contains('alex-data-teal')), 'Accent updates the real preview');
                await click(dialog().getByRole('button', { name: 'Undo', exact: true }));
                assert(await ageView().evaluate(el => el.classList.contains('alex-data-gold')), 'Undo restores the previous visual choice');
                await click(dialog().getByRole('button', { name: 'Blue accent', exact: true }));
                await dialog().getByLabel('Spacing', { exact: true }).selectOption('compact');
                await dialog().getByLabel('Show as', { exact: true }).selectOption('cards');
                assert.equal(await ageView().getAttribute('data-view-display'), 'cards', 'Cards can display the same computed dataset');
                await dialog().getByLabel('Show as', { exact: true }).selectOption('table');
                await dialog().getByLabel('Title', { exact: true }).fill('My position age comparison');
                await dialog().getByLabel('Title', { exact: true }).press('Enter');
                await ageView().getByRole('heading', { name: 'My position age comparison', exact: true }).waitFor();
                assert(await ageView().evaluate(el => el.classList.contains('alex-data-compact')), 'Spacing updates the real preview');
                assert.equal(await dialog().getByLabel('Show as', { exact: true }).locator('option[value="metric"]').isDisabled(), true, 'Grouped data cannot silently become a single value');
                await fit('Expanded visual controls');
                assert.equal(requests.length, directRequestCount, 'Visual controls and draft undo do not make model calls');
                equalLayout((await saved()).layout, startingLayout, 'Visual changes remain private until Save');
                const expectedCustom = JSON.parse(JSON.stringify(customPlan));
                expectedCustom[0].title = 'My position age comparison';
                expectedCustom[0].view.display = 'table';
                expectedCustom[0].view.appearance = { accent: 'blue', density: 'compact' };
                await dialog().locator('.alex-builder-visual-options').getByLabel('View', { exact: true }).selectOption('alex_roster_details');
                await submit('Keep this view as a detailed roster table.', { layout: expectedCustom });
                await ready();
                assert.equal(JSON.parse(requests.at(-1).context.messages.at(-1).content).selectedSectionId, 'alex_roster_details', 'Conversation targets the explicitly selected custom view');
                await tab('Preview');
                const requestsBeforeCustomSave = requests.length;
                await click(visualSummary);
                const tableScroll = dialog().getByRole('region', { name: 'Detailed roster data table', exact: true });
                await tableScroll.scrollIntoViewIfNeeded();
                const tableState = await tableScroll.evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth, tabIndex: el.tabIndex, disabled: el.getAttribute('aria-disabled'), pointerEvents: getComputedStyle(el).pointerEvents }));
                assert(tableState.content > tableState.width && tableState.tabIndex === 0 && tableState.disabled !== 'true' && tableState.pointerEvents === 'auto', 'Wide table remains scrollable within preview: ' + JSON.stringify(tableState));
                await tableScroll.focus();
                await page.keyboard.press('ArrowRight');
                await page.waitForFunction(() => [...document.querySelectorAll('.alex-builder-preview [data-alex-scroll]')].some(el => el.scrollLeft > 0));
                await fit('Wide generated table');
                await page.screenshot({ path: path.join(output, size.label + '-custom-views.png'), fullPage: false });
                const reminderPanel = dialog().locator('.dashboard-reminders');
                await click(reminderPanel.locator('.dashboard-reminders-toggle'));
                await reminderPanel.getByText('Delivery not connected', { exact: true }).first().waitFor();
                await click(reminderPanel.getByRole('button', { name: 'Add reminder draft', exact: true }));
                await reminderPanel.getByLabel(/^Reminder title/).fill('Review my roster ages');
                await reminderPanel.getByLabel(/^Delivery/).selectOption('push');
                await reminderPanel.getByLabel(/^Repeat/).selectOption('daily');
                await reachable(reminderPanel.locator('input[type="time"]'), 'Reminder time');
                await reminderPanel.locator('input[type="time"]').fill('08:30');
                await reminderPanel.getByLabel(/^Time zone/).fill('America/Chicago');
                await fit('Reminder form');
                await reachable(reminderPanel.getByRole('button', { name: 'Save reminder draft', exact: true }), 'Save reminder draft');
                await click(reminderPanel.getByRole('button', { name: 'Save reminder draft', exact: true }));
                await reminderPanel.getByText('Reminder draft saved on this device. Delivery has not been changed.', { exact: true }).waitFor();
                const reminderState = await page.evaluate(({ leagueA, leagueB }) => {
                    const builder = window.WR.DashboardBuilder, reminders = window.WR.DashboardReminders;
                    return { current: reminders.read(builder.scopeFor(leagueA)), otherLeague: reminders.read(builder.scopeFor(leagueB)), otherAccount: reminders.read('another-account:' + leagueA) };
                }, { leagueA, leagueB });
                assert.equal(reminderState.current.reminders.length, 1, 'Reminder draft persists separately from dashboard save');
                assert.equal(reminderState.current.reminders[0].channel, 'push', 'Chosen reminder delivery preference is retained');
                equalLayout(reminderState.current.reminders[0].schedule, { frequency: 'daily', day: null, time: '08:30', timeZone: 'America/Chicago' }, 'Reminder time and zone persist');
                assert.equal(reminderState.otherLeague.reminders.length + reminderState.otherAccount.reminders.length, 0, 'Reminder drafts stay scoped to account and league');
                assert.equal(await reminderPanel.getByRole('button', { name: 'Enable reminder', exact: true }).count(), 0, 'Unavailable delivery never offers a false activation');
                assert.equal(await reminderPanel.getByText('Scheduled', { exact: true }).count(), 0, 'Saving a draft never claims it is scheduled');
                assert.equal(reminderWrites.length, 0, 'Saving a local reminder draft sends no delivery request');
                await page.screenshot({ path: path.join(output, size.label + '-reminder-draft.png'), fullPage: false });
                await click(dialog().getByRole('button', { name: 'Save dashboard', exact: true }));
                await dialog().getByText('Saved on this device.', { exact: true }).waitFor();
                const savedCustom = (await saved()).layout;
                equalLayout(savedCustom, expectedCustom, 'Save retains custom query, title, display, and visual options');
                await click(dialog().getByRole('button', { name: 'Close builder', exact: true }));
                await page.reload({ waitUntil: 'domcontentloaded' });
                await page.getByRole('button', { name: 'Build with Alex', exact: true }).first().waitFor({ timeout: 60000 });
                equalLayout((await saved()).layout, expectedCustom, 'Custom view survives reload');
                await page.locator('.alex-data-view').first().getByRole('heading', { name: 'My position age comparison', exact: true }).waitFor();
                await open();
                await tab('Preview');
                await click(dialog().locator('.dashboard-reminders-toggle'));
                await dialog().locator('.dashboard-reminders').getByText('Review my roster ages', { exact: true }).waitFor();
                assert.equal(await dialog().locator('.dashboard-reminders').getByText('Scheduled', { exact: true }).count(), 0, 'Reload retains inactive reminder draft status');
                await click(dialog().getByRole('button', { name: 'Close builder', exact: true }));
                await click(page.getByRole('button', { name: 'Undo last save', exact: true }));
                equalLayout((await saved()).layout, startingLayout, 'Persistent undo restores Home before custom views');
                assert.equal(requests.length, requestsBeforeCustomSave, 'Reminders, saving, reloading and persistent undo need no model call');
                assert.equal(errors.length, 0, 'No browser runtime errors: ' + errors.join(' | '));
                assert.equal(plans.length, 0, 'All queued fixture responses were consumed');
                results.push({ viewport: size.label, dimensions: `${size.width}x${size.height}`, touch: size.touch, passed: true, aiFixtureRequests: requests.length, blockedExternalWrites: blocked.length });
                console.log('PASS dashboard builder ' + size.label + ': preview, custom queries/visuals, table scroll, save/reload, conversation, draft/persistent undo, discard, storage/AI failures, cancel, league isolation, focus');
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
