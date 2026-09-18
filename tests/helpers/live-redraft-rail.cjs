'use strict';
const assert = require('node:assert/strict');
const { installReadOnlyRoutes } = require('./browser-readonly.cjs');
const { createLeagueSkinFixture } = require('./league-skin-fixture.cjs');
async function verifyLiveRedraftRail(browser, baseUrl, basePath = '/dist-preview/') {
  const context = await browser.newContext();
  const redraftId = 'qa-live-redraft', dynastyId = 'qa-live-dynasty', user = 'qa_live_draft';
  await installReadOnlyRoutes(context, { fixture: createLeagueSkinFixture({ redraftId, dynastyId, user }) });
  await context.addInitScript(username => {
    localStorage.setItem('dynastyhq_username', username);
    localStorage.setItem('wr_tutorial_done_v1', '1');
  }, user);
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1365, height: 900 });
    await page.goto(`${baseUrl}${basePath}?dev=true&user=${user}#league=${redraftId}&tab=draft`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.App?.LI_LOADED === true, null, { timeout: 45000 });
    await page.getByRole('button', { name: 'Follow Live Draft', exact: true }).click();
    const rail = page.locator('.mock-draft-cockpit.is-live-redraft .mock-draftcast-rail');
    await rail.waitFor({ state: 'visible', timeout: 30000 });
    await page.setViewportSize({ width: 900, height: 900 });
    for (const width of [842, 600]) {
      // A tablet-width shell and a narrower embedded panel must both stack.
      // Keep the real live redraft renderer mounted; phones have their own UI.
      await page.locator('.mock-draft-cockpit.is-live-redraft').evaluate((element, size) => { element.style.width = `${size}px`; }, width);
      await page.waitForTimeout(250);
      const state = await rail.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const controls = [...element.querySelectorAll('.mock-cast-controls button')].map(button => ({ text: button.innerText, rect: button.getBoundingClientRect().toJSON() }));
        return { columns: getComputedStyle(element).gridTemplateColumns.split(' ').length, width: rect.width, left: rect.left, right: rect.right, viewport: innerWidth, controls };
      });
      assert.equal(state.columns, 1, `live redraft@${width} must stack in its narrow container`);
      assert(state.left >= -2 && state.right <= state.viewport + 2, `live redraft rail@${width} exceeds viewport`);
      for (const label of ['Manual Pick', 'View teams', 'Exit']) {
        const control = state.controls.find(item => item.text === label);
        assert(control, `live redraft@${width} missing ${label}`);
        assert(control.rect.width > 0 && control.rect.left >= state.left - 2 && control.rect.right <= state.right + 2, `live redraft@${width} clips ${label}`);
      }
    }
    await page.setViewportSize({ width: 320, height: 740 });
    const room = page.locator('.la-view-select').filter({ hasText: 'Live room' }).locator('select');
    await room.waitFor({ state: 'visible' });
    await room.selectOption('teams');
    await page.getByText('QA Team 1', { exact: true }).first().waitFor({ state: 'visible' });
    await room.selectOption('board');
    const draftButton = page.getByRole('button', { name: 'DRAFT', exact: true }).first();
    await draftButton.scrollIntoViewIfNeeded();
    const box = await draftButton.boundingBox();
    assert(box && box.x >= -2 && box.x + box.width <= 322, 'live redraft@320 must expose draft action');
    await room.selectOption('feed');
    await page.getByRole('button', { name: /You're up.*open the Big Board/ }).click();
    assert.equal(await room.inputValue(), 'board', 'phone current action must open the board');
    return 3;
  } finally { await context.close(); }
}
module.exports = { verifyLiveRedraftRail };
