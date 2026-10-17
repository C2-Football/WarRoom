#!/usr/bin/env node
// Browser QA matrix for league-format skin behavior.
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { installReadOnlyRoutes } = require('./helpers/browser-readonly.cjs');
const { createLeagueSkinFixture } = require('./helpers/league-skin-fixture.cjs');

const ROOT = path.join(__dirname, '..');
const REDRAFT_LEAGUE_ID = process.env.WARROOM_QA_REDRAFT_LEAGUE || '1356311207652360192';
const DYNASTY_LEAGUE_ID = process.env.WARROOM_QA_DYNASTY_LEAGUE || '1312100327931019264';
const USER = process.env.WARROOM_QA_USER || 'bigloco';
const BASE_PATH = process.env.WARROOM_QA_PATH || '/dist-preview/';
const CHROME = process.env.PLAYWRIGHT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT_START = Number(process.env.WARROOM_LEAGUE_SKIN_QA_PORT || 3610);

let chromium;
try {
  chromium = require('@playwright/test').chromium;
} catch (_err) {
  console.log('FAIL league skin browser QA - @playwright/test is not installed. Run npm install first.');
  process.exit(1);
}

function hasChrome() {
  return fs.existsSync(CHROME);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findOpenPort(start) {
  return new Promise((resolve, reject) => {
    const tryPort = port => {
      if (port >= 65536) return reject(new Error(`no open port found starting at ${start}`));
      const server = net.createServer();
      server.once('error', err => {
        if (err && ['EACCES', 'EPERM'].includes(err.code)) reject(err);
        else tryPort(port + 1);
      });
      server.once('listening', () => server.close(() => resolve(port)));
      server.listen(port, '127.0.0.1');
    };
    if (!Number.isFinite(start)) reject(new Error('invalid start port'));
    else tryPort(start);
  });
}

async function startStaticServer(port) {
  const proc = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve-static.cjs'), '--host=127.0.0.1', `--port=${port}`], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let ready = false;
  proc.stdout.on('data', chunk => {
    if (String(chunk).includes('Serving')) ready = true;
  });
  for (let i = 0; i < 40; i++) {
    if (ready) return proc;
    await wait(250);
  }
  return proc;
}

async function skinSnapshot(page) {
  return page.evaluate(() => {
    const sectionButtons = title => {
      const heading = Array.from(document.querySelectorAll('div'))
        .find(el => String(el.textContent || '').trim() === title);
      if (!heading?.parentElement) return [];
      return Array.from(heading.parentElement.querySelectorAll('button'))
        .map(el => String(el.textContent || '').trim().replace(/\s+/g, ' '))
        .filter(Boolean);
    };
    const skin = window.App?.LeagueSkin?.getCurrent?.() || null;
    return {
      skin,
      text: String(document.body?.innerText || ''),
      buttons: Array.from(document.querySelectorAll('button'))
        .filter(el => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        })
        .map(el => String(el.textContent || '').trim().replace(/\s+/g, ' '))
        .filter(Boolean),
      sections: {
        targetPositions: sectionButtons('Target Positions'),
        draftPickYears: sectionButtons('Draft Pick Years'),
      },
    };
  });
}

async function openLeaguePage(context, port, leagueId, expectedType, tab, options = {}) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1365, height: 900 });
  if (options.alexSubTab) {
    await page.addInitScript(subTab => {
      try { localStorage.setItem('wr_alex_subtab', subTab); } catch (_) {}
    }, options.alexSubTab);
  }
  const hashSuffix = options.hashSuffix || '';
  const url = `http://127.0.0.1:${port}${BASE_PATH}?dev=true&user=${USER}#league=${leagueId}&tab=${tab}${hashSuffix}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(type => {
    const skin = window.App?.LeagueSkin?.getCurrent?.();
    if (!skin || skin.type !== type) return false;
    const text = document.body?.innerText || '';
    return text.length > 80 && !text.includes('BUILDING LEAGUE INTELLIGENCE');
  }, expectedType, { timeout: 30000 }).catch(async error => {
    const diagnostic = await page.evaluate(() => ({ skin: window.App?.LeagueSkin?.getCurrent?.(), text: document.body.innerText.slice(0, 1800) }));
    throw new Error(`${leagueId}/${tab}: ${error.message} ${JSON.stringify(diagnostic)}`);
  });
  await page.waitForTimeout(400);
  return page;
}

function hasExact(labels, text) {
  return labels.some(label => label === text);
}

function textHas(snap, phrase) {
  return String(snap?.text || '').toLowerCase().includes(String(phrase || '').toLowerCase());
}

function pushIf(failures, condition, message) {
  if (condition) failures.push(message);
}

function assertSkin(failures, label, snap, expected) {
  const skin = snap.skin || {};
  pushIf(failures, skin.type !== expected.type, `${label}: expected skin type ${expected.type}, got ${skin.type || 'none'}`);
  pushIf(failures, skin.vocabulary?.appLabel !== 'Dynasty HQ', `${label}: app brand changed to ${skin.vocabulary?.appLabel || 'none'}`);
  pushIf(failures, !!expected.phase && skin.phase !== expected.phase, `${label}: expected phase ${expected.phase}, got ${skin.phase || 'none'}`);
}

async function waitForModelSettings(page) {
  const hasSettings = () => {
    const text = String(document.body?.innerText || '').toLowerCase();
    return text.includes('target positions') && text.includes('draft pick years');
  };
  try {
    await page.waitForFunction(hasSettings, null, { timeout: 15000 });
  } catch (_err) {
    await page.evaluate(() => {
      try { localStorage.setItem('wr_alex_subtab', 'settings'); } catch (_) {}
    });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForFunction(hasSettings, null, { timeout: 60000 });
  }
  await page.waitForTimeout(200);
}

async function verifyStudioContrast(page, failures) {
  const scope = '[data-wire-studio-contrast]';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => window.React && window.ReactDOM && window.WrWireStudio && document.querySelector('.wr-mission-v8'));
  try {
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.dataset.wireStudioContrast = '';
      const outside = document.createElement('div');
      outside.dataset.studioOutsideProbe = '';
      outside.innerHTML = '<h3>Outside heading</h3><p>Outside context</p><select aria-label="Outside theme probe"><option>Outside</option></select>';
      host.appendChild(outside);
      const mount = document.createElement('div');
      host.appendChild(mount);
      document.querySelector('.wr-mission-v8').appendChild(host);
      const outsideColors = () => [...outside.children].map(node => ({ color: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor }));
      host.__outsideBefore = outsideColors();
      host.__outsideColors = outsideColors;
      const race = { supported: true, slots: 1, remainingWeeks: 1, futureDecisions: 2, decisionsPerWeek: 2, throughWeek: 2,
        rows: [{ id: 'qa-alpha', name: 'QA Alpha', ownerName: 'QA owner', record: '3–1', wins: 3, losses: 1, ties: 0, status: 'In the race' },
          { id: 'qa-bravo', name: 'QA Bravo', record: '2–2', wins: 2, losses: 2, ties: 0, status: 'In the race' }] };
      const root = ReactDOM.createRoot(mount);
      host.__studioRoot = root;
      root.render(React.createElement('dialog', { className: 'wr-journal', open: true }, React.createElement(window.WrWireStudio, {
        league: { league_id: 'qa-contrast-only', season: '2026', name: 'QA Studio contrast' }, race, initialTab: 'race', onClose() {},
      })));
    });
    const studio = page.locator(scope + ' .wr-wire-studio');
    await studio.waitFor({ state: 'visible' });
    const colors = async selectors => page.evaluate(({ scope, selectors }) => {
      const parse = value => {
        const parts = value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0];
        return [...parts.slice(0, 3), parts[3] ?? 1];
      };
      const composite = (front, back) => front.slice(0, 3).map((value, i) => value * front[3] + back[i] * (1 - front[3]));
      const luminance = rgb => rgb.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
      const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
      return selectors.map(selector => {
        const node = document.querySelector(scope + ' ' + selector);
        if (!node) return { selector, missing: true };
        const chain = [];
        for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) chain.unshift(ancestor);
        const background = chain.reduce((behind, ancestor) => composite(parse(getComputedStyle(ancestor).backgroundColor), behind), [255, 255, 255]);
        const style = getComputedStyle(node), foreground = composite(parse(style.color), background);
        const outline = composite(parse(style.outlineColor), background);
        return { selector, foreground: style.color, background, ratio: ratio(foreground, background), backgroundLuminance: luminance(background), outlineRatio: ratio(outline, background), outlineWidth: parseFloat(style.outlineWidth), focusVisible: node.matches(':focus-visible') };
      });
    }, { scope, selectors });
    const textColors = await colors(['.wr-studio-mast h2', '.wr-studio-race h3', '.wr-studio-race-summary strong', '.wr-studio-race-context', '.wr-studio-race-table caption']);
    for (const sample of textColors) pushIf(failures, sample.missing || sample.ratio < 4.5, `Studio phone contrast: ${sample.selector} ${JSON.stringify(sample)}`);
    await studio.getByRole('button', { name: 'Explore QA Alpha’s finish', exact: true }).click();
    await studio.getByRole('combobox', { name: 'Race scenario team', exact: true }).waitFor({ state: 'visible' });
    const [selectColor] = await colors(['.wr-wire-studio select']);
    pushIf(failures, selectColor.missing || selectColor.ratio < 4.5 || selectColor.backgroundLuminance < .7, `Studio phone select must retain a legible light surface: ${JSON.stringify(selectColor)}`);
    await page.keyboard.press('Tab');
    await studio.getByRole('button', { name: 'Explore QA Alpha’s finish', exact: true }).focus();
    const [focusColor] = await colors(['.wr-studio-race-team']);
    pushIf(failures, focusColor.missing || !focusColor.focusVisible || focusColor.outlineWidth < 2 || focusColor.outlineRatio < 3, `Studio phone focus ring: ${JSON.stringify(focusColor)}`);
    const outside = await page.evaluate(scope => {
      const host = document.querySelector(scope), shell = host.closest('.wr-mission-v8');
      const probe = document.createElement('i');
      probe.style.color = 'var(--cx-ink)'; probe.style.backgroundColor = 'var(--cx-bg)'; shell.appendChild(probe);
      const ink = getComputedStyle(probe).color, background = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { before: host.__outsideBefore, after: host.__outsideColors(), ink, background };
    }, scope);
    pushIf(failures, JSON.stringify(outside.before) !== JSON.stringify(outside.after), 'Studio phone contrast: opening Studio recolored the surrounding Mission Control interface');
    const channels = value => value.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [];
    pushIf(failures, outside.after[0].color !== outside.ink || !channels(outside.ink).every(value => value > 200) || !channels(outside.background).every(value => value < 80), `Studio phone contrast: the actual Mission Control dark theme was not exercised ${JSON.stringify(outside)}`);
  } finally {
    await page.evaluate(scope => { const host = document.querySelector(scope); host?.__studioRoot?.unmount(); host?.remove(); }, scope);
    await page.setViewportSize({ width: 1365, height: 900 });
  }
}

async function runMatrix(context, port, failures) {
  let page;

  page = await openLeaguePage(context, port, REDRAFT_LEAGUE_ID, 'redraft', 'dashboard');
  let snap = await skinSnapshot(page);
  assertSkin(failures, 'redraft dashboard', snap, { type: 'redraft', phase: 'pre_draft' });
  pushIf(failures, !textHas(snap, 'redraft'), 'redraft dashboard: Redraft badge/text missing');
  pushIf(failures, !textHas(snap, 'pre-draft'), 'redraft dashboard: Pre-Draft phase missing');
  pushIf(failures, !snap.skin?.state?.isPreDraftRosterEmpty, 'redraft dashboard: pre-draft empty-roster state not active');
  await verifyStudioContrast(page, failures);
  await page.close();

  page = await openLeaguePage(context, port, REDRAFT_LEAGUE_ID, 'redraft', 'myteam');
  snap = await skinSnapshot(page);
  assertSkin(failures, 'redraft myteam', snap, { type: 'redraft', phase: 'pre_draft' });
  pushIf(failures, snap.skin?.features?.showTaxi !== false, 'redraft myteam: showTaxi should be false');
  pushIf(failures, snap.skin?.features?.showIDP !== false, 'redraft myteam: showIDP should be false');
  pushIf(failures, snap.skin?.vocabulary?.valueLabel !== 'Season value', 'redraft myteam: value label should be Season value');
  pushIf(failures, hasExact(snap.buttons, 'Taxi'), 'redraft myteam: Taxi filter should not render');
  pushIf(failures, hasExact(snap.buttons, 'IDP'), 'redraft myteam: IDP filter should not render');
  await page.close();

  for (const tab of ['fa', 'trades']) {
    page = await openLeaguePage(context, port, REDRAFT_LEAGUE_ID, 'redraft', tab);
    snap = await skinSnapshot(page);
    assertSkin(failures, `redraft ${tab}`, snap, { type: 'redraft', phase: 'pre_draft' });
    pushIf(failures, !textHas(snap, 'pre-draft mode'), `redraft ${tab}: pre-draft mode copy missing`);
    await page.close();
  }

  page = await openLeaguePage(context, port, REDRAFT_LEAGUE_ID, 'redraft', 'gm-settings', { alexSubTab: 'settings' });
  await waitForModelSettings(page);
  snap = await skinSnapshot(page);
  const redraftPositionButtons = snap.sections?.targetPositions || [];
  const redraftYearButtons = snap.sections?.draftPickYears || [];
  ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'].forEach(pos => {
    pushIf(failures, !hasExact(redraftPositionButtons, pos), `redraft alex settings: ${pos} target chip missing`);
  });
  ['DL', 'LB', 'DB'].forEach(pos => {
    pushIf(failures, hasExact(redraftPositionButtons, pos), `redraft alex settings: ${pos} target chip should not render`);
  });
  pushIf(failures, redraftYearButtons.length !== 1, `redraft alex settings: expected one current-year draft chip, got ${redraftYearButtons.join(', ') || 'none'}`);
  await page.close();

  page = await openLeaguePage(context, port, DYNASTY_LEAGUE_ID, 'dynasty', 'dashboard');
  snap = await skinSnapshot(page);
  assertSkin(failures, 'dynasty dashboard', snap, { type: 'dynasty', phase: 'pre_draft' });
  pushIf(failures, !textHas(snap, 'dynasty'), 'dynasty dashboard: Dynasty badge/text missing');
  pushIf(failures, !textHas(snap, 'pre-draft'), 'dynasty dashboard: Pre-Draft phase missing');
  await page.close();

  page = await openLeaguePage(context, port, DYNASTY_LEAGUE_ID, 'dynasty', 'myteam');
  snap = await skinSnapshot(page);
  assertSkin(failures, 'dynasty myteam', snap, { type: 'dynasty', phase: 'pre_draft' });
  pushIf(failures, snap.skin?.features?.showTaxi !== true, 'dynasty myteam: showTaxi should be true');
  pushIf(failures, snap.skin?.features?.showIDP !== true, 'dynasty myteam: showIDP should be true');
  pushIf(failures, snap.skin?.vocabulary?.valueShortLabel !== 'DHQ', 'dynasty myteam: short value label should be DHQ');
  pushIf(failures, snap.skin?.vocabulary?.valueLabel !== 'DHQ Dynasty Value', 'dynasty myteam: value label should be DHQ Dynasty Value');
  await page.close();

  page = await openLeaguePage(context, port, DYNASTY_LEAGUE_ID, 'dynasty', 'gm-settings', { alexSubTab: 'settings' });
  await waitForModelSettings(page);
  snap = await skinSnapshot(page);
  const dynastyPositionButtons = snap.sections?.targetPositions || [];
  const dynastyYearButtons = snap.sections?.draftPickYears || [];
  ['DL', 'LB', 'DB'].forEach(pos => {
    pushIf(failures, !hasExact(dynastyPositionButtons, pos), `dynasty alex settings: ${pos} target chip missing`);
  });
  pushIf(failures, dynastyYearButtons.length < 3, `dynasty alex settings: expected future draft-year chips, got ${dynastyYearButtons.join(', ') || 'none'}`);
  await page.close();
}

async function main() {
  if (!hasChrome()) {
    console.log(`FAIL league skin browser QA - Chrome not found at ${CHROME}`);
    process.exitCode = 1; return;
  }

  let port;
  try {
    port = await findOpenPort(PORT_START);
  } catch (err) {
    if (err && ['EACCES', 'EPERM'].includes(err.code)) {
      console.log(`FAIL league skin browser QA - local port binding is not permitted here (${err.code}).`);
      process.exitCode = 1; return;
    }
    throw err;
  }

  const server = await startStaticServer(port);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const failures = [];

  try {
    const context = await browser.newContext();
    await context.addInitScript(user => {
      localStorage.setItem('wr_tutorial_done_v1', '1');
      localStorage.setItem('dynastyhq_username', user);
    }, USER);
    await installReadOnlyRoutes(context, { fixture: createLeagueSkinFixture({ redraftId: REDRAFT_LEAGUE_ID, dynastyId: DYNASTY_LEAGUE_ID, user: USER }) });
    await runMatrix(context, port, failures);
    await context.close();
  } finally {
    await browser.close();
    server.kill();
  }

  if (failures.length) {
    console.log('\nLeague skin browser QA failures:');
    failures.forEach(failure => console.log(`  FAIL: ${failure}`));
    process.exit(1);
  }

  console.log('\nPASS league skin browser QA - redraft/dynasty product skin matrix');
}

main().catch(err => {
  console.error('League skin browser QA failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
