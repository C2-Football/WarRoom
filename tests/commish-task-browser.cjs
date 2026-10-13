'use strict';
// Actual Office/Prefs browser journeys. Only provider reads, disposable local
// account identities, task-sync service, clipboard and quota failures are fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const browsers = require('@playwright/test');
const { installReadOnlyRoutes } = require('./helpers/browser-readonly.cjs');
const { createLeagueSkinFixture } = require('./helpers/league-skin-fixture.cjs');

const engine = process.env.COMMISH_BROWSER || 'chromium';
assert(['chromium', 'webkit'].includes(engine));
assert(process.env.COMMISH_TASK_URL, 'Set COMMISH_TASK_URL to the ready preview or canonical hosted release.');
const entry = new URL(process.env.COMMISH_TASK_URL);
assert(['localhost', '127.0.0.1'].includes(entry.hostname)
  || (entry.origin === 'https://c2-football.github.io' && ['/WarRoom/', '/WarRoom-sandbox/'].includes(entry.pathname)),
'Hosted task journeys must use the canonical C2 production or sandbox URL.');
entry.searchParams.set('dev', 'true'); entry.searchParams.set('user', 'readiness-fixture');
const output = path.resolve(process.env.COMMISH_TASK_OUTPUT || path.join(__dirname, '../output/playwright/commish-task'));
const allSizes = [
  { label: 'phone-small', width: 320, height: 700, touch: true },
  { label: 'phone', width: 390, height: 844, touch: true },
  { label: 'phone-landscape', width: 844, height: 390, touch: true },
  { label: 'ipad-portrait', width: 768, height: 1024, touch: true },
  { label: 'ipad-landscape', width: 1024, height: 768, touch: true },
  { label: 'desktop', width: 1440, height: 1000, touch: false },
];
const requested = process.env.COMMISH_SIZES?.split(',').map(value => value.trim()).filter(Boolean);
const sizes = requested ? allSizes.filter(size => requested.includes(size.label)) : allSizes;
assert(sizes.length && (!requested || sizes.length === requested.length), 'Use unique supported COMMISH_SIZES.');
const alpha = 'qa-task-alpha', beta = 'qa-task-beta';
const accountA = '10000000-0000-4000-8000-000000000001';
const accountB = '10000000-0000-4000-8000-000000000002';
const names = { [alpha]: 'QA Empty Redraft', [beta]: 'QA Dynasty With IDP' };
const taskId = id => 'genesis:' + id;
const clone = value => JSON.parse(JSON.stringify(value));

// Both independent browser contexts use this service model, never each
// other's storage. Every request is fulfilled locally before the general
// external-write guard, so authenticated API fixtures cannot reach a backend.
function ignoredServiceFixture() {
  const rows = new Map(), operations = new Map(), events = [];
  const tokens = new Map([['isolated-task-fixture', accountA], ...[accountA, accountB].map(id => ['isolated-task-fixture-' + id, id])]);
  const stable = value => JSON.stringify(value && typeof value === 'object' ? (Array.isArray(value)
    ? value.map(item => JSON.parse(stable(item))) : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(stable(value[key]))]))) : value);
  const accountRows = id => { if (!rows.has(id)) rows.set(id, new Map()); return rows.get(id); };
  const accountOps = id => { if (!operations.has(id)) operations.set(id, new Map()); return operations.get(id); };
  const get = (id, task) => clone(accountRows(id).get(task) || null);
  const install = async (context, control = {}) => context.route('**/functions/v1/fw-commish-ignored**', async route => {
    const request = route.request(), method = request.method(), url = new URL(request.url());
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
    const respond = (status, body) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const id = tokens.get((request.headers().authorization || '').replace(/^Bearer\s+/i, ''));
    if (!id || control.unauthorized) return respond(401, { ok: false, code: 'unauthorized', error: 'Sign in again.' });
    if (control.offline) { events.push({ accountId: id, method, offline: true }); return route.abort('failed'); }
    if (method === 'GET') {
      const offset = Number((url.searchParams.get('cursor') || '').replace(/^fixture:/, '')) || 0;
      const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 200);
      const records = [...accountRows(id).values()].sort((a, b) => a.taskId.localeCompare(b.taskId));
      events.push({ accountId: id, method, offset });
      return respond(200, { ok: true, accountId: id, records: clone(records.slice(offset, offset + limit)), nextCursor: offset + limit < records.length ? 'fixture:' + (offset + limit) : null });
    }
    assert.equal(method, 'POST', 'Ignore synchronization uses only the documented service methods');
    const body = request.postDataJSON();
    assert(body && typeof body.taskId === 'string' && ['ignored', 'restored'].includes(body.state));
    assert(Number.isSafeInteger(body.expectedRevision) && body.expectedRevision >= 0);
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.operationId), 'An immutable operation ID is required');
    assert(!body.snapshot || body.snapshot.id === body.taskId, 'Snapshot belongs to the requested task');
    if (control.pauseBeforeNextPost) {
      control.pauseBeforeNextPost = false;
      await new Promise(resolve => { control.pendingBeforePost = { release: resolve, taskId: body.taskId, expectedRevision: body.expectedRevision }; });
      delete control.pendingBeforePost;
    }
    const payload = stable(body), prior = accountOps(id).get(body.operationId), current = get(id, body.taskId);
    if (prior && prior.payload !== payload) {
      events.push({ accountId: id, method, taskId: body.taskId, status: 409, code: 'operation_conflict' });
      return respond(409, { ok: false, accountId: id, code: 'operation_conflict', error: 'Operation changed.', record: current });
    }
    if (!prior && body.expectedRevision !== (current?.revision || 0)) {
      events.push({ accountId: id, method, taskId: body.taskId, status: 409, code: 'revision_conflict' });
      return respond(409, { ok: false, accountId: id, code: 'revision_conflict', error: 'Another device changed this task.', record: current });
    }
    if (!prior) {
      const record = { taskId: body.taskId, state: body.state, revision: (current?.revision || 0) + 1,
        updatedAt: new Date().toISOString(), snapshot: body.snapshot || current?.snapshot || null };
      accountRows(id).set(body.taskId, record);
      accountOps(id).set(body.operationId, { payload, revision: record.revision });
    }
    const record = get(id, body.taskId), appliedRevision = accountOps(id).get(body.operationId).revision;
    events.push({ accountId: id, method, taskId: body.taskId, operationId: body.operationId, state: body.state,
      expectedRevision: body.expectedRevision, revision: record.revision, duplicate: !!prior, status: 200 });
    if (control.loseNextResponse) { control.loseNextResponse = false; return route.abort('failed'); }
    if (control.pauseNextPost) {
      control.pauseNextPost = false;
      await new Promise(resolve => { control.pendingPost = { release: resolve, taskId: body.taskId }; });
      delete control.pendingPost;
    }
    return respond(200, { ok: true, accountId: id, record, appliedRevision, duplicate: !!prior });
  });
  const seedTombstones = (id, count) => {
    for (let index = 0; index < count; index++) {
      const task = 'archive:' + String(index).padStart(3, '0');
      accountRows(id).set(task, { taskId: task, state: 'restored', revision: 1, updatedAt: new Date().toISOString(), snapshot: null });
    }
  };
  return { install, get, events, seedTombstones };
}

function fixture() {
  const base = createLeagueSkinFixture({ redraftId: alpha, dynastyId: beta, user: 'readiness-fixture' });
  const state = { scheduled: false, complete: false };
  const reads = [];
  return { state, reads, read(url) {
    // Unrelated portfolio warmups stay isolated as well; these empty, valid
    // public MFL responses do not influence Commissioner task findings.
    if (/myfantasyleague\.com$/.test(url.hostname)) {
      if (url.searchParams.get('TYPE') === 'players') return { players: { player: [] } };
      if (url.searchParams.get('TYPE') === 'adp') return { adp: { adp: [] } };
      return {};
    }
    if (url.pathname.endsWith('/rest/v1/gm_strategy')) return [];
    if (url.pathname.endsWith('/rest/v1/league_docs')) {
      reads.push({ kind: 'league-docs', league: url.searchParams.get('league_id'), complete: state.complete });
      return state.complete ? [{ doc_name: 'Isolated QA constitution', chunk_idx: 0, category: 'bylaws',
        chunk_text: 'Article 1. Governance\nThe commissioner schedules the draft and publishes the league rules.\nArticle 2. Rosters\nEvery team follows the published roster rules.' }] : [];
    }
    const value = base(url);
    if (value === undefined) return undefined;
    const data = clone(value);
    const pathname = url.pathname.replace(/^\/v1/, '');
    if (pathname.endsWith('/users') && Array.isArray(data)) return data.map((user, index) => ({ ...user, is_owner: index === 0 }));
    const enrich = league => state.complete ? { ...league, settings: { ...league.settings, trade_deadline: 12 } } : league;
    if (/^\/user\/[^/]+\/leagues\/nfl\//.test(pathname)) return data.map(enrich);
    if (/^\/league\/[^/]+$/.test(pathname) && data) return enrich(data);
    if (pathname.endsWith('/drafts') && Array.isArray(data)) return data.map((draft, index) => ({ ...draft,
      ...(state.scheduled || state.complete ? { start_time: Date.now() + (10 + index) * 86400000 } : {}) }));
    return data;
  } };
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await browsers[engine].launch({ headless: true, ...(engine === 'chromium'
    ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }
    : { executablePath: process.env.PLAYWRIGHT_WEBKIT_PATH || '/Users/jacobc/Library/Caches/ms-playwright/webkit-2368/pw_run.sh' }) });
  const results = [];
  let testedRelease = null;
  const releaseProof = async page => {
    if (['localhost', '127.0.0.1'].includes(entry.hostname)) return null;
    const url = new URL('release.json', entry); url.searchParams.set('taskQa', Date.now());
    const response = await page.request.get(url.href, { timeout: 30000 });
    assert(response.ok(), 'Canonical hosted release metadata is available');
    const data = await response.json();
    assert(/^[0-9a-f]{40}$/.test(data.revision), 'Hosted revision is an exact commit SHA');
    if (process.env.COMMISH_EXPECTED_SHA) assert.equal(data.revision, process.env.COMMISH_EXPECTED_SHA, 'Hosted journeys must exercise the intended release');
    if (testedRelease) assert.equal(data.revision, testedRelease.revision, 'The release must remain stable throughout the matrix');
    return { revision: data.revision, environment: data.environment, metadataUrl: url.href,
      moduleUrls: await page.evaluate(() => [...document.scripts].map(script => script.src).filter(src => /commish|commissioner/i.test(src))) };
  };
  const persist = () => fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ engine, url: entry.href,
    fixture: 'Two public-provider fixtures and a locally fulfilled authenticated task-sync service; actual Office, IgnoreSync, task queue, Prefs, checklist, AccountStorage and schedule generator.',
    capabilityBoundary: 'Disposable synthetic browser identities, isolated service responses and touch/viewport emulation. This proves frontend integration, not deployed authentication/backend persistence or physical-device behavior. External writes are blocked before navigation.',
    testedRelease, results }, null, 2) + '\n');
  try {
    for (const size of sizes) {
      console.log(engine + ' ' + size.label + ' starting');
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch });
      const provider = fixture();
      const ignoredService = ignoredServiceFixture(), syncControl = {};
      const blocked = await installReadOnlyRoutes(context, { fixture: provider.read });
      await ignoredService.install(context, syncControl);
      await context.route('https://sleeper.com/leagues/**', route => route.fulfill({ status: 200, contentType: 'text/plain', body: 'Isolated provider settings destination.' }));
      await context.addInitScript(() => {
        if (!localStorage.getItem('fw_session_v1')) {
          localStorage.setItem('fw_session_v1', JSON.stringify({ token: 'isolated-task-fixture', user: { id: '10000000-0000-4000-8000-000000000001', email: 'qa@example.invalid' } }));
          localStorage.setItem('od_auth_v1', JSON.stringify({ username: 'readiness-fixture' }));
          localStorage.setItem('od_profile_v1', JSON.stringify({ onboardingComplete: true }));
          localStorage.setItem('wr_active_connection_owner_v1', 'account:10000000-0000-4000-8000-000000000001');
        }
        const originalSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          const rejectedKey = sessionStorage.getItem('qa_task_quota_failure');
          if (this === localStorage && rejectedKey && String(key).includes(rejectedKey)) {
            throw new DOMException('Isolated task preference quota failure', 'QuotaExceededError');
          }
          return originalSet.call(this, key, value);
        };
        window.__qaClipboardMode = 'success'; window.__qaClipboardWrites = [];
        Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => window.__qaClipboardMode === 'unavailable' ? undefined : ({
          writeText(text) {
            window.__qaClipboardWrites.push(String(text));
            if (window.__qaClipboardMode === 'reject') return Promise.reject(new DOMException('Isolated clipboard rejection', 'NotAllowedError'));
            if (window.__qaClipboardMode === 'pending') return new Promise(resolve => { window.__qaClipboardResolve = resolve; });
            return Promise.resolve();
          },
        }) });
        // Passive observer: the original engine still receives every actual
        // Office argument and returns its unmodified result to the UI.
        const observer = setInterval(() => {
          const triage = window.App?.Commish?.Triage;
          if (!triage?.buildQueue) return;
          clearInterval(observer);
          const build = triage.buildQueue;
          triage.buildQueue = function (args) {
            const result = build.call(this, args);
            window.__qaRawTaskQueue = JSON.parse(JSON.stringify(result));
            return result;
          };
        }, 5);
      });
      const page = await context.newPage(), errors = [], checks = [], touchChecks = [], matrixChecks = [];
      let crossDeviceProof = null;
      let capturedReview = false;
      const checkpoint = description => { checks.push(description); console.log(engine + ' ' + size.label + ' checked: ' + description); };
      page.on('pageerror', error => errors.push(error.message));
      const activate = locator => size.touch ? locator.tap() : locator.click();
      const fit = async label => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ' must fit the viewport');
      const reachable = async (locator, label, inline = 'center') => {
        await locator.scrollIntoViewIfNeeded();
        await locator.evaluate((element, alignment) => element.scrollIntoView({ block: 'center', inline: alignment }), inline);
        const target = await locator.evaluate(element => {
          const rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return { width: rect.width, height: rect.height, x: rect.x, y: rect.y, reachable: element === hit || element.contains(hit),
            ...(element === hit || element.contains(hit) ? {} : { hit: hit?.outerHTML?.slice(0, 500), element: element.outerHTML.slice(0, 500), computed: { display: getComputedStyle(element).display, fontSize: getComputedStyle(element).fontSize, lineHeight: getComputedStyle(element).lineHeight, height: getComputedStyle(element).height } }),
            coarse: matchMedia('(pointer:coarse)').matches, maxTouchPoints: navigator.maxTouchPoints, touchEvents: 'ontouchstart' in window };
        });
        assert(target.reachable, label + ' must be reachable: ' + JSON.stringify(target));
        if (size.touch) {
          assert(target.coarse && (target.maxTouchPoints > 0 || target.touchEvents), label + ' needs active touch input');
          assert(target.width >= 44 && target.height >= 44, label + ' needs a44px target: ' + JSON.stringify(target));
        }
        touchChecks.push({ control: label, ...target });
      };
      const capture = name => page.screenshot({ path: path.join(output, size.label + '-' + name + '.png'), fullPage: false });
      const workspace = async name => {
        const trigger = page.getByRole('button', { name: /^Workspaces/ });
        if (await trigger.isVisible()) await activate(trigger);
        const nav = page.getByRole('navigation', { name: 'Commissioner workspaces', exact: true });
        const control = nav.getByRole('button', { name });
        await reachable(control, 'Workspace ' + name); await activate(control);
      };
      const openOffice = async ({ allowSyncError = false } = {}) => {
        const card = page.locator('.hub-experience-card.commish-hero');
        await card.waitFor({ timeout: 60000 }); await activate(card);
        await page.getByRole('group', { name: 'Filter by priority', exact: true }).waitFor({ timeout: 60000 });
        await page.waitForFunction(() => Array.isArray(window.__qaRawTaskQueue?.items));
        await page.waitForFunction(allowError => {
          const phase = document.querySelector('[data-testid="commish-ignore-sync"]')?.getAttribute('data-phase');
          return phase === 'ready' || (allowError && phase === 'error');
        }, allowSyncError);
      };
      const reload = async options => { await page.reload({ waitUntil: 'domcontentloaded' }); await openOffice(options); };
      const raw = async id => page.evaluate(id => (window.__qaRawTaskQueue?.items || []).find(item => item.id === id) || null, id);
      const preference = id => page.evaluate(id => App.Commish.Prefs.stateOf(id), id);
      const activePreference = id => page.evaluate(id => App.Commish.Prefs.activeStateOf((window.__qaRawTaskQueue?.items || []).find(item => item.id === id)), id);
      const task = async id => {
        const item = await raw(id); assert(item, 'Expected real provider finding: ' + id);
        const tier = item.tier === 'NOW' ? /\bNow\b/ : item.tier === 'SOON' ? /\bSoon\b/ : /\bLater\b/;
        const filter = page.getByRole('group', { name: 'Filter by priority', exact: true }).getByRole('button', { name: tier });
        if (await filter.getAttribute('aria-pressed') !== 'true') await activate(filter);
        return page.getByRole('button', { name: 'Review ' + item.headline, exact: true });
      };
      const review = async id => {
        const control = await task(id);
        const openerName = await control.getAttribute('aria-label');
        const row = page.getByTestId('commish-task-row').filter({ has: control });
        assert.equal(await row.getAttribute('data-task-id'), id);
        const layout = await row.getAttribute('data-layout');
        assert(['card', 'table'].includes(layout));
        if (size.width <= 844) assert.equal(layout, 'card', 'Narrow phone and portrait iPad screens retain readable task cards');
        if (size.width >= 1440) assert.equal(layout, 'table', 'Wide desktop retains its dense task table');
        const geometry = await control.evaluate(element => { const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height, fontSize: parseFloat(getComputedStyle(element).fontSize) }; });
        const rowGeometry = await row.boundingBox();
        assert(geometry.width >= 44 && geometry.height >= (size.touch ? 44 : 14) && geometry.height <= 90 && geometry.fontSize >= 14, 'Task headline must stay readable and bounded with44px touch targets: ' + JSON.stringify(geometry));
        assert(rowGeometry && rowGeometry.height <= 400, 'Task row must not collapse into a tall empty block: ' + JSON.stringify(rowGeometry));
        await reachable(control, 'Review task');
        if (!capturedReview) { await capture('overview-review-task'); capturedReview = true; }
        await activate(control); await page.getByRole('dialog', { name: 'Action', exact: true }).waitFor();
        return openerName;
      };
      const dialog = page.getByRole('dialog', { name: 'Action', exact: true });
      const absent = async id => assert.equal(await (await task(id)).count(), 0, 'Dismissed task must stay out of the actual overview: ' + id);
      const settings = async () => { await workspace('Settings'); await page.getByTestId('commish-ignored-tasks').waitFor(); };
      const overview = () => workspace('Overview');
      const leagueMatrix = async () => {
        const disclosure = page.locator('summary').filter({ hasText: /^All leagues & desks$/ });
        if (await disclosure.count() && !await disclosure.evaluate(element => element.parentElement.open)) await activate(disclosure);
        const grid = page.getByTestId('commish-league-grid-scroll');
        await grid.waitFor();
        return grid;
      };
      const checkLeagueMatrix = async () => {
        const grid = await leagueMatrix();
        const domains = ['Coefficient', 'People', 'Operations', 'Programmes', 'Rule Lab', 'Schedule Builder', 'Season Setup', 'Bylaws + Dues'];
        const dimensions = await grid.evaluate(element => ({ width: element.clientWidth, contentWidth: element.scrollWidth, tabIndex: element.tabIndex }));
        if (dimensions.contentWidth > dimensions.width + 1) {
          assert.equal(await grid.getAttribute('role'), 'region');
          assert.equal(await grid.getAttribute('aria-label'), 'Workspaces across your leagues');
          assert.equal(dimensions.tabIndex, 0, 'Overflowing league matrix remains keyboard-scrollable');
          assert(await page.getByTestId('commish-league-grid-scroll-hint').isVisible(), 'Horizontal workspaces need a visible scroll hint');
        }
        for (const name of domains) {
          const heading = grid.getByRole('button', { name, exact: true });
          assert.equal(await heading.count(), 1, 'Every workspace has one matrix heading: ' + name);
          // The pinned league-name column occupies the left part of the
          // scroller. Align headings at its right edge, rather than centering
          // them beneath that sticky column on the narrowest phone.
          await reachable(heading, 'League matrix heading ' + name, 'end');
          const geometry = await heading.evaluate(element => {
            const rect = element.getBoundingClientRect(), range = document.createRange();
            range.selectNodeContents(element);
            return { width: rect.width, height: rect.height, fontSize: parseFloat(getComputedStyle(element).fontSize),
              textLines: [...range.getClientRects()].filter(line => line.width > 0 && line.height > 0).length };
          });
          assert(geometry.textLines > 0 && geometry.textLines <= 2 && geometry.fontSize >= 12 && geometry.height <= 90,
            'Workspace heading must remain readable in at most two lines: ' + name + ' ' + JSON.stringify(geometry));
          matrixChecks.push({ heading: name, ...geometry });
        }
        const last = grid.getByRole('button', { name: 'Bylaws + Dues', exact: true });
        const lastBounds = await last.boundingBox(), gridBounds = await grid.boundingBox();
        assert(lastBounds && gridBounds && lastBounds.x >= gridBounds.x - 1 && lastBounds.x + lastBounds.width <= gridBounds.x + gridBounds.width + 1,
          'The last workspace must be fully reachable inside the matrix scroll region');
        // macOS WebKit uses Option+Tab to include buttons when full keyboard
        // access is off; ordinary Tab otherwise goes to the scroll region.
        await last.focus(); await page.keyboard.press(engine === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
        // Native focus scrolling may animate after the key event. Wait for
        // complete visibility; never reveal or scroll the focused target here.
        await page.waitForFunction(() => {
          const element = document.querySelector('[data-testid="commish-league-grid-scroll"]');
          const active = document.activeElement;
          if (!element || !active || !element.contains(active)) return false;
          const rect = active.getBoundingClientRect(), outer = element.getBoundingClientRect();
          const pinned = element.firstElementChild?.firstElementChild;
          const leftInset = pinned && getComputedStyle(pinned).position === 'sticky' ? pinned.getBoundingClientRect().width : 0;
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return active.textContent.trim() === 'Season Setup' && (active === hit || active.contains(hit))
            && rect.x >= outer.x + leftInset - 1 && rect.right <= outer.right + 1;
        }, null, { timeout: 2000 }).catch(() => {});
        const reverseHeading = await grid.evaluate(element => {
          const active = document.activeElement, rect = active.getBoundingClientRect(), outer = element.getBoundingClientRect();
          const pinned = element.firstElementChild?.firstElementChild;
          const leftInset = pinned && getComputedStyle(pinned).position === 'sticky' ? pinned.getBoundingClientRect().width : 0;
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return { heading: active.textContent.trim(), x: rect.x, right: rect.right, leftEdge: outer.x + leftInset, rightEdge: outer.right,
            centerReachable: active === hit || active.contains(hit), hit: hit?.outerHTML?.slice(0, 300) };
        });
        assert.equal(reverseHeading.heading, 'Season Setup', 'Reverse keyboard navigation reaches the preceding matrix heading');
        assert(reverseHeading.centerReachable && reverseHeading.x >= reverseHeading.leftEdge - 1 && reverseHeading.right <= reverseHeading.rightEdge + 1,
          'Native reverse keyboard navigation must reveal the complete heading beside the pinned league column: ' + JSON.stringify(reverseHeading));
        matrixChecks.push({ keyboardReverse: reverseHeading });
        await reachable(last, 'Return to last league matrix heading', 'end');
        await fit('League matrix at last column'); await capture('league-matrix-last-column');
        const scheduleHeading = grid.getByRole('button', { name: 'Schedule Builder', exact: true });
        await reachable(scheduleHeading, 'Open Schedule Builder from league matrix', 'end'); await activate(scheduleHeading);
        assert.equal(await page.getByRole('navigation', { name: 'Season & Schedule views', exact: true }).getByRole('button', { name: 'Schedule Builder', exact: true }).getAttribute('aria-current'), 'page');
        await overview();
        const bylawsHeading = (await leagueMatrix()).getByRole('button', { name: 'Bylaws + Dues', exact: true });
        await reachable(bylawsHeading, 'Open last workspace from league matrix', 'end'); await activate(bylawsHeading);
        assert.equal(await page.getByRole('navigation', { name: 'Rules views', exact: true }).getByRole('button', { name: 'Bylaws & Amendments', exact: true }).getAttribute('aria-current'), 'page');
        await overview();
        checkpoint('All eight league-matrix headings stay readable and reachable; Schedule Builder and the last workspace open their correct views');
      };
      const season = async () => {
        await workspace(/^Season & Schedule/);
        const tab = page.getByRole('navigation', { name: 'Season & Schedule views', exact: true }).getByRole('button', { name: 'Season Setup', exact: true });
        await activate(tab); await page.getByTestId('genesis-league').first().waitFor();
      };
      const leagueCard = id => page.getByTestId('genesis-league').filter({ has: page.getByRole('button', { name: 'Season setup for ' + names[id], exact: true }) });
      const expand = async id => {
        const control = leagueCard(id).getByRole('button', { name: 'Season setup for ' + names[id], exact: true });
        await reachable(control, 'Season checklist header');
        if (await control.getAttribute('aria-expanded') !== 'true') await activate(control);
      };
      const switchAccount = async (id, options) => {
        await page.evaluate(id => {
          localStorage.setItem('fw_session_v1', JSON.stringify({ token: 'isolated-task-fixture-' + id, user: { id, email: 'qa@example.invalid' } }));
          localStorage.setItem('wr_active_connection_owner_v1', 'account:' + id);
          localStorage.setItem('od_auth_v1', JSON.stringify({ username: 'readiness-fixture' }));
          localStorage.setItem('od_profile_v1', JSON.stringify({ onboardingComplete: true }));
          sessionStorage.setItem('wr_credentials_owner_v1', 'account:' + id);
        }, id);
        await reload(options);
        assert.equal(await page.evaluate(() => App.AccountStorage.owner()), 'account:' + id);
      };
      const checkCrossDevice = async () => {
        const peerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
        const peerControl = {}, peerErrors = [], peerTouchChecks = [], syncChecks = [];
        const peerBlocked = await installReadOnlyRoutes(peerContext, { fixture: provider.read });
        await ignoredService.install(peerContext, peerControl);
        await peerContext.addInitScript(id => {
          window.__qaPeerHadPrivateCache = Object.keys(localStorage).some(key => key.includes('commish_'));
          localStorage.setItem('fw_session_v1', JSON.stringify({ token: 'isolated-task-fixture', user: { id, email: 'qa@example.invalid' } }));
          localStorage.setItem('od_auth_v1', JSON.stringify({ username: 'readiness-fixture' }));
          localStorage.setItem('od_profile_v1', JSON.stringify({ onboardingComplete: true }));
          localStorage.setItem('wr_active_connection_owner_v1', 'account:' + id);
        }, accountA);
        const peer = await peerContext.newPage();
        peer.on('pageerror', error => peerErrors.push(error.message));
        const peerActivate = async locator => {
          await locator.scrollIntoViewIfNeeded();
          const bounds = await locator.boundingBox();
          assert(bounds && bounds.width >= 44 && bounds.height >= 44, 'The independent phone has touch-sized actions');
          peerTouchChecks.push({ label: await locator.getAttribute('aria-label') || await locator.textContent(), width: bounds.width, height: bounds.height });
          await locator.tap();
        };
        const peerOpen = async () => {
          await peerActivate(peer.locator('.hub-experience-card.commish-hero'));
          await peer.getByRole('group', { name: 'Filter by priority', exact: true }).waitFor();
          await peer.waitForFunction(() => document.querySelector('[data-testid="commish-ignore-sync"]')?.getAttribute('data-phase') === 'ready');
        };
        const peerReload = async () => { await peer.reload({ waitUntil: 'domcontentloaded' }); await peerOpen(); };
        const peerWorkspace = async name => {
          await peerActivate(peer.getByRole('button', { name: /^Workspaces/ }));
          await peerActivate(peer.getByRole('navigation', { name: 'Commissioner workspaces', exact: true }).getByRole('button', { name }));
        };
        const peerRows = id => peer.locator('[data-testid="commish-task-row"][data-task-id="' + id + '"]');
        const peerIgnore = async () => {
          await peerActivate(peerRows(taskId(alpha)).getByRole('button', { name: /^Review / }));
          const action = peer.getByRole('dialog', { name: 'Action', exact: true });
          await peerActivate(action.getByRole('button', { name: 'Ignore task', exact: true }));
          await action.waitFor({ state: 'hidden' });
        };
        const peerRestore = async () => {
          await peerWorkspace('Settings');
          const row = peer.getByTestId('commish-ignored-tasks').locator(':scope > div').filter({ hasText: names[alpha] });
          await peerActivate(row.getByRole('button', { name: 'Restore', exact: true }));
          await row.waitFor({ state: 'hidden' });
          await peer.waitForFunction(() => document.querySelector('[data-testid="commish-ignore-sync"]')?.getAttribute('data-phase') === 'ready');
          await peerWorkspace('Overview');
          await peerRows(taskId(alpha)).waitFor();
        };
        const mainIgnore = async () => {
          await review(taskId(alpha)); await activate(dialog.getByRole('button', { name: 'Ignore task', exact: true }));
        };
        const mainRestore = async () => {
          await settings();
          const row = page.getByTestId('commish-ignored-tasks').locator(':scope > div').filter({ hasText: names[alpha] });
          await activate(row.getByRole('button', { name: 'Restore', exact: true }));
          await row.waitFor({ state: 'hidden' });
          await page.waitForFunction(() => document.querySelector('[data-testid="commish-ignore-sync"]')?.getAttribute('data-phase') === 'ready');
          await overview(); assert(await (await task(taskId(alpha))).isVisible());
        };
        const failedSync = () => dialog.getByTestId('commish-ignore-sync-error').waitFor();
        const retryChoice = () => activate(dialog.getByRole('button', { name: 'Retry task sync', exact: true }));
        try {
          provider.state.complete = false; provider.state.scheduled = false; await reload();
          await mainIgnore(); await dialog.waitFor({ state: 'hidden' });
          ignoredService.seedTombstones(accountA, 205);
          await peer.goto(entry.href, { waitUntil: 'domcontentloaded' }); await peerOpen();
          assert.equal(await peer.evaluate(() => window.__qaPeerHadPrivateCache), false, 'The second device starts without copied planning storage');
          assert.equal(await peerRows(taskId(alpha)).count(), 0, 'A fresh independent phone reads the same account Ignore from the service');
          assert(ignoredService.events.some(event => event.method === 'GET' && event.offset === 200), 'The active task is loaded after a complete first page of restore tombstones');
          assert(await peerRows(taskId(beta)).isVisible(), 'The other league remains actionable');
          await peerRestore();
          assert.equal(ignoredService.get(accountA, taskId(alpha)).state, 'restored');
          await reload(); assert(await (await task(taskId(alpha))).isVisible());
          syncChecks.push('Independent desktop/phone contexts share Ignore and restore through paginated service reads; no storage-state copying');

          await page.evaluate(() => sessionStorage.setItem('qa_task_quota_failure', 'commish_ignore_cloud_v1'));
          await mainIgnore(); await dialog.waitFor({ state: 'hidden' });
          assert.equal(ignoredService.get(accountA, taskId(alpha)).state, 'ignored');
          assert.equal((await preference(taskId(alpha))).confirmed, true);
          assert.equal(await page.getByTestId('commish-ignore-sync').getAttribute('data-phase'), 'ready');
          await page.getByTestId('commish-ignore-sync').getByText('Your confirmed account choice is saved online.', { exact: false }).waitFor();
          await page.evaluate(() => sessionStorage.removeItem('qa_task_quota_failure'));
          await reload(); await absent(taskId(alpha)); await mainRestore();
          syncChecks.push('A cache quota failure after server confirmation remains honestly saved online and recovers on reload');

          await peerReload();
          syncControl.pauseBeforeNextPost = true; await mainIgnore();
          await browsers.expect.poll(() => !!syncControl.pendingBeforePost).toBeTruthy();
          await peerIgnore(); await peerRestore();
          const conflictRevision = ignoredService.get(accountA, taskId(alpha)).revision;
          const postsBeforeConflict = ignoredService.events.filter(event => event.method === 'POST').length;
          assert(syncControl.pendingBeforePost.expectedRevision < conflictRevision, 'Another device advances the revision after the first request was sent');
          syncControl.pendingBeforePost.release(); await failedSync();
          assert.equal(ignoredService.get(accountA, taskId(alpha)).revision, conflictRevision, 'A stale device cannot overwrite a newer restore');
          assert.equal(ignoredService.events.filter(event => event.method === 'POST').length, postsBeforeConflict + 1, '409 must not automatically rebase user intent');
          assert(ignoredService.events.some(event => event.status === 409 && event.code === 'revision_conflict' && event.taskId === taskId(alpha)));
          await retryChoice(); await dialog.waitFor({ state: 'hidden' });
          assert.equal(ignoredService.get(accountA, taskId(alpha)).revision, conflictRevision + 1);
          await mainRestore();
          syncChecks.push('409 preserves the newer server choice until explicit retry with its current revision');

          syncControl.loseNextResponse = true;
          await mainIgnore(); await failedSync();
          const lostRecord = ignoredService.get(accountA, taskId(alpha));
          const lostOperation = ignoredService.events.findLast(event => event.method === 'POST' && event.status === 200).operationId;
          await reload({ allowSyncError: true });
          const recoveredRetry = page.getByTestId('commish-ignore-sync').getByRole('button', { name: 'Retry task sync', exact: true });
          await recoveredRetry.waitFor(); await activate(recoveredRetry);
          await page.waitForFunction(() => document.querySelector('[data-testid="commish-ignore-sync"]')?.getAttribute('data-phase') === 'ready');
          assert.equal(ignoredService.get(accountA, taskId(alpha)).revision, lostRecord.revision, 'Lost-response recovery must not create a second write');
          assert(ignoredService.events.some(event => event.operationId === lostOperation && event.duplicate), 'Reload retry recovers the exact operation ID');
          await absent(taskId(alpha)); await peerReload(); await peerRestore(); await reload();
          syncChecks.push('A committed write with a lost response remains recoverable after reload and retries idempotently');

          syncControl.loseNextResponse = true;
          await mainIgnore(); await failedSync();
          const supersededOperation = ignoredService.events.findLast(event => event.method === 'POST' && event.status === 200).operationId;
          await peerReload(); await peerRestore();
          const tombstone = ignoredService.get(accountA, taskId(alpha));
          await retryChoice(); await failedSync();
          assert.equal(ignoredService.get(accountA, taskId(alpha)).revision, tombstone.revision);
          assert.equal(ignoredService.get(accountA, taskId(alpha)).state, 'restored');
          assert(ignoredService.events.some(event => event.operationId === supersededOperation && event.duplicate));
          assert.equal(await activePreference(taskId(alpha)), null, 'A replayed old Ignore must honor the current restore tombstone');
          await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
          assert(await (await task(taskId(alpha))).isVisible());
          syncChecks.push('An old idempotent Ignore retry returns the current tombstone and cannot resurrect restored work');

          syncControl.unauthorized = true;
          await mainIgnore(); await failedSync();
          assert.equal(ignoredService.get(accountA, taskId(alpha)).revision, tombstone.revision);
          assert.equal(await activePreference(taskId(alpha)), null);
          await dialog.getByTestId('commish-ignore-sync-error').getByText(/Sign in again/i).waitFor();
          syncControl.unauthorized = false; await retryChoice(); await dialog.waitFor({ state: 'hidden' });
          await mainRestore();
          syncChecks.push('401 keeps the task visible and retryable without a false synced result');

          syncControl.pauseNextPost = true; await mainIgnore();
          await page.waitForFunction(() => document.querySelector('[data-testid="commish-ignore-sync"]')?.getAttribute('data-phase') === 'saving');
          await browsers.expect.poll(() => !!syncControl.pendingPost).toBeTruthy();
          assert(syncControl.pendingPost, 'The service response is deliberately held');
          assert(await dialog.getByRole('button', { name: 'Ignore task', exact: true }).isDisabled());
          assert(await dialog.getByRole('textbox', { name: 'Private note', exact: true }).isDisabled());
          const postsBeforeSwitch = ignoredService.events.filter(event => event.method === 'POST').length;
          await page.evaluate(id => {
            localStorage.setItem('fw_session_v1', JSON.stringify({ token: 'isolated-task-fixture-' + id, user: { id, email: 'qa@example.invalid' } }));
            localStorage.setItem('wr_active_connection_owner_v1', 'account:' + id);
          }, accountB);
          syncControl.pendingPost.release();
          await page.waitForFunction(id => window.App?.AccountStorage?.owner?.() === 'account:' + id, accountB);
          await openOffice();
          assert.equal(await activePreference(taskId(alpha)), null, 'The old account response cannot ignore work for the newly signed-in account');
          assert.equal(ignoredService.get(accountB, taskId(alpha)), null);
          assert.equal(ignoredService.events.filter(event => event.method === 'POST').length, postsBeforeSwitch, 'Account switching must not replay the old mutation under new credentials');
          assert.equal(ignoredService.get(accountA, taskId(alpha)).state, 'ignored');
          await switchAccount(accountA, { allowSyncError: true });
          const accountRecovery = page.getByTestId('commish-ignore-sync').getByRole('button', { name: 'Retry task sync', exact: true });
          await accountRecovery.waitFor(); await activate(accountRecovery);
          await page.waitForFunction(() => document.querySelector('[data-testid="commish-ignore-sync"]')?.getAttribute('data-phase') === 'ready');
          await absent(taskId(alpha)); await mainRestore();
          syncChecks.push('Held response, disabled duplicate actions and account switch preserve both principals');
          assert.deepEqual(peerErrors, []); assert.equal(await peer.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          checkpoint('Two independent account contexts: restore propagation, cache failure,409, lost-response reload, idempotency, tombstones,401 and account-switch isolation');
          return { passed: true, contexts: ['desktop', 'independent390px touch phone'], checks: syncChecks, peerTouchChecks,
            peerPageErrors: peerErrors, blockedExternalMutations: peerBlocked.length, boundary: 'Locally fulfilled authenticated service contract; no deployed backend or physical-device claim.' };
        } finally {
          syncControl.pendingPost?.release(); peerControl.pendingPost?.release();
          syncControl.pendingBeforePost?.release(); peerControl.pendingBeforePost?.release();
          await peerContext.close();
        }
      };
      try {
        await page.goto(entry.href, { waitUntil: 'domcontentloaded' }); await openOffice(); await fit('Overview');
        const proof = await releaseProof(page); if (proof) testedRelease = proof;
        await checkLeagueMatrix();
        await season(); await expand(alpha);
        const dues = leagueCard(alpha).locator('[data-item-id="dues_noted"]').getByRole('button');
        await reachable(dues, 'Manual checklist completion'); await activate(dues);
        assert.equal(await dues.getAttribute('aria-pressed'), 'true');
        const initial = await raw(taskId(alpha)); assert.equal(initial.metric.value, 44); assert.equal(initial.tier, 'NOW');
        // A direct blocked check must lead to the relevant league/workspace;
        // clicking its Fix action never marks an automatic check complete.
        const bylaws = leagueCard(alpha).getByRole('button', { name: 'View bylaws for ' + names[alpha], exact: true });
        await reachable(bylaws, 'Blocked checklist action'); await activate(bylaws);
        await page.getByRole('navigation', { name: 'Rules views', exact: true }).getByRole('button', { name: 'Bylaws & Amendments', exact: true }).waitFor();
        assert.equal(await page.getByRole('navigation', { name: 'Rules views', exact: true }).getByRole('button', { name: 'Bylaws & Amendments', exact: true }).getAttribute('aria-current'), 'page');
        assert(await page.getByRole('button', { name: names[alpha] + ' ✕', exact: true }).isVisible(), 'Fix action keeps the relevant league scope');
        await season(); await expand(alpha);
        assert.equal(await leagueCard(alpha).locator('[data-item-id="constitution_on_file"]').getByRole('button', { name: 'View bylaws for ' + names[alpha], exact: true }).count(), 1);
        checkpoint('Scoped blocked checklist navigation preserves automatic check truth');
        await overview(); await capture('overview-task-cards'); const initialOpener = await review(taskId(alpha));
        assert(await dialog.evaluate(element => element.matches(':modal')), 'Task drawer must use native modality');
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Close');
        for (let index = 0; index < 18; index++) {
          await page.keyboard.press('Tab');
          const focused = await dialog.evaluate(element => ({ inside: element.contains(document.activeElement), modal: element.matches(':modal'), tag: document.activeElement?.tagName, documentFocused: document.hasFocus(), active: document.activeElement?.outerHTML?.slice(0, 300) }));
          if (!focused.inside) console.log(engine + ' ' + size.label + ' Tab boundary ' + index + ': ' + JSON.stringify(focused));
          assert(focused.inside || (focused.modal && ['BODY', 'HTML'].includes(focused.tag)), 'Tab must focus the modal or browser chrome, never a background page control: ' + JSON.stringify(focused));
          if (!focused.inside) {
            await page.keyboard.press('Tab');
            assert(await dialog.evaluate(element => element.contains(document.activeElement)), 'Tab from browser chrome must return to the native modal');
          }
        }
        await page.keyboard.press('Shift+Tab');
        const reverse = await dialog.evaluate(element => ({ inside: element.contains(document.activeElement), modal: element.matches(':modal'), tag: document.activeElement?.tagName }));
        assert(reverse.inside || (reverse.modal && ['BODY', 'HTML'].includes(reverse.tag)), 'Reverse Tab must never focus a background page control');
        if (!reverse.inside) {
          await page.keyboard.press('Shift+Tab');
          assert(await dialog.evaluate(element => element.contains(document.activeElement)), 'Reverse Tab from browser chrome returns to the native modal');
        }
        await dialog.getByRole('textbox', { name: 'Private note', exact: true }).fill('Retain this private task draft.');
        await page.keyboard.press('Escape');
        assert(await dialog.isVisible(), 'Escape must preserve a dirty task draft');
        assert.equal(await dialog.getByRole('textbox', { name: 'Private note', exact: true }).inputValue(), 'Retain this private task draft.');
        await dialog.getByText('Your edits are not saved.', { exact: false }).waitFor();
        const discard = dialog.getByRole('button', { name: 'Discard unsaved edits', exact: true });
        await reachable(discard, 'Discard private draft'); await activate(discard);
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => document.querySelector('.co-office')?.contains(document.activeElement), null, { timeout: 3000 }).catch(async () => {
          assert.fail('Clean Escape must return focus to Office: ' + await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 600)));
        });
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), initialOpener, 'Closing returns keyboard focus to the corresponding Review task');
        checkpoint('Native modal focus trap, dirty Escape guard, explicit discard and focus return');
        await review(taskId(alpha));
        const message = dialog.getByRole('textbox', { name: 'Message draft', exact: true });
        await message.fill('Isolated commissioner message. Nothing is sent.');
        await page.evaluate(() => { window.__qaClipboardMode = 'reject'; });
        const copyMessage = dialog.getByRole('button', { name: 'Copy message', exact: true });
        await reachable(copyMessage, 'Copy task message'); await activate(copyMessage);
        await dialog.getByText('Could not copy.', { exact: false }).waitFor();
        assert.equal(await page.evaluate(id => App.Commish.Followups.get(id).history.filter(event => event.type === 'COPIED').length, taskId(alpha)), 0);
        assert.equal(await message.inputValue(), 'Isolated commissioner message. Nothing is sent.');
        await page.evaluate(() => { window.__qaClipboardMode = 'success'; });
        await activate(copyMessage); await dialog.getByText('Message copied. Nothing was sent.', { exact: true }).waitFor();
        assert.equal(await page.evaluate(id => App.Commish.Followups.get(id).history.filter(event => event.type === 'COPIED').length, taskId(alpha)), 1);
        checkpoint('Task message copy failure retains saved text; successful clipboard confirmation records one copied event');
        syncControl.offline = true;
        const ignore = dialog.getByRole('button', { name: 'Ignore task', exact: true });
        await reachable(ignore, 'Ignore task'); await activate(ignore);
        assert(await dialog.isVisible(), 'Rejected remote write must leave the drawer open');
        assert.equal(await preference(taskId(alpha)), null, 'An offline service must not falsely mark task ignored');
        assert.equal(ignoredService.get(accountA, taskId(alpha)), null, 'No remote choice was committed');
        await dialog.getByRole('button', { name: 'Retry task sync', exact: true }).waitFor();
        await dialog.getByRole('textbox', { name: 'Private note', exact: true }).fill('Newer note written after the rejected Ignore save.');
        await capture('ignore-save-failure'); await fit('Failed task save');
        syncControl.offline = false;
        const retry = dialog.getByRole('button', { name: 'Retry task sync', exact: true });
        await page.evaluate(() => sessionStorage.setItem('qa_task_quota_failure', 'commish_followups_v1'));
        const postsBeforeDraftRetry = ignoredService.events.filter(event => event.method === 'POST').length;
        await activate(retry);
        await dialog.getByRole('alert').filter({ hasText: /follow-up.*not saved/i }).waitFor();
        assert(await dialog.isVisible(), 'An unsaved newer note must block remote retry and dismissal');
        assert.equal(await dialog.getByRole('textbox', { name: 'Private note', exact: true }).inputValue(), 'Newer note written after the rejected Ignore save.');
        assert.equal(ignoredService.events.filter(event => event.method === 'POST').length, postsBeforeDraftRetry, 'Follow-up quota failure must prevent a service write');
        await page.evaluate(() => sessionStorage.removeItem('qa_task_quota_failure'));
        await reachable(retry, 'Retry task save'); await activate(retry);
        await dialog.waitFor({ state: 'hidden' });
        assert.equal((await preference(taskId(alpha))).state, 'ignored');
        assert.equal(ignoredService.get(accountA, taskId(alpha)).state, 'ignored', 'Only a confirmed service response can finish Ignore');
        assert.equal(await page.evaluate(id => App.Commish.Followups.get(id).note, taskId(alpha)), 'Newer note written after the rejected Ignore save.', 'Retry must save the newer draft before closing the task');
        await absent(taskId(alpha)); await reload(); await absent(taskId(alpha));
        provider.state.scheduled = true;
        await reload();
        const changed = await raw(taskId(alpha)); assert.equal(changed.metric.value, 56); assert.equal(changed.tier, 'SOON');
        assert.notEqual(changed.kind, initial.kind); await absent(taskId(alpha));
        assert(await (await task(taskId(beta))).isVisible(), 'Ignoring one league cannot hide another league finding');
        await settings();
        const ignoredRows = page.getByTestId('commish-ignored-tasks');
        assert.equal(await ignoredRows.getByRole('button', { name: 'Restore', exact: true }).count(), 1);
        assert((await ignoredRows.innerText()).includes(names[alpha]));
        await ignoredRows.scrollIntoViewIfNeeded(); await ignoredRows.evaluate(element => element.scrollIntoView({ block: 'center' }));
        await fit('Ignored task Settings'); await capture('ignored-task-settings');
        const restore = ignoredRows.getByRole('button', { name: 'Restore', exact: true });
        await reachable(restore, 'Restore ignored task'); await activate(restore);
        await restore.waitFor({ state: 'hidden' });
        assert.equal(await preference(taskId(alpha)), null);
        await overview(); assert(await (await task(taskId(alpha))).isVisible());
        checkpoint('Offline Ignore and newer-note quota rejection block false success; confirmed retry, reload persistence, changed finding, league isolation and Settings restore');
        await review(taskId(alpha));
        const done = dialog.getByRole('button', { name: '✓ Mark done', exact: true });
        await reachable(done, 'Mark task done'); await activate(done); await dialog.waitFor({ state: 'hidden' });
        assert.equal((await preference(taskId(alpha))).state, 'done'); await reload(); await absent(taskId(alpha));
        provider.state.scheduled = false; await reload();
        assert(await (await task(taskId(alpha))).isVisible(), 'Done returns when the underlying metric/urgency changes');
        await review(taskId(alpha));
        assert.equal(await dialog.getByRole('button', { name: 'Restore', exact: true }).count(), 0, 'Returned changed work must not stay trapped in the stale Done disposition');
        assert(await dialog.getByRole('button', { name: 'Ignore task', exact: true }).isVisible());
        await activate(dialog.getByRole('button', { name: 'Ignore task', exact: true })); await dialog.waitFor({ state: 'hidden' });
        const savedA = await page.evaluate(() => localStorage.getItem(App.AccountStorage.key('commish_prefs_v1')));
        await switchAccount('10000000-0000-4000-8000-000000000002');
        assert.equal(await preference(taskId(alpha)), null);
        assert(await (await task(taskId(alpha))).isVisible()); assert(await (await task(taskId(beta))).isVisible());
        await review(taskId(beta)); await activate(dialog.getByRole('button', { name: 'Ignore task', exact: true })); await dialog.waitFor({ state: 'hidden' });
        const savedB = await page.evaluate(() => localStorage.getItem(App.AccountStorage.key('commish_prefs_v1')));
        await switchAccount('10000000-0000-4000-8000-000000000001'); await absent(taskId(alpha)); assert(await (await task(taskId(beta))).isVisible());
        assert.equal(await page.evaluate(() => localStorage.getItem(App.AccountStorage.key('commish_prefs_v1'))), savedA);
        assert.notEqual(savedA, savedB);
        checkpoint('Done returns on changed finding; A→B→A preserves separate account and league choices');
        // Make the ignored finding disappear naturally from public data.
        // Its Settings recovery row must survive, without manufacturing work.
        provider.state.complete = true; await reload();
        await season();
        for (const id of [alpha, beta]) {
          await expand(id);
          for (const itemId of ['dues_noted', 'rules_reratified', 'welcome_drafted']) {
            const control = leagueCard(id).locator('[data-item-id="' + itemId + '"]').getByRole('button');
            if (await control.getAttribute('aria-pressed') !== 'true') { await reachable(control, 'Complete checklist ' + itemId); await activate(control); }
          }
        }
        // A real settings change must be ratified, not erased from storage.
        await workspace(/^Season & Schedule/);
        await activate(page.getByRole('navigation', { name: 'Season & Schedule views', exact: true }).getByRole('button', { name: 'Calendar & Operations', exact: true }));
        const ratify = page.getByRole('button', { name: 'Acknowledge & ratify', exact: true });
        for (let remaining = await ratify.count(); remaining > 0; remaining--) {
          await reachable(ratify.first(), 'Ratify changed settings'); await activate(ratify.first());
          await page.waitForFunction(previous => [...document.querySelectorAll('.co-office button')].filter(button => button.textContent.trim() === 'Acknowledge & ratify').length < previous, remaining);
        }
        await season();
        await page.getByText('Every league is opening-day ready.', { exact: false }).waitFor();
        assert.equal(await page.getByTestId('genesis-league').count(), 2, '100% checklists remain reachable');
        await expand(alpha);
        const completedDues = leagueCard(alpha).locator('[data-item-id="dues_noted"]').getByRole('button');
        assert.equal(await completedDues.getAttribute('aria-pressed'), 'true');
        await reachable(completedDues, 'Reopen completed checklist item'); await activate(completedDues);
        assert.equal(await completedDues.getAttribute('aria-pressed'), 'false'); await activate(completedDues);
        await reload(); await season(); await expand(alpha);
        assert.equal(await leagueCard(alpha).locator('[data-item-id="dues_noted"]').getByRole('button').getAttribute('aria-pressed'), 'true');
        await page.getByText('Every league is opening-day ready.', { exact: false }).waitFor();
        assert(provider.reads.some(read => read.kind === 'league-docs' && read.complete), '100% uses real docs API response fixture');
        await capture('completed-checklist'); await fit('Completed Season Setup');
        await settings();
        await page.getByTestId('commish-ignored-tasks').getByText('Not present in the latest league data.', { exact: false }).waitFor();
        const missingRestore = page.getByTestId('commish-ignored-tasks').getByRole('button', { name: 'Restore', exact: true });
        await activate(missingRestore); await missingRestore.waitFor({ state: 'hidden' });
        assert(!['ignored', 'hidden'].includes((await preference(taskId(alpha)))?.state));
        assert.equal(await raw(taskId(alpha)), null, 'Restore never fabricates a resolved provider finding');
        checkpoint('All100% checklists remain editable across reload; missing ignored findings remain recoverable in Settings');
        await workspace(/^Season & Schedule/);
        await activate(page.getByRole('navigation', { name: 'Season & Schedule views', exact: true }).getByRole('button', { name: 'Schedule Builder', exact: true }));
        const generate = page.getByRole('button', { name: 'Generate schedule', exact: true });
        await reachable(generate, 'Generate schedule'); await activate(generate);
        const copyText = page.getByRole('button', { name: 'Copy as text', exact: true });
        await copyText.waitFor(); await page.evaluate(() => { window.__qaClipboardMode = 'pending'; });
        await reachable(copyText, 'Copy schedule text'); await activate(copyText);
        await page.waitForFunction(() => typeof window.__qaClipboardResolve === 'function');
        assert.equal(await page.getByTestId('commish-copy-success').count(), 0, 'Pending clipboard write cannot claim copied');
        await overview(); await page.evaluate(async () => { window.__qaClipboardResolve(); await new Promise(resolve => setTimeout(resolve, 50)); });
        assert.equal(await page.getByTestId('commish-copy-success').count(), 0, 'Old clipboard completion cannot claim success in a different workspace');
        assert.equal(await page.getByRole('dialog', { name: 'Copy manually', exact: true }).count(), 0, 'Old clipboard completion cannot open a modal in a different workspace');
        await workspace(/^Season & Schedule/);
        await activate(page.getByRole('navigation', { name: 'Season & Schedule views', exact: true }).getByRole('button', { name: 'Schedule Builder', exact: true }));
        await page.evaluate(() => { delete window.__qaClipboardResolve; }); await activate(copyText);
        await page.waitForFunction(() => typeof window.__qaClipboardResolve === 'function');
        await page.evaluate(() => window.__qaClipboardResolve());
        await page.getByTestId('commish-copy-success').getByText('Schedule text copied.', { exact: true }).waitFor();
        await page.evaluate(() => { window.__qaClipboardMode = 'reject'; }); await activate(copyText);
        const manual = page.getByRole('dialog', { name: 'Copy manually', exact: true });
        await manual.waitFor(); assert(await manual.evaluate(element => element.matches(':modal')));
        const text = manual.getByRole('textbox', { name: 'Schedule text', exact: true });
        assert(await text.inputValue()); assert.equal(await text.getAttribute('readonly'), '');
        assert.equal(await page.getByTestId('commish-copy-success').count(), 0, 'Rejected clipboard clears any old success claim');
        const selectAll = manual.getByRole('button', { name: 'Select all text', exact: true });
        await reachable(selectAll, 'Select manual copy text'); await activate(selectAll);
        assert(await text.evaluate(element => element.selectionStart === 0 && element.selectionEnd === element.value.length));
        await fit('Manual clipboard fallback'); await capture('manual-copy');
        await page.keyboard.press('Escape'); await manual.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Copy as text', null, { timeout: 3000 });
        await page.evaluate(() => { window.__qaClipboardMode = 'unavailable'; });
        const copyCSV = page.getByRole('button', { name: 'Copy as CSV', exact: true });
        await reachable(copyCSV, 'Copy schedule CSV'); await activate(copyCSV); await manual.waitFor();
        const csv = manual.getByRole('textbox', { name: 'Schedule CSV', exact: true });
        assert((await csv.inputValue()).includes(','));
        await reachable(manual.getByRole('button', { name: 'Close', exact: true }), 'Close manual copy');
        await activate(manual.getByRole('button', { name: 'Close', exact: true })); await manual.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Copy as CSV', null, { timeout: 3000 });
        checkpoint('Clipboard pending/success confirmation and workspace invalidation; rejected and unavailable clipboard expose selectable manual text/CSV fallback');
        if (size.label === 'desktop') crossDeviceProof = await checkCrossDevice();
        await releaseProof(page);
        await fit('Final schedule'); assert.deepEqual(errors, [], 'No page errors');
        results.push({ label: size.label, viewport: { width: size.width, height: size.height }, touch: size.touch,
          passed: true, checks, touchChecks, matrixChecks, crossDeviceProof, serviceFixtureEvents: ignoredService.events, blockedExternalMutations: blocked.length, pageErrors: errors });
        persist(); console.log(engine + ' ' + size.label + ' PASS (' + checks.length + ' journeys; ' + blocked.length + ' external writes blocked)');
      } catch (error) {
        await capture('failure').catch(() => {});
        results.push({ label: size.label, passed: false, checks, touchChecks, matrixChecks, crossDeviceProof, serviceFixtureEvents: ignoredService.events, blockedExternalMutations: blocked.length, pageErrors: errors,
          error: error.stack || String(error) }); persist(); throw error;
      } finally {
        await context.close();
        console.log(engine + ' ' + size.label + ' context closed');
      }
    }
  } finally { await browser.close(); }
  console.log(engine + ' task acceptance PASS; browser closed.');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
