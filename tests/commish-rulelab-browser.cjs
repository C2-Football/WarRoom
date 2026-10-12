'use strict';
// Browser acceptance for the scoring workflow. Provider reads are fixtures;
// Office, the real weekly scorer, Rule Lab and Luck engine all run unchanged.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const browsers = require('@playwright/test');
const { installReadOnlyRoutes } = require('./helpers/browser-readonly.cjs');
const { createRuleLabSeasonFixture } = require('./helpers/rulelab-season-fixture.cjs');
const engine = process.env.COMMISH_BROWSER || 'chromium';
const geometryOnly = process.env.COMMISH_GEOMETRY_ONLY === '1';
assert(['chromium', 'webkit'].includes(engine));
const output = path.resolve(process.env.COMMISH_RULELAB_OUTPUT || path.join(__dirname, '../output/playwright/commish-rulelab'));
const entry = new URL(process.env.COMMISH_RULELAB_URL || '/dist-preview/', process.env.READINESS_PREVIEW_ORIGIN || 'http://127.0.0.1:3025');
entry.searchParams.set('dev', 'true'); entry.searchParams.set('user', 'readiness-fixture');
const allSizes = [
  { label: 'phone-small', width: 320, height: 700, touch: true },
  { label: 'phone', width: 390, height: 844, touch: true },
  { label: 'phone-landscape', width: 844, height: 390, touch: true },
  { label: 'ipad-portrait', width: 768, height: 1024, touch: true },
  { label: 'ipad-landscape', width: 1024, height: 768, touch: true },
  { label: 'desktop', width: 1440, height: 1000, touch: false },
];
const requested = process.env.COMMISH_SIZES?.split(',').map(s => s.trim()).filter(Boolean);
const sizes = requested ? allSizes.filter(s => requested.includes(s.label)) : allSizes;
assert(sizes.length && (!requested || requested.length === sizes.length), 'Use unique supported COMMISH_SIZES');
const signed = value => (value > 0 ? '+' : value < 0 ? '−' : '') + Math.abs(value).toFixed(1);
const half = 'qa-replay-half', full = 'qa-replay-full';

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await browsers[engine].launch({ headless: true, ...(engine === 'chromium'
    ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }
    : { executablePath: process.env.PLAYWRIGHT_WEBKIT_PATH || '/Users/jacobc/Library/Caches/ms-playwright/webkit-2368/pw_run.sh' }) });
  const results = [];
  const saveResults = () => fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ engine,
    url: entry.href, fixture: 'Completed2025 / 18provider weeks / 14regular-season replay weeks / 10teams / 40players / real engines',
    capabilityBoundary: 'Browser touch/viewport emulation; physical iPad and authenticated hosted persistence are not asserted.', results }, null, 2));
  try {
    for (const size of sizes) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch });
      const provider = createRuleLabSeasonFixture();
      const blocked = await installReadOnlyRoutes(context, { fixture: provider.fixture });
      let unavailableStats = false;
      const failedStatReads = [];
      let unavailableLineups = false;
      const failedLineupReads = [];
      await context.route('**/stats/nfl/regular/2025/*', route => {
        if (unavailableStats && new URL(route.request().url()).pathname.endsWith('/3')) {
          failedStatReads.push(route.request().url());
          return route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"Isolated raw-stat outage"}' });
        }
        return route.fallback();
      });
      await context.route('**/league/*/matchups/*', route => {
        if (unavailableLineups && new URL(route.request().url()).pathname.includes('-2025/matchups/3')) {
          failedLineupReads.push(route.request().url());
          return route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"Isolated historical lineup outage"}' });
        }
        return route.fallback();
      });
      await context.addInitScript(() => {
        localStorage.setItem('fw_session_v1', JSON.stringify({ token: 'isolated-browser-fixture', user: { id: 'isolated-browser-fixture', email: 'qa@example.invalid' } }));
        localStorage.setItem('od_auth_v1', JSON.stringify({ username: 'readiness-fixture' }));
        localStorage.setItem('od_profile_v1', JSON.stringify({ onboardingComplete: true }));
        localStorage.setItem('wr_active_connection_owner_v1', 'account:isolated-browser-fixture');
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (this === localStorage && String(key).includes('commish_rulelab_proposals') && sessionStorage.getItem('qa_proposal_quota_failure') === 'true') {
            throw new DOMException('Isolated proposal quota failure', 'QuotaExceededError');
          }
          return setItem.call(this, key, value);
        };
      });
      const page = await context.newPage(), errors = [], touchChecks = [], checks = [];
      page.on('pageerror', error => errors.push(error.message));
      const activate = locator => size.touch ? locator.tap() : locator.click();
      const fit = async name => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, name + ' must fit viewport');
      const reachable = async (locator, name) => {
        await locator.scrollIntoViewIfNeeded();
        await locator.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' }));
        const target = await locator.evaluate(el => {
          const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { width: r.width, height: r.height, reachable: el === hit || el.contains(hit),
            minHeight: getComputedStyle(el).minHeight, computedHeight: getComputedStyle(el).height,
            appearance: getComputedStyle(el).appearance, fontSize: getComputedStyle(el).fontSize,
            coarse: matchMedia('(pointer:coarse)').matches, maxTouchPoints: navigator.maxTouchPoints, touchEvents: 'ontouchstart' in window };
        });
        assert(target.reachable, name + ' must be reachable');
        if (size.touch) {
          assert(target.coarse && (target.maxTouchPoints > 0 || target.touchEvents), name + ' needs active touch input');
          assert(target.width >= 44 && target.height >= 44, name + ' needs44px touch target: ' + JSON.stringify(target));
        }
        touchChecks.push({ control: name, ...target });
      };
      const capture = async name => {
        // Full-page Chromium capture can reset touch emulation. Keep the
        // actual viewport during the touch journey and assert its capability.
        // Viewport captures also preserve sticky panel/dock positions instead
        // of relocating them into a stitched full-document screenshot.
        await page.screenshot({ path: path.join(output, size.label + '-' + name + '.png'), fullPage: false });
        if (size.touch) assert(await page.evaluate(() => matchMedia('(pointer:coarse)').matches && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)), 'Capture must preserve touch input');
      };
      const workspace = async () => {
        await page.locator('.co-workspace-trigger, nav[aria-label="Commissioner workspaces"]').first().waitFor({ state: 'visible', timeout: 60000 });
        const trigger = page.getByRole('button', { name: /^Workspaces/ });
        if (await trigger.isVisible()) await activate(trigger);
        await activate(page.getByRole('navigation', { name: 'Commissioner workspaces', exact: true }).getByRole('button', { name: /^Rules/ }).first());
        await page.getByTestId('rulelab-quick-editor').waitFor({ timeout: 60000 });
      };
      const open = async () => {
        await page.locator('.hub-experience-card.commish-hero').waitFor({ timeout: 60000 });
        await activate(page.locator('.hub-experience-card.commish-hero'));
        await page.getByRole('group', { name: 'Filter by priority', exact: true }).waitFor({ timeout: 60000 });
        // Passive observer only: every result is returned by the original
        // engine with unmodified real Office arguments and scoring pipeline.
        await page.evaluate(() => {
          const lab = App.Commish.RuleLab, run = lab.runProposal, sweep = lab.sweep;
          window.__qaRuleLabRuns = [];
          window.__qaRuleLabSweeps = [];
          lab.runProposal = function (args) {
            const result = run.call(this, args);
            window.__qaRuleLabRuns.push(JSON.parse(JSON.stringify({ leagueId: String(args.league.league_id || args.league.id),
              proposal: args.proposal, rosterProposal: args.rosterProposal, result })));
            return result;
          };
          lab.sweep = function (args) {
            const result = sweep.call(this, args);
            window.__qaRuleLabSweeps.push(JSON.parse(JSON.stringify({ leagueId: String(args.league.league_id || args.league.id), key: args.key, result })));
            return result;
          };
        });
        await workspace();
      };
      const input = page.getByRole('spinbutton', { name: 'Proposed value', exact: true });
      const rule = page.getByRole('combobox', { name: 'Scoring rule', exact: true });
      const search = page.getByRole('searchbox', { name: 'Find a scoring rule', exact: true });
      const preview = page.getByTestId('rulelab-quick-editor').getByRole('button', { name: 'Preview changes', exact: true });
      const runCount = () => page.evaluate(() => window.__qaRuleLabRuns.length);
      const selectScope = async id => {
        const select = page.getByRole('combobox', { name: 'Amending league', exact: true });
        if (await select.isVisible()) await select.selectOption(id);
        else await activate(page.locator('.co-rulelab').getByRole('button', { name: id === half ? 'Replay Half PPR' : id === full ? 'Replay Full PPR' : 'All 2 leagues', exact: true }));
      };
      const replay = async (proposal, ids = [half]) => {
        await page.waitForFunction(({ proposal, ids }) => ids.every(id => {
          const run = [...(window.__qaRuleLabRuns || [])].reverse().find(row => row.leagueId === id);
          const card = [...document.querySelectorAll('[data-testid="rulelab-result"]')].find(el => el.dataset.leagueId === id);
          return run && !run.result.empty && JSON.stringify(run.proposal || {}) === JSON.stringify(proposal)
            && card?.querySelector('.co-rulelab-impact-summary');
        }) && document.querySelectorAll('[data-testid="rulelab-result"]').length === ids.length, { proposal, ids }, { timeout: 60000 });
        assert.equal(await page.getByTestId('rulelab-result').count(), ids.length, 'Only selected league results must render');
        const rows = await page.evaluate(ids => ids.map(id => [...window.__qaRuleLabRuns].reverse().find(row => row.leagueId === id)), ids);
        for (const row of rows) {
          const before = provider.expectedPoints(row.leagueId), after = provider.expectedPoints(row.leagueId, proposal);
          assert.equal(row.result.weeksCounted, 14); assert.equal(row.result.teamDeltas.length, 10);
          assert.equal(row.result.seasonUsed, 2025);
          for (const team of row.result.teamDeltas) {
            const id = String(team.rosterId), round = x => Math.round(x * 10) / 10;
            assert.equal(round(team.baselinePts), round(before[id]), 'Real baseline score for ' + row.leagueId + '/' + id);
            assert.equal(round(team.proposedPts), round(after[id]), 'Real proposed score for ' + row.leagueId + '/' + id);
            assert.equal(team.delta, round(after[id] - before[id]), 'Rule-only points difference');
          }
          const result = page.locator('[data-testid="rulelab-result"][data-league-id="' + row.leagueId + '"]');
          assert.match(await result.textContent(), /14 weeks replayed/);
          const largest = row.result.teamDeltas.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
          assert((await result.locator('.co-rulelab-impact-summary').textContent()).includes(signed(largest.delta) + ' pts'), 'Visible impact must match computed result');
        }
        return rows;
      };
      const typeStaged = async value => {
        const count = await runCount(), text = await page.getByTestId('rulelab-impact').locator('.co-rulelab-impact-summary').textContent();
        await reachable(input, 'Proposed value');
        await activate(input); await input.press('ControlOrMeta+A');
        for (const char of value) {
          await input.pressSequentially(char);
          assert.equal(await input.evaluate(el => document.activeElement === el), true, 'Typing must retain input focus after every character');
        }
        assert.equal(await input.inputValue(), value, 'Typed decimal/negative must remain intact');
        if (size.width <= 400) assert((await input.boundingBox()).width >= 88, 'Narrow-screen input must show negative decimals without clipping');
        assert.equal(await runCount(), count, 'Typing must stage without rerunning the replay');
        assert.match(await page.getByTestId('rulelab-impact').textContent(), /Changes staged/);
        assert.equal(await page.getByTestId('rulelab-impact').locator('.co-rulelab-impact-summary').textContent(),
          text, 'Staged impact stays at the last preview');
        assert(await page.getByRole('button', { name: 'Copy ballot text', exact: true }).isDisabled());
        assert(await page.getByRole('button', { name: 'Export PNG', exact: true }).isDisabled());
        assert(await preview.isEnabled());
        if (size.width < 1200) assert.match(await page.locator('.co-rulelab-feedback').textContent(), /Last preview.*14 weeks replayed/s);
      };
      try {
        await page.goto(entry.href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await open();
        await replay({}); await fit('Initial Rule Lab');
        assert.equal(await input.inputValue(), '0.5');
        assert.equal(await page.locator('.co-rulelab-current-value strong').textContent(), '0.5');
        await reachable(rule, 'Scoring rule picker');
        await reachable(page.locator('.co-rulelab').getByRole('button', { name: '2025', exact: true }), 'Replay season');
        if (size.width < 1200) {
          const jump = page.getByRole('button', { name: 'See replay impact', exact: true });
          await reachable(jump, 'See replay impact'); await activate(jump);
          assert.equal(await page.getByTestId('rulelab-impact').evaluate(el => document.activeElement === el), true, 'Impact jump must move keyboard focus to the replay');
          checks.push('compact preview preserves season and moves focus directly to full impact');
        }
        for (const title of ['Starting lineup changes', 'All scoring rules', 'Find a scoring threshold', 'Manage saved proposals']) {
          const disclosure = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: title }) }).last();
          assert.equal(await disclosure.getAttribute('open'), null, title + ' begins folded');
        }
        checks.push('18 provider weeks,14 regular-season replay weeks and honest half-PPR baseline');
        if (geometryOnly) {
          await activate(rule); await page.keyboard.press('Escape');
          await rule.selectOption('pass_sack'); assert.equal(await input.inputValue(), '-0.25');
          await reachable(rule, 'Selected custom scoring rule');
          assert.equal(await rule.evaluate(el => getComputedStyle(el).appearance), 'none');
          await fit('Explicit select geometry'); await capture('select-geometry');
          assert.deepEqual(errors, []);
          results.push({ label: size.label, passed: true, geometryOnly: true, checks: ['44px styled select geometry and actual open/close interaction', 'custom selection retains its baseline'],
            touchChecks, externalWriteGuard: true, blockedExternalMutations: blocked.length });
          saveResults(); console.log('PASS ' + engine + ' Rule Lab select geometry ' + size.label); continue;
        }
        const preset = page.getByRole('button', { name: 'Full PPR (1.0/rec)', exact: true });
        await reachable(preset, 'Full PPR preset'); await activate(preset); await replay({ rec: 1 });
        assert.equal(await preset.getAttribute('aria-pressed'), 'true');
        const increase = page.getByRole('button', { name: 'Increase Reception (PPR)', exact: true });
        const decrease = page.getByRole('button', { name: 'Decrease Reception (PPR)', exact: true });
        await reachable(increase, 'Increase PPR'); await activate(increase); await replay({ rec: 1.25 });
        await reachable(decrease, 'Decrease PPR'); await activate(decrease); await replay({ rec: 1 });
        checks.push('actual preset and +/- taps update scoped real engine result immediately');
        await typeStaged('0.75');
        const name = page.getByRole('textbox', { name: 'Proposal name', exact: true });
        const save = page.getByRole('button', { name: 'Save draft', exact: true });
        const saved = () => page.evaluate(() => App.Commish.Proposals.read().list);
        await name.fill('Staged decimal draft'); await activate(save);
        const stagedSave = (await saved())[0];
        assert.equal(stagedSave.status, 'draft'); assert.deepEqual(stagedSave.overrides, { rec: 0.75 });
        assert.equal(Object.hasOwn(stagedSave, 'result'), false, 'A saved draft must not persist an unanalyzed result');
        assert(await preview.isEnabled(), 'Saving a draft does not preview it'); await replay({ rec: 1 });
        await reachable(preview, 'Preview changes'); await activate(preview); await replay({ rec: 0.75 });
        assert(await preview.isDisabled()); checks.push('manual decimal retains focus and stages until preview');
        await reachable(search, 'Scoring search'); await search.fill('pass_sack');
        assert.equal(await rule.locator('option[value="pass_sack"]').count(), 1, 'Current custom key remains searchable');
        await rule.selectOption('pass_sack'); assert.equal(await input.inputValue(), '-0.25');
        await typeStaged('-0.75'); await activate(preview); await replay({ rec: 0.75, pass_sack: -0.75 });
        await search.fill('TE reception'); await rule.selectOption('bonus_rec_te');
        await typeStaged('0.5'); await activate(preview); await replay({ rec: 0.75, pass_sack: -0.75, bonus_rec_te: 0.5 });
        const resetRule = page.getByRole('button', { name: 'Reset this rule', exact: true });
        await reachable(resetRule, 'Reset selected rule'); await activate(resetRule); await replay({ rec: 0.75, pass_sack: -0.75 });
        checks.push('search exposes custom and catalog rules; negative decimals and per-rule reset');
        await search.fill(''); await rule.selectOption('rec');
        if (size.label === 'desktop') await page.locator('.co-rulelab-workspace').evaluate(el => el.scrollIntoView({ block: 'start' }));
        await capture('edited-replay');
        const resetAll = page.getByRole('button', { name: 'Reset all changes', exact: true });
        await reachable(resetAll, 'Reset all changes'); await activate(resetAll); await replay({});
        await selectScope(full); await replay({}, [full]);
        assert.equal(await page.locator('.co-rulelab-current-value strong').textContent(), '1.0');
        await selectScope('__all'); await replay({}, [half, full]);
        assert.equal(await page.locator('.co-rulelab-current-value strong').textContent(), '—', 'Omnibus cannot invent one baseline');
        await selectScope(half); await replay({}); await activate(preset); await replay({ rec: 1 });
        checks.push('single league scope and all-league baseline truthfulness');
        const result = page.locator('[data-testid="rulelab-result"][data-league-id="' + half + '"]');
        const details = result.locator('summary').filter({ hasText: 'View details' });
        await reachable(details, 'View replay details'); await activate(details);
        const viewAll = result.getByRole('button', { name: 'View all teams', exact: true });
        await reachable(viewAll, 'View all teams'); await activate(viewAll);
        const points = result.getByRole('region', { name: 'Season points comparison. Scroll for all columns.', exact: true });
        await points.waitFor();
        for (let i = 1; i <= 10; i++) assert.equal(await points.getByText('Replay Team ' + String(i).padStart(2, '0'), { exact: true }).count(), 1);
        await fit('All replay details'); await capture('all-teams');
        await activate(details); checks.push('details and all10 teams reachable without page overflow');
        await reachable(name, 'Proposal name'); await name.fill('Browser full PPR');
        await reachable(save, 'Save draft'); await activate(save);
        assert.equal((await saved())[0].name, 'Browser full PPR'); assert.deepEqual((await saved())[0].overrides, { rec: 1 });
        const durable = await saved();
        await activate(increase); await replay({ rec: 1.25 }); await name.fill('Retained quota proposal');
        await page.evaluate(() => sessionStorage.setItem('qa_proposal_quota_failure', 'true')); await activate(save);
        await page.getByText(/Your rule proposal was not saved/).first().waitFor();
        assert.deepEqual(await saved(), durable, 'Failed write cannot replace earlier proposals');
        assert.equal(await name.inputValue(), 'Retained quota proposal', 'Failed proposal name stays reviewable');
        await replay({ rec: 1.25 }); await fit('Proposal quota failure'); await capture('save-recovery');
        await page.evaluate(() => sessionStorage.removeItem('qa_proposal_quota_failure'));
        const retry = page.getByRole('button', { name: 'Retry save', exact: true }).first();
        await reachable(retry, 'Retry proposal save'); await activate(retry);
        await page.waitForFunction(count => App.Commish.Proposals.read().list.length === count, durable.length + 1);
        const confirmed = await saved(); assert.equal(confirmed[0].name, 'Retained quota proposal');
        assert.deepEqual(confirmed[0].overrides, { rec: 1.25 });
        await page.reload({ waitUntil: 'domcontentloaded' }); await open(); await replay({});
        assert.deepEqual(await saved(), confirmed, 'Confirmed proposals survive reload unchanged');
        const manage = page.locator('summary').filter({ hasText: 'Manage saved proposals' });
        await reachable(manage, 'Manage saved proposals'); await activate(manage);
        const savedRow = page.getByText('Retained quota proposal', { exact: true }).locator('..');
        await activate(savedRow.getByRole('button', { name: 'Load', exact: true }));
        await replay({ rec: 1.25 }); await fit('Loaded saved proposal');
        checks.push('proposal quota rejection retains last save and inputs; retry and reload/load remain correct');
        // Fresh data retry must escape a missing raw-stat week rather than
        // cache invented zero scores for an otherwise played season.
        unavailableStats = true;
        const reloadData = page.getByRole('button', { name: 'Reload season data', exact: true });
        await reachable(reloadData, 'Reload season data'); await activate(reloadData);
        const retryReplay = page.getByRole('button', { name: 'Retry replay', exact: true });
        await retryReplay.waitFor({ timeout: 60000 });
        assert.equal(await page.getByTestId('rulelab-impact').locator('.co-rulelab-impact-summary').count(), 0, 'Missing raw stats cannot display a numeric impact');
        assert.equal(failedStatReads.length, 1, 'Reload must actually fetch raw stats again');
        assert.match(await page.getByTestId('rulelab-impact').textContent(), /stats|stat lines|week 3/i);
        unavailableStats = false; await reachable(retryReplay, 'Retry replay'); await activate(retryReplay);
        await replay({ rec: 1.25 });
        checks.push('fresh raw-stat failure shows no fabricated replay; Retry replay restores same proposal');
        unavailableLineups = true; await activate(reloadData);
        await retryReplay.waitFor({ timeout: 60000 });
        assert(failedLineupReads.length >= 1, 'Fresh reload must actually request historical lineups');
        assert.equal(await page.getByTestId('rulelab-impact').locator('.co-rulelab-impact-summary').count(), 0, 'Failed lineup read cannot invent completed-week standings');
        assert.match(await page.getByTestId('rulelab-impact').textContent(), /lineup/i);
        const beforeRecoveryReads = provider.reads.filter(p => p.includes('-2025/matchups/3')).length;
        unavailableLineups = false; await reachable(retryReplay, 'Retry historical lineups'); await activate(retryReplay);
        await replay({ rec: 1.25 });
        assert(provider.reads.filter(p => p.includes('-2025/matchups/3')).length > beforeRecoveryReads, 'Recovery must bypass a failed matchup cache');
        assert.equal(provider.reads.some(p => /-2025\/matchups\/(15|16|17|18)$/.test(p)), false, 'Office must not fetch playoff lineups for regular-season replay');
        checks.push('historical lineup503 produces unavailable replay and refetches on retry; playoff weeks excluded');
        if (size.label === 'desktop') {
          const thresholdSummary = page.locator('summary').filter({ hasText: 'Find a scoring threshold' });
          await activate(thresholdSummary);
          const threshold = thresholdSummary.locator('..');
          await activate(threshold.getByRole('button', { name: 'PPR 0 → 1.5', exact: true }));
          await page.waitForFunction(() => window.__qaRuleLabSweeps.length === 1);
          const sweep = await page.evaluate(() => window.__qaRuleLabSweeps[0]);
          assert.equal(sweep.leagueId, half); assert.equal(sweep.key, 'rec');
          assert.deepEqual(sweep.result.steps.map(s => s.value), [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]);
          assert(sweep.result.steps.every(s => !s.empty), 'Threshold must replay actual completed weeks at every value');
          const baseline = sweep.result.steps.find(s => s.isCurrent);
          assert.equal(baseline.value, 0.5); assert.equal(baseline.ranksMoved, 0);
          assert.equal(baseline.seedFlips, false); assert.equal(baseline.fieldMoves, 0);
          await threshold.getByText('NOW', { exact: true }).waitFor();
          assert((await threshold.textContent()).includes('Replay Half PPR'));
          assert(!(await threshold.textContent()).includes('Replay Full PPR'), 'Threshold remains in chosen league scope');
          await fit('Threshold results'); await capture('threshold');
          checks.push('threshold runs real7-value engine sweep within selected league and marks true baseline');
          const advancedSummary = page.locator('summary').filter({ hasText: 'All scoring rules' });
          await activate(advancedSummary);
          const advanced = advancedSummary.locator('..');
          const passingSummary = advanced.locator('summary').filter({ hasText: 'Passing' });
          if (await passingSummary.locator('..').getAttribute('open') === null) await activate(passingSummary);
          const passing = advanced.getByRole('spinbutton', { name: 'Passing TD', exact: true });
          const previousRuns = await runCount();
          await activate(passing); await passing.press('ControlOrMeta+A');
          for (const char of '5.5') {
            await passing.pressSequentially(char);
            assert(await passing.evaluate(el => document.activeElement === el), 'Advanced numeric editor must retain focus');
          }
          assert.equal(await passing.inputValue(), '5.5'); assert.equal(await runCount(), previousRuns);
          await activate(advanced.getByRole('button', { name: 'Preview changes', exact: true }));
          await replay({ rec: 1.25, pass_td: 5.5 });
          checks.push('advanced scoring editor retains focus and stages an additional decimal rule until preview');
          // A malformed saved list must be preserved before a new list can
          // replace it. This context owns only synthetic browser-local data.
          const originalRaw = '{"unreadable-fixture":';
          await page.evaluate(raw => localStorage.setItem(App.AccountStorage.key('commish_rulelab_proposals'), raw), originalRaw);
          await page.reload({ waitUntil: 'domcontentloaded' }); await open(); await replay({});
          assert(await page.getByRole('button', { name: 'Save draft', exact: true }).isDisabled());
          await activate(page.locator('summary').filter({ hasText: 'Manage saved proposals' }));
          const preserve = page.getByRole('button', { name: 'Preserve a copy & start a new list', exact: true });
          await reachable(preserve, 'Preserve original proposal data'); await activate(preserve);
          assert.deepEqual(await saved(), []);
          const recovery = await page.evaluate(() => App.AccountStorage.get('commish_rulelab_proposals_recovery_v1', []));
          assert.equal(recovery.length, 1); assert.equal(recovery[0].raw, originalRaw);
          await page.getByRole('button', { name: 'Download recovery copy', exact: true }).waitFor();
          await page.reload({ waitUntil: 'domcontentloaded' }); await open(); await replay({});
          assert.equal(await page.evaluate(() => App.AccountStorage.get('commish_rulelab_proposals_recovery_v1', [])[0].raw), originalRaw);
          checks.push('malformed proposal recovery preserves exact original bytes across reload');
        }
        assert.equal(provider.reads.filter(p => /^\/stats\/nfl\/regular\/2025\/\d+$/.test(p)).length >= 18, true);
        assert.deepEqual(errors, [], 'No uncaught browser errors');
        results.push({ label: size.label, viewport: { width: size.width, height: size.height }, touch: size.touch, passed: true,
          checks, touchChecks, observedRealEngineRuns: await runCount(), providerReads: provider.reads.length,
          externalWriteGuard: true, blockedExternalMutations: blocked.length });
        saveResults(); console.log('PASS ' + engine + ' Rule Lab real replay ' + size.label + ' ' + size.width + '×' + size.height);
      } catch (error) {
        const replayDiagnostics = await page.evaluate(() => ({ runs: (window.__qaRuleLabRuns || []).map(row => ({ leagueId: row.leagueId, proposal: row.proposal,
          empty: row.result.empty, reason: row.result.reason, weeks: row.result.weeksCounted })), rendered: [...document.querySelectorAll('[data-testid="rulelab-result"]')].map(el => el.dataset.leagueId) })).catch(() => null);
        console.error('Replay diagnostics ' + JSON.stringify(replayDiagnostics));
        await page.screenshot({ path: path.join(output, size.label + '-failure.png'), fullPage: false }).catch(() => {});
        results.push({ label: size.label, passed: false, error: error.stack, checks, errors, touchChecks,
          replayDiagnostics, externalWriteGuard: true, blockedExternalMutations: blocked.length }); saveResults(); throw error;
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
