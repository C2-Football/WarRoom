'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const Engine = require('../js/duat/dynasty.js');
const Season = globalThis.App.TimeLeagueSeason;
// Match the release runner's isolated compiled preview; explicit entry URLs
// also support read-only post-deployment checks without changing the journey.
const previewOrigin = process.env.READINESS_PREVIEW_ORIGIN || 'http://127.0.0.1:3025';
const entry = new URL(process.env.DUAT_POLISH_URL || process.env.READINESS_PREVIEW_URL
 || process.env.READINESS_PREVIEW_PATH || '/dist-preview/', previewOrigin);
entry.searchParams.set('dev', 'true');
entry.searchParams.set('duat', '1');
const origin = entry.origin;
const base = entry.href;
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output/playwright/duat-polish');
fs.mkdirSync(output, { recursive: true });
const data = { cards: JSON.parse(fs.readFileSync(path.join(root, 'data/duat/player-cards.json'), 'utf8')), logIndex: Season.buildGameLogIndex(Season.parseGameLogCsv(fs.readFileSync(path.join(root, 'data/duat/nflverse-game-logs.csv'), 'utf8')).logs) };
const settings = Engine.normalizeSettings({ leagueSize: 8, mummyCount: 1, bench: 3, playoffTeams: 4, favors: true, conquest: true });
let campaign = Engine.createCampaign({ version: 4, id: 'duat-polish-local-only', seed: 'duat-polish-local-only', name: 'The Nile Dynasty', createdAt: '2026-09-25T16:00:00.000Z', hostFactionId: 'egypt', settings, seasons: [2025], expansionSettings: { worldScale: 'countries', conquestMode: 'original' } }, data);
campaign = Engine.applyAction(campaign, { type: 'start-draft' }, data);
while (campaign.phase === 'draft') { const turn = Engine.draftTurn(campaign), pool = Engine.draftCandidates(campaign, data); campaign = Engine.applyAction(campaign, { type: 'draft-pick', factionId: turn.factionId, playerId: pool[0].id }, data); }
while (campaign.phase === 'reveal') campaign = Engine.applyAction(campaign, { type: 'reveal-next' }, data);
assert(Engine.validateCampaign(campaign));
(async () => {
 const vendor = new Map();
 for (const file of ['react@18.3.1/umd/react.production.min.js','react-dom@18.3.1/umd/react-dom.production.min.js','@supabase/supabase-js@2.101.1/dist/umd/supabase.min.js']) { const url='https://cdn.jsdelivr.net/npm/'+file; const response=await fetch(url,{signal:AbortSignal.timeout(15000)}); assert(response.ok); vendor.set(url,await response.text()); }
 const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
 const evidence = [];
 try {
  for (const [width, height] of [[320,740],[390,844],[667,375],[1440,1000]]) {
   const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
   const blocked = [];
   await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    // Reject mutations before the same-origin asset allowlist. This remains
    // safe when the explicit target is a hosted deployment, not localhost.
    if (!['GET', 'HEAD'].includes(request.method())) {
     blocked.push({ method: request.method(), host: url.hostname, path: url.pathname });
     return route.abort();
    }
    if (url.origin === origin && !url.pathname.startsWith('/api/')) return route.continue();
    if (vendor.has(url.href)) return route.fulfill({status:200,contentType:'application/javascript',body:vendor.get(url.href)});
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({status:200,contentType:'text/css',body:''});
    blocked.push({ method: request.method(), host: url.hostname, path: url.pathname });
    return route.abort();
   });
   const page = await context.newPage(), pageErrors = [];
   page.on('pageerror', error => pageErrors.push(error.message));
   await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
   await page.getByRole('button', { name: 'Found a dynasty · enter the draft', exact: true }).waitFor({ timeout: 60000 });
   await page.waitForFunction(() => !document.querySelector('.duat-creation-panel button[type="submit"]')?.disabled && !!window.App?.DuatStorage);
   await page.locator('.duat-intro').scrollIntoViewIfNeeded();
   assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
   const choiceColors = await page.locator('.duat-creation-panel > .duat-choice-row .duat-choice').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).borderColor));
   assert.notEqual(choiceColors[0], choiceColors[1], 'selected play mode must remain visually distinct');
   await page.screenshot({ path: `${output}/entry-${width}.png` });
   await page.locator('.duat-mode-disclosure > summary').click();
   await page.getByRole('button', { name: 'Original Duat · Resurrection', exact: false }).click();
   assert.match(await page.locator('.duat-mode-disclosure').innerText(), /Weekly play and offerings remain locked/);
   await page.getByRole('button', { name: 'Historical Replay', exact: false }).click();
   await page.locator('.duat-mode-disclosure > summary').click();
   await page.locator('.duat-banner-disclosure > summary').click();
   await page.getByRole('textbox', { name: 'Find a faction', exact: true }).fill('Egypt');
   assert.equal(await page.locator('.duat-faction-choice').count(), 1);
   await page.locator('.duat-faction-choice').click();
   await page.locator('.duat-banner-disclosure > summary').click();
   await page.getByRole('button', { name: 'Use first-expedition rules', exact: true }).click();
   await page.getByRole('textbox', { name: 'Campaign name', exact: true }).fill('Polish UI Journey');
   await page.getByRole('button', { name: 'Found a dynasty · enter the draft', exact: true }).click();
   await page.getByRole('button', { name: 'Open the draft', exact: true }).waitFor();
   const mainTop = await page.locator('.duat-main').evaluate(node => node.getBoundingClientRect().top);
   assert(mainTop >= -1 && mainTop < height, 'new draft returns to the top of its content');
   await page.getByRole('button', { name: 'Open the draft', exact: true }).click();
   await page.getByRole('textbox', { name: 'Search draft players', exact: true }).waitFor();
   await page.locator('.duat-draft-player button').first().click();
   const drafted = await page.evaluate(() => { const row = App.DuatStorage.list().find(saved => saved.name === 'Polish UI Journey'); return App.DuatStorage.read(row.id).draft.cursor; });
   assert(drafted > 0);
   await page.evaluate(state => App.DuatStorage.write(state), campaign);
   await page.reload();
   await page.getByRole('button', { name: 'The Nile Dynasty Egypt', exact: false }).click({ timeout: 60000 });
   const home = page.locator(width < 768 ? '.duat-phone-home' : '.duat-season-home');
   await home.waitFor(); await home.scrollIntoViewIfNeeded();
   assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
   await page.screenshot({ path: `${output}/home-${width}.png` });
   await page.locator(width < 768 ? '.duat-phone-primary' : '.duat-home-resume .primary').click();
   await page.getByRole('button', { name: 'Meet my ally · prepare Week 1', exact: true }).click();
   const confirmation = page.locator('.duat-weekly-next .primary');
   await confirmation.waitFor();
   await page.locator('.duat-weekly-lineup input:checked').first().uncheck();
   assert(await confirmation.isDisabled(), 'invalid lineup cannot continue');
   await page.locator('.duat-weekly-lineup input').first().check();
   assert(await confirmation.isEnabled());
   const layout = await page.evaluate(() => {
    const action = document.querySelector('.duat-weekly-next .primary').getBoundingClientRect(), dock = document.querySelector('.duat-phone-dock')?.getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth + 1, actionHeight: action.height, actionDockOverlap: dock ? Math.max(0, action.bottom - dock.top) : 0 };
   });
   assert(!layout.overflow); assert(layout.actionHeight >= 44); assert(layout.actionDockOverlap <= 1);
   await page.locator('.duat-weekly-heading').scrollIntoViewIfNeeded();
   await page.screenshot({ path: `${output}/lineup-${width}.png` });
   await confirmation.click();
   await page.getByRole('button', { name: 'Continue to kickoff', exact: true }).waitFor();
   await page.reload();
   await page.getByRole('button', { name: 'The Nile Dynasty Egypt', exact: false }).click({ timeout: 60000 });
   await page.locator(width < 768 ? '.duat-phone-primary' : '.duat-home-resume .primary').click();
   await page.getByRole('button', { name: 'Continue to kickoff', exact: true }).waitFor();
   await page.getByRole('button', { name: 'Continue to kickoff', exact: true }).click();
   assert(await page.getByRole('button', { name: 'Start Week 1 games', exact: true }).isEnabled());
   if (width < 768) {
    await page.getByRole('button', { name: 'Realm', exact: true }).click();
    await page.locator('.duat-phone-realm').waitFor();
    await page.locator('.duat-phone-realm details').first().locator(':scope > summary').click();
    assert(await page.getByRole('button', { name: 'Week 1 ·', exact: false }).first().isVisible());
    await page.getByRole('button', { name: 'More', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export campaign backup', exact: true }).click();
    const download = await downloadPromise;
    await download.saveAs(`${output}/backup-${width}.json`);
    assert.equal(JSON.parse(fs.readFileSync(`${output}/backup-${width}.json`, 'utf8')).id, campaign.id);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', { name: 'Export campaign backup', exact: true }).count(), 0);
   }
   assert.deepEqual(pageErrors, []);
   evidence.push({ ...layout, checks: ['entry mode selection','Resurrection gate','faction disclosure and search','create and draft pick','new-campaign scroll','Home and alliance','lineup legality','saved weekly step after reload','kickoff enabled', ...(width < 768 ? ['Realm calendar','backup export','More Escape dismissal'] : [])], pageErrors, blocked });
   console.log(`PASS ${width}x${height}: creation, draft, weekly navigation, persistence and layout`);
   await context.close();
  }
  fs.writeFileSync(`${output}/browser-evidence.json`, JSON.stringify({ target: entry.origin + entry.pathname, source: 'Actual UI with historical-engine fixtures; isolated from hosted backend; mutation requests blocked', passed: true, evidence }, null, 2));
 } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
