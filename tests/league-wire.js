#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/standalone');
const journalSource = fs.readFileSync('js/shared/league-wire-journal.js', 'utf8');
const source = babel.transform(fs.readFileSync('js/components/league-wire.js', 'utf8'), { presets: ['react'] }).code;
function harness({ reduced = false, phone = false, week = 1 } = {}) {
    let states = [], cursor = 0, effects = [], intervals = 0;
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
        useState: initial => { const slot = cursor++; if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial; return [states[slot], value => { states[slot] = typeof value === 'function' ? value(states[slot]) : value; }]; },
        useMemo: fn => fn(), useCallback: fn => fn, useEffect: fn => effects.push(fn), useRef: () => ({ current: null }),
    };
    const context = { React, console, setInterval: () => { intervals++; return intervals; }, clearInterval() {}, window: { App: { LeagueLiveScores: { useScores: () => ({ week, rows: [{ roster_id: 1, matchup_id: 1, points: 20 }, { roster_id: 2, matchup_id: 1, points: 10 }] }), rosterPoints: r => typeof r.custom_points === 'number' ? r.custom_points : typeof r.points === 'number' ? r.points : null, supported: () => true } }, WR: { useViewport: () => ({ isPhone: phone }) }, matchMedia: () => ({ matches: reduced }) } };
    vm.createContext(context); vm.runInContext(journalSource, context); vm.runInContext(source, context);
    const props = { currentLeague: { league_id: 'test', season: '2026', rosters: [] }, standings: [], transactions: [] };
    const render = () => { cursor = 0; effects = []; return context.window.WrLeagueWire(props); };
    render();
    states[8] = [{ state: 'pre', away: 'AAA', home: 'BBB', shortDetail: 'Sunday' }, { state: 'in', away: 'CCC', home: 'DDD', awayScore: 7, homeScore: 3 }];
    return { props, render, rotate: () => effects.at(-1)(), intervals: () => intervals, engine: context.window.WrWireStories, setArchive: value => { states[4] = value; } };
}
function nodes(node) { return node && typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : []; }
function text(node) { return node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : node.children.map(text).join(' '); }
const app = harness();
let tree = app.render();
const find = predicate => nodes(tree).find(predicate);
assert.match(text(find(n => n.props.className === 'wr-wire-headline')), /CCC 7/);
app.rotate(); assert.equal(app.intervals(), 1, 'automatic rotation starts');
find(n => n.props['aria-label'] === 'Pause automatic updates').props.onClick();
tree = app.render(); app.rotate(); assert.equal(app.intervals(), 1, 'pause prevents rotation');
find(n => n.props['aria-label'] === 'Next update').props.onClick();
tree = app.render(); assert.doesNotMatch(text(find(n => n.props.className === 'wr-wire-headline')), /CCC 7/, 'manual navigation works while paused');
find(n => n.type === 'select').props.onChange({ target: { value: 'trends' } });
tree = app.render(); assert.match(text(tree), /Open The Wire for league stories and the season archive/);
assert.doesNotMatch(text(tree), /won on|BIGGEST WIN|UGLIEST WIN/, 'unfinished scores are not called wins');
const accessible = harness({ reduced: true }); accessible.render(); accessible.rotate(); assert.equal(accessible.intervals(), 0, 'reduced motion disables rotation');
const phoneTree = harness({ phone: true }).render();
assert(nodes(phoneTree).some(n => n.props.className === 'wr-wire-mobile-launch'), 'phone has an inline edition launcher');
assert(!nodes(phoneTree).some(n => n.props.className === 'wr-wire-headline'), 'phone has no fixed ticker over its navigation');
console.log('PASS league wire: priority, pause, navigation, filters, reduced motion, phone launcher');

// Completed-score journalism: records require a baseline, gaps stop claims,
// custom scoring overrides raw totals, and ties never become wins.
const row = (id, score, matchup = 1, extra = {}) => ({ roster_id: id, points: score, matchup_id: matchup, ...extra });
const weeks = [
    { week: 1, rows: [row(1, 100), row(2, 99), row(3, 80, 2), row(4, 70, 2)] },
    { week: 2, rows: [row(1, 120), row(2, 110), row(3, 90, 2), row(4, 70, 2)] },
    { week: 3, rows: [row(1, 140, 1, { starters: ['p1', 'bench'], players_points: { p1: 30, bench: 20, unused: 60 } }), row(2, 139), row(3, 85, 2), row(4, 80, 2)] },
];
const build = (data = weeks, end = 3, extras = {}) => app.engine.build({ weeks: data, start: 1, end, nameFor: id => 'Team ' + id, playerName: id => 'Player ' + id, ...extras });
const edition = build();
assert.equal(edition.high, 140);
assert.equal(edition.stories.filter(s => s.kind === 'recap').length, 6);
assert(!edition.stories.some(s => s.week === 1 && s.kind === 'record'), 'opening baseline is not a broken record');
assert(edition.stories.some(s => /3 straight/.test(s.text)));
assert(edition.stories.some(s => /No justice|cruel draw|score big/.test(s.text)));
assert(edition.stories.some(s => /Player p1 led/.test(s.body)));
assert(!edition.stories.some(s => /unused/.test(s.body)), 'bench players cannot earn winning-starter credit');
assert.equal(build(weeks, 2).high, 120, 'current and future weeks excluded');
assert.equal(build([weeks[0], weeks[2]]).high, 100, 'missing week stops record and streak claims');
assert.equal(build([{ week: 1, rows: [row(1, 500, 1, { custom_points: 50 }), row(2, 60)] }], 1).high, 60);
const ties = build([{ week: 1, rows: [row(1, 100), row(2, 100)] }, { week: 2, rows: [row(1, 100), row(2, 100)] }], 2);
assert(ties.stories.some(s => /finish level/.test(s.text)));
assert(ties.stories.some(s => /match the season/.test(s.text)));
assert(!ties.stories.some(s => /winning margin|straight|winning starters/.test(s.body + s.text)));
assert.equal(ties.records.length, 4, 'all tied record holders retained');
assert.equal(build([{ week: 1, rows: [row(1, null), row(2, 80)] }], 1).stories.length, 0);
assert(!build(weeks, 3, { headToHead: false }).stories.some(s => s.kind === 'recap' || /straight/.test(s.text)), 'non-head-to-head formats do not get game narratives');
const archiveApp = harness();
archiveApp.setArchive({ key: 'test|2026|1|0', status: 'ready', weeks: [] });
let archiveTree = archiveApp.render();
nodes(archiveTree).find(n => n.props.className === 'wr-wire-brand').props.onClick();
archiveTree = archiveApp.render();
assert.match(text(archiveTree), /first chapter is still being written/);
assert(nodes(archiveTree).some(n => n.props['aria-label'] === 'Story week'));
console.log('PASS league stories: recaps, record ties, custom totals, streaks, missing weeks, format boundaries, archive controls');

const scoped = harness({ week: 4 });
scoped.setArchive({ key: 'test|2026|1|3', status: 'ready', weeks });
let scopedTree = scoped.render();
nodes(scopedTree).find(n => n.props.className === 'wr-wire-brand').props.onClick();
scopedTree = scoped.render();
nodes(scopedTree).find(n => n.props['aria-label'] === 'Story week').props.onChange({ target: { value: '1' } });
scopedTree = scoped.render();
const recordBook = nodes(scopedTree).find(n => n.props.className === 'wr-journal-record');
assert.match(text(recordBook), /100.00/);
assert.doesNotMatch(text(recordBook), /140.00/, 'reading an old edition cannot leak later records');
assert.match(text(scopedTree), /THROUGH WK  1/);
scoped.props.currentLeague = { ...scoped.props.currentLeague, league_id: 'another-league' };
scopedTree = scoped.render();
assert.doesNotMatch(text(nodes(scopedTree).find(n => n.props.className === 'wr-journal-record')), /100.00/, 'league switch cannot reuse another league archive');
console.log('PASS Wire reading scope: as-of-week records and league isolation');
