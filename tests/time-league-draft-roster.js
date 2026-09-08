'use strict';
const assert = require('node:assert/strict');
global.window = globalThis;
global.App = {};
for (const name of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'public-state']) require(`../js/shared/time-league-${name}.js`);
const { TimeLeagueEngine: E, TimeLeaguePublicState: Public } = App;
let states = [], cursor = 0, isDesktop = false;
global.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: initial => { const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useEffect() {}, useMemo: fn => fn(), useRef: value => ({ current: value }),
};
global.matchMedia = () => ({ matches: isDesktop });
require('../js/components/time-league-draft-roster.js');
const walk = node => !node || typeof node !== 'object' ? [] : [node, ...(node.children || []).flatMap(walk)];
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : (node?.children || []).map(text).join(' ');
const find = (node, predicate) => walk(node).find(predicate);
const byClass = (node, name) => find(node, item => String(item.props.className || '').split(' ').includes(name));
const render = (props, reset = true) => { if (reset) states = []; cursor = 0; return WrTimeLeagueDraftRoster(props); };
const stamp = '2026-09-08T12:00:00.000Z';
const slots = { QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 1, SUPER_FLEX: 1, K: 1, DEF: 1, BN: 2 };
const sequence = ['QB', 'QB', 'RB', 'RB', 'RB', 'WR', 'TE', 'K', 'DEF', 'RB'];
const cards = new Map(['t1', 't2'].flatMap(teamId => sequence.map((position, index) => ({
    identity: `${teamId}-player-${index}`, name: `${teamId === 't1' ? 'Host' : 'Guest'} player ${index + 1}`, position, peak: 9876.54,
    seasons: [{ season: 1988, points: 9876.54, games: 14 }, { season: 1999, points: 5432.19, games: 16 }],
}))).map(card => [card.identity, card]));
const create = (rosterSlots = slots) => E.createTimeLeague({ name: 'Roster visibility', seed: 'draft-roster', createdAt: stamp,
    seats: [{ name: 'Host club', manager: 'human' }, { name: 'Guest club', manager: 'human' }],
    settings: { rosterSlots, maxQuarterbacks: 3, regularSeasonWeeks: 12,
        scoring: { passTd: 4, reception: 0.5, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 },
        eraRules: { mode: 'any-era', decades: [] }, draftOrderMode: 'manual', draftTeamOrder: ['t2', 't1'] } });
const partial = () => {
    let league = E.startDraft(create(), stamp);
    while (league.draftPicks.length < 18) {
        const seat = E.currentDraftSeat(league), team = league.teams.find(item => item.teamId === seat.teamId);
        const next = E.applyDraftPick(league, cards.get(`${team.teamId}-player-${team.roster.length}`), { madeBy: 'human', createdAt: stamp });
        assert.notEqual(next, league, 'The fixture makes a legal real draft pick'); league = next;
    }
    return league;
};
const positionCounts = tree => Object.fromEntries(walk(byClass(tree, 'tl-draft-roster-counts')).filter(node => node.props['data-position'])
    .map(node => [node.props['data-position'], Number(text(find(node, child => child.type === 'dd')).trim())]));
const slotRows = tree => walk(tree).filter(node => node.type === 'li' && node.props['data-slot']);
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`ok ${name}`); };

test('empty draft shows configured slots and zero position counts without inventing a player', () => {
    const league = create(), team = league.teams[1], tree = render({ league, team });
    assert(tree);
    assert.equal(slotRows(tree).length, 10);
    assert.equal(walk(tree).filter(node => node.props.className === 'tl-draft-roster-open').length, 10);
    assert.deepEqual(positionCounts(tree), { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 });
    assert.match(text(byClass(tree, 'tl-draft-roster-progress')), /0\s*\/\s*10/);
    assert(!text(tree).includes('Host player') && !text(tree).includes('Guest player'));
});

test('position totals include flex and bench players while slot rows retain their assigned positions', () => {
    const league = partial(), team = league.teams[1], before = JSON.stringify(league), tree = render({ league, team });
    assert.deepEqual(positionCounts(tree), { QB: 2, RB: 3, WR: 1, TE: 1, K: 1, DEF: 1 });
    assert.match(text(byClass(tree, 'tl-draft-roster-progress')), /9\s*\/\s*10/);
    const rows = slotRows(tree);
    assert.equal(rows.filter(row => row.props['data-slot'] === 'RB').length, 1);
    assert(text(rows.find(row => row.props['data-slot'] === 'RB')).includes('Guest player 3'));
    assert(text(rows.find(row => row.props['data-slot'] === 'FLEX')).includes('Guest player 4'));
    assert(text(rows.find(row => row.props['data-slot'] === 'SUPER_FLEX')).includes('Guest player 2'));
    const bench = rows.filter(row => row.props['data-slot'] === 'BN');
    assert.equal(bench.length, 2); assert(text(bench[0]).includes('Guest player 5'));
    assert(byClass(bench[1], 'tl-draft-roster-open'));
    assert.equal(JSON.stringify(league), before, 'Rendering never sorts or reassigns the saved roster');
});

test('incoming draft picks update the visible totals and latest names in the existing panel', () => {
    const initial = create();
    let tree = render({ league: initial, team: initial.teams[1] });
    assert.match(text(byClass(tree, 'tl-draft-roster-progress')), /0\s*\/\s*10/);
    const next = partial(), before = JSON.stringify(next);
    tree = render({ league: next, team: next.teams[1] }, false);
    assert.equal(positionCounts(tree).RB, 3);
    assert.equal(positionCounts(tree).QB, 2);
    const latest = text(byClass(tree, 'tl-draft-roster-recent'));
    assert(latest.indexOf('Guest player 9') < latest.indexOf('Guest player 8'), 'Newest acquisitions appear first above the expandable roster');
    assert.equal(JSON.stringify(next), before);
});

test('supplied online owner is respected and a missing owner never falls back to the host', () => {
    const league = partial(), team = league.teams[1], tree = render({ league, team });
    assert(text(tree).includes('Guest player 1'));
    assert(!text(tree).includes('Host player'), 'The first stored team is not implicitly the viewer');
    assert.equal(render({ league, team: null }), null);
    assert.equal(render({ league, team: undefined }), null);
});

test('canonical solo and sealed online reconnect show the same roster without hidden seasons or scoring', () => {
    const league = partial(), team = league.teams[1];
    for (const entry of team.roster) { entry.points = 9876.54; entry.seasonPoints = 5432.19; }
    const canonical = render({ league, team });
    const publicLeague = E.normalizePublicTimeLeague(JSON.parse(JSON.stringify(Public.projectPublicState(league, 't2'))));
    assert(publicLeague); assert(publicLeague.teams[1].roster.every(entry => !Object.hasOwn(entry, 'drawnSeason')));
    const publicTree = render({ league: publicLeague, team: publicLeague.teams[1] });
    assert.deepEqual(positionCounts(publicTree), positionCounts(canonical));
    assert.deepEqual(slotRows(publicTree).map(text), slotRows(canonical).map(text));
    for (const tree of [canonical, publicTree]) {
        const serialized = JSON.stringify(tree);
        for (const secret of ['1988', '1999', '9876.54', '5432.19', 'drawnSeason', 'seasonPoints']) assert(!serialized.includes(secret), `Draft roster must not expose ${secret}`);
    }
});

test('custom leagues show only configured starter and bench slots including repeated superflex and defense', () => {
    const customSlots = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 2, SUPER_FLEX: 2, K: 2, DEF: 1, BN: 3 };
    const league = create(customSlots), tree = render({ league, team: league.teams[1] });
    assert.deepEqual(slotRows(tree).map(row => row.props['data-slot']), ['FLEX', 'FLEX', 'SUPER_FLEX', 'SUPER_FLEX', 'K', 'K', 'DEF', 'BN', 'BN', 'BN']);
    assert.match(text(byClass(tree, 'tl-draft-roster-progress')), /0\s*\/\s*10/);
});

test('scouting sends the selected drafted identity without leaking or changing its edition', () => {
    const league = partial(), team = league.teams[1], calls = [], before = JSON.stringify(league);
    const tree = render({ league, team, onScout: (...args) => calls.push(args) });
    const button = walk(tree).find(node => node.type === 'button' && text(node).includes('Guest player 4'));
    assert(button, 'A drafted player can be opened directly for scouting');
    const event = { currentTarget: { fixture: true } }; button.props.onClick(event);
    assert.deepEqual(calls, [[team.roster.find(entry => entry.name === 'Guest player 4').identity, event]]);
    assert.equal(JSON.stringify(league), before);
    const readOnly = render({ league, team });
    assert(!walk(readOnly).some(node => node.type === 'button'), 'Without a scout handler the roster has no dead player controls');
});

test('mobile keeps totals visible with details collapsed while desktop can open the full roster', () => {
    const league = partial(), team = league.teams[1];
    isDesktop = false; let tree = render({ league, team });
    assert(byClass(tree, 'tl-draft-roster-counts'));
    assert(!byClass(tree, 'tl-draft-roster-details').props.open);
    isDesktop = true; tree = render({ league, team });
    assert.equal(byClass(tree, 'tl-draft-roster-details').props.open, true);
    delete global.matchMedia;
    assert.doesNotThrow(() => render({ league, team }), 'Server rendering and older browsers do not require matchMedia');
});
console.log(`PASS: ${passed} draft roster visibility scenarios`);
