'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const { installReadOnlyRoutes } = require('./helpers/browser-readonly.cjs');
const { createLeagueSkinFixture } = require('./helpers/league-skin-fixture.cjs');
const source = createLeagueSkinFixture({ redraftId: 'qa-seasonal', dynastyId: 'qa-dynasty', user: 'season-fixture' });
const base = (process.env.READINESS_PREVIEW_ORIGIN || 'http://127.0.0.1:3503') + '/dist-preview/?dev=true';
(async () => {
 const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
 try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installReadOnlyRoutes(context, { fixture: url => {
   const data = source(url); if (data === undefined || !/^api\.sleeper\.(app|com)$/.test(url.hostname)) return data;
   if (/\/user\/[^/]+\/leagues\//.test(url.pathname)) return data.filter(l => l.league_id === 'qa-seasonal').map(l => ({ ...l, name: 'Seasonal QA', status: 'in_season' }));
   if (/\/league\/qa-seasonal\/rosters$/.test(url.pathname)) return source(new URL('https://api.sleeper.app/v1/league/qa-dynasty/rosters')).map(roster => ({ ...roster, league_id: 'qa-seasonal' }));
   if (/\/players\/nfl$/.test(url.pathname)) return Object.fromEntries(Object.entries(data).map(([id, player]) => [id, { ...player, age: 35 }]));
   return data;
  } });
  await context.route('**/*.supabase.co/**', route => route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"Isolated fixture backend disabled"}' }));
  await context.addInitScript(() => localStorage.setItem('od_auth_v1', JSON.stringify({ sleeperUsername: 'season-fixture' })));
  const page = await context.newPage(); await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('.hub-experience-card.empire-hero').waitFor({ timeout: 60000 });
  await page.evaluate(() => {
   const projections = Object.fromEntries(Array.from({ length: 90 }, (_, i) => ['qa-player-' + i, { gp: 17, pass_yd: 4000 - i * 10, pass_td: 25, rush_yd: 800, rush_td: 8, rec: 70, rec_yd: 900, rec_td: 6, fgm: 25, xpm: 40, idp_tkl: 100 }]));
   window.__seasonRequested = []; window.__seasonFixtureReady = false;
   window.fetchSeasonProjections = async season => { window.__seasonRequested.push(String(season)); return window.__seasonFixtureReady ? projections : {}; };
   window.fetchSeasonStats = async () => ({});
   window.S = window.S || {}; window.S.projectionsData = projections; window.S.statsData = projections; window.S.currentLeagueId = 'historical-2025';
   window.S.nflState = { season: '2026', week: 2 };
  });
  await page.locator('.hub-experience-card.empire-hero').click();
  const notice = page.getByTestId('empire-value-basis'); await notice.getByText('Seasonal values unavailable', { exact: true }).waitFor({ timeout: 60000 });
  await notice.locator('summary').click();
  assert.match(await notice.innerText(), /Holdings remain visible and unpriced/);
  assert.deepEqual(await page.evaluate(() => window.__seasonRequested), ['2026']);
  await page.getByRole('button', { name: 'Assets', exact: true }).click(); await page.getByRole('button', { name: 'Players & picks', exact: true }).click();
  assert.match(await page.locator('.empire-workspace').last().innerText(), /Value unavailable/);
  assert.equal(await page.getByText('Post-window value needs pruning', { exact: true }).count(), 0);
  console.log('PASS missing current projections ignore historical bridge and retain visible unpriced seasonal holdings');
  await page.evaluate(() => { window.__seasonFixtureReady = true; });
  await page.getByRole('button', { name: 'Retry seasonal values', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="empire-value-basis"]')?.textContent.includes('Current-season evidence: 2026.'));
  assert.equal(await notice.getAttribute('open'), null, 'successful retry restores compact notice');
  await page.waitForFunction(() => [...document.querySelectorAll('.empire-asset-row')].some(row => /Season value/.test(row.innerText)));
  assert.equal(await page.getByText('Post-window value needs pruning', { exact: true }).count(), 0);
  await page.locator('.empire-asset-row').first().click();
  assert.match(await page.locator('.empire-detail').innerText(), /Needs assessment unavailable/);
  await page.locator('.empire-league-card').first().click();
  assert.match(await page.locator('.empire-detail').innerText(), /Assessment unavailable/);
  assert.doesNotMatch(await page.locator('.empire-detail').innerText(), /None flagged/);
  await page.getByRole('button', { name: 'Back to Empire', exact: true }).click();
  console.log('PASS retry restores actual engine season values without age pruning; unimplemented seasonal assessments stay explicitly unavailable');
  await page.getByRole('button', { name: 'Portfolio Lab', exact: true }).click();
  assert.match(await page.getByTestId('empire-portfolio-lab').innerText(), /Season value/);
  assert.match(await page.getByTestId('empire-portfolio-lab').innerText(), /hypothetical value change/);
  assert.match(await page.locator('.empire-lab-table tbody').innerText(), /Season value/);
  console.log('PASS rendered scenario uses seasonal values with hypothetical and keeper limits');
  for (const [width, height] of [[320, 720], [390, 844], [844, 390]]) {
   await page.setViewportSize({ width, height }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByTestId('empire-portfolio-lab').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'reports/public-readiness/empire-seasonal-lab-390.png', fullPage: false });
  await page.getByRole('button', { name: 'Rankings', exact: true }).click();
  assert.match(await page.locator('.empire-rankings-detail').innerText(), /Season value/);
  await page.getByRole('button', { name: 'Leagues', exact: true }).click(); await page.getByRole('button', { name: 'Competitive windows', exact: true }).click();
  assert.match(await page.locator('.empire-detail').innerText(), /Seasonal review/);
  console.log('PASS phone/landscape overflow, seasonal rankings and competitive review remain usable');
  console.log(JSON.stringify({ status: 'passed', fixtureOnly: true, externalWritesBlocked: true, backendDisabled: true }));
 } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
