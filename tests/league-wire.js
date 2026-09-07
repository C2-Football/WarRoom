#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/standalone');
const source = babel.transform(fs.readFileSync('js/components/league-wire.js', 'utf8'), { presets: ['react'] }).code;
function harness({ reduced = false, phone = false } = {}) {
    let states = [], cursor = 0, effects = [], intervals = 0;
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
        useState: initial => { const slot = cursor++; if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial; return [states[slot], value => { states[slot] = typeof value === 'function' ? value(states[slot]) : value; }]; },
        useMemo: fn => fn(), useCallback: fn => fn, useEffect: fn => effects.push(fn), useRef: () => ({ current: null }),
    };
    const context = { React, console, setInterval: () => { intervals++; return intervals; }, clearInterval() {}, window: { WR: { useViewport: () => ({ isPhone: phone }) }, matchMedia: () => ({ matches: reduced }) } };
    vm.createContext(context); vm.runInContext(source, context);
    const props = { currentLeague: { league_id: 'test', season: '2026', rosters: [] }, standings: [], transactions: [] };
    const render = () => { cursor = 0; effects = []; return context.window.WrLeagueWire(props); };
    render();
    states[0] = { week: 1, rows: [{ roster_id: 1, matchup_id: 1, points: 20 }, { roster_id: 2, matchup_id: 1, points: 10 }] };
    states[2] = [{ state: 'pre', away: 'AAA', home: 'BBB', shortDetail: 'Sunday' }, { state: 'in', away: 'CCC', home: 'DDD', awayScore: 7, homeScore: 3 }];
    return { render, rotate: () => effects.at(-1)(), intervals: () => intervals };
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
tree = app.render(); assert.match(text(tree), /No updates in this topic yet/);
assert.doesNotMatch(text(tree), /won on|BIGGEST WIN|UGLIEST WIN/, 'unfinished scores are not called wins');
const accessible = harness({ reduced: true }); accessible.render(); accessible.rotate(); assert.equal(accessible.intervals(), 0, 'reduced motion disables rotation');
assert.equal(harness({ phone: true }).render(), null, 'phone dock remains unobstructed');
console.log('PASS league wire: priority, pause, navigation, filters, reduced motion, phone exclusion');
