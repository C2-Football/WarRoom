'use strict';
// Real app, isolated provider fixtures. External writes are blocked before navigation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const browsers = require('@playwright/test');
const browserName = process.env.COMMISH_BROWSER || 'chromium';
assert(['chromium', 'webkit'].includes(browserName), 'COMMISH_BROWSER must be chromium or webkit');
const { installReadOnlyRoutes } = require('./helpers/browser-readonly.cjs');
const { createLeagueSkinFixture } = require('./helpers/league-skin-fixture.cjs');
const output = path.resolve(process.env.COMMISH_POLISH_OUTPUT || path.join(__dirname, '../output/playwright/commish-polish'));
// The release runner supplies an isolated origin and uses the compiled app.
const previewOrigin = process.env.READINESS_PREVIEW_ORIGIN || 'http://127.0.0.1:3025';
const entry = new URL(process.env.COMMISH_POLISH_URL || process.env.READINESS_PREVIEW_URL
  || process.env.READINESS_PREVIEW_PATH || '/dist-preview/', previewOrigin);
entry.searchParams.set('dev', 'true');
entry.searchParams.set('user', 'readiness-fixture');
const allSizes = [
  { label: 'phone-small', width: 320, height: 700, touch: true },
  { label: 'phone', width: 390, height: 844, touch: true },
  { label: 'phone-landscape', width: 844, height: 390, touch: true },
  { label: 'ipad-portrait', width: 768, height: 1024, touch: true },
  { label: 'ipad-landscape', width: 1024, height: 768, touch: true },
  { label: 'desktop', width: 1440, height: 1000, touch: false },
];
const requestedSizes = process.env.COMMISH_SIZES?.split(',').map(value => value.trim()).filter(Boolean);
const sizes = requestedSizes ? allSizes.filter(size => requestedSizes.includes(size.label)) : allSizes;
assert(sizes.length && (!requestedSizes || sizes.length === requestedSizes.length), 'COMMISH_SIZES must contain valid unique viewport labels');
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await browsers[browserName].launch({ headless: true, ...(browserName === 'chromium' ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : process.env.PLAYWRIGHT_WEBKIT_PATH ? { executablePath: process.env.PLAYWRIGHT_WEBKIT_PATH } : {}) });
  const results = [];
  try {
    for (const size of sizes) {
      const viewport = { width: size.width, height: size.height };
      const context = await browser.newContext({ viewport, hasTouch: size.touch });
      const provider = createLeagueSkinFixture({ redraftId: 'qa-redraft', dynastyId: 'qa-dynasty', user: 'readiness-fixture' });
      const blocked = await installReadOnlyRoutes(context, { fixture: url => {
        const value = provider(url);
        return url.pathname.endsWith('/users') && Array.isArray(value) ? value.map((row, i) => ({ ...row, is_owner: i === 0 })) : value;
      } });
      // A failed provider week must remain unknown, even if other weeks return [].
      let activityUnavailable = true;
      const failedActivityReads = [];
      await context.route('**/league/*/transactions/*', route => {
        const url = new URL(route.request().url());
        if (activityUnavailable && url.pathname.endsWith('/transactions/0')) {
          failedActivityReads.push(url.pathname);
          return route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"Isolated transaction outage"}' });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '[]' });
      });
      await context.addInitScript(() => {
        localStorage.setItem('fw_session_v1', JSON.stringify({ token: 'isolated-browser-fixture', user: { id: 'isolated-browser-fixture', email: 'qa@example.invalid' } }));
        localStorage.setItem('od_auth_v1', JSON.stringify({ username: 'readiness-fixture' }));
        localStorage.setItem('od_profile_v1', JSON.stringify({ onboardingComplete: true }));
        localStorage.setItem('wr_active_connection_owner_v1', 'account:isolated-browser-fixture');
        // Throw only for durable schedule writes. Session recovery stays available,
        // matching a real localStorage quota rejection; the flag survives reload.
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (this === localStorage && String(key).includes('wr_commish_schedule_') && sessionStorage.getItem('qa_schedule_quota_failure') === 'true') {
            throw new DOMException('Isolated schedule storage quota failure', 'QuotaExceededError');
          }
          return setItem.call(this, key, value);
        };
      });
      const page = await context.newPage();
      const errors = [], touchChecks = [];
      const activate = locator => size.touch ? locator.tap() : locator.click();
      page.on('pageerror', error => errors.push(error.message));
      const capture = async (filename, fullPage = !size.touch) => {
        // Current Chromium full-page capture disables touch emulation. Capture
        // the actual touch viewport while the interaction journey is active.
        await page.screenshot({ path: path.join(output, filename), fullPage });
        if (size.touch) assert.equal(await page.evaluate(() => matchMedia('(pointer:coarse)').matches && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)), true, 'Screenshots must preserve touch input mode');
      };
      const fit = async label => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ' should fit the viewport');
      const reachable = async (locator, label) => {
        await locator.scrollIntoViewIfNeeded();
        // Centering avoids a fixed dock covering a control near the viewport edge.
        await locator.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' }));
        const hit = await locator.evaluate(el => {
          const rect = el.getBoundingClientRect();
          const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return { width: rect.width, height: rect.height, reachable: el === target || el.contains(target), minHeight: getComputedStyle(el).minHeight, pointerCoarse: matchMedia('(pointer:coarse)').matches, innerWidth, maxTouchPoints: navigator.maxTouchPoints, touchEvents: 'ontouchstart' in window };
        });
        assert(hit.reachable, label + ' must be reachable after scrolling');
        if (size.touch) {
          assert(hit.pointerCoarse && (hit.maxTouchPoints > 0 || hit.touchEvents), label + ' must be tested with active touch emulation');
          assert(hit.width >= 44 && hit.height >= 44, label + ' must provide a 44px touch target: ' + JSON.stringify(hit));
        }
        touchChecks.push({ control: label, ...hit });
      };
      const openOffice = async () => {
        await page.locator('.hub-experience-card.commish-hero').click({ timeout: 60000 });
        await page.getByRole('group', { name: 'Filter by priority', exact: true }).waitFor({ timeout: 60000 });
      };
      const workspace = async name => {
        await page.locator('.co-workspace-trigger, nav[aria-label="Commissioner workspaces"]').first().waitFor({ state: 'visible', timeout: 60000 });
        const trigger = page.getByRole('button', { name: /^Workspaces/ });
        if (await trigger.isVisible()) await activate(trigger);
        await activate(page.getByRole('navigation', { name: 'Commissioner workspaces', exact: true }).getByRole('button', { name }).first());
      };
      const showSchedule = async () => {
        await workspace(/^Season & Schedule/);
        await page.getByRole('navigation', { name: 'Season & Schedule views', exact: true }).getByRole('button', { name: 'Schedule Builder', exact: true }).click();
        await page.getByRole('button', { name: 'QA Dynasty With IDP', exact: true }).click();
        await page.getByLabel('Weeks', { exact: true }).waitFor();
      };
      const durableSchedule = () => page.evaluate(() => App.AccountStorage.get(App.WR_KEYS.COMMISH_SCHEDULE('qa-dynasty'), null));
      const visibleWeeks = () => page.getByText(/^WEEK \d+$/, { exact: true }).count();
      await page.goto(entry.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await openOffice();
      assert.equal(await page.getByTestId('commish-session-warning').count(), 0, 'Signed-in fixture must retain save authority');
      await fit('Overview');
      const priorities = page.getByRole('group', { name: 'Filter by priority', exact: true });
      assert.equal(await priorities.getByRole('button', { name: /Now/ }).getAttribute('aria-pressed'), 'true');
      await priorities.getByRole('button', { name: /Soon/ }).click();
      assert.equal(await priorities.getByRole('button', { name: /Soon/ }).getAttribute('aria-pressed'), 'true');
      await priorities.getByRole('button', { name: /Now/ }).click();
      await page.getByTestId('commish-activity-warning').waitFor();
      assert(failedActivityReads.length >= 2, 'Both commissioned leagues must exercise a failed transaction week');
      await capture('after-overview-' + size.label + '.png');
      const review = page.getByRole('button', { name: /^Review QA Dynasty With IDP has no draft/ });
      await review.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('dialog', { name: 'Action', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('button', { name: /^schedule$/i }).first().click();
      await page.getByRole('button', { name: 'QA Dynasty With IDP ✕', exact: true }).waitFor();
      await page.getByRole('navigation', { name: 'Season & Schedule views', exact: true }).waitFor();
      await fit('Scoped season workspace');
      await page.getByRole('navigation', { name: 'Season & Schedule views', exact: true }).getByRole('button', { name: 'Schedule Builder', exact: true }).click();
      await page.getByLabel('Weeks', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'QA Dynasty With IDP', exact: true }).getAttribute('aria-pressed'), 'true', 'Task handoff must select its actual schedule league');

      // Missing transaction evidence is visible and produces no invented inactivity.
      await workspace(/^People & Dues/);
      const allPeople = page.getByRole('button', { name: /^All people/ });
      if (await allPeople.isVisible()) await allPeople.click();
      const unknown = page.getByText('Activity unavailable', { exact: true });
      await unknown.first().waitFor();
      assert.equal(await unknown.count(), 6, 'Every healthy manager has unknown activity when one requested week fails');
      assert.equal(await page.getByRole('button', { name: /Copy check-in/i }).count(), 0, 'Unavailable activity must not invent a check-in');
      await fit('Unknown manager activity');
      await capture('activity-unavailable-' + size.label + '.png');
      const retryActivity = page.getByRole('button', { name: 'Retry activity', exact: true });
      await reachable(retryActivity, 'Retry activity');
      activityUnavailable = false;
      await activate(retryActivity);
      await page.getByTestId('commish-activity-warning').waitFor({ state: 'hidden', timeout: 60000 });
      await page.locator('.co-people').waitFor({ state: 'visible', timeout: 60000 });
      assert.equal(await page.getByTestId('commish-activity-warning').count(), 0, 'Activity retry must obtain complete provider evidence');

      // A committed plan is isolated to the selected league and survives reload.
      await showSchedule();
      const generate = page.getByRole('button', { name: 'Generate schedule', exact: true });
      await reachable(generate, 'Generate schedule');
      await activate(generate);
      await page.getByTestId('commish-schedule-save-state').filter({ hasText: 'Saved in this browser' }).waitFor();
      assert.equal(await visibleWeeks(), 5);
      const originalSaved = await durableSchedule();
      assert.equal(originalSaved.schedule.length, 5);
      assert.equal(await page.evaluate(() => App.AccountStorage.get(App.WR_KEYS.COMMISH_SCHEDULE('qa-redraft'), null)), null, 'Generating dynasty schedule must not write redraft plan');
      await fit('Saved schedule');
      await capture('schedule-saved-' + size.label + '.png');

      // Quota failure retains edited plan but must preserve the last durable save.
      await page.evaluate(() => sessionStorage.setItem('qa_schedule_quota_failure', 'true'));
      await page.getByLabel('Weeks', { exact: true }).fill('4');
      await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
      await page.getByTestId('commish-schedule-save-state').filter({ hasText: 'Unsaved schedule changes' }).waitFor();
      assert.equal(await visibleWeeks(), 4, 'Failed save must retain generated plan on screen');
      assert.deepEqual(await durableSchedule(), originalSaved, 'Quota rejection must preserve last durable schedule');
      await fit('Unsaved schedule');
      await capture('schedule-quota-failure-' + size.label + '.png');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await openOffice();
      await showSchedule();
      await page.getByTestId('commish-schedule-save-state').filter({ hasText: 'Unsaved schedule changes' }).waitFor();
      assert.equal(await visibleWeeks(), 4, 'Session recovery must restore unsaved plan after reload');
      assert.equal(await page.getByLabel('Weeks', { exact: true }).inputValue(), '4');
      assert.deepEqual(await durableSchedule(), originalSaved, 'Reload must not overwrite durable plan while storage is blocked');
      await page.evaluate(() => sessionStorage.removeItem('qa_schedule_quota_failure'));
      const retrySave = page.getByTestId('commish-schedule-save-state').getByRole('button', { name: 'Retry save', exact: true });
      await reachable(retrySave, 'Retry schedule save');
      await activate(retrySave);
      await page.getByTestId('commish-schedule-save-state').filter({ hasText: 'Saved in this browser' }).waitFor();
      const recoveredSaved = await durableSchedule();
      assert.equal(recoveredSaved.schedule.length, 4);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await openOffice();
      await showSchedule();
      await page.getByTestId('commish-schedule-save-state').filter({ hasText: 'Saved in this browser' }).waitFor();
      assert.deepEqual(await durableSchedule(), recoveredSaved, 'Retried plan must remain identical after reload');
      assert.equal(await visibleWeeks(), 4);
      await page.getByRole('button', { name: 'QA Empty Redraft', exact: true }).click();
      await page.getByRole('button', { name: 'Generate schedule', exact: true }).waitFor();
      assert.equal(await visibleWeeks(), 0, 'Other league must remain unplanned');
      await page.getByRole('button', { name: 'QA Dynasty With IDP', exact: true }).click();
      await page.getByRole('button', { name: 'Regenerate', exact: true }).waitFor();
      assert.equal(await visibleWeeks(), 4, 'Switching leagues must restore selected league plan');

      const workspaces = page.getByRole('button', { name: /^Workspaces/ });
      if (await workspaces.isVisible()) {
        await reachable(workspaces, 'Workspace menu');
        await activate(workspaces);
        await page.getByRole('dialog', { name: 'Commissioner menu', exact: true }).waitFor({ state: 'visible' });
        await capture('after-menu-' + size.label + '.png', false);
        await page.keyboard.press('Escape');
        await page.getByRole('dialog', { name: 'Commissioner menu', exact: true }).waitFor({ state: 'hidden' });
        assert.equal(await workspaces.getAttribute('aria-expanded'), 'false');
        assert.equal(await workspaces.evaluate(el => el === document.activeElement), true, 'Menu returns keyboard focus');
      }
      await workspace(/^Rules/);
      const rules = page.getByRole('navigation', { name: 'Rules views', exact: true });
      await rules.waitFor();
      assert.equal(await rules.getByRole('button', { name: 'Rule Lab', exact: true }).getAttribute('aria-current'), 'page');
      await fit('Rule Lab');
      await capture('after-rules-' + size.label + '.png');
      await rules.getByRole('button', { name: 'Bylaws & Amendments', exact: true }).click();
      assert.equal(await rules.getByRole('button', { name: 'Bylaws & Amendments', exact: true }).getAttribute('aria-current'), 'page');
      await fit('Bylaws');
      const hub = page.getByRole('button', { name: '‹ Hub', exact: true });
      await reachable(hub, 'Return to Hub');
      await activate(hub);
      await page.locator('.hub-experience-card.commish-hero').waitFor();
      assert.deepEqual(errors, [], 'No uncaught browser errors');
      results.push({ browser: browserName, viewport, label: size.label, touch: size.touch, passed: true, checked: ['priority filters', 'native keyboard task review', 'task league scope', 'unavailable transaction evidence', 'activity retry', 'schedule save/reload', 'schedule quota failure', 'unsaved schedule reload recovery', 'schedule save retry', 'per-league plan isolation', 'workspace navigation', 'menu focus recovery', 'rule view selection', 'hub return', 'no horizontal overflow'], touchChecks, externalWriteGuard: true, blockedRequests: blocked.length });
      await context.close();
      console.log('PASS ' + browserName + ' Commissioner recovery, activity, navigation and layout ' + size.label + ' ' + viewport.width + '×' + viewport.height);
    }
    // A connected public Sleeper username is not an app-account session.
    // Verify that this common view-only path explains why saves need sign-in.
    const viewOnlyContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const viewOnlyProvider = createLeagueSkinFixture({ redraftId: 'qa-redraft', dynastyId: 'qa-dynasty', user: 'readiness-fixture' });
    await installReadOnlyRoutes(viewOnlyContext, { fixture: url => {
      const value = viewOnlyProvider(url);
      return url.pathname.endsWith('/users') && Array.isArray(value) ? value.map((row, i) => ({ ...row, is_owner: i === 0 })) : value;
    } });
    let viewOnlyActivityUnavailable = true;
    await viewOnlyContext.route('**/league/*/transactions/*', route => {
      const failed = viewOnlyActivityUnavailable && new URL(route.request().url()).pathname.endsWith('/transactions/0');
      return route.fulfill({ status: failed ? 503 : 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: failed ? '{"error":"Isolated view-only transaction outage"}' : '[]' });
    });
    await viewOnlyContext.addInitScript(() => {
      localStorage.setItem('od_auth_v1', JSON.stringify({ username: 'readiness-fixture' }));
      localStorage.setItem('od_profile_v1', JSON.stringify({ onboardingComplete: true }));
    });
    const viewOnlyPage = await viewOnlyContext.newPage();
    await viewOnlyPage.goto(entry.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await viewOnlyPage.locator('.hub-experience-card.commish-hero').click({ timeout: 60000 });
    const sessionWarning = viewOnlyPage.getByTestId('commish-session-warning');
    await sessionWarning.waitFor({ timeout: 60000 });
    assert.match(await sessionWarning.textContent(), /View-only Sleeper connection/);
    assert.match(await sessionWarning.getByRole('link', { name: 'Sign in to save plans', exact: true }).getAttribute('href'), /login\.html$/);
    assert.equal(await viewOnlyPage.evaluate(() => App.AccountStorage.owner()), null);
    await viewOnlyPage.getByTestId('commish-activity-warning').waitFor({ timeout: 60000 });
    viewOnlyActivityUnavailable = false;
    await viewOnlyPage.getByRole('button', { name: 'Retry activity', exact: true }).click();
    await viewOnlyPage.getByTestId('commish-activity-warning').waitFor({ state: 'hidden', timeout: 60000 });
    await viewOnlyPage.getByRole('group', { name: 'Filter by priority', exact: true }).waitFor({ timeout: 60000 });
    assert.equal(await viewOnlyPage.getByTestId('commish-activity-warning').count(), 0, 'View-only connection must be allowed to retry public activity reads');
    assert.equal(await viewOnlyPage.getByTestId('commish-session-warning').count(), 1, 'Public read retry must retain the view-only save explanation');
    assert.deepEqual(await viewOnlyPage.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('wr_account_v1:'))), [], 'View-only public reads must not write account-private planning records');
    await viewOnlyPage.screenshot({ path: path.join(output, 'view-only-connection-desktop.png'), fullPage: true });
    await viewOnlyContext.close();
    console.log('PASS ' + browserName + ' Commissioner public username view-only session explanation');
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify({ browser: browserName, target: entry.origin + entry.pathname, viewOnlyConnection: { passed: true, checked: ['public Sleeper username has no app-account save authority', 'view-only explanation visible', 'sign-in link visible', 'view-only public activity retry', 'no account-private planning writes'] }, captureMethod: 'Touch journeys use viewport screenshots because current Chromium full-page capture resets touch emulation. Coarse pointer and touch-event capability are asserted after every capture and before touch-target checks; touch points are recorded (macOS WebKit reports zero with touch enabled). Primary controls are activated by touchscreen taps in touch contexts.', evidence: 'Actual ' + browserName + ' browser engine; synthetic provider/session fixtures; external writes blocked. Touch emulation is not physical iPad/phone or real hosted authentication evidence.', results }, null, 2) + '\n');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
