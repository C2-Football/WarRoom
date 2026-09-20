'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const { installReadOnlyRoutes } = require('./helpers/browser-readonly.cjs');
const { createLeagueSkinFixture } = require('./helpers/league-skin-fixture.cjs');
const base = (process.env.READINESS_PREVIEW_ORIGIN || 'http://127.0.0.1:3503') + '/dist-preview/?dev=true';
const source = createLeagueSkinFixture({ redraftId: 'qa-seasonal', dynastyId: 'qa-dynasty', user: 'draft-fixture' });
let mode = 'failed';
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await installReadOnlyRoutes(context, { fixture: url => {
            const data = source(url);
            if (data === undefined || !/^api\.sleeper\.(app|com)$/.test(url.hostname)) return data;
            if (/\/league\/[^/]+\/drafts$/.test(url.pathname)) return data.map(draft => ({ ...draft,
                status: mode === 'complete' || (mode === 'drafting' && draft.league_id === 'qa-seasonal') ? 'complete' : mode === 'drafting' ? 'drafting' : 'pre_draft',
                settings: { ...draft.settings, rounds: 4 }, slot_to_roster_id: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 },
            }));
            if (/\/draft\/[^/]+\/picks$/.test(url.pathname)) return [{ round: 1, draft_slot: 1, roster_id: 1, player_id: 'qa-player-0' }];
            return data;
        } });
        await context.route('**/*.supabase.co/**', route => route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"Isolated fixture backend disabled"}' }));
        await context.route('**/v1/league/*/drafts', route => mode === 'failed' ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }) : route.fallback());
        await context.addInitScript(() => localStorage.setItem('od_auth_v1', JSON.stringify({ sleeperUsername: 'draft-fixture' })));
        const page = await context.newPage();
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.locator('.hub-experience-card.empire-hero').click({ timeout: 60000 });
        await page.getByTestId('empire-pick-coverage').waitFor({ timeout: 60000 });
        await page.getByRole('button', { name: 'Assets', exact: true }).click();
        await page.getByRole('button', { name: 'Players & picks', exact: true }).click();
        await page.getByRole('button', { name: 'Picks', exact: true }).click();
        const years = () => page.locator('.empire-quality-grid .empire-league-card').allTextContents();
        const waitYearCount = count => page.waitForFunction(count => [...document.querySelectorAll('.empire-quality-grid .empire-league-card')].map(node => node.innerText).reduce((n, text) => n + Number(text.match(/(\d+) picks/)?.[1] || 0), 0) === count, count);
        await waitYearCount(8);
        assert(!(await years()).some(text => text.includes('2026')));
        assert.match(await page.getByTestId('empire-pick-coverage').innerText(), /Current-year draft progress is unverified for 2/);
        console.log('PASS initial failed progress shows verified future rights only with current-year unknown');
        mode = 'ready'; await page.getByRole('button', { name: 'Retry pick sync', exact: true }).click();
        await page.getByTestId('empire-pick-coverage').waitFor({ state: 'hidden', timeout: 60000 }); await waitYearCount(16);
        assert((await years()).some(text => text.includes('2026') && text.includes('8 picks')));
        console.log('PASS retry verifies pre-draft 2026 holdings without changing future years');
        const refresh = () => page.locator('.empire-topbar button[title^="Re-sync"]').click();
        mode = 'drafting'; await refresh(); await waitYearCount(11);
        assert((await years()).some(text => text.includes('2026') && text.includes('3 picks')));
        console.log('PASS consumed dynasty slot and completed redraft rights disappear from current draft capital');
        mode = 'failed'; await refresh(); await page.getByRole('button', { name: 'Retry pick sync', exact: true }).waitFor({ timeout: 60000 });
        assert.match(await page.getByTestId('empire-pick-coverage').innerText(), /2 use saved ownership/); await waitYearCount(11);
        assert.equal(await page.getByText('Synced ✓', { exact: true }).count(), 0);
        for (const [width, height] of [[320, 720], [390, 844], [844, 390]]) {
            await page.setViewportSize({ width, height });
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByTestId('empire-pick-coverage').scrollIntoViewIfNeeded();
        await page.screenshot({ path: 'reports/public-readiness/empire-draft-progress-stale-390.png', fullPage: false });
        console.log('PASS refresh failure keeps explicit saved inventory, no false Synced, and no overflow at 320/390/844');
        mode = 'complete'; await page.getByRole('button', { name: 'Retry pick sync', exact: true }).click();
        await page.getByTestId('empire-pick-coverage').waitFor({ state: 'hidden', timeout: 60000 }); await waitYearCount(8);
        assert(!(await years()).some(text => text.includes('2026')));
        console.log('PASS completed draft retry removes every consumed current-year right and preserves eight dynasty future picks');
        console.log(JSON.stringify({ status: 'passed', externalWriteGuard: true, backendDisabled: true, fixtureOnly: true }));
    } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
