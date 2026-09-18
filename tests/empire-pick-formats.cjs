'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const Babel = require('@babel/standalone');
const context = vm.createContext({ window: { App: {} }, console });
vm.runInContext(fs.readFileSync('js/league-skin.js', 'utf8'), context);
vm.runInContext(Babel.transform(fs.readFileSync('js/tabs/global-view.js', 'utf8'), { presets: ['react'] }).code, context);
const fixture = (type, overrides = {}) => ({ id: 'L' + type, name: 'Fixture ' + type, season: '2026', status: 'pre_draft',
    settings: { type, draft_rounds: 4 }, rosters: [{ roster_id: 1, owner_id: 'me', players: ['p'] }, { roster_id: 2, owner_id: 'other', players: [] }], tradedPicks: [], ...overrides });
const model = leagues => context.buildEmpirePortfolioModel({ allLeagues: leagues, sleeperUserId: 'me', scores: { p: 1000 }, playersData: { p: { full_name: 'Fixture Player', position: 'WR' } } });
const years = portfolio => Array.from(portfolio.pickCapital.byYear, year => year.year);

test('seasonal draft ownership follows the canonical one-year horizon without dynasty prices or future-capital advice', () => {
    let priced = 0;
    context.window.getIndustryPickValue = () => { priced++; return 1234; };
    for (const type of [0, 3, 'redraft', 'chopped', 'best_ball', 'dfs']) {
        const league = fixture(type, { tradedPicks: [{ season: '2027', round: 1, roster_id: 2, owner_id: 1 }] });
        const skin = context.window.App.LeagueSkin.build({ league });
        assert.equal(skin.features.showFuturePicks, false);
        const result = model([league]);
        assert.deepEqual(years(result), [2026]);
        assert.equal(result.pickCapital.total, 4);
        assert.equal(result.pickCapital.acquired, 0, 'out-of-horizon transfers cannot add future seasonal assets');
        assert.equal(result.pickCapital.score, null);
        assert.equal(result.pickCapital.unpriced, 4);
        assert.equal(result.pickCapital.byYear[0].score, null);
        assert(result.picks.every(pick => pick.score === null));
        assert(!result.signals.some(signal => signal.type === 'capital'));
        assert.match(context.buildCommandBridge({ model: result }).kpis.find(kpi => kpi.key === 'picks').sub, /4 unpriced/);
    }
    assert.equal(priced, 0, 'seasonal picks must never invoke dynasty valuation');
});

test('keeper future rights survive but unknown costs and eligibility cannot become dynasty capital value', () => {
    const league = fixture(1, { tradedPicks: [{ season: '2027', round: 2, roster_id: 1, owner_id: 2 }, { season: '2028', round: 1, roster_id: 2, owner_id: 1 }] });
    assert.equal(context.window.App.LeagueSkin.build({ league }).features.showFuturePicks, true);
    const result = model([league]);
    assert.deepEqual(years(result), [2026, 2027, 2028]);
    assert.equal(result.pickCapital.total, 12);
    assert.equal(result.pickCapital.acquired, 1);
    assert.equal(result.pickCapital.score, null);
    assert.equal(result.pickCapital.unpriced, 12);
    assert(!result.signals.some(signal => signal.type === 'capital'));
    assert.equal(result.provinces[0].pickScore, null);
});

test('dynasty ownership and valuation remain unchanged; mixed totals do not pass off partial values as full portfolio value', () => {
    context.window.getIndustryPickValue = () => 1000;
    const dynasty = model([fixture(2)]);
    assert.deepEqual(years(dynasty), [2026, 2027, 2028]);
    assert.equal(dynasty.pickCapital.total, 12);
    assert.equal(dynasty.pickCapital.score, 12000);
    assert.equal(dynasty.pickCapital.unpriced, 0);
    assert(dynasty.signals.some(signal => signal.type === 'capital'));
    const mixed = model([fixture(2), fixture(1), fixture(0)]);
    assert.equal(mixed.pickCapital.total, 28);
    assert.equal(mixed.pickCapital.score, null);
    assert.equal(mixed.pickCapital.unpriced, 16);
    assert.equal(mixed.pickCapital.dynastyPremium, 6);
    const signal = mixed.signals.find(item => item.type === 'capital');
    assert.match(signal.body, /^6 dynasty round 1-2 picks/);
    assert(mixed.pickCapital.byYear.every(year => year.score === null));
});

test('explicit zero-format and league overrides win over vestigial keeper settings; unknown format remains unpriced', () => {
    const seasonal = fixture(0, { settings: { type: 0, max_keepers: 2, draft_rounds: 4 } });
    assert.deepEqual(years(model([seasonal])), [2026]);
    const unknown = model([fixture(undefined)]);
    assert.deepEqual(years(unknown), [2026]);
    assert.equal(unknown.pickCapital.score, null);
    const inferredKeeper = model([fixture(undefined, { settings: { keeper_count: 2, draft_rounds: 4 } })]);
    assert.deepEqual(years(inferredKeeper), [2026, 2027, 2028]);
    context.window.App.Intelligence = { getLeagueTypeOverride: () => 'redraft' };
    try {
        const result = model([fixture(2)]);
        assert.deepEqual(years(result), [2026]);
        assert.equal(result.pickCapital.score, null);
    } finally { delete context.window.App.Intelligence; }
});

test('scenario loss remains player-only regardless of verified keeper or dynasty draft rights', () => {
    const portfolio = model([fixture(1), fixture(2)]);
    const scenario = context.buildEmpireScenario(portfolio, { target: 'p', drop: 30 });
    assert.equal(scenario.total, 2000);
    assert.equal(scenario.loss, 600);
    assert.equal(scenario.after, 1400);
});
