'use strict';
// Full application, real LensData/Research/Composition pipeline, deterministic
// provider and AI fixtures. This does not prove live-model or hosted behavior.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium, webkit } = require('@playwright/test');
const { installReadOnlyRoutes } = require('./helpers/browser-readonly.cjs');
const { createLeagueSkinFixture } = require('./helpers/league-skin-fixture.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output/playwright/lens-generative');
const leagueId = '1312100327931019264', otherId = '1312100327931019265';
const account = '10000000-0000-4000-8000-000000000019', username = 'generative-lens-fixture';
const sizes = [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 900 }, { width: 1440, height: 1000 }];
const selected = process.env.GENERATIVE_WIDTHS?.split(',').map(Number);
const browserName = process.env.GENERATIVE_BROWSER || 'chromium';
assert(['chromium', 'webkit'].includes(browserName), 'Unknown GENERATIVE_BROWSER');
const matrix = selected ? sizes.filter(size => selected.includes(size.width)) : sizes;
assert(matrix.length && (!selected || matrix.length === selected.length), 'Unknown GENERATIVE_WIDTHS value');
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS' };
const columns = ['playerId', 'name', 'position', 'teamName', 'teamRecord', 'teamWinPct', 'ppg', 'gamesPlayed', 'positionRank', 'age', 'value'];
const plan = { version: 1, needs: [{ id: 'targets', source: 'tradeTargets', columns, filters: [{ field: 'teamWinPct', op: 'lt', value: 50 }], sort: { field: 'ppg', direction: 'desc' }, limit: 60 }], researchQuestion: null, assumptions: ['Bad teams means losing fantasy teams. Ranking uses reported league-scored season PPG; willingness to trade is unknown.'], reuseEvidence: false };
function composition(payload, edit) {
    const sourceIds = payload.sources.map(source => source.id), ds = payload.datasets[0];
    assert.equal(ds.source, 'tradeTargets'); assert.equal(ds.status, 'ready'); assert.equal(ds.rows.length, 18);
    assert(ds.rows.every(row => row.teamWinPct < 50 && ['QA Team 2', 'QA Team 4'].includes(row.teamName)));
    assert(ds.rows.every(row => typeof row.ppg === 'number'));
    assert(ds.rows.every((row, i, rows) => !i || rows[i - 1].ppg >= row.ppg));
    const blocks = [
        { id: 'production', kind: 'chart', title: 'Production versus team record', datasetId: 'targets', sourceIds, span: 8, tabletSpan: 12,
            visual: { mark: { type: 'point', filled: true, size: 120 }, encoding: { x: { field: 'teamWinPct', type: 'quantitative', title: 'Fantasy team win percentage' }, y: { field: 'ppg', type: 'quantitative', title: 'League PPG' }, color: { field: 'position', type: 'nominal' }, tooltip: [{ field: 'name', type: 'nominal' }, { field: 'ppg', type: 'quantitative' }] } },
            mobileVisual: { mark: 'bar', encoding: { y: { field: 'name', type: 'nominal', sort: '-x' }, x: { field: 'ppg', type: 'quantitative' }, color: { field: 'position', type: 'nominal' } } } },
        { id: 'positions', kind: 'chart', title: 'Where the targets play', datasetId: 'targets', sourceIds, span: 4, tabletSpan: 6,
            visual: { mark: { type: 'arc', innerRadius: 45 }, encoding: { theta: { aggregate: 'count', type: 'quantitative' }, color: { field: 'position', type: 'nominal' } } } },
        { id: 'ranking', kind: 'chart', title: 'Observed PPG ranking', datasetId: 'targets', sourceIds, span: 12, tabletSpan: 6,
            visual: { mark: 'bar', encoding: { y: { field: 'name', type: 'nominal', sort: '-x' }, x: { field: 'ppg', type: 'quantitative' }, color: { field: 'teamName', type: 'nominal' } } } },
        { id: 'players', kind: 'table', title: 'Players to discuss', datasetId: 'targets', columns: ['name', 'position', 'teamName', 'teamRecord', 'ppg', 'positionRank', 'age', 'value'], sourceIds, span: 12, tabletSpan: 12 },
        { id: 'scope', kind: 'text', title: 'What this evidence means', body: 'These players belong to losing fantasy teams. Reported PPG supplies the ranking; a team record does not establish whether its owner will trade.', sourceIds, span: 12, tabletSpan: 12 },
    ];
    if (edit) blocks.unshift(blocks.splice(3, 1)[0]);
    return { version: 1, reply: edit ? 'I made the lens purple and moved player details first.' : 'I ranked players on losing fantasy teams using observed PPG.', composition: { version: 1, title: edit ? 'Trade targets in purple' : 'Trade targets from losing teams', subtitle: 'Your league · observed season production · other teams only', theme: { accent: edit ? '#b585ed' : '#63cbb5', style: 'analytic' }, blocks } };
}
async function server() {
    if (process.env.GENERATIVE_URL) return { url: process.env.GENERATIVE_URL, stop() {} };
    const port = await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); }); });
    const child = spawn(process.execPath, ['scripts/serve-static.cjs', '--host=127.0.0.1', '--port=' + port, '--compile'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Server did not become ready')), 30000); child.stdout.on('data', chunk => { if (String(chunk).includes('Serving')) { clearTimeout(timer); resolve(); } }); child.once('exit', code => { clearTimeout(timer); reject(Error('Server exited ' + code)); }); });
    return { url: `http://127.0.0.1:${port}/index.html`, stop: () => child.kill() };
}
async function run() {
    fs.mkdirSync(output, { recursive: true });
    const serving = await server(); let browser; const results = [];
    try {
        browser = await (browserName === 'webkit' ? webkit : chromium).launch({ headless: true, ...(browserName === 'chromium' ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
        for (const size of matrix) {
            const caseLabel = (browserName === 'webkit' ? 'webkit-' : '') + size.width;
            const touch = size.width < 1024;
            const context = await browser.newContext({ viewport: size, hasTouch: touch, serviceWorkers: 'block' });
            const original = createLeagueSkinFixture({ dynastyId: leagueId, redraftId: otherId, user: username });
            const stats = Object.fromEntries(Array.from({ length: 90 }, (_, i) => ['qa-player-' + i, { gp: 5, rec: 60 + i, rec_yd: 500 + i * 10 }]));
            const phase = item => item?.league_id === leagueId && item.settings?.type != null ? { ...item, status: 'in_season', settings: { ...item.settings, leg: 7 } } : item?.draft_id === 'qa-draft-' + leagueId ? { ...item, status: 'complete' } : item;
            const blocked = await installReadOnlyRoutes(context, { fixture: url => {
                if (/^api\.sleeper\.(?:app|com)$/.test(url.hostname) && /\/state\/nfl$/.test(url.pathname)) return { season: '2026', league_season: '2026', season_type: 'regular', week: 7, display_week: 7 };
                if (/^api\.sleeper\.(?:app|com)$/.test(url.hostname) && /\/(stats|projections)\//.test(url.pathname)) return stats;
                const value = original(url);
                if (url.pathname.endsWith('/league/' + leagueId + '/rosters')) return value.map((row, i) => ({ ...row, settings: { ...row.settings, wins: [1, 2, 5, 1, 4, 3][i], losses: [5, 4, 1, 5, 2, 3][i], ties: 0, fpts: 300 + i * 50 } }));
                return Array.isArray(value) ? value.map(phase) : phase(value);
            } });
            const calls = [], errors = [], routeErrors = []; let edit = false;
            await context.route('**/functions/v1/ai-analyze', async route => {
                try {
                    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
                    const request = route.request().postDataJSON(), ctx = typeof request.context === 'string' ? JSON.parse(request.context) : request.context;
                    if (!/^lens-/.test(ctx?.callType || '')) return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ analysis: 'Fixture briefing.' }) });
                    const payload = JSON.parse(ctx.messages[0].content); calls.push({ phase: ctx.callType, payload });
                    let answer;
                    if (ctx.callType === 'lens-plan') { edit = /purple/i.test(payload.request); answer = edit ? { version: 1, needs: [], researchQuestion: null, assumptions: [], reuseEvidence: true } : plan; }
                    else if (ctx.callType === 'lens-compose') answer = composition(payload, edit);
                    else throw Error('Unexpected lens phase: ' + ctx.callType);
                    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ analysis: JSON.stringify(answer) }) });
                } catch (error) { routeErrors.push(error.message); return route.fulfill({ status: 500, headers, contentType: 'application/json', body: JSON.stringify({ error: error.message }) }); }
            });
            await context.addInitScript(({ account, username }) => {
                if (!localStorage.getItem('fw_session_v1')) {
                    const payload = btoa(JSON.stringify({ sub: account, exp: Math.floor(Date.now() / 1000) + 3600 }));
                    localStorage.setItem('fw_session_v1', JSON.stringify({ token: 'fixture.' + payload + '.fixture', user: { id: account, email: 'lens-fixture@example.invalid' } }));
                    localStorage.setItem('od_auth_v1', JSON.stringify({ username })); localStorage.setItem('od_profile_v1', JSON.stringify({ onboardingComplete: true })); localStorage.setItem('wr_active_connection_owner_v1', 'account:' + account);
                }
                localStorage.setItem('dynastyhq_username', username); localStorage.setItem('wr_tutorial_done_v1', '1');
            }, { account, username });
            const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
            const click = locator => touch ? locator.tap() : locator.click();
            const workspace = () => page.locator('.dashboard-lenses').first(), canvas = () => workspace().locator('.dashboard-lenses-canvas'), dialog = () => page.getByRole('dialog', { name: 'Build with Alex', exact: true });
            const state = () => page.evaluate(leagueId => window.WR.DashboardLensesStore.read(window.WR.DashboardBuilder.scopeFor(leagueId), [], window.WR.DashboardBuilder.catalog(WIDGET_MODULES)), leagueId);
            const active = async () => { const doc = await state(); return doc.lenses.find(lens => lens.id === doc.activeId); };
            const tab = async name => { const item = dialog().getByRole('tab', { name, exact: true }); if (await item.isVisible()) await click(item); };
            const fit = async label => {
                const dimensions = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, compositions: [...document.querySelectorAll('[data-lens-composition]')].map(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; }) }));
                assert(dimensions.document <= dimensions.width + 1 && dimensions.body <= dimensions.width + 1, label + ' document overflow: ' + JSON.stringify(dimensions));
                for (const rect of dimensions.compositions) if (rect.width) assert(rect.left >= -1 && rect.right <= dimensions.width + 1, label + ' composition overflow: ' + JSON.stringify(dimensions));
            };
            const scrollLock = async () => {
                const snapshot = () => page.evaluate(() => ({ x: scrollX, y: scrollY, root: document.documentElement.scrollTop, body: document.body.scrollTop }));
                const before = await snapshot(); const box = await dialog().locator('.alex-builder-preview').boundingBox();
                await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 200)); await page.mouse.wheel(0, 900); await page.waitForTimeout(180);
                assert.deepEqual(await snapshot(), before, 'Scrolling the preview must not move the dashboard behind it');
                if (touch && browserName === 'chromium') { const session = await context.newCDPSession(page); await session.send('Input.synthesizeScrollGesture', { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 200), yDistance: -100, speed: 600, preventFling: true, gestureSourceType: 'touch' }); await page.waitForTimeout(120); assert.deepEqual(await snapshot(), before, 'Touch scrolling must not move the dashboard behind it'); await session.detach(); }
            };
            const submit = async prompt => { await tab('Edit'); await dialog().getByRole('textbox', { name: /Describe your (?:dashboard|lens)/ }).fill(prompt); await click(dialog().getByRole('button', { name: 'Update preview', exact: true })); await dialog().getByRole('button', { name: 'Cancel request', exact: true }).waitFor({ state: 'hidden', timeout: 60000 }); assert.deepEqual(routeErrors, []); await tab('Preview'); };
            const save = async () => { await click(dialog().getByRole('button', { name: 'Save lens', exact: true })); await dialog().getByText('Saved on this device.', { exact: true }).waitFor(); };
            const close = async () => { await click(dialog().getByRole('button', { name: 'Close builder', exact: true })); await dialog().waitFor({ state: 'hidden' }); };
            const visualsOnly = async host => {
                const article = host.locator('[data-lens-composition]').first();
                await article.waitFor();
                await page.waitForFunction(el => el.querySelectorAll('.lens-composition-graphic svg').length === 3 && !el.querySelector('.lens-composition-chart-status'), await article.elementHandle(), { timeout: 45000 });
                assert.equal(await article.locator('.lens-composition-text, .lens-composition-prose').count(), 0, 'Narrative blocks are absent from the visual canvas');
                assert.equal(await article.locator('.lens-composition-heading > p, .lens-composition-block > header > p').count(), 0, 'No lens or chart subtitle paragraphs');
                assert.equal(await article.locator('.lens-composition-block > footer').count(), 0, 'Source notes are not repeated below charts');
                assert.equal(await article.locator('p:visible').count(), 0, 'The initial composition shows visuals rather than explanatory paragraphs');
                assert.equal(await article.locator('.lens-composition-block.lens-composition-chart').count(), 3, 'All three core graphics remain');
                assert.equal(await article.locator('[data-lens-block="players"] tbody tr').count(), 18, 'The player data remains intact');
                const sources = article.locator('.lens-composition-research');
                assert.equal(await sources.count(), 1, 'There is one sources disclosure');
                assert.equal(await sources.getAttribute('open'), null, 'Evidence is closed initially');
                const note = calls.find(call => call.phase === 'lens-compose').payload.datasets[0].note;
                assert((await sources.locator('.lens-composition-snapshots').textContent()).includes(note), 'Dataset limitations remain available inside the disclosure');
                const links = article.locator('a[data-lens-source]');
                assert.equal(await links.count(), await sources.locator('a[data-lens-source]').count(), 'Source links live only in the single disclosure');
                assert.equal(await links.first().isVisible(), false, 'Sources do not add captions to the initial canvas');
                const legendGeometry = await article.locator('.lens-composition-block.lens-composition-chart').evaluateAll(blocks => blocks.map(block => {
                    const graphic = block.querySelector('.lens-composition-graphic'), svg = graphic.querySelector('svg');
                    const host = graphic.getBoundingClientRect(), viewport = svg.getBoundingClientRect();
                    const labels = [...svg.querySelectorAll('.role-legend-label text, .role-legend-title text')].map(el => {
                        const r = el.getBoundingClientRect();
                        return { text: el.textContent, clipped: r.left < Math.max(host.left, viewport.left) - 2 || r.right > Math.min(host.right, viewport.right) + 2 || r.top < viewport.top - 2 || r.bottom > viewport.bottom + 2, box: { left: r.left - viewport.left, right: r.right - viewport.left, top: r.top - viewport.top, bottom: r.bottom - viewport.top } };
                    });
                    return { id: block.dataset.lensBlock, width: viewport.width, height: viewport.height, labels, values: [...svg.querySelectorAll('.role-legend-label text')].map(el => el.textContent.trim()) };
                }));
                const dataRows = calls.find(call => call.phase === 'lens-compose').payload.datasets[0].rows;
                for (const chart of legendGeometry) {
                    assert(chart.labels.length, 'Each fixture chart has a rendered legend');
                    assert(chart.labels.every(label => !label.clipped), 'Legend labels fit inside the rendered SVG and chart: ' + JSON.stringify(chart));
                    const field = chart.id === 'ranking' ? 'teamName' : 'position';
                    assert.deepEqual(chart.values.slice().sort(), [...new Set(dataRows.map(row => row[field]))].sort(), 'All legend categories remain fully readable: ' + chart.id);
                }
            };
            try {
                const entry = new URL(serving.url); entry.searchParams.set('dev', 'true'); entry.searchParams.set('user', username); entry.hash = 'league=' + leagueId + '&tab=lenses';
                await page.goto(entry.href, { waitUntil: 'domcontentloaded' }); await workspace().waitFor({ timeout: 60000 });
                await click(workspace().getByRole('button', { name: 'Build with Alex', exact: true }));
                await workspace().getByLabel('Lens name', { exact: true }).fill('Trade target research'); await click(workspace().getByRole('button', { name: 'Create lens', exact: true })); await dialog().waitFor();
                await tab('Preview'); await dialog().getByRole('heading', { name: 'Your blank canvas', exact: true }).waitFor();
                assert.equal(await dialog().locator('[data-lens-composition], [data-widget-key]').count(), 0); await scrollLock();
                await submit('List all the best players from bad teams I could target in a trade.');
                await dialog().getByRole('heading', { name: 'Trade targets from losing teams', exact: true }).waitFor({ timeout: 30000 });
                await page.waitForFunction(() => document.querySelectorAll('[role="dialog"] .lens-composition-graphic svg').length === 3, null, { timeout: 45000 });
                const production = dialog().locator('[data-lens-block="production"] .lens-composition-graphic');
                const graphicWidth = await production.evaluate(el => el.getBoundingClientRect().width);
                assert(await production.locator(graphicWidth < 500 ? 'svg .mark-rect' : 'svg .mark-symbol').count(), 'The responsive visual renders real bars on narrow panels and scatter points on wide panels');
                assert.equal(await dialog().getByText(/could not render/).count(), 0); assert.equal((await active()).layout.length, 0, 'Generated preview stays unsaved');
                assert.deepEqual(calls.map(call => call.phase), ['lens-plan', 'lens-compose']);
                assert(calls[0].payload.dataCatalog.some(source => source.id === 'tradeTargets'));
                await visualsOnly(dialog());
                await fit('Generated preview'); await scrollLock();
                const details = dialog().locator('[data-lens-block="players"] .lens-composition-row-details details').first();
                if (await details.isVisible()) { await click(details.locator('summary')); assert.equal(await details.getAttribute('open'), ''); }
                else { const evidence = dialog().locator('.lens-composition-evidence').first(); await click(evidence.locator('summary')); assert.equal(await evidence.getAttribute('open'), ''); }
                const research = dialog().locator('.lens-composition-research'); await click(research.locator('summary')); assert.equal(await research.getAttribute('open'), '');
                const source = research.locator('a[data-lens-source]').first();
                const [popup] = await Promise.all([page.waitForEvent('popup'), click(source)]); await popup.waitForURL(/^https:\/\/api\.sleeper\.app\//); assert.equal(new URL(popup.url()).hostname, 'api.sleeper.app'); await popup.close();
                await fit('Interactive preview'); await page.screenshot({ path: path.join(output, caseLabel + '-preview.png') });
                await save(); await close(); const saved = (await active()).layout;
                assert.equal(saved.length, 1); assert.equal(saved[0].key, 'generative-lens'); assert.equal(saved[0].composition.datasets[0].rows.length, 18);
                assert.equal(saved[0].composition.subtitle, undefined, 'New compositions discard model-supplied caption prose');
                assert(saved[0].composition.blocks.every(block => block.kind !== 'text' && block.subtitle === undefined && block.body === undefined), 'New saves contain visual blocks without explanatory captions');
                assert(Date.now() - Date.parse(saved[0].composition.datasets[0].asOf) < 300000, 'Newly fetched statistics carry their real snapshot time');
                const beforeReload = calls.length; await page.reload({ waitUntil: 'domcontentloaded' }); await workspace().getByRole('tab', { name: 'Trade target research', exact: true, selected: true }).waitFor({ timeout: 60000 });
                await canvas().getByRole('heading', { name: 'Trade targets from losing teams', exact: true }).waitFor(); assert.equal(calls.length, beforeReload, 'Reload renders saved evidence without calling AI');
                assert.deepEqual((await active()).layout, saved); await visualsOnly(canvas()); await fit('Reloaded lens');
                await click(workspace().getByRole('button', { name: 'Edit lens', exact: true })); await dialog().waitFor();
                await submit('Make it purple and put the player details first.');
                await dialog().getByRole('heading', { name: 'Trade targets in purple', exact: true }).waitFor();
                await visualsOnly(dialog());
                assert.equal(calls.at(-2).phase, 'lens-plan'); assert.equal(calls.at(-1).phase, 'lens-compose'); assert.equal(calls.at(-2).payload.currentComposition.title, saved[0].composition.title);
                assert.deepEqual((await active()).layout, saved, 'Conversational edit remains unsaved'); await save(); await close();
                assert.equal((await active()).layout[0].composition.theme.accent, '#b585ed'); assert.equal((await active()).layout[0].composition.blocks[0].kind, 'table');
                await click(workspace().getByRole('button', { name: 'Lens options', exact: true })); await click(workspace().getByRole('button', { name: 'Undo last save', exact: true }));
                assert.deepEqual((await active()).layout, saved, 'Undo restores original composition and evidence');
                await canvas().getByRole('heading', { name: 'Trade targets from losing teams', exact: true }).waitFor(); await visualsOnly(canvas()); await fit('Undo');
                // A pre-change saved document can still contain prose. Keep its
                // source data intact while verifying the new renderer hides it.
                await page.evaluate(leagueId => {
                    const store = window.WR.DashboardLensesStore, scope = window.WR.DashboardBuilder.scopeFor(leagueId), key = store.storageKey(scope);
                    const doc = JSON.parse(localStorage.getItem(key)), lens = doc.lenses.find(item => item.id === doc.activeId), composition = lens.layout[0].composition;
                    composition.subtitle = 'Legacy explanation should stay off the canvas.';
                    composition.blocks[0].subtitle = 'Legacy chart caption should stay off the canvas.';
                    composition.blocks.push({ id: 'legacy_narrative', kind: 'text', title: 'Legacy explanation', body: 'Old explanatory paragraphs should remain hidden.', sourceIds: composition.sources.map(source => source.id), span: 12, tabletSpan: 12 });
                    localStorage.setItem(key, JSON.stringify(doc));
                }, leagueId);
                const beforeLegacyReload = calls.length;
                await page.reload({ waitUntil: 'domcontentloaded' }); await workspace().getByRole('tab', { name: 'Trade target research', exact: true, selected: true }).waitFor({ timeout: 60000 });
                await visualsOnly(canvas()); assert.equal(calls.length, beforeLegacyReload, 'Legacy saved documents render without another AI call');
                assert((await active()).layout[0].composition.blocks.some(block => block.id === 'legacy_narrative'), 'Rendering does not rewrite the saved document');
                await fit('Legacy saved captions hidden');
                await canvas().locator('[data-lens-block="positions"]').screenshot({ path: path.join(output, caseLabel + '-legend.png') });
                await page.screenshot({ path: path.join(output, caseLabel + '-saved.png') });
                assert.deepEqual(errors, [], 'No uncaught page exceptions'); assert.deepEqual(routeErrors, []);
                results.push({ width: size.width, height: size.height, calls: calls.map(call => call.phase), datasets: 1, rows: 18, renderedCharts: 3, visualOnlyCanvas: true, evidenceInitiallyCollapsed: true, legacyCaptionsHidden: true, legendLabelsContained: true, blockedExternalWrites: blocked.length, status: 'passed' });
                console.log('PASS generative lens full flow at ' + caseLabel);
            } catch (error) {
                await page.screenshot({ path: path.join(output, caseLabel + '-failure.png') }).catch(() => {});
                fs.writeFileSync(path.join(output, caseLabel + '-failure.txt'), JSON.stringify({ error: error.stack, errors, routeErrors, calls: calls.map(c => c.phase), text: await page.locator('body').innerText().catch(() => '') }, null, 2));
                throw error;
            } finally { await context.close(); }
        }
        const report = selected ? `results-${browserName}-${matrix.map(size => size.width).join('-')}.json` : browserName === 'webkit' ? 'results-webkit.json' : 'results.json';
        fs.writeFileSync(path.join(output, report), JSON.stringify({ browser: browserName, proof: 'Local real-app browser flow with isolated provider and AI fixtures; not live model, hosted or physical-device evidence.', results }, null, 2));
    } finally { await browser?.close(); serving.stop(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
