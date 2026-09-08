'use strict';
const assert = require('node:assert/strict');
global.window = globalThis;
global.App = {};
for (const name of ['roster','rules','draft-room','era-rules','types','season','helmet','engine','ai','actions','ui','draft-clock']) require('../js/shared/time-league-' + name + '.js');
const E = App.TimeLeagueEngine;
const disk = new Map();
global.localStorage = { getItem: key => disk.get(key) || null, setItem: (key, value) => disk.set(key, value) };
let states = [], refs = [], cursor = 0, refCursor = 0;
global.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }), Fragment: 'fragment',
    useState: value => { const i = cursor++; if (!(i in states)) states[i] = typeof value === 'function' ? value() : value; return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; },
    useRef: value => { const i = refCursor++; refs[i] ||= { current: value }; return refs[i]; },
    useMemo: fn => fn(), useCallback: fn => fn, useEffect: () => {},
};
for (const name of ['DraftPanel','ActivityPanel','DraftClock','AuctionPanel']) window['WrTimeLeague' + name] = function Panel() {};
require('../js/tabs/time-league.js');
const nodes = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.children)];
const cards = new Map([0,1,2].map(i => ['qb' + i, { identity: 'qb' + i, name: 'QB ' + i, position: 'QB', peak: 150 - i, seasons: [{ season: 2000, points: 150 - i, games: 16 }] }]));
const RealDate = Date;
let now = RealDate.parse('2026-09-07T12:00:00Z');
global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
const create = seed => E.createTimeLeague({ seed, createdAt: new Date().toISOString(), name: seed,
    seats: [{ name: 'First', manager: 'human' }, { name: 'Second', manager: 'human' }], settings: {
        rosterSlots: { QB: 1 }, maxQuarterbacks: 1, regularSeasonWeeks: 12, tradesEnabled: false,
        scoring: { passTd: 4, reception: 0.5, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 },
        eraRules: { mode: 'position-roulette', decades: ['2000s'], positionDecades: { QB: '2000s' } }, draftPickSeconds: 15,
    } });
const render = () => { cursor = 0; refCursor = 0; return TimeLeague({ onClose() {} }); };
const draft = () => nodes(render()).find(node => node.type === WrTimeLeagueDraftPanel).props;
(async () => {
    const first = create('first');
    first.activity.push({ id: 'legacy-era', week: 1, kind: 'league', message: 'Era roulette — QB 2000s', createdAt: first.createdAt });
    states[1] = first; states[4] = 'activity'; states[6] = cards;
    let tree = render();
    assert(!nodes(tree).some(node => node.type === WrTimeLeagueActivityPanel), 'Legacy activity cannot expose sealed decades');
    assert(JSON.stringify(tree).includes('The draft archives are sealed'));
    states[4] = 'draft';
    let panel = draft();
    assert.equal(panel.key, first.leagueId, 'Changing leagues remounts its reveal state');
    assert.equal(await panel.onDraftAction({ type: 'draft-clock-start' }), false);
    assert.equal(states[1].draftClock.status, 'waiting');
    panel.onRevealReadyChange(true);
    panel = draft();
    assert.equal(await panel.onDraftAction({ type: 'draft-clock-start' }), true);
    assert.equal(states[1].draftClock.status, 'running');
    assert(disk.has(App.TimeLeagueTypes.timeLeagueStorageKey(first.leagueId)), 'Clock start is saved, not just displayed');
    now += 15000;
    panel = draft();
    assert.equal(await panel.onDraftAction({ type: 'draft', identity: 'qb0' }), false, 'Late solo clicks pass through deadline validation');
    assert.equal(states[1].draftPicks.length, 0);
    assert.equal(await panel.onDraftAction(App.TimeLeagueDraftClock.nextAction(states[1], cards, now)), true);
    assert.equal(states[1].draftPicks.length, 1);
    now += 1000;
    panel = draft();
    assert.equal(await panel.onDraftAction({ type: 'draft', identity: 'qb1' }), true, 'Local hotseat actions use the current human seat');
    assert.equal(states[1].draftPicks[1].teamId, 't2');
    assert.equal(states[1].phase, 'season');
    assert.equal(states[4], 'home', 'The saved final pick hands off to Home instead of leaving the recap open');
    for (const tab of ['home', 'roster', 'waivers', 'trades', 'gameday', 'messages', 'career', 'activity']) {
        states[4] = tab;
        tree = render();
        assert.equal(tree.props['data-vault-phase'], 'season');
        assert.equal(tree.props['data-vault-tab'], tab);
        assert(!nodes(tree).some(node => node.type === WrTimeLeagueDraftPanel), `${tab} cannot retain the completed draft panel`);
        assert(!nodes(tree).some(node => node.type === WrTimeLeagueDraftClock), `${tab} cannot retain the draft clock`);
    }
    const mobile = nodes(tree).find(node => node.type?.name === 'MobileGameNav');
    const rootStates = states, rootRefs = refs;
    states = []; refs = []; let destination;
    const menu = () => { cursor = 0; refCursor = 0; return mobile.type({ ...mobile.props, onNavigate: tab => { destination = tab; } }); };
    const label = node => JSON.stringify(node.children);
    const more = nodes(menu()).find(node => node.type === 'button' && label(node).includes('More'));
    more.props.onClick();
    const recapLink = nodes(menu()).find(node => node.type === 'button' && label(node).includes('Draft recap'));
    assert(recapLink, 'Completed drafts are named Draft recap inside More');
    recapLink.props.onClick(); assert.equal(destination, 'draft');
    states = rootStates; refs = rootRefs; states[4] = 'draft';
    assert(nodes(render()).some(node => node.type === WrTimeLeagueDraftPanel), 'More can still open the completed draft on demand');
    states[1] = create('second');
    panel = draft();
    assert.equal(await panel.onDraftAction({ type: 'draft-clock-start' }), false, 'A prior league reveal cannot unlock a new league');
    console.log('PASS: draft UI bridges reveal readiness, saved clock, expired clicks, timeout, hotseat picks, recap and league isolation.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { global.Date = RealDate; });
