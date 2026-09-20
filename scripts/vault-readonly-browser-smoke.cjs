#!/usr/bin/env node
'use strict';
// Explicit, opt-in hosted read-only evidence. Login is the only allowed write.
// Credentials stay in a mode-0600 file outside version control; no storage state,
// response bodies, tokens, invite links, or credential screenshots are exported.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const split = arg.indexOf('=');
  if (!arg.startsWith('--') || split < 3) throw new Error('Use --key=value arguments');
  return [arg.slice(2, split), arg.slice(split + 1)];
}));
const EXPECTED_IDS = ['9159bd98-98e2-49fb-8741-d4cd513bfcb4', 'c5fbdc81-d5ac-4118-8547-ed27b28e822b'];
const ROOM = '9abe0f2c-7f52-4035-984a-606a0b121142';
const RUN = 'readiness-20260918-99b2f837-2a00-4a2d-b337-a17ce0164755';
const allowedOrigins = new Set(['https://warroom.skjjcruz.com', 'https://c2-football.github.io', 'https://jcc100218.github.io', 'http://localhost:3001']);
(async () => {
  assert(args.credentials, 'Provide --credentials=/absolute/path/to/private.json');
  assert(args.base, 'Provide --base=https://existing-site/path/');
  const base = new URL(args.base.endsWith('/') ? args.base : args.base + '/');
  assert(allowedOrigins.has(base.origin), 'Only existing release destinations or the approved local preview origin are allowed');
  assert.equal(fs.statSync(args.credentials).mode & 0o777, 0o600, 'Credential file must be mode 0600');
  const privateData = JSON.parse(fs.readFileSync(args.credentials, 'utf8'));
  assert.equal(privateData.runId, RUN);
  assert.equal(privateData.vaultRoomId, ROOM);
  const account = Number(args.account ?? 0);
  assert(Number.isInteger(account) && account >= 0 && account < 2, 'Account must be 0 or 1');
  const credentials = privateData.accounts[account];
  assert.equal(credentials.session.user.id, EXPECTED_IDS[account]);
  const browser = await chromium.launch({ headless: true, executablePath: args.chrome || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const evidence = { startedAt: new Date().toISOString(), origin: base.origin, path: base.pathname, accountId: EXPECTED_IDS[account], roomId: ROOM, checks: [], loads: [], blocked: [] };
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) return route.continue();
    if (url.hostname === 'sxshiqyxhhifvtfqawbq.supabase.co' && url.pathname === '/functions/v1/fw-signin' && request.method() === 'POST') return route.continue();
    if (url.hostname === 'sxshiqyxhhifvtfqawbq.supabase.co' && url.pathname === '/functions/v1/time-league' && request.method() === 'POST') {
      let body; try { body = request.postDataJSON(); } catch {}
      if (['list', 'profile-get'].includes(body?.op) || (body?.op === 'load' && body.rowId === ROOM)) return route.continue();
      evidence.blocked.push({ endpoint: 'time-league', op: body?.op || 'invalid', target: body?.rowId === ROOM ? 'preserved-room' : 'other' });
    } else evidence.blocked.push({ endpoint: url.pathname });
    return route.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"error":"Read-only smoke scope"}' });
  });
  page.on('response', async response => {
    if (!response.url().endsWith('/functions/v1/time-league')) return;
    let body; try { body = response.request().postDataJSON(); } catch { return; }
    if (body?.op !== 'load' || body.rowId !== ROOM) return;
    try {
      const result = await response.json();
      evidence.loads.push({ status: response.status(), ok: result.ok, phase: result.row?.state?.phase, version: result.row?.version });
    } catch { evidence.loads.push({ status: response.status(), parseError: true }); }
  });
  try {
    await page.goto(new URL('login.html?vault=1', base).href, { waitUntil: 'domcontentloaded' });
    await page.locator('#identifier').fill(credentials.email);
    await page.locator('#password').fill(credentials.password);
    await page.locator('#btnSignin').click();
    await page.waitForURL(url => url.pathname.endsWith('/index.html') && url.searchParams.get('vault') === '1', { waitUntil: 'commit' });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('fw_session_v1') || 'null')?.user?.id), EXPECTED_IDS[account]);
    evidence.checks.push('real UI sign-in verified exact controlled account');
    if (args.preview === 'true') await page.goto(new URL('dist-preview/?vault=1', base).href, { waitUntil: 'domcontentloaded' });
    const card = page.locator('.tl-season-card').filter({ has: page.locator('.tl-season-name', { hasText: RUN + ' Vault' }) });
    await card.first().waitFor({ state: 'visible' });
    assert.equal(await card.count(), 1, 'Room card must be unambiguous');
    await card.getByRole('button', { name: 'CONTINUE →', exact: true }).click();
    await page.getByText('CROWNED VAULT CHAMPION', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => App.OD.getCurrentUserId()), EXPECTED_IDS[account]);
    evidence.checks.push('preserved completed room opened from shelf with account identity intact');
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 740 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Unexpected horizontal overflow');
      await page.getByLabel('League options', { exact: true }).click();
      await page.getByRole('button', { name: 'Switch league', exact: true }).waitFor({ state: 'visible' });
      await page.getByLabel('League options', { exact: true }).click();
      evidence.checks.push(`completed room ${viewport.width}x${viewport.height}: no page overflow and league navigation reachable`);
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('CROWNED VAULT CHAMPION', { exact: true }).waitFor();
    evidence.checks.push('completed room restored after full browser reload');
    assert(evidence.loads.length >= 2, 'Require at least two real hosted room loads');
    assert(evidence.loads.every(load => load.ok && load.status === 200 && load.phase === 'complete'), 'Every room load must remain complete');
    assert.equal(new Set(evidence.loads.map(load => load.version)).size, 1, 'Read-only smoke must not change room version');
    assert(!evidence.blocked.some(item => item.endpoint === 'time-league'), 'Unexpected Vault write or wrong-room request');
    evidence.passed = true;
  } finally {
    await browser.close();
    evidence.finishedAt = new Date().toISOString();
    if (args.output) fs.writeFileSync(args.output, JSON.stringify(evidence, null, 2) + '\n');
  }
  console.log(JSON.stringify(evidence, null, 2));
})().catch(error => {
  // Playwright call logs can include filled credentials/invite DOM values. Emit
  // only a redacted generic failure; detailed safe checkpoints live in output.
  console.error('Vault read-only browser smoke failed. Inspect the sanitized checkpoint output; no credentials or raw browser call logs were exported.');
  process.exitCode = 1;
});
