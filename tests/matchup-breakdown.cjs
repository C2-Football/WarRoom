'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/standalone');
const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(x => x != null && x !== false) });
let state = [], cursor = 0;
const ctx = { window: {}, React: { createElement: h, Fragment: 'fragment', useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; } } };
vm.createContext(ctx);
vm.runInContext(babel.transform(fs.readFileSync('js/tabs/lineup.js', 'utf8'), { presets: ['react'] }).code, ctx);
const text = node => node == null ? '' : typeof node === 'object' ? node.children.map(text).join(' ').replace(/\s+/g, ' ') : String(node);
const all = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(all)] : [];
const render = (props, reset = false) => { if (reset) state = []; cursor = 0; return ctx.MatchupBreakdown(props); };
const button = (tree, label) => all(tree).find(node => node.type === 'button' && text(node).trim() === label);
const slotRows = tree => all(tree).filter(node => node.props['data-slot-index'] != null);
const props = {
    week: 3, pro: true, pmeta: pid => ({ name: pid }),
    matchup: { fc: { projMe: 80, projOpp: 100, margin: -20, winPct: 25 }, oppName: 'Opponent', oppCurTotal: 90, oppIdealTotal: 100,
        posStrength: [{ pos: 'TE', mine: 20.4, theirs: 8.5 }, { pos: 'WR', mine: 26.3, theirs: 66.6 }, { pos: 'K', mine: 8.9, theirs: 8.4 }],
        h2h: [{ slot: 'TE', myPid: 'Mine', theirPid: 'Theirs', myMed: 12, theirMed: 8.5 }, { slot: 'K', myPid: 'Kicker', theirPid: 'Their kicker', myMed: 8.9, theirMed: 8.4 }, { slot: 'QB', myPid: 'Quarterback', theirPid: 'Their QB', myMed: 10, theirMed: 10 }, { slot: 'WR', myPid: 'Unknown', theirPid: 'Their receiver', myMed: null, theirMed: 20 }],
    },
};
let tree = render(props);
assert.match(text(tree), /TE \+3\.5/);
assert.match(text(tree), /Incomplete data/);
assert.match(text(tree), /2 slots/);
assert.match(text(tree), /You lead 2 of 4 slots/);
assert.match(text(tree), /Projected points · your lineup plan.*Their current lineup:.*Green: your edge/, 'desktop keeps its matchup guidance');
assert.doesNotMatch(text(tree), /Slot by slot/, 'The separate duplicate comparison list is removed');
assert.equal(slotRows(tree).length, 0, 'Position bars appear before opening their player detail');
const groupButton = all(tree).find(node => node.type === 'button' && node.props['aria-label']?.startsWith('Show TE player comparisons'));
assert.equal(groupButton.props['aria-expanded'], false);
assert(all(tree).find(node => node.props.id === groupButton.props['aria-controls']).props.hidden, 'Disclosure target exists and is hidden while collapsed');
groupButton.props.onClick(); tree = render(props);
assert.equal(slotRows(tree).length, 1);
assert.match(text(slotRows(tree)[0]), /Mine.*Theirs/);
const expandedButton = all(tree).find(node => node.type === 'button' && node.props['aria-label']?.startsWith('Hide TE player comparisons'));
assert.equal(expandedButton.props['aria-expanded'], true);
assert.equal(all(tree).find(node => node.props.id === expandedButton.props['aria-controls']).props.hidden, false);
assert(!text(tree).includes('Their receiver'), 'Opening TE leaves other position players collapsed');
button(tree, 'Show all players').props.onClick(); tree = render(props);
const rows = slotRows(tree);
assert.deepEqual(rows.map(row => row.props['data-slot-index']).sort(), [0, 1, 2, 3], 'Every comparison is mounted exactly once across the position disclosures');
assert.match(text(rows[0]), /You \+3\.5/);
assert.match(text(rows[1]), /You \+0\.5/);
assert.match(text(rows[2]), /Even/);
assert.match(text(rows[3]), /Unavailable/);
assert.doesNotMatch(rows[3].props.className, /is-behind|is-close/);
assert(all(tree).filter(n => n.props.role === 'img').every(n => n.props['aria-label']), 'position bars have numeric text alternatives');
assert(!all(tree).some(n => ['details', 'dialog'].includes(n.type)));
assert.equal(button(tree, 'Hide all players').props['aria-pressed'], true);
button(tree, 'Hide all players').props.onClick(); tree = render(props);
assert.equal(slotRows(tree).length, 0);
const compact = render({ ...props, compact: true }, true);
assert.match(compact.props.className, /gd-matchup-compact/, 'phone matchup uses the compact layout hook');
assert.match(text(compact), /80\.0.*You.*100\.0.*Them/, 'phone matchup keeps both projected scores');
assert.doesNotMatch(text(compact), /Projected points · your lineup plan|Their current lineup:|Green: your edge/, 'phone matchup omits desktop-only explanatory copy');
assert.equal(slotRows(compact).length, 0, 'phone matchup opens with position bars and no persistent duplicate list');
assert.doesNotMatch(text(render({ ...props, pro: false }, true)), /11\.9|40\.3|Win probability|Your biggest edge|Show all players/);
const zeroOpponent = render({ ...props, pro: false, matchup: { ...props.matchup, oppCurTotal: 0 } }, true);
assert.match(text(zeroOpponent), /0\.0 Them/, 'A valid zero opponent forecast stays visible on the free view');
const negativeOpponent = render({ ...props, pro: false, matchup: { ...props.matchup, oppCurTotal: -2.5 } }, true);
assert.match(text(negativeOpponent), /-2\.5 Them/);

// FLEX matchups can use different player positions on the two sides. Group
// by actual lineup slot so neither pair nor its points is counted twice.
const flexProps = { ...props, compact: true, matchup: { ...props.matchup, h2h: [
    { slot: 'QB', myPid: 'Starting QB', theirPid: 'Their QB', myMed: 10, theirMed: 10 },
    { slot: 'FLEX', myPid: 'Flex RB', theirPid: 'Flex WR', myMed: 0, theirMed: -2 },
    { slot: 'FLEX', myPid: 'Second flex WR', theirPid: 'Second flex TE', myMed: 5, theirMed: null },
    { slot: 'SUPER_FLEX', myPid: 'Second QB', theirPid: 'Superflex TE', myMed: 20, theirMed: 8 },
    { slot: 'REC_FLEX', myPid: null, theirPid: 'Reception flex TE', myMed: 0, theirMed: 4 },
    { slot: 'RB', myPid: 'Fixed RB', theirPid: 'Their RB', myMed: 7, theirMed: 5 },
] } };
tree = render(flexProps, true);
const flexGroup = all(tree).find(node => node.props['data-position'] === 'FLEX');
assert.match(text(flexGroup), /5\.0.*—.*Unavailable/, 'A missing flex projection makes the group incomplete instead of a fabricated partial total');
button(tree, 'Show all players').props.onClick(); tree = render(flexProps);
assert.deepEqual(slotRows(tree).map(row => row.props['data-slot-index']).sort(), [0, 1, 2, 3, 4, 5]);
assert.equal(slotRows(tree).filter(row => row.props['data-slot'] === 'FLEX').length, 2);
assert.match(text(slotRows(tree).find(row => row.props['data-slot-index'] === 1)), /0\.0.*-2\.0/, 'Inline flex detail preserves genuine zero and negative projections');
assert.match(text(all(tree).find(node => node.props['data-position'] === 'SUPER_FLEX')), /SUPER FLEX.*Second QB.*Superflex TE/);
assert.match(text(all(tree).find(node => node.props['data-position'] === 'REC_FLEX')), /REC FLEX.*Empty slot.*0\.0/);
assert.equal(all(tree).filter(node => node.props.className === 'gd-matchup-you' || node.props.className === 'gd-matchup-player gd-matchup-you').length, 6);
const negativeBar = all(tree).find(node => node.props.role === 'img' && node.props['aria-label']?.includes('FLEX: you'));
assert(negativeBar, 'Accessible labels preserve signed group values');
tree = render({ ...flexProps, week: 4 });
assert.equal(slotRows(tree).length, 0, 'Expansions reset when the matchup week changes');
const unavailable = { ...props.matchup, fc: { winPct: null, projMe: null, projOpp: null, margin: null }, posStrength: [{ pos: 'WR', mine: null, theirs: 20 }], h2h: [props.matchup.h2h[3]] };
assert.match(text(render({ ...props, matchup: unavailable }, true)), /Forecast unavailable.*Incomplete data/);
assert.equal(render({ ...props, matchup: null }), null);
console.log('PASS matchup breakdown: unified position disclosures, exactly-once FLEX and superflex comparisons, signed/missing metrics, accessible bars and controls, matchup reset, and free-tier boundary');
