'use strict';

// Real app ancestry, isolated provider/AI fixtures, and emulated touch input.
// This is not live model, hosted delivery, or physical-device evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium, webkit } = require('@playwright/test');
const { installReadOnlyRoutes } = require('./helpers/browser-readonly.cjs');
const { createLeagueSkinFixture } = require('./helpers/league-skin-fixture.cjs');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.LENSES_OUTPUT || path.join(root, 'output/playwright/dashboard-lenses'));
const leagueA = '1312100327931019264', leagueB = '1312100327931019265';
const username = 'lenses-fixture';
const account = '10000000-0000-4000-8000-000000000017';
const secondAccount = '10000000-0000-4000-8000-000000000018';
const sizes = [
    { label: 'phone-small', width: 320, height: 700, touch: true },
    { label: 'phone', width: 390, height: 844, touch: true },
    { label: 'landscape', width: 667, height: 375, touch: true },
    { label: 'desktop', width: 1365, height: 900, touch: false },
];
const selected = process.env.LENSES_SIZES?.split(',').filter(Boolean);
const matrix = selected ? sizes.filter(size => selected.includes(size.label)) : sizes;
assert(matrix.length && (!selected || matrix.length === selected.length), 'Unknown LENSES_SIZES entry');
const legacyLayout = [
    { id: 'legacy_matchup', key: 'weekly-matchups', size: 'lg' },
    { id: 'legacy_roster', key: 'roster-pulse', size: 'md', primaryMetric: 'health-score' },
    { id: 'legacy_calendar', key: 'league-calendar', size: 'md' },
];
const rosterLayout = [
    { id: 'alex_age', key: 'custom-view', size: 'lg', title: 'Average age by position', view: {
        source: 'roster', groupBy: 'position', aggregate: { op: 'avg', field: 'age' }, columns: ['position', 'value'],
        sort: { field: 'value', direction: 'desc' }, limit: 20, display: 'bar', x: 'position', y: 'value', appearance: { accent: 'teal', density: 'comfortable' },
    } },
    { id: 'alex_roster_details', key: 'custom-view', size: 'xl', title: 'Detailed roster', view: {
        source: 'roster', columns: ['name', 'position', 'nflTeam', 'age', 'slot', 'teamName', 'gamesPlayed', 'fantasyPoints', 'ppg'],
        limit: 20, display: 'table', appearance: { accent: 'blue', density: 'comfortable' },
    } },
];
const leagueLayout = [{ id: 'alex_standings', key: 'league-standings', size: 'lg' }];
const withoutIds = layout => layout.map(({ id, ...item }) => item);
const equal = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS' };

async function server() {
    if (process.env.LENSES_URL) return { url: process.env.LENSES_URL, stop() {} };
    const port = await new Promise((resolve, reject) => {
        const probe = net.createServer(); probe.once('error', reject);
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
    const serving = await server(), browserName = process.env.LENSES_BROWSER || 'chromium';
    assert(['chromium', 'webkit'].includes(browserName), 'Unsupported LENSES_BROWSER');
    let browser;
    const results = [];
    try {
        browser = await (browserName === 'webkit' ? webkit : chromium).launch({ headless: true,
            ...(browserName === 'chromium' ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
        for (const size of matrix) {
            const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch, serviceWorkers: 'block' });
            const provider = createLeagueSkinFixture({ redraftId: leagueB, dynastyId: leagueA, user: username });
            const blocked = await installReadOnlyRoutes(context, { fixture: provider });
            const plans = [], requests = [], errors = [];
            await context.route('**/functions/v1/ai-analyze', async route => {
                if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
                const body = route.request().postDataJSON();
                const data = typeof body.context === 'string' ? JSON.parse(body.context) : body.context;
                if (!/dashboard[-_ ]builder/i.test(data?.callType || '') && !/dashboard (?:builder|layout)/i.test(data?.system || '')) {
                    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ analysis: 'Fixture briefing.' }) });
                }
                requests.push(body);
                const response = plans.shift();
                assert(response, 'Every builder response must be queued explicitly');
                if (response.hold) await response.hold;
                try {
                    return await route.fulfill({ status: response.status || 200, headers, contentType: 'application/json', body: JSON.stringify(response.status
                        ? { error: 'Fixture AI temporarily unavailable.' }
                        : { analysis: JSON.stringify({ version: 1, reply: 'Your lens preview is ready.', layout: response.layout }) }) });
                } catch (error) { if (!/closed|disposed|cancel|aborted/i.test(error.message)) throw error; }
            });
            await context.addInitScript(({ account, username, leagueA, legacyLayout }) => {
                if (!localStorage.getItem('fw_session_v1')) {
                    const payload = btoa(JSON.stringify({ sub: account, exp: Math.floor(Date.now() / 1000) + 3600 }));
                    localStorage.setItem('fw_session_v1', JSON.stringify({ token: 'fixture.' + payload + '.fixture', user: { id: account, email: 'lenses@example.invalid' } }));
                    localStorage.setItem('od_auth_v1', JSON.stringify({ username }));
                    localStorage.setItem('od_profile_v1', JSON.stringify({ onboardingComplete: true }));
                    localStorage.setItem('wr_active_connection_owner_v1', 'account:' + account);
                }
                if (!localStorage.getItem('lenses-fixture-initialized')) {
                    localStorage.setItem('wr_alex_dashboard_v1:' + account + ':' + leagueA, JSON.stringify({ version: 1, layout: legacyLayout, history: [] }));
                    localStorage.setItem('lenses-fixture-initialized', '1');
                }
                localStorage.setItem('dynastyhq_username', username);
                localStorage.setItem('wr_tutorial_done_v1', '1');
                window.__lensQuotaFailure = false;
                const original = Storage.prototype.setItem;
                Storage.prototype.setItem = function (key, value) {
                    if (window.__lensQuotaFailure && String(key).startsWith('wr_dashboard_lenses_v1:')) throw new DOMException('Fixture storage full', 'QuotaExceededError');
                    return original.call(this, key, value);
                };
            }, { account, username, leagueA, legacyLayout });
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            const click = locator => size.touch ? locator.tap() : locator.click();
            const workspace = () => page.locator('.dashboard-lenses').first();
            const canvas = () => workspace().locator('.dashboard-lenses-canvas');
            const dialog = () => page.getByRole('dialog', { name: 'Build with Alex', exact: true });
            const entry = id => { const url = new URL(serving.url); url.searchParams.set('dev', 'true'); url.searchParams.set('user', username); url.hash = 'league=' + id + '&tab=dashboard'; return url.href; };
            const load = async id => { await page.goto(entry(id), { waitUntil: 'domcontentloaded' }); await workspace().waitFor({ timeout: 60000 }); };
            const state = async (id = leagueA, owner = account) => page.evaluate(({ id, owner }) => {
                return window.WR.DashboardLensesStore.read(encodeURIComponent(owner) + ':' + encodeURIComponent(id), [], window.WR.DashboardBuilder.catalog(WIDGET_MODULES));
            }, { id, owner });
            const active = async () => { const doc = await state(); return doc.lenses.find(lens => lens.id === doc.activeId); };
            const activeName = async name => { await workspace().getByRole('tab', { name, exact: true, selected: true }).waitFor(); };
            const keyboardName = async name => {
                await activeName(name);
                await page.waitForFunction(() => document.activeElement === document.querySelector('.dashboard-lenses [role="tab"][aria-selected="true"]'));
            };
            const choose = async name => { await click(workspace().getByRole('tab', { name, exact: true })); await activeName(name); };
            const fit = async label => {
                const dimensions = await workspace().evaluate(el => { const rect = el.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1 }; });
                assert(!dimensions.overflow && dimensions.left >= -1 && dimensions.right <= dimensions.width + 1, label + ' fits the viewport: ' + JSON.stringify(dimensions));
            };
            const reachable = async (locator, label) => {
                await locator.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
                // App loading/status bubbles and sticky phone headers can
                // shift during provider resolution. Wait for normal hitability
                // rather than forcing through those overlays.
                await page.waitForFunction(el => {
                    const rect = el.getBoundingClientRect();
                    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
                    return el === hit || el.contains(hit);
                }, await locator.elementHandle(), { timeout: 30000 });
                const dimensions = await locator.evaluate(el => { const rect = el.getBoundingClientRect(); const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2); return { width: rect.width, height: rect.height, hit: el === hit || el.contains(hit) }; });
                assert(dimensions.hit, label + ' receives input: ' + JSON.stringify(dimensions));
                if (size.touch) assert(dimensions.width >= 44 && dimensions.height >= 44, label + ' is a 44px touch target');
            };
            const builderTab = async name => { const item = dialog().getByRole('tab', { name, exact: true }); if (await item.isVisible()) await click(item); };
            const submit = async (prompt, response) => {
                await builderTab('Edit'); plans.push(response);
                await dialog().getByRole('textbox', { name: /Describe your (?:dashboard|lens)/ }).fill(prompt);
                await click(dialog().getByRole('button', { name: 'Update preview', exact: true }));
            };
            const ready = async () => { await dialog().getByText('Your lens preview is ready.', { exact: true }).last().waitFor(); await dialog().getByRole('button', { name: 'Cancel request', exact: true }).waitFor({ state: 'hidden' }); };
            const save = async () => { await click(dialog().getByRole('button', { name: /^Save (?:dashboard|lens)$/ })); await dialog().getByText('Saved on this device.', { exact: true }).waitFor(); };
            const close = async () => { await click(dialog().getByRole('button', { name: 'Close builder', exact: true })); await dialog().waitFor({ state: 'hidden' }); };
            const open = async () => { await click(workspace().getByRole('button', { name: 'Build with Alex', exact: true })); await dialog().waitFor(); };
            const create = async name => {
                await reachable(workspace().getByRole('button', { name: 'New lens', exact: true }), 'New lens');
                await click(workspace().getByRole('button', { name: 'New lens', exact: true }));
                await workspace().getByLabel('Lens name', { exact: true }).fill(name);
                await click(workspace().getByRole('button', { name: 'Create lens', exact: true }));
                await dialog().waitFor();
            };
            const options = async () => { const button = workspace().getByRole('button', { name: 'Lens options', exact: true }); if (await button.getAttribute('aria-expanded') !== 'true') await click(button); };
            const touch = async (locator, dx, dy, clickAfter = false) => {
                await locator.scrollIntoViewIfNeeded();
                await locator.evaluate((el, { dx, dy, clickAfter }) => {
                    const box = el.getBoundingClientRect();
                    const x = Math.max(15, Math.min(innerWidth - 15, box.left + box.width * (dx < 0 ? 0.8 : 0.2)));
                    const y = Math.max(15, Math.min(innerHeight - 15, box.top + Math.min(box.height / 2, 60)));
                    const point = (clientX, clientY) => new Touch({ identifier: 7, target: el, clientX, clientY, pageX: clientX + scrollX, pageY: clientY + scrollY, screenX: clientX, screenY: clientY });
                    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [point(x, y)], changedTouches: [point(x, y)] }));
                    el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [point(x + dx, y + dy)], changedTouches: [point(x + dx, y + dy)] }));
                    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: [point(x + dx, y + dy)] }));
                    // A synthetic touch sequence does not synthesize the click
                    // a browser emits after touchend, so test that event too.
                    if (clickAfter) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x + dx, clientY: y + dy }));
                }, { dx, dy, clickAfter });
            };
            try {
                await load(leagueA);
                await activeName('Home');
                equal((await state()).lenses[0].layout, legacyLayout, 'The old dashboard becomes Home without losing saved sections');
                assert.equal(await workspace().getByRole('button', { name: /Add Widget|Reorder|Customize Home/ }).count(), 0, 'The former widget setup is replaced');
                await fit('Migrated lens');
                await create('Roster watch');
                equal((await active()).layout, [], 'A new lens starts blank rather than as a fixed preset');
                const home = (await state()).lenses[0];
                await submit('Compare roster age by position, with a detailed roster table.', { layout: rosterLayout });
                await ready();
                equal((await active()).layout, [], 'Alex preview does not save before confirmation');
                await builderTab('Preview');
                await dialog().getByRole('heading', { name: 'Average age by position', exact: true }).waitFor();
                await page.screenshot({ path: path.join(output, size.label + '-lens-preview.png') });
                await save();
                equal(withoutIds((await active()).layout), withoutIds(rosterLayout), 'The lens saves its own custom data views');
                await close();
                const rosterId = (await active()).id;
                equal((await state()).lenses.find(lens => lens.id === home.id), home, 'Saving another lens leaves Home unchanged');
                await fit('Custom lens');
                await page.screenshot({ path: path.join(output, size.label + '-lens-dashboard.png') });
                await create('League pulse');
                await submit('Show the league standings.', { layout: leagueLayout });
                await ready(); await save(); await close();
                equal((await state()).lenses.map(lens => lens.name), ['Home', 'Roster watch', 'League pulse'], 'Each requested lens is retained');
                if (size.touch) {
                    const beforeSwipe = page.url();
                    await touch(canvas().getByRole('button', { name: 'View standings', exact: true }), 160, 5, true);
                    await activeName('Roster watch');
                    assert.equal(page.url(), beforeSwipe, 'Swiping from a card action changes lens without opening that action');
                    await touch(canvas(), -160, 5); await activeName('League pulse');
                    await touch(canvas(), 10, -140); await activeName('League pulse');
                } else {
                    await click(workspace().getByRole('button', { name: 'Previous lens', exact: true })); await activeName('Roster watch');
                    await click(workspace().getByRole('button', { name: 'Next lens', exact: true })); await activeName('League pulse');
                }
                await choose('Roster watch');
                const table = canvas().getByRole('region', { name: 'Detailed roster data table', exact: true });
                await table.waitFor();
                if (size.touch) { await touch(table, -160, 3); await activeName('Roster watch'); }
                const requestCount = requests.length;
                await page.reload({ waitUntil: 'domcontentloaded' }); await workspace().waitFor({ timeout: 60000 });
                await activeName('Roster watch');
                assert.equal(requests.length, requestCount, 'Reload and switching do not call Alex');
                await workspace().getByRole('tab', { name: 'Roster watch', exact: true }).focus();
                await page.keyboard.press('Home'); await keyboardName('Home');
                await page.keyboard.press('End'); await keyboardName('League pulse');
                await page.keyboard.press('ArrowLeft'); await keyboardName('Roster watch');
                assert.equal(await workspace().getByRole('tab', { name: 'Roster watch', exact: true }).evaluate(el => document.activeElement === el), true, 'Keyboard selection keeps focus on the selected tab');
                const beforeEdit = (await active()).layout;
                await open();
                const revised = JSON.parse(JSON.stringify(beforeEdit)); revised[0].title = 'Ages worth reviewing';
                await submit('Rename the age chart to Ages worth reviewing.', { layout: revised }); await ready(); await save(); await close();
                assert.equal((await active()).layout[0].title, 'Ages worth reviewing');
                await options(); await click(workspace().getByRole('button', { name: 'Undo last save', exact: true }));
                equal((await active()).layout, beforeEdit, 'Undo restores only the active lens');
                equal((await state()).lenses.find(lens => lens.name === 'League pulse').layout.map(item => item.key), ['league-standings'], 'Undo does not alter another lens');
                await options(); await click(workspace().getByRole('button', { name: 'Rename lens', exact: true }));
                await workspace().getByLabel('Lens name', { exact: true }).fill('Roster radar');
                await click(workspace().getByRole('button', { name: 'Save name', exact: true })); await activeName('Roster radar');
                await options(); await click(workspace().getByRole('button', { name: 'Duplicate lens', exact: true }));
                await page.waitForFunction(id => document.querySelector('.dashboard-lenses [role="tab"][aria-selected="true"]')?.textContent !== 'Roster radar' && window.WR.DashboardLensesStore.read(window.WR.DashboardBuilder.scopeFor(id), [], window.WR.DashboardBuilder.catalog(WIDGET_MODULES)).lenses.length === 4, leagueA);
                const duplicate = await active();
                equal(withoutIds(duplicate.layout), withoutIds(beforeEdit), 'Duplication preserves data/visuals');
                assert(duplicate.layout.every(item => !beforeEdit.some(original => original.id === item.id)), 'Duplicated sections have independent reminder identities');
                await options(); await click(workspace().getByRole('button', { name: 'Remove lens', exact: true }));
                await workspace().getByRole('heading', { name: 'Remove this lens?', exact: true }).waitFor();
                await click(workspace().getByRole('button', { name: 'Remove lens', exact: true }).last());
                assert.equal((await state()).lenses.length, 3);
                await click(workspace().getByRole('button', { name: 'Restore lens', exact: true }));
                assert.equal((await state()).lenses.length, 4, 'A removed lens can be restored');
                await choose('Roster radar');
                await options(); await click(workspace().getByRole('button', { name: 'Rename lens', exact: true }));
                await workspace().getByLabel('Lens name', { exact: true }).fill('Must not save');
                await page.evaluate(() => { window.__lensQuotaFailure = true; });
                await click(workspace().getByRole('button', { name: 'Save name', exact: true }));
                await workspace().getByRole('alert').waitFor();
                assert.equal((await state()).lenses.find(lens => lens.id === rosterId).name, 'Roster radar', 'Storage failure does not change the saved lens');
                await page.evaluate(() => { window.__lensQuotaFailure = false; });
                await workspace().getByLabel('Lens name', { exact: true }).fill('Roster radar');
                await click(workspace().getByRole('button', { name: 'Save name', exact: true }));
                await fit('Management controls');
                await page.screenshot({ path: path.join(output, size.label + '-managed-lenses.png') });

                // The second league is deliberately redraft: the new lens UI
                // must replace the old fixed-layout exception too.
                const leagueADocument = await state();
                await load(leagueB); await activeName('Home');
                assert.equal((await state(leagueB)).lenses.length, 1, 'Other leagues do not inherit the lens collection');
                await create('Season focus'); await close();
                assert.equal((await state(leagueB)).lenses.length, 2, 'Redraft also supports custom lenses');
                await load(leagueA); await activeName('Roster radar');
                equal(await state(), leagueADocument, 'Returning to a league restores its exact collection');

                if (size.label === 'phone' || (selected?.length === 1)) {
                    await open();
                    let release;
                    const hold = new Promise(resolve => { release = resolve; });
                    await submit('A late request must remain in this league.', { layout: leagueLayout, hold });
                    await dialog().getByRole('button', { name: 'Cancel request', exact: true }).waitFor();
                    await page.evaluate(id => { location.hash = 'league=' + id + '&tab=dashboard'; }, leagueB);
                    await workspace().getByRole('tab', { name: 'Season focus', exact: true, selected: true }).waitFor({ timeout: 60000 });
                    release();
                    await dialog().waitFor({ state: 'hidden' });
                    equal((await state(leagueB)).lenses.find(lens => lens.name === 'Season focus').layout, [], 'A reply from the previous league cannot modify this lens');
                    await load(leagueA); await open();
                    let releaseAccount;
                    const heldAccount = new Promise(resolve => { releaseAccount = resolve; });
                    await submit('A late request must remain in this account.', { layout: leagueLayout, hold: heldAccount });
                    await dialog().getByRole('button', { name: 'Cancel request', exact: true }).waitFor();
                    await page.evaluate(({ secondAccount, username }) => {
                        const payload = btoa(JSON.stringify({ sub: secondAccount, exp: Math.floor(Date.now() / 1000) + 3600 }));
                        localStorage.setItem('fw_session_v1', JSON.stringify({ token: 'fixture.' + payload + '.fixture', user: { id: secondAccount, email: 'other-lenses@example.invalid' } }));
                        localStorage.setItem('wr_active_connection_owner_v1', 'account:' + secondAccount);
                        localStorage.setItem('od_auth_v1', JSON.stringify({ username }));
                        window.dispatchEvent(new StorageEvent('storage', { key: 'fw_session_v1' }));
                    }, { secondAccount, username });
                    await workspace().getByRole('tab', { name: 'Home', exact: true, selected: true }).waitFor({ timeout: 60000 });
                    releaseAccount();
                    assert.equal((await state(leagueA, secondAccount)).lenses.length, 1, 'Another account starts with its own lens collection');
                    equal(await state(leagueA, account), leagueADocument, 'Account switching and late replies preserve the first account');
                }
                assert.equal(errors.length, 0, 'No browser runtime errors: ' + errors.join(' | '));
                assert.equal(plans.length, 0, 'All queued fixture responses were consumed');
                results.push({ viewport: size.label, dimensions: `${size.width}x${size.height}`, touch: size.touch, passed: true, aiFixtureRequests: requests.length, blockedExternalWrites: blocked.length });
                console.log('PASS dashboard lenses ' + size.label + ': migration, independent creation, preview/save, switching, touch/keyboard, nested scrolling, reload, rename/duplicate/remove/restore, per-lens undo, quota, league/account isolation');
            } catch (error) {
                await page.screenshot({ path: path.join(output, size.label + '-failure.png') }).catch(() => {});
                fs.writeFileSync(path.join(output, size.label + '-failure.json'), JSON.stringify({ error: error.stack, browserErrors: errors, url: page.url(), text: await page.locator('body').innerText().catch(() => ''), requests }, null, 2));
                throw error;
            } finally { await context.close(); }
        }
        fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ evidence: 'Local real-app browser acceptance with fixture provider/AI responses and emulated touch; no live AI, hosted deployment, or physical-device claim.', browser: browserName, results }, null, 2));
    } finally { await browser?.close(); serving.stop(); }
}

run().catch(error => { console.error(error.stack); process.exitCode = 1; });
