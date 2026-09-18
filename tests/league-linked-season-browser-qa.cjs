'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const { installReadOnlyRoutes } = require('./helpers/browser-readonly.cjs');
const { createLeagueSkinFixture } = require('./helpers/league-skin-fixture.cjs');
const oldId = '1660000000000000001', currentId = '1760000000000000001';
const origin = process.env.READINESS_PREVIEW_ORIGIN || 'http://127.0.0.1:3502';
const base = origin + '/dist-preview/?dev=true';
const oldLink = base + '#league=' + oldId + '&tab=stats';
const underlying = createLeagueSkinFixture({ redraftId: 'unused', dynastyId: currentId, user: 'history-fixture' });
const current = { ...underlying(new URL('https://api.sleeper.app/v1/league/' + currentId)), name: 'Current 2026' };
const old = { ...current, league_id: oldId, name: 'Historical 2025', season: '2025', status: 'complete', draft_id: 'history-draft' };
let mode = 'ready', releaseSlow;
const checks = [], requests = [];
const pass = message => { checks.push(message); console.log('PASS ' + message); };
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const blocked = await installReadOnlyRoutes(context, { fixture: url => {
            if (!/^api\.sleeper\.(app|com)$/.test(url.hostname)) return undefined;
            const p = url.pathname.replace(/^\/v1/, ''); requests.push(p);
            if (/^\/user\/[^/]+\/leagues\/nfl\//.test(p)) return p.endsWith('/2025') ? (mode === 'unowned' ? [] : [old]) : [current];
            if (p === '/league/' + oldId) return old;
            if (p === '/league/' + currentId) return current;
            if (p.startsWith('/league/' + oldId + '/')) {
                const value = underlying(new URL(url.href.replace(oldId, currentId)));
                return Array.isArray(value) && p.endsWith('/rosters') ? value.map(r => ({ ...r, league_id: oldId, settings: { wins: 12, losses: 2 } })) : value;
            }
            return underlying(url);
        } });
        await context.route('**/*.supabase.co/**', route => route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"Isolated fixture: backend disabled"}' }));
        await context.route('https://api.sleeper.app/v1/league/' + oldId, async route => {
            if (mode === 'failed') return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
            if (mode === 'slow') await new Promise(resolve => { releaseSlow = resolve; });
            return route.fallback();
        });
        await context.addInitScript(() => {
            localStorage.setItem('od_auth_v1', JSON.stringify({ sleeperUsername: 'history-fixture' }));
        });
        const page = await context.newPage();
        const opened = (id, season) => page.waitForFunction(({ id, season }) => window.S?.currentLeagueId === id && String(window.S?.season) === season && !!document.querySelector('[aria-label="Player statistics"]'), { id, season }, { timeout: 60000 });
        await page.goto(oldLink, { waitUntil: 'domcontentloaded' }); await opened(oldId, '2025');
        assert.match(await page.locator('body').innerText(), /Historical 2025/);
        await page.reload({ waitUntil: 'domcontentloaded' }); await opened(oldId, '2025'); pass('historical bookmark and reload preserve 2025 identity and Stats');
        await page.getByRole('button', { name: 'SWITCH', exact: true }).click();
        await page.locator('.hub-league-card').first().waitFor();
        assert.equal(await page.locator('.hub-league-card').count(), 1);
        assert.match(await page.locator('.hub-league-card').innerText(), /Current 2026/);
        await page.goBack(); await opened(oldId, '2025');
        await page.goForward(); await page.locator('.hub-league-card').first().waitFor();
        pass('Home and actual browser Back/Forward retain old route without mixing current portfolio');
        await page.locator('.hub-league-card').click();
        await page.waitForFunction(id => window.S?.currentLeagueId === id && String(window.S?.season) === '2026', currentId, { timeout: 60000 });
        pass('selecting current league remounts 2026 context after historical view');

        mode = 'failed'; await page.goto(oldLink.replace('?dev=true', '?dev=true&case=failed'), { waitUntil: 'domcontentloaded' }); await page.getByRole('button', { name: 'Retry league link', exact: true }).waitFor({ timeout: 60000 });
        assert.match(await page.getByTestId('league-route-status').innerText(), /League unavailable/);
        for (const [width, height] of [[320, 720], [390, 844], [844, 390]]) {
            await page.setViewportSize({ width, height });
            const geometry = await page.getByTestId('league-route-status').evaluate(node => ({ viewport: innerWidth, page: document.documentElement.scrollWidth, rect: node.getBoundingClientRect().toJSON(), buttons: [...node.querySelectorAll('button')].map(b => ({ rect: b.getBoundingClientRect().toJSON(), font: parseFloat(getComputedStyle(b).fontSize) })) }));
            assert(geometry.page <= width + 1, 'route recovery must not create document overflow');
            assert(geometry.buttons.every(b => b.rect.width >= 44 && b.rect.height >= 44 && b.rect.right <= width && b.font >= 16), JSON.stringify(geometry));
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: 'reports/public-readiness/historical-link-retry-390.png', fullPage: false });
        mode = 'ready'; await page.getByRole('button', { name: 'Retry league link', exact: true }).click(); await opened(oldId, '2025');
        pass('503 gives readable reachable recovery at 320/390/844 widths; Retry opens exact same link');

        mode = 'unowned'; requests.length = 0; await page.goto(oldLink.replace('?dev=true', '?dev=true&case=unowned'), { waitUntil: 'domcontentloaded' }); await page.getByRole('button', { name: 'Retry league link', exact: true }).waitFor({ timeout: 60000 });
        assert.match(await page.getByTestId('league-route-status').innerText(), /not connected.*2025/);
        assert(!requests.some(p => p === '/league/' + oldId + '/rosters'), 'unowned link must stop before roster reads');
        await page.getByRole('button', { name: 'Stay on home', exact: true }).click();
        assert.equal(new URL(page.url()).hash, ''); pass('unconnected historical ID never loads roster and can return home');

        mode = 'slow'; await page.goto(oldLink.replace('?dev=true', '?dev=true&case=slow'), { waitUntil: 'domcontentloaded' }); await page.getByTestId('league-route-status').getByText('Opening linked league…', { exact: true }).waitFor({ timeout: 60000 });
        await page.waitForFunction(() => !!document.querySelector('.hub-league-card'));
        const deadline = Date.now() + 5000;
        while (!releaseSlow && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
        assert(releaseSlow, 'Slow fixture request was started');
        await page.getByRole('button', { name: 'Stay on home', exact: true }).click();
        releaseSlow(); mode = 'ready';
        await page.locator('.hub-league-card').click();
        await page.waitForFunction(id => window.S?.currentLeagueId === id && String(window.S?.season) === '2026', currentId, { timeout: 60000 });
        assert.equal(new URL(page.url()).hash, '#league=' + currentId + '&tab=dashboard');
        pass('canceled slow historical response cannot replace newly selected current league');
        console.log(JSON.stringify({ status: 'passed', checks, externalWriteGuard: true, backendDisabled: true, blockedExternalWrites: blocked.length }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
