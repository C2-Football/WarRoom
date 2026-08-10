#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

global.window = globalThis;
window.App = window.App || {};
window.WR = window.WR || {};
require('../js/league-skin.js');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const Skin = window.App.LeagueSkin;
let passed = 0;

function test(name, fn) {
    fn();
    passed += 1;
    console.log('  ok  ' + name);
}

test('product contract declares the four first-class experiences', () => {
    assert.strictEqual(Skin.PRODUCT_SUPPORT.leagueTypes.dynasty, 'first_class');
    assert.strictEqual(Skin.PRODUCT_SUPPORT.leagueTypes.chopped, 'first_class');
    assert.strictEqual(Skin.PRODUCT_SUPPORT.modes.empire, 'first_class');
    assert.strictEqual(Skin.PRODUCT_SUPPORT.modes.commissioner, 'first_class');
});

test('the roadmap boundary remains explicit for other formats', () => {
    assert.strictEqual(Skin.supportLevel('redraft'), 'next');
    assert.strictEqual(Skin.supportLevel('keeper'), 'next');
    assert.strictEqual(Skin.supportLevel('best_ball'), 'beta');
    assert.strictEqual(Skin.PRODUCT_SUPPORT.draftModes.auction, 'beta');
    assert.strictEqual(Skin.supportLevel('devy'), 'unsupported');
});

test('Dynasty and native Sleeper Chopped both resolve as first class', () => {
    const dynasty = Skin.build({ league: { settings: { type: 2 }, roster_positions: ['QB', 'RB'] }, rosters: [] });
    const chopped = Skin.build({ league: { settings: { type: 3, disable_trades: 1 }, roster_positions: ['QB', 'RB'] }, rosters: [] });
    assert.strictEqual(dynasty.type, 'dynasty');
    assert.strictEqual(dynasty.supportLevel, 'first_class');
    assert.strictEqual(chopped.type, 'chopped');
    assert.strictEqual(chopped.typeMeta.label, 'Chopped');
    assert.strictEqual(chopped.supportLevel, 'first_class');
    assert.strictEqual(chopped.features.showTrades, false);
    assert.strictEqual(chopped.features.showElimination, true);
    assert.strictEqual(chopped.strategyModes[0], 'survive');
});

test('shared league surfaces preserve the Chopped identity', () => {
    const app = read('js/app.js');
    const detail = read('js/league-detail.js');
    assert.match(app, /3:\s*'chopped'/);
    assert.match(detail, /chopped:\s*\{ label: 'Chopped'/);
    assert.match(detail, /leagueSkin\?\.type === 'chopped'/);
    assert.match(detail, /showGmOffice === false/);
    assert.match(detail, /leagueSkin\?\.type !== 'chopped'/);
});

test('Chopped briefing and radar are survival-first and trade-free', () => {
    const brief = read('js/tabs/flash-brief.js');
    const radar = read('js/widgets/market-radar.js');
    assert.match(brief, /SURVIVAL PLAN/);
    assert.match(brief, /goTo\(isChopped \? 'fa' : 'strategy'\)/);
    assert.match(radar, /Waiver Pool Radar/);
    assert.match(radar, /if \(isChopped\) return renderChoppedRadar\(\)/);
    assert.match(radar, /isChopped \? 'Open Free Agency' : 'Open Trades'/);
});

test('Empire and Commissioner operational modules remain wired', () => {
    const index = read('index.html');
    const app = read('js/app.js');
    assert.match(index, /js\/shared\/empire-decisions\.js/);
    assert.match(index, /js\/shared\/commish-followups\.js/);
    assert.match(app, /EmpireDashboard/);
    assert.match(app, /CommissionerOffice/);
});

test('Empire does not manufacture trade actions in Chopped leagues', () => {
    const empire = read('js/tabs/global-view.js');
    assert.match(empire, /const canTrade = !isChopped/);
    assert.match(empire, /normalizedType === 'chopped'.*disable_trades/s);
    assert.match(empire, /o\.canTrade !== false/);
    assert.match(empire, /p\.status === 'rebuild' && p\.canTrade !== false/);
});

console.log('\n' + passed + ' first-class mode contract tests passed.');
