'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('@playwright/test');
const { installReadOnlyRoutes } = require('./helpers/browser-readonly.cjs');
const { createLeagueSkinFixture } = require('./helpers/league-skin-fixture.cjs');
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'reports/public-readiness/evidence');
const KEY = 'commish_rulelab_proposals', BACKUP = KEY + '_recovery_v1';
const raw = '{"damaged":"exact original bytes",';
const port = () => new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const chosen = server.address().port; server.close(() => resolve(chosen)); }); });
(async () => {
    fs.mkdirSync(evidence, { recursive: true });
    const serverPort = await port(), server = spawn(process.execPath, ['scripts/serve-static.cjs', '--host=127.0.0.1', '--port=' + serverPort], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let browser, page;
    try {
        await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Preview did not start')), 10000); server.stdout.on('data', b => { if (String(b).includes('Serving')) { clearTimeout(timer); resolve(); } }); server.once('exit', () => { clearTimeout(timer); reject(Error('Preview exited')); }); });
        browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
        const results = [];
        for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
            const context = await browser.newContext({ viewport, acceptDownloads: true });
            const provider = createLeagueSkinFixture({ redraftId: 'qa-redraft', dynastyId: 'qa-dynasty', user: 'readiness-fixture' });
            const blocked = await installReadOnlyRoutes(context, { fixture: url => {
                const value = provider(url);
                if (url.pathname.endsWith('/users') && Array.isArray(value)) return value.map((row, i) => ({ ...row, is_owner: i === 0 }));
                return value;
            } });
            await context.addInitScript(() => {
                if (!localStorage.getItem('fw_session_v1')) {
                    localStorage.setItem('fw_session_v1', JSON.stringify({ token: 'isolated-browser-fixture', user: { id: 'isolated-browser-fixture', email: 'qa@example.invalid' } }));
                    localStorage.setItem('od_auth_v1', JSON.stringify({ username: 'readiness-fixture' }));
                    localStorage.setItem('od_profile_v1', JSON.stringify({ onboardingComplete: true }));
                    localStorage.setItem('wr_active_connection_owner_v1', 'account:isolated-browser-fixture');
                }
                window.__rejectProposals = false;
                const original = Storage.prototype.setItem;
                Storage.prototype.setItem = function (key, value) {
                    if (window.__rejectProposals && key.includes('commish_rulelab_proposals')) throw new DOMException('Controlled full storage', 'QuotaExceededError');
                    return original.call(this, key, value);
                };
            });
            page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
            await page.goto('http://127.0.0.1:' + serverPort + '/index.html?dev=true&user=readiness-fixture', { waitUntil: 'domcontentloaded' });
            const office = page.locator('.hub-experience-card.commish-hero');
            await office.waitFor({ timeout: 60000 });
            await page.waitForFunction(() => window.App?.AccountStorage?.key && !document.querySelector('.commish-hero')?.disabled);
            await page.evaluate(({ KEY, raw }) => localStorage.setItem(window.App.AccountStorage.key(KEY), raw), { KEY, raw });
            const openLab = async () => {
                await page.locator('.hub-experience-card.commish-hero').click();
                await page.getByText('Needs you now', { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 60000 });
                const workspaces = page.getByRole('button', { name: /Workspaces/ });
                if (await workspaces.isVisible()) await workspaces.click();
                await page.getByRole('navigation', { name: 'Commissioner workspaces', exact: true }).getByRole('button', { name: /^Rules/ }).click({ timeout: 60000 });
                const summary = page.locator('summary').filter({ hasText: /^Saved Proposals/ });
                if (await summary.count()) await summary.click();
            };
            await openLab();
            console.log('CHECK ' + viewport.width + ' actual Rule Lab opened');
            const recover = page.getByRole('button', { name: 'Preserve a copy & start a new list', exact: true });
            await recover.waitFor();
            const name = page.getByPlaceholder("Name this proposal — 'TE premium 2027'");
            await name.fill('Keep my proposal name');
            await page.evaluate(() => window.__rejectProposals = true);
            await recover.click();
            await page.getByText('The recovery copy was not saved.', { exact: false }).waitFor();
            assert.equal(await name.inputValue(), 'Keep my proposal name');
            await recover.scrollIntoViewIfNeeded();
            assert((await recover.boundingBox()).height >= 44);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
            await page.screenshot({ path: path.join(evidence, 'commish-proposals-' + viewport.width + '-recovery.png'), fullPage: false });
            assert.equal(await page.evaluate(KEY => localStorage.getItem(window.App.AccountStorage.key(KEY)), KEY), raw);
            const downloaded = page.waitForEvent('download');
            await page.getByRole('button', { name: 'Download original data', exact: true }).click();
            const download = await downloaded;
            assert.equal(JSON.parse(fs.readFileSync(await download.path(), 'utf8'))[0].raw, raw);
            await page.evaluate(() => window.__rejectProposals = false);
            await recover.click();
            await page.getByRole('button', { name: 'Download recovery copy', exact: true }).waitFor();
            assert.equal(await name.inputValue(), 'Keep my proposal name');
            assert.equal(await page.evaluate(BACKUP => window.App.AccountStorage.get(BACKUP)[0].raw, BACKUP), raw);
            // The actual preset button supplies meaningful rules for a new proposal.
            const presets = page.getByRole('button', { name: /Full PPR/ });
            await presets.first().click();
            const save = page.getByRole('button', { name: 'Save', exact: true });
            await page.evaluate(() => window.__rejectProposals = true);
            await save.click();
            assert.equal(await name.inputValue(), 'Keep my proposal name');
            assert.equal(await page.evaluate(KEY => window.App.AccountStorage.get(KEY).length, KEY), 0);
            await page.evaluate(() => window.__rejectProposals = false);
            await save.click();
            await page.waitForFunction(KEY => window.App.AccountStorage.get(KEY).length === 1, KEY);
            assert.equal(await name.inputValue(), '');
            await page.reload({ waitUntil: 'domcontentloaded' });
            await openLab();
            await page.getByText('Keep my proposal name', { exact: true }).waitFor();
            const copy = page.getByRole('button', { name: 'Download recovery copy', exact: true });
            await copy.scrollIntoViewIfNeeded();
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'page must fit viewport');
            assert((await copy.boundingBox()).height >= 44);
            assert.equal(await page.evaluate(BACKUP => window.App.AccountStorage.get(BACKUP)[0].raw, BACKUP), raw);
            await page.screenshot({ path: path.join(evidence, 'commish-proposals-' + viewport.width + '.png'), fullPage: false });
            assert.deepEqual(errors, []);
            results.push({ viewport, passed: true, externalWriteGuard: true, blockedExternalWrites: blocked.length });
            await context.close();
            console.log('PASS actual Commissioner proposal recovery/save/reopen ' + viewport.width + 'x' + viewport.height);
        }
        fs.writeFileSync(path.join(evidence, 'commish-proposal-browser-sep20.json'), JSON.stringify({ evidence: 'Actual compiled local app; synthetic provider data, simulated quota failures; no external writes', results }, null, 2) + '\n');
    } catch (error) {
        if (page) await page.screenshot({ path: path.join(evidence, 'commish-proposals-failure.png'), fullPage: false }).catch(() => {});
        throw error;
    } finally { if (browser) await browser.close(); server.kill(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
