'use strict';
// Real app, isolated provider fixtures. External writes are blocked before navigation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { installReadOnlyRoutes } = require('./helpers/browser-readonly.cjs');
const { createLeagueSkinFixture } = require('./helpers/league-skin-fixture.cjs');
const output = path.resolve(__dirname, '../output/playwright/commish-polish');
// The release runner supplies an isolated origin and uses the compiled app.
// Override PATH with '/' for a compile-enabled dev server, or URL with the
// exact application entry point for a read-only post-deployment check.
const previewOrigin = process.env.READINESS_PREVIEW_ORIGIN || 'http://127.0.0.1:3025';
const entry = new URL(process.env.COMMISH_POLISH_URL || process.env.READINESS_PREVIEW_URL
  || process.env.READINESS_PREVIEW_PATH || '/dist-preview/', previewOrigin);
entry.searchParams.set('dev', 'true');
entry.searchParams.set('user', 'readiness-fixture');
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const results = [];
  try {
    for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 1000 }]) {
      const context = await browser.newContext({ viewport });
      const provider = createLeagueSkinFixture({ redraftId: 'qa-redraft', dynastyId: 'qa-dynasty', user: 'readiness-fixture' });
      const blocked = await installReadOnlyRoutes(context, { fixture: url => {
        const value = provider(url);
        return url.pathname.endsWith('/users') && Array.isArray(value) ? value.map((row, i) => ({ ...row, is_owner: i === 0 })) : value;
      } });
      await context.addInitScript(() => {
        localStorage.setItem('fw_session_v1', JSON.stringify({ token: 'isolated-browser-fixture', user: { id: 'isolated-browser-fixture', email: 'qa@example.invalid' } }));
        localStorage.setItem('od_auth_v1', JSON.stringify({ username: 'readiness-fixture' }));
        localStorage.setItem('od_profile_v1', JSON.stringify({ onboardingComplete: true }));
        localStorage.setItem('wr_active_connection_owner_v1', 'account:isolated-browser-fixture');
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(entry.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.locator('.hub-experience-card.commish-hero').click({ timeout: 60000 });
      await page.getByRole('group', { name: 'Filter by priority', exact: true }).waitFor({ timeout: 60000 });
      const fit = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'page should fit the viewport');
      await fit();
      const priorities = page.getByRole('group', { name: 'Filter by priority', exact: true });
      assert.equal(await priorities.getByRole('button', { name: /Now/ }).getAttribute('aria-pressed'), 'true');
      await priorities.getByRole('button', { name: /Soon/ }).click();
      assert.equal(await priorities.getByRole('button', { name: /Soon/ }).getAttribute('aria-pressed'), 'true');
      await priorities.getByRole('button', { name: /Now/ }).click();
      await page.screenshot({ path: path.join(output, 'after-overview-' + viewport.width + '.png'), fullPage: true });
      const review = page.getByRole('button', { name: /^Review QA Dynasty With IDP has no draft/ });
      await review.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('dialog', { name: 'Action', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('button', { name: /^schedule$/i }).first().click();
      await page.getByRole('button', { name: 'QA Dynasty With IDP ✕', exact: true }).waitFor();
      await page.getByRole('navigation', { name: 'Season & Schedule views', exact: true }).waitFor();
      await fit();
      const workspaces = page.getByRole('button', { name: /^Workspaces/ });
      if (await workspaces.isVisible()) {
        await workspaces.click();
        await page.getByRole('dialog', { name: 'Commissioner menu', exact: true }).waitFor({ state: 'visible' });
        if (viewport.width === 390) await page.screenshot({ path: path.join(output, 'after-menu-390.png') });
        await page.keyboard.press('Escape');
        await page.getByRole('dialog', { name: 'Commissioner menu', exact: true }).waitFor({ state: 'hidden' });
        assert.equal(await workspaces.getAttribute('aria-expanded'), 'false');
        await page.waitForFunction(() => document.activeElement?.classList.contains('co-workspace-trigger'), null, { timeout: 5000 });
        assert.equal(await workspaces.evaluate(el => el === document.activeElement), true, 'menu returns keyboard focus');
        await workspaces.click();
      }
      await page.getByRole('navigation', { name: 'Commissioner workspaces', exact: true }).getByRole('button', { name: /^Rules/ }).click();
      const rules = page.getByRole('navigation', { name: 'Rules views', exact: true });
      await rules.waitFor();
      assert.equal(await rules.getByRole('button', { name: 'Rule Lab', exact: true }).getAttribute('aria-current'), 'page');
      await fit();
      await page.screenshot({ path: path.join(output, 'after-rules-' + viewport.width + '.png'), fullPage: true });
      await rules.getByRole('button', { name: 'Bylaws & Amendments', exact: true }).click();
      assert.equal(await rules.getByRole('button', { name: 'Bylaws & Amendments', exact: true }).getAttribute('aria-current'), 'page');
      await fit();
      await page.getByRole('button', { name: '‹ Hub', exact: true }).click();
      await page.locator('.hub-experience-card.commish-hero').waitFor();
      assert.deepEqual(errors, [], 'no uncaught browser errors');
      results.push({ viewport, passed: true, checked: ['priority filters', 'native keyboard task review', 'correct task league scope', 'workspace navigation', 'menu focus recovery', 'rule view selection', 'hub return', 'no horizontal overflow'], externalWriteGuard: true, blockedRequests: blocked.length });
      await context.close();
      console.log('PASS Commissioner overview, task handoff, rules and navigation ' + viewport.width + '×' + viewport.height);
    }
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify({ target: entry.origin + entry.pathname, evidence: 'Actual browser; synthetic provider fixtures; external writes blocked. This does not prove hosted auth or native-device behavior.', results }, null, 2) + '\n');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
