'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/standalone');
const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(x => x != null && x !== false) });
const ctx = { window: {}, React: { createElement: h, Fragment: 'fragment' } };
vm.createContext(ctx);
vm.runInContext(babel.transform(fs.readFileSync('js/tabs/lineup.js', 'utf8'), { presets: ['react'] }).code, ctx);
const text = node => node == null ? '' : typeof node === 'object' ? node.children.map(text).join(' ').replace(/\s+/g, ' ') : String(node);
const all = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(all)] : [];
const props = {
    week: 3, pro: true, pmeta: pid => ({ name: pid }),
    matchup: { fc: { projMe: 80, projOpp: 100, margin: -20, winPct: 25 }, oppName: 'Opponent', oppCurTotal: 90, oppIdealTotal: 100,
        posStrength: [{ pos: 'TE', mine: 20.4, theirs: 8.5 }, { pos: 'WR', mine: 26.3, theirs: 66.6 }, { pos: 'K', mine: 8.9, theirs: 8.4 }],
        h2h: [{ slot: 'TE', myPid: 'Mine', theirPid: 'Theirs', myMed: 12, theirMed: 8.5 }, { slot: 'K', myPid: 'Kicker', theirPid: 'Their kicker', myMed: 8.9, theirMed: 8.4 }, { slot: 'QB', myPid: 'Quarterback', theirPid: 'Their QB', myMed: 10, theirMed: 10 }, { slot: 'WR', myPid: 'Unknown', theirPid: 'Their receiver', myMed: null, theirMed: 20 }],
    },
};
let tree = ctx.MatchupBreakdown(props);
assert.match(text(tree), /TE \+11\.9/);
assert.match(text(tree), /WR −40\.3/);
assert.match(text(tree), /2 slots/);
assert.match(text(tree), /You lead 2 of 4/);
const rows = all(tree).filter(n => n.props.className?.startsWith('gd-matchup-slot is-'));
assert.match(text(rows[0]), /You \+3\.5/);
assert.match(text(rows[1]), /You \+0\.5/);
assert.match(text(rows[2]), /Even/);
assert.match(text(rows[3]), /Unavailable/);
assert.doesNotMatch(rows[3].props.className, /is-behind|is-close/);
assert(all(tree).filter(n => n.props.role === 'img').every(n => n.props['aria-label']), 'position bars have numeric text alternatives');
assert(!all(tree).some(n => ['details', 'dialog'].includes(n.type)));
assert.doesNotMatch(text(ctx.MatchupBreakdown({ ...props, pro: false })), /11\.9|40\.3|Win probability|Your biggest edge/);
const unavailable = { ...props.matchup, fc: { winPct: null, projMe: null, projOpp: null, margin: null }, posStrength: [{ pos: 'WR', mine: null, theirs: 20 }], h2h: [props.matchup.h2h[3]] };
assert.match(text(ctx.MatchupBreakdown({ ...props, matchup: unavailable })), /Forecast unavailable.*Incomplete data/);
assert.equal(ctx.MatchupBreakdown({ ...props, matchup: null }), null);
console.log('PASS matchup breakdown: visible analysis, biggest edges, close and even slots, unavailable data, accessible bars, and free-tier boundary');
