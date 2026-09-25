'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('@playwright/test');
const Engine = require('../js/duat/dynasty.js');
const Progress = require('../js/duat/weekly-progress.js');
const Season = globalThis.App.TimeLeagueSeason;
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output/playwright/duat-lineup-density');
const baseline = process.argv.includes('--baseline');
const requestedPhase = process.env.DUAT_LINEUP_PHASE || 'after';
assert(['after', 'compiled', 'live', 'sandbox'].includes(requestedPhase), 'Use an explicit after/compiled/live/sandbox evidence phase.');
const mode = baseline ? 'before' : requestedPhase;
const sourceFiles = ['duat-polish.css', 'js/components/duat-weekly-flow.js', 'js/components/duat-mystery.js', 'js/components/duat-presentation.js', 'js/tabs/duat.js'];
const sourceHashes = () => Object.fromEntries(sourceFiles.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
const testedSources = sourceHashes();
const previewOrigin = process.env.READINESS_PREVIEW_ORIGIN || 'http://127.0.0.1:3026';
const entry = new URL(process.env.DUAT_LINEUP_URL || process.env.READINESS_PREVIEW_URL || process.env.READINESS_PREVIEW_PATH || '/', previewOrigin);
entry.searchParams.set('duat', '1');
const localPreview = ['http:', 'https:'].includes(entry.protocol) && ['127.0.0.1', 'localhost'].includes(entry.hostname);
const existingHostedSite = Boolean(process.env.DUAT_LINEUP_URL) && entry.protocol === 'https:' && entry.hostname === 'c2-football.github.io' && /^\/(WarRoom|WarRoom-sandbox)\/(?:index\.html)?$/.test(entry.pathname);
assert(localPreview || existingHostedSite, 'Only local previews or an explicit existing Dynasty HQ hosted destination may receive this isolated fixture.');
if (existingHostedSite) entry.searchParams.delete('dev');
fs.mkdirSync(output, { recursive: true });
const data = {
 cards: JSON.parse(fs.readFileSync(path.join(root, 'data/duat/player-cards.json'), 'utf8')),
 manifest: JSON.parse(fs.readFileSync(path.join(root, 'data/duat/manifest.json'), 'utf8')),
 logIndex: Season.buildGameLogIndex(Season.parseGameLogCsv(fs.readFileSync(path.join(root, 'data/duat/nflverse-game-logs.csv'), 'utf8')).logs),
};
let campaign = Engine.createCampaign({ version: 4, id: 'duat-lineup-density-local-only', seed: 'duat-lineup-density-local-only', name: 'The Veiled Nile', createdAt: '2026-09-25T19:00:00.000Z', hostFactionId: 'egypt', settings: { leagueSize: 8, mummyCount: 1, bench: 3, playoffTeams: 4, favors: false, conquest: false }, seasons: [2025], era: { mode: 'historical', hiddenYears: true } }, data);
campaign = Engine.applyAction(campaign, { type: 'start-draft' }, data);
let longNameDrafted = false;
while (campaign.phase === 'draft') {
 const turn = Engine.draftTurn(campaign), candidates = Engine.draftCandidates(campaign, data);
 const longName = !longNameDrafted && candidates.find(player => player.name.length >= 18);
 const selected = longName || candidates[0];
 longNameDrafted ||= Boolean(longName);
 campaign = Engine.applyAction(campaign, { type: 'draft-pick', factionId: turn.factionId, playerId: selected.id }, data);
}
while (campaign.phase === 'reveal') campaign = Engine.applyAction(campaign, { type: 'reveal-next' }, data);
const openingCampaign = JSON.parse(JSON.stringify(campaign));
while (campaign.week < 8) campaign = Engine.applyAction(campaign, { type: 'advance-week' }, data);
assert(Engine.validateCampaign(campaign, data));
assert.equal(campaign.week, 8);
assert.equal(campaign.completedWeeks.length, 7);
let progress = Progress.create(campaign, 'egypt');
for (let week = 1; week <= 7; week++) {
 for (const event of [{ type: 'clock', clock: 60 }, { type: 'recap-done' }, { type: 'conquest-done' }]) progress = Progress.update(progress, campaign, 'egypt', { ...event, week });
}
assert.equal(progress.reviewedThrough, 7);
const faction = campaign.factions.find(item => item.id === 'egypt');
const players = Engine.activeArmy(faction).players;
assert(players.some(player => player.name.length >= 18), 'The real archive roster includes a long player name.');
const expected = players.map(player => ({ id: player.id, name: player.name, position: player.position, decade: player.decade, estimate: Engine.estimatePlayer(campaign, 'egypt', player.id), previous: campaign.completedWeeks.at(-1).factions.find(item => item.factionId === 'egypt').players.find(item => item.id === player.id), mystery: globalThis.App.DuatMystery.inspect(Engine.projectCampaign(campaign, 'egypt', data), player, data, { throughWeek: 7, factionId: 'egypt' }) }));
const identifiedIndex = expected.findIndex(player => player.mystery.remaining.length === 1 && player.mystery.candidates.length > 1);
assert(identifiedIndex >= 0, 'The real archive fixture must cover an inferred year and an alternative candidate for comparison.');
let replacement;
for (const starterId of faction.lineup) for (const bench of players.filter(player => !faction.lineup.includes(player.id))) {
 const changed = faction.lineup.filter(id => id !== starterId).concat(bench.id);
 if (!replacement && Engine.legalLineup(faction, changed)) replacement = { starterId, benchId: bench.id, lineup: changed };
}
assert(replacement, 'The real roster permits a legal starter/bench swap for persistence verification.');
fs.writeFileSync(path.join(output, 'week8-fixture.json'), JSON.stringify({ campaign, progress, expected, openingCampaign }, null, 2));
console.log(`Fixture: valid Hidden Years campaign, Week ${campaign.week}, ${campaign.completedWeeks.length} completed weeks, ${players.length} real archive players.`);
if (process.argv.includes('--fixture-only')) process.exit(0);

(async () => {
 const vendor = new Map();
 for (const file of ['react@18.3.1/umd/react.production.min.js', 'react-dom@18.3.1/umd/react-dom.production.min.js', '@supabase/supabase-js@2.101.1/dist/umd/supabase.min.js']) {
  const url = 'https://cdn.jsdelivr.net/npm/' + file, response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  assert(response.ok); vendor.set(url, await response.text());
 }
 const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
 const evidence = [];
 try {
  for (const [width, height] of [[390, 844], [320, 740], [667, 375], [1440, 1000]]) {
   const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
   const blocked = [], pageErrors = [];
   await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (!['GET', 'HEAD'].includes(request.method())) { blocked.push({ method: request.method(), host: url.hostname, path: url.pathname }); return route.abort(); }
    if (url.origin === entry.origin && !url.pathname.startsWith('/api/')) return route.continue();
    if (vendor.has(url.href)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: vendor.get(url.href) });
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    blocked.push({ method: request.method(), host: url.hostname, path: url.pathname }); return route.abort();
   });
   const page = await context.newPage();
   page.on('pageerror', error => pageErrors.push(error.message));
   await page.goto(entry.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
   await page.waitForFunction(() => !!window.App?.DuatStorage && !!window.App?.DuatWeeklyProgress, null, { timeout: 60000 });
   await page.evaluate(({ campaign, progress }) => { App.DuatStorage.write(campaign); App.DuatWeeklyProgress.write(progress, campaign, 'egypt', localStorage); }, { campaign, progress });
   await page.reload({ waitUntil: 'domcontentloaded' });
   await page.getByRole('button', { name: 'The Veiled Nile Egypt', exact: false }).click({ timeout: 60000 });
   await page.locator(width < 768 ? '.duat-phone-primary' : '.duat-home-resume .primary').click();
   await page.getByRole('heading', { name: 'Set your starting lineup', exact: true }).waitFor();
   const roster = page.locator('.duat-weekly-lineup .duat-roster');
   let archiveLoading;
   if (!baseline) {
    const firstRow = roster.locator('.duat-player-entry').first(), research = firstRow.locator('.duat-lineup-research-toggle');
    const beforeSelection = await roster.getByRole('checkbox').evaluateAll(nodes => nodes.map(node => node.checked));
    const initialClue = await firstRow.locator('.duat-player-name small').innerText();
    await research.click();
    const panel = firstRow.locator('.duat-lineup-research-panel'), initialText = await panel.innerText();
    const explicitLoadingObserved = /archive is loading|Load the archive/.test(initialText);
    if (explicitLoadingObserved) assert.doesNotMatch(initialText, /Matches the revealed campaign box scores|Differs in campaign/, 'Archive loading cannot claim a candidate match or contradiction before comparison is available.');
    // Saved progress is readable before the asynchronous archive arrives.
    // Wait for independently observable archive availability, never the
    // candidate-count value that the assertions below are meant to verify.
    await panel.locator('.duat-table-wrap table').waitFor({ state: 'visible', timeout: 60000 });
    const archiveRows = await panel.locator('.duat-table-wrap tbody tr').count();
    assert.equal(archiveRows, 17, 'The candidate archive has its actual seventeen-week game log.');
    archiveLoading = { initialClue, explicitLoadingObserved, loadingVerdictChecked: explicitLoadingObserved, archiveRows, settledClue: await firstRow.locator('.duat-player-name small').innerText() };
    await research.click();
    assert.equal(await research.getAttribute('aria-expanded'), 'false');
    assert.deepEqual(await roster.getByRole('checkbox').evaluateAll(nodes => nodes.map(node => node.checked)), beforeSelection, 'Reading archive readiness does not change the lineup.');
   }
   await roster.scrollIntoViewIfNeeded();
   const metrics = await roster.evaluate(node => ({ rows: [...node.querySelectorAll('.duat-player-entry')].map(row => ({ name: row.querySelector('.duat-player-name strong')?.textContent, height: row.getBoundingClientRect().height, text: row.innerText })), rosterHeight: node.getBoundingClientRect().height, overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
   assert.equal(metrics.rows.length, players.length);
   await page.screenshot({ path: path.join(output, `${mode}-lineup-${width}.png`) });
   await roster.screenshot({ path: path.join(output, `${mode}-roster-${width}.png`) });
   fs.writeFileSync(path.join(output, `${mode}-measurements-${width}.json`), JSON.stringify({ width, height, ...metrics }, null, 2));
   const checks = baseline ? [] : ['real archive table loaded before exact candidate-clue verification'];
   if (!baseline) {
    const rows = roster.locator('.duat-player-entry');
    assert(!metrics.overflow, 'Roster must not create horizontal page overflow.');
    const maxRowHeight = width === 320 ? 96 : width >= 768 ? 100 : 88;
    assert(metrics.rows.every(row => row.height <= maxRowHeight + 1), `Collapsed rows must meet the ${maxRowHeight}px density target with 1px fractional-layout tolerance: ${metrics.rows.map(row => row.height).join(', ')}.`);
    assert.equal(await roster.locator('.duat-lineup-research-panel:visible').count(), 0, 'Research stays collapsed until requested.');
    const columnPositions = [];
    for (let index = 0; index < expected.length; index++) {
     const player = expected[index], row = rows.nth(index);
     assert.equal(await row.locator('.duat-player-name strong').innerText(), player.name);
     assert.equal(await row.getByRole('checkbox', { name: new RegExp(player.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).count(), 1, 'Selection has a player-specific accessible name.');
     const estimate = row.locator('.duat-lineup-estimate'), last = row.locator('.duat-lineup-last');
     assert.equal(await estimate.locator('strong').innerText(), Number(player.estimate.points).toFixed(1), `${player.name} keeps the actual engine estimate.`);
     assert.equal(await last.locator('strong').innerText(), Number(player.previous.effectivePoints).toFixed(1), `${player.name} keeps the actual prior-week score, including zero.`);
     assert.match(await estimate.innerText(), /Est\.\s*PPG/i, 'Blended engine estimate is explicitly labeled.');
     assert.match(await last.innerText(), /W7|Week 7/, 'Prior result names its actual completed week.');
     const knownYears = player.mystery.remaining;
     const expectedClue = knownYears.length === 1 ? `${knownYears[0]} · identified season` : `${player.decade}s · ${knownYears.length} possible ${knownYears.length === 1 ? 'season' : 'seasons'}`;
     assert.equal(await row.locator('.duat-player-name small').innerText(), expectedClue, 'The row names a publicly identified year or preserves the remaining uncertainty.');
     const accessibleResearch = await row.locator('.duat-lineup-research-toggle').evaluate(node => ({
      description: (node.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.textContent || '').join(' '),
      targetExists: Boolean(document.getElementById(node.getAttribute('aria-controls'))),
     }));
     assert.equal(accessibleResearch.description, expectedClue, 'Research exposes the visible identified-year or candidate clue to assistive technology.');
     assert(accessibleResearch.targetExists, 'Research aria-controls has a valid target while collapsed.');
     if (knownYears.length !== 1) for (const candidate of player.mystery.candidates) assert(!new RegExp(`\\b${candidate.year}\\b`).test(await row.innerText()), 'An ambiguous collapsed row cannot reveal any selected scoring year.');
     const layout = await row.evaluate(node => {
      const rect = selector => { const r = node.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      const row = node.getBoundingClientRect();
      return { row: { top: row.top, bottom: row.bottom }, selection: rect('.duat-lineup-toggle'), research: rect('.duat-lineup-research-toggle'), estimate: rect('.duat-lineup-estimate'), last: rect('.duat-lineup-last'), name: rect('.duat-player-name strong'), nameSize: parseFloat(getComputedStyle(node.querySelector('.duat-player-name strong')).fontSize) };
     });
     assert(layout.selection.width >= 44 && layout.selection.height >= 44, 'Selection remains a practical touch target.');
     assert(layout.research.height >= 44, 'Player research remains a practical touch target.');
     assert(layout.nameSize >= 14, 'Player names remain readable.');
     assert(layout.research.right <= layout.estimate.x + 1, 'Long player names do not overlap statistics.');
     for (const value of [layout.estimate, layout.last]) assert(value.y >= layout.row.top && value.bottom <= layout.row.bottom, 'Both metrics remain contained in their compact player row.');
     assert(Math.abs(layout.estimate.right - layout.last.right) <= 1, 'Estimate and latest-week result share a right-aligned metric column.');
     columnPositions.push({ estimate: layout.estimate.right, last: layout.last.right });
    }
    for (const column of ['estimate', 'last']) assert(Math.max(...columnPositions.map(row => row[column])) - Math.min(...columnPositions.map(row => row[column])) <= 1, `${column} forms one aligned roster column.`);
    metrics.metricColumns = columnPositions;
    checks.push('compact rows and readable long names', 'single aligned estimate/actual columns', 'real Week 7 values including zero', 'public singleton year identified; ambiguous years remain sealed', 'accessible candidate clue and disclosure target');

    const confirmation = page.locator('.duat-weekly-next .primary');
    for (let index = 0; index < expected.length; index++) {
     const input = rows.nth(index).getByRole('checkbox'), wasChecked = await input.isChecked();
     await input.setChecked(!wasChecked);
     assert(await confirmation.isDisabled(), 'Changing one slot to an illegal count blocks confirmation.');
     await input.setChecked(wasChecked);
     assert(await confirmation.isEnabled(), 'Restoring the valid lineup enables confirmation.');
    }
    const firstResearch = rows.nth(identifiedIndex).locator('.duat-lineup-research-toggle');
    const selectionsBefore = await roster.getByRole('checkbox').evaluateAll(nodes => nodes.map(node => node.checked));
    await firstResearch.focus(); await page.keyboard.press('Enter');
    assert.equal(await firstResearch.getAttribute('aria-expanded'), 'true');
    const researchPanel = rows.nth(identifiedIndex).locator('.duat-lineup-research-panel');
    await researchPanel.waitFor({ state: 'visible' });
    assert.equal(await researchPanel.locator('h4').filter({ hasText: 'What your campaign has revealed' }).count(), 1);
    assert.doesNotMatch(await researchPanel.innerText(), /Final reveal:/);
    {
     const identifiedYear = expected[identifiedIndex].mystery.remaining[0], candidateSelect = researchPanel.locator('select');
     assert.match(await researchPanel.innerText(), new RegExp(`Identified season: ${identifiedYear}`));
     assert.equal(await candidateSelect.inputValue(), String(identifiedYear), 'Opening research defaults to the publicly identified candidate.');
     const comparison = expected[identifiedIndex].mystery.candidates.find(candidate => candidate.year !== identifiedYear);
     await candidateSelect.selectOption(String(comparison.year));
     assert.equal(await candidateSelect.inputValue(), String(comparison.year), 'Another candidate remains available for deliberate comparison.');
     assert.match(await researchPanel.innerText(), new RegExp(`Identified season: ${identifiedYear}`));
    }
    const revealedSummaries = await researchPanel.locator('details > summary').allTextContents();
    const observedWeekNumbers = revealedSummaries.map(text => text.match(/^Week (\d+) ·/)).filter(Boolean).map(match => Number(match[1]));
    assert.deepEqual(observedWeekNumbers, [1, 2, 3, 4, 5, 6, 7], 'Observed evidence stops at completed Week 7; candidate archive is separately labeled.');
    assert.equal(await researchPanel.getByText('Candidate-season archive', { exact: true }).count(), 1);
    assert.deepEqual(await roster.getByRole('checkbox').evaluateAll(nodes => nodes.map(node => node.checked)), selectionsBefore, 'Opening research does not change lineup selection.');
    await page.screenshot({ path: path.join(output, `${mode}-research-${width}.png`) });
    await firstResearch.focus(); await page.keyboard.press('Space');
    assert.equal(await firstResearch.getAttribute('aria-expanded'), 'false');
    assert.deepEqual(await roster.getByRole('checkbox').evaluateAll(nodes => nodes.map(node => node.checked)), selectionsBefore, 'Closing research does not change lineup selection.');
    const keyboardSelection = rows.first().getByRole('checkbox');
    await keyboardSelection.focus(); await page.keyboard.press('Space');
    assert.equal(await keyboardSelection.isChecked(), !selectionsBefore[0]);
    await page.keyboard.press('Space');
    assert.equal(await keyboardSelection.isChecked(), selectionsBefore[0]);
    checks.push('all eight selection controls operate normally', 'keyboard selection', 'independent keyboard research', 'research shows only completed campaign weeks');

    if (width < 768) {
     await page.evaluate(() => { document.documentElement.style.setProperty('--sat', '20px'); document.documentElement.style.setProperty('--sab', '20px'); });
     const firstInput = rows.first().getByRole('checkbox'), checked = await firstInput.isChecked();
     await firstInput.setChecked(!checked); await firstInput.setChecked(checked);
     const safeLayout = await page.evaluate(() => { const action = document.querySelector('.duat-weekly-next').getBoundingClientRect(), button = document.querySelector('.duat-weekly-next .primary').getBoundingClientRect(), dock = document.querySelector('.duat-phone-dock').getBoundingClientRect(); return { actionBottom: action.bottom, dockTop: dock.top, buttonHeight: button.height, viewportHeight: innerHeight, dockBottom: dock.bottom }; });
     assert(safeLayout.actionBottom <= safeLayout.dockTop + 1, 'Week actions stay above the dock with simulated safe-area insets.');
     assert(safeLayout.buttonHeight >= 44);
     assert(safeLayout.dockBottom <= height + 1);
     metrics.safeArea = safeLayout;
     checks.push('simulated safe-area and short-landscape control access');
     await page.evaluate(() => { document.documentElement.style.removeProperty('--sat'); document.documentElement.style.removeProperty('--sab'); });
    }
    const starterIndex = players.findIndex(player => player.id === replacement.starterId), benchIndex = players.findIndex(player => player.id === replacement.benchId);
    await rows.nth(starterIndex).getByRole('checkbox').uncheck();
    assert(await confirmation.isDisabled());
    await rows.nth(benchIndex).getByRole('checkbox').check();
    assert(await confirmation.isEnabled());
    await confirmation.click();
    await page.getByRole('heading', { name: 'Ready for kickoff', exact: true }).waitFor();
    const saved = await page.evaluate(id => App.DuatStorage.read(id).factions.find(row => row.id === 'egypt').lineup, campaign.id);
    assert.deepEqual([...saved].sort(), [...replacement.lineup].sort(), 'The actual changed legal lineup is persisted.');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'The Veiled Nile Egypt', exact: false }).click({ timeout: 60000 });
    await page.locator(width < 768 ? '.duat-phone-primary' : '.duat-home-resume .primary').click();
    await page.getByRole('heading', { name: 'Ready for kickoff', exact: true }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Start Week 8 games' && !button.disabled), null, { timeout: 60000 });
    assert(await page.getByRole('button', { name: 'Start Week 8 games', exact: true }).isEnabled());
    assert.deepEqual([...(await page.evaluate(id => App.DuatStorage.read(id).factions.find(row => row.id === 'egypt').lineup, campaign.id))].sort(), [...replacement.lineup].sort());
    checks.push('changed legal lineup saved', 'confirmation survives reload', 'next Week 8 action is reachable');
    if (width < 768) {
     await page.getByRole('button', { name: 'Army', exact: true }).click();
     await page.locator('.duat-phone-army').waitFor();
     const armyCheckboxes = page.locator('.duat-phone-army').getByRole('checkbox');
     assert.equal(await armyCheckboxes.count(), players.length);
     for (const checkbox of await armyCheckboxes.all()) assert(await checkbox.isDisabled(), 'Read-only Army cannot alter the saved lineup.');
     const readOnlyResearch = page.locator('.duat-phone-army .duat-lineup-research-toggle').first();
     await readOnlyResearch.click();
     assert.equal(await readOnlyResearch.getAttribute('aria-expanded'), 'true', 'Read-only Army retains research access.');
     const seasonSelect = page.locator('.duat-phone-army .duat-lineup-research-panel select');
     await seasonSelect.focus(); await page.keyboard.press('Escape');
     assert.equal(await readOnlyResearch.getAttribute('aria-expanded'), 'false');
     assert(await readOnlyResearch.evaluate(node => node === document.activeElement), 'Escape returns focus to the research control.');
     checks.push('read-only Army keeps research and prevents lineup edits', 'research Escape restores focus');
    }
    if (width === 390) {
     await page.evaluate(({ campaign, progress }) => { App.DuatStorage.write(campaign); App.DuatWeeklyProgress.write(progress, campaign, 'egypt', localStorage); }, { campaign: openingCampaign, progress: Progress.create(openingCampaign, 'egypt') });
     await page.reload({ waitUntil: 'domcontentloaded' });
     await page.getByRole('button', { name: 'The Veiled Nile Egypt', exact: false }).click({ timeout: 60000 });
     await page.locator('.duat-phone-primary').click();
     await page.getByRole('button', { name: 'Meet my ally · prepare Week 1', exact: true }).click();
     await page.getByRole('heading', { name: 'Set your starting lineup', exact: true }).waitFor();
     const openingRows = page.locator('.duat-lineup-list .duat-player-entry');
     assert.equal(await openingRows.locator('.duat-lineup-last').count(), 0, 'No prior-week result is fabricated before any game is played.');
     for (let index = 0; index < players.length; index++) {
      const openingEstimate = Engine.estimatePlayer(openingCampaign, 'egypt', players[index].id), estimate = openingRows.nth(index).locator('.duat-lineup-estimate');
      assert.equal(await estimate.locator('strong').innerText(), Number(openingEstimate.points).toFixed(1));
      assert.match(await estimate.innerText(), /Est\.\s*PPG/i);
      const knownYears = players[index].candidateYears, expectedClue = knownYears.length === 1 ? `${knownYears[0]} · identified season` : `${players[index].decade}s · ${knownYears.length} possible seasons`;
      assert.equal(await openingRows.nth(index).locator('.duat-player-name small').innerText(), expectedClue, 'Before viewing a game, only the original public candidate set can identify a year.');
      if (knownYears.length !== 1) for (const year of knownYears) assert(!new RegExp(`\\b${year}\\b`).test(await openingRows.nth(index).innerText()), 'Pregame ambiguous years remain sealed.');
     }
     await openingRows.first().locator('.duat-lineup-research-toggle').click();
     assert.match(await openingRows.first().locator('.duat-lineup-research-panel').innerText(), /No completed games have been revealed/);
     assert.doesNotMatch(await openingRows.first().locator('.duat-lineup-research-panel').innerText(), /Final reveal:/);
     await page.screenshot({ path: path.join(output, `${mode}-pregame-390.png`) });
     checks.push('pregame archive estimate stays explicit', 'missing prior-week score is omitted', 'pregame hidden-year research has no observed result');
    }
   }
   evidence.push({ width, height, ...metrics, archiveLoading, checks, pageErrors, blocked });
   console.log(`${baseline ? 'BEFORE' : 'PASS'} ${width}x${height}: row heights ${metrics.rows.map(row => row.height.toFixed(1)).join(', ')}; overflow=${metrics.overflow}; completed checks=${checks.length}`);
   assert.deepEqual(pageErrors, []);
   await context.close();
  }
  assert.deepEqual(sourceHashes(), testedSources, 'Production files stayed unchanged during the browser matrix.');
  fs.writeFileSync(path.join(output, `${mode}-evidence.json`), JSON.stringify({ target: entry.href, mode, passed: true, testedSources, fixture: 'Real archive Hidden Years engine campaign legally advanced through Week 7', evidence }, null, 2));
 } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
