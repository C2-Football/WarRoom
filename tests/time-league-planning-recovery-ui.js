#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
global.window = globalThis; window.App = {};
for (const name of ['roster', 'helmet', 'rules', 'draft-room', 'era-rules', 'season', 'engine', 'ai', 'ui', 'hidden-years', 'player-stats']) require(`../js/shared/time-league-${name}.js`);
let states = [], refs = [], cursor = 0, refCursor = 0;
global.React = {
    Fragment: 'fragment', createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : ({ type, props: props || {}, children }),
    useState: initial => { const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; },
    useMemo: fn => fn(), useRef: initial => { const index = refCursor++; return refs[index] ||= { current: initial }; }, useEffect() {},
};
require('../js/components/time-league-team-panel.js'); require('../js/components/time-league-week-gates.js');
const E = App.TimeLeagueEngine, stamp = '2026-10-21T00:00:00Z';
const player = (team, position, slot = position) => ({ entryId: `${team}-${slot}`, identity: `${position}:${team}-${slot}`, name: `${team} ${slot}`, position, slot, drawnSeason: 2000 });
const create = (count = 2, settings = {}) => {
    const initial = E.createTimeLeague({ seed: 'planning-recovery-ui', name: 'Recovery decisions', createdAt: stamp,
        settings: { gameDeckVersion: 0, hiddenYears: false, eraRules: { mode: 'any-era', decades: [] }, rosterSlots: { QB: 1, RB: 1, WR: 1, BN: 1 },
            maxQuarterbacks: 2, regularSeasonWeeks: 2, playoffTeams: 0, waiversEnabled: true, tradesEnabled: true,
            scoring: { passTd: 4, reception: .5, rushRecYd: .1, passingYd: .04, turnover: -2 }, ...settings },
        seats: Array.from({ length: count }, (_, i) => ({ name: i ? `Manager ${i + 1}` : 'Atlas', manager: 'human' })) });
    return { ...initial, phase: 'season', weekStage: 'lineup', seasonsRevealed: true,
        teams: initial.teams.map(team => ({ ...team, roster: [player(team.teamId, 'QB'), player(team.teamId, 'RB'), player(team.teamId, 'WR'), player(team.teamId, 'WR', 'BN')] })) };
};
const missing = league => ({ ...league, teams: league.teams.map((team, i) => i ? team : { ...team, roster: team.roster.filter(entry => entry.position !== 'RB') }) });
const cardsFor = league => new Map(league.teams.flatMap(team => team.roster).map(entry => [entry.identity, { ...entry, peak: 100, seasons: [{ season: 2000, points: 100, games: 14 }] }]));
let league, cards, calls, target;
const reset = next => { league = next || missing(create()); cards = cardsFor(league); states = []; refs = []; calls = []; target = null; };
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.children)];
const text = node => node == null || node === false ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.children);
const button = (tree, label) => walk(tree).find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node.children) === label));
const region = (tree, label) => walk(tree).find(node => node.props['aria-label'] === label);
const byClass = (tree, cls) => walk(tree).find(node => node.props.className?.split(' ').includes(cls));
const render = fn => { cursor = 0; refCursor = 0; return fn(); };
const teamView = (props = {}) => render(() => WrTimeLeagueTeamPanel({ league, cards, section: 'roster', activeTeamId: 't1', onSelectTeam() {}, logIndex: new Map(), onUpdate: async () => true,
    onNavigate: tab => { target = tab; }, onBrowseWaivers: slot => { target = slot; },
    onReopenPlanning: async teamId => { calls.push(teamId); league = E.reopenPlanning(league, stamp); return true; }, ...props }));
const gates = (props = {}) => render(() => WrTimeLeagueWeekGates({ league, currentTab: league.weekStage === 'ready' ? 'gameday' : 'roster', teamId: 't1', dataReady: true,
    onNavigate: tab => { target = tab; }, onAction: async action => { calls.push(action); return true; }, ...props }));
let count = 0;
async function test(name, fn) { reset(); await fn(); count++; console.log(`  ok ${name}`); }
(async () => {
    await test('an unfillable roster has a named acquisition recovery route, guarded against duplicate saves', async () => {
        const before = JSON.stringify(league), tree = teamView();
        const notice = region(tree, 'Roster recovery required'); assert(notice);
        assert(text(notice).includes('RB needs an eligible player')); assert(text(notice).includes('Moving the current players cannot solve'));
        assert(button(tree, 'Fill empty slots').props.disabled);
        assert(text(byClass(tree, 'tl-roster-fill-help')).includes('Review the roster recovery notice'));
        assert.equal(JSON.stringify(league), before, 'Reviewing recovery does not rewrite the old roster or its history');
        const confirm = button(notice, 'Confirm reopen planning');
        await Promise.all([confirm.props.onClick(), confirm.props.onClick()]);
        assert.deepEqual(calls, ['t1']); assert.equal(league.weekStage, 'claims'); assert.equal(league.planningRecoveryWeek, 1);
        assert(region(teamView(), 'Reopened planning window'));
    });
    await test('failed recovery is explicit and retryable without moving roster or history', async () => {
        const before = JSON.stringify(league);
        await button(teamView({ onReopenPlanning: async id => { calls.push(id); return false; } }), 'Confirm reopen planning').props.onClick();
        const tree = teamView(); assert(text(tree).includes('Planning was not reopened'));
        assert.equal(JSON.stringify(league), before); assert(!button(tree, 'Confirm reopen planning').props.disabled);
        await button(teamView({ onReopenPlanning: async () => { throw new Error('fixture failure'); } }), 'Confirm reopen planning').props.onClick();
        assert(text(teamView()).includes('Planning could not be reopened'));
    });
    await test('inline cancel and Escape return focus without committing a stage change', () => {
        const tree = teamView(), confirmation = byClass(tree, 'tl-roster-recovery-confirm');
        let focused = 0;
        const details = { open: true, closest: () => details, querySelector: () => ({ focus: () => { focused++; } }) };
        button(confirmation, 'Keep current stage').props.onClick({ currentTarget: details }); assert(!details.open); assert.equal(focused, 1);
        details.open = true;
        confirmation.props.onKeyDown({ key: 'Escape', currentTarget: details, preventDefault() {}, stopPropagation() {} });
        assert(!details.open); assert.equal(focused, 2); assert.equal(league.weekStage, 'lineup'); assert.equal(calls.length, 0);
    });
    await test('online members get an honest commissioner requirement and disabled mechanics give their exact reason', () => {
        let tree = teamView({ onlineMeta: { role: 'member', seatTeamId: 't1' }, activeTeamId: 't2' });
        assert(region(tree, 'Roster recovery required')); assert(text(tree).includes('Ask your commissioner to reopen planning'));
        assert(!button(tree, 'Confirm reopen planning')); assert(!text(tree).includes('request sent'));
        reset(missing(create(2, { waiversEnabled: false, tradesEnabled: false })));
        tree = teamView(); assert(text(region(tree, 'Roster recovery required')).includes(E.planningRecovery(league).reason));
        assert(!button(tree, 'Confirm reopen planning'));
    });
    await test('movable lineup gaps and playoff observers keep their existing path without recovery', () => {
        reset(create()); league = { ...league, teams: league.teams.map((team, i) => i ? team : { ...team, roster: team.roster.map(entry => entry.position === 'RB' ? { ...entry, slot: 'BN' } : entry).filter(entry => entry.slot !== 'BN' || entry.position === 'RB') }) };
        assert(!region(teamView(), 'Roster recovery required')); assert(!button(teamView(), 'Fill empty slots').props.disabled);
        reset(create(4, { regularSeasonWeeks: 1, playoffTeams: 2 }));
        league = { ...E.finalizeCurrentWeek(league, new Map(), null, stamp), weekStage: 'lineup' };
        const pair = E.playoffPairs(league, league.currentWeek)[0], observer = league.teams.find(team => !pair.includes(team.teamId));
        league = { ...league, teams: league.teams.map(team => team.teamId === observer.teamId ? { ...team, roster: [] } : team) };
        assert(!region(teamView({ activeTeamId: observer.teamId }), 'Roster recovery required'));
    });
    await test('an empty acquisition chooser no longer sends an impossible roster into a closed wire', () => {
        button(teamView(), 'Fill open RB slot').props.onClick();
        const dialog = region(teamView(), 'Fill RB'); assert(dialog);
        assert(text(dialog).includes('Acquisitions are closed')); assert(text(dialog).includes('review the roster recovery notice'));
        assert(!button(dialog, 'Find eligible RB free agents →'));
        league = E.reopenPlanning(league, stamp); states = []; refs = [];
        button(teamView(), 'Fill open RB slot').props.onClick();
        button(region(teamView(), 'Fill RB'), 'Find eligible RB free agents →').props.onClick(); assert.equal(target, 'RB');
    });
    await test('the dock names structural needs and offers visible host confirmation before either locked stage', async () => {
        for (const stage of ['lineup', 'ready']) {
            reset({ ...missing(create()), weekStage: stage });
            const tree = gates(), confirmation = byClass(tree, 'tl-gate-planning-recovery'); assert(confirmation);
            assert(text(tree).includes('Atlas: RB needs an eligible player'));
            assert(button(tree, stage === 'lineup' ? 'Lock lineup' : 'Start game day').props.disabled);
            assert(!button(tree, 'Reopen lineups'), 'Reopening assignments alone cannot repair an unfillable roster');
            await Promise.all([button(confirmation, 'Confirm reopen planning').props.onClick(), button(confirmation, 'Confirm reopen planning').props.onClick()]);
            assert.deepEqual(calls, [{ type: 'reopen-planning' }]);
        }
    });
    await test('dock members cannot reopen, majority votes remain early, and save/auth paths retain priority', async () => {
        league = { ...league, settings: { ...league.settings, advancementMode: 'majority' } };
        let tree = gates({ onlineMeta: { role: 'member', seatTeamId: 't1' } });
        assert(!byClass(tree, 'tl-gate-planning-recovery')); assert(text(tree).includes('Ask the commissioner'));
        assert(!button(tree, 'Vote to advance').props.disabled); assert(button(tree, 'Review roster need'));
        tree = gates({ saving: true }); assert(button(tree, 'Confirm reopen planning').props.disabled);
        await button(tree, 'Confirm reopen planning').props.onClick(); assert.equal(calls.length, 0);
        tree = gates({ authRequired: true }); assert(!byClass(tree, 'tl-gate-planning-recovery')); assert(text(tree).includes('Sign in again'));
        tree = gates({ saveError: true, saveConflict: true, onRetrySave() {} }); assert(!byClass(tree, 'tl-gate-planning-recovery')); assert(button(tree, 'Load latest save'));
        tree = gates({ onAction: async () => false }); await button(tree, 'Confirm reopen planning').props.onClick(); assert(text(gates()).includes('Planning was not reopened'));
        assert(!button(gates(), 'Confirm reopen planning').props.disabled, 'The footer confirmation remains available after a failed save');
        reset(missing(create(2, { waiversEnabled: false, tradesEnabled: false })));
        tree = gates(); assert(!byClass(tree, 'tl-gate-planning-recovery')); assert(text(tree).includes('Waivers and trades are both disabled'));
    });
    await test('footer readiness and recovery disclosures replace one another in either direction', () => {
        const tree = gates(), readiness = byClass(tree, 'tl-gate-readiness'), recovery = byClass(tree, 'tl-gate-planning-recovery');
        const readyDetails = { open: false }, recoveryDetails = { open: true };
        const footer = { querySelectorAll: () => [readyDetails, recoveryDetails].filter(details => details.open) };
        readiness.children.find(node => node?.type === 'summary').props.onClick({ currentTarget: { parentElement: readyDetails, closest: () => footer } });
        assert(!recoveryDetails.open, 'Readiness actions cannot be covered by the previous recovery panel');
        readyDetails.open = true;
        recovery.children.find(node => node?.type === 'summary').props.onClick({ currentTarget: { parentElement: recoveryDetails, closest: () => footer } });
        assert(!readyDetails.open, 'Recovery review also closes the previous readiness panel');
        assert.equal(calls.length, 0, 'Switching disclosures never commits a recovery');
    });
    await test('reopened claims explain the human-only window and choose the enabled acquisition route', () => {
        league = E.reopenPlanning(league, stamp);
        let window = region(teamView(), 'Reopened planning window'); assert(text(window).includes('spent FAAB stay final')); assert(text(window).includes('not file another automatic waiver batch'));
        button(window, 'Open free agents').props.onClick(); assert.equal(target, 'waivers');
        assert(text(gates()).includes('Roster recovery planning'));
        reset(missing(create(2, { waiversEnabled: false, tradesEnabled: true }))); league = E.reopenPlanning(league, stamp);
        window = region(teamView(), 'Reopened planning window'); assert(!button(window, 'Open free agents'));
        button(window, 'Open trades').props.onClick(); assert.equal(target, 'trades');
        states = []; refs = [];
        assert(!button(region(teamView({ section: 'trades' }), 'Reopened planning window'), 'Open trades'));
    });
    await test('same-week receipts retain earlier awards and current activity without inventing a batch boundary', () => {
        league = { ...league, currentWeek: 2, weekStage: 'claims', planningRecoveryWeek: 2,
            waiverResults: [{ week: 1, identity: 'old', name: 'Prior Week', winnerTeamId: 't1', contenderTeamIds: ['t1'] },
                { week: 2, identity: 'first', name: 'First Award', winnerTeamId: 't1', contenderTeamIds: ['t1'] },
                { week: 2, identity: 'second', name: 'Recovery Award', winnerTeamId: 't1', contenderTeamIds: ['t1'] }],
            activity: [{ id: 'a1', week: 2, kind: 'waiver', message: 'Existing current-week settlement record' }] };
        const before = JSON.stringify(league);
        let receipt = region(teamView({ section: 'waivers' }), 'Week 2 waiver results'); assert(receipt);
        assert(text(receipt).includes('First Award, Recovery Award')); assert(!text(receipt).includes('Prior Week'));
        assert(text(receipt).includes('Existing current-week settlement record'));
        assert.equal(JSON.stringify(league), before);
        league = { ...league, currentWeek: 3, weekStage: 'postgame' }; states = []; refs = [];
        receipt = region(teamView({ section: 'waivers' }), 'Week 2 waiver results'); assert(text(receipt).includes('First Award, Recovery Award'), 'The saved combined recovery-week record remains honestly labeled after scoring');
        league = { ...league, currentWeek: 2, weekStage: 'claims' };
        delete league.planningRecoveryWeek; states = []; refs = [];
        receipt = region(teamView({ section: 'waivers' }), 'Latest waiver batch'); assert(text(receipt).includes('Prior Week')); assert(!text(receipt).includes('Recovery Award'));
    });
    await test('recovery-only dock rendering never reads private assigned years or decks', () => {
        league = { ...league, settings: { ...league.settings, hiddenYears: true } };
        for (const team of league.teams) for (const entry of team.roster) {
            delete entry.drawnSeason; Object.defineProperty(entry, 'drawnSeason', { get() { throw new Error('Private year consulted'); } });
        }
        for (const key of ['privateGameDecks', 'hiddenYearAssignments']) Object.defineProperty(league, key, { get() { throw new Error(`${key} consulted`); } });
        assert(byClass(gates(), 'tl-gate-planning-recovery')); assert(text(gates()).includes('RB needs an eligible player'));
    });
    console.log(`PASS: ${count} planning recovery UI cases; structural versus movable needs, host/member authority, serial saves and failures, keyboard cancellation, honest acquisition routes and same-week saved receipts.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
