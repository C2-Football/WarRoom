#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
global.window = globalThis; window.App = {};
for (const name of ['roster', 'helmet', 'rules', 'draft-room', 'era-rules', 'season', 'engine', 'ui']) require(`../js/shared/time-league-${name}.js`);
let states = [], cursor = 0;
global.React = {
    createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : ({ type, props: props || {}, children }),
    useState: initial => { const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; },
    useMemo: fn => fn(), useRef: () => ({ current: null }), useEffect() {}, Fragment: 'fragment',
};
window.TimeLeagueHelmetIcon = () => null;
require('../js/components/time-league-week-gates.js');
require('../js/components/time-league-standings-panel.js');
const E = App.TimeLeagueEngine, S = App.TimeLeagueSeason;
const stamp = '2026-10-21T00:00:00Z';
const entry = teamId => ({ entryId: `${teamId}-qb`, identity: `qb:${teamId}`, name: `${teamId} Quarterback`, position: 'QB', slot: 'QB', drawnSeason: 2020 });
function create(count = 4, settings = {}) {
    const league = E.createTimeLeague({ name: 'Gate decisions', seed: 'gate-readiness', createdAt: stamp,
        settings: { gameDeckVersion: 0, hiddenYears: false, rosterSlots: { QB: 1, BN: 1 }, regularSeasonWeeks: 2, playoffTeams: 0,
            scoring: { passTd: 4, reception: .5, rushRecYd: .1, passingYd: .04, turnover: -2 }, ...settings },
        seats: Array.from({ length: count }, (_, i) => ({ name: i === 1 ? 'Missing Morgan' : `Manager ${i + 1}`, manager: 'human' })) });
    return { ...league, phase: 'season', weekStage: 'lineup', seasonsRevealed: true, teams: league.teams.map(team => ({ ...team, roster: [entry(team.teamId)] })) };
}
const gap = (league, teamId) => ({ ...league, teams: league.teams.map(team => team.teamId === teamId ? { ...team, roster: team.roster.map(player => ({ ...player, slot: 'BN' })) } : team) });
const reset = () => { states = []; cursor = 0; };
const render = fn => { cursor = 0; return fn(); };
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.children)];
const content = node => !node ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(content).join(' ') : content(node.children);
const button = (tree, label) => walk(tree).find(node => node.type === 'button' && content(node.children) === label);
const hasReadiness = tree => walk(tree).some(node => node.props.className === 'tl-gate-readiness');
let action, target, review;
function gates(league, props = {}) {
    return render(() => WrTimeLeagueWeekGates({ league, teamId: 't1', currentTab: league.weekStage === 'ready' ? 'gameday' : 'roster', dataReady: true,
        onAction: next => { action = next; }, onNavigate: next => { target = next; }, ...props }));
}
let passed = 0;
async function test(name, run) { reset(); action = target = review = undefined; await run(); passed++; console.log(`  ok ${name}`); }

(async () => {
    await test('the legal blocker is named before Lock, with direct local hotseat repair', () => {
        const league = gap(create(), 't2'), before = JSON.stringify(league);
        let tree = gates(league, { onReviewLineup: teamId => { review = teamId; } });
        assert(hasReadiness(tree)); assert(content(tree).includes('Missing Morgan: QB slot is empty'));
        assert(button(tree, 'Lock lineup').props.disabled);
        button(tree, 'Fix Missing Morgan lineup').props.onClick(); assert.equal(review, 't2');
        assert.equal(JSON.stringify(league), before, 'Opening repairs does not mutate the saved lineup');
        tree = gates(gap(league, 't1'));
        button(tree, 'Fix my lineup').props.onClick(); assert.equal(target, 'roster', 'A current roster tab still has a reachable repair action');
        tree = gates(league, { currentTab: 'home' });
        assert(!button(tree, 'Lock lineup')); assert(!button(tree, 'Set lineup').props.disabled);
        button(tree, 'Set lineup').props.onClick(); assert.equal(target, 'roster');
    });
    await test('shared-room voting keeps early votes available while naming every blocker', () => {
        const league = gap(create(4, { advancementMode: 'majority' }), 't2');
        const meta = { role: 'member', seatTeamId: 't1' };
        let tree = gates(league, { onlineMeta: meta });
        assert(!button(tree, 'Vote to advance').props.disabled);
        button(tree, 'Vote to advance').props.onClick(); assert.equal(action.type, 'vote-advance');
        assert(!button(tree, 'Fix Missing Morgan lineup'), 'An online member cannot edit another manager');
        assert(content(tree).includes('Missing Morgan: QB slot is empty'));
        tree = gates({ ...league, gateVotes: ['t1'] }, { onlineMeta: meta }); assert(button(tree, 'Vote recorded').props.disabled);
        tree = gates(league, { onlineMeta: meta, dataReady: false }); assert(button(tree, 'Vote to advance').props.disabled);
        tree = gates(league, { onlineMeta: meta, saving: true }); assert(button(tree, 'Saving…').props.disabled);
    });
    await test('closing readiness by button or Escape returns focus to its available summary', () => {
        const tree = gates(gap(create(), 't2'));
        const disclosure = walk(tree).find(node => node.props.className === 'tl-gate-readiness');
        let focused = 0, prevented = false, stopped = false;
        const details = { open: true, closest: () => details, querySelector: selector => { assert.equal(selector, 'summary'); return { focus: () => { focused++; } }; } };
        walk(tree).find(node => node.props['aria-label'] === 'Close lineup readiness').props.onClick({ currentTarget: details });
        assert.equal(details.open, false); assert.equal(focused, 1);
        details.open = true;
        disclosure.props.onKeyDown({ key: 'Escape', currentTarget: details, preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
        assert.equal(details.open, false); assert.equal(focused, 2); assert(prevented && stopped);
        disclosure.props.onKeyDown({ key: 'Escape', currentTarget: details }); assert.equal(focused, 2, 'An already closed disclosure leaves focus alone');
    });
    await test('commissioner and timed controls cannot bypass blockers', () => {
        const league = gap(create(4, { advancementMode: 'timed' }), 't2');
        const props = { onlineMeta: { role: 'commissioner', seatTeamId: 't1' } };
        let tree = gates(league, props);
        assert(button(tree, 'Lock lineup').props.disabled); assert(content(tree).includes('Deadline:'));
        walk(tree).find(node => node.props['aria-label'] === 'Week options').props.onClick(); tree = gates(league, props);
        assert(button(tree, 'Commissioner override · Lock lineup').props.disabled);
        assert(content(tree).includes('Time per stage'), 'Readiness does not replace the existing timing settings');
        tree = gates(league, { saving: true }); assert(button(tree, 'Saving…').props.disabled);
    });
    await test('a locked invalid lineup exposes the authorized reopen action and respects failed saves', async () => {
        const league = { ...gap(create(), 't1'), weekStage: 'ready' };
        let tree = gates(league, { onReviewLineup: teamId => { review = teamId; }, onAction: next => { action = next; return true; } });
        assert(button(tree, 'Start game day').props.disabled);
        await button(tree, 'Reopen lineups').props.onClick(); assert.deepEqual(action, { type: 'reopen-lineups' }); assert.equal(review, 't1');
        tree = gates({ ...gap(create(), 't2'), weekStage: 'ready' }, { onReviewLineup: teamId => { review = teamId; }, onAction: () => true });
        await button(tree, 'Reopen lineups').props.onClick(); assert.equal(review, 't2', 'A local host lands on the blocked manager instead of the active legal lineup');
        review = undefined;
        tree = gates(league, { onReviewLineup: teamId => { review = teamId; }, onAction: () => false });
        await button(tree, 'Reopen lineups').props.onClick(); assert.equal(review, undefined, 'A failed authoritative change cannot pretend to reopen the roster');
        tree = gates(league, { onlineMeta: { role: 'member', seatTeamId: 't1' } });
        assert(!button(tree, 'Reopen lineups')); assert(button(tree, 'Review my lineup'));
        assert(content(tree).includes('commissioner must reopen'));
    });
    await test('save recovery, authentication and first playback keep their existing primary controls', () => {
        const league = gap(create(), 't1');
        let tree = gates(league, { authRequired: true }); assert(!hasReadiness(tree)); assert(content(tree).includes('Sign in again'));
        tree = gates(league, { saveError: true, saveConflict: true, onRetrySave: () => { action = 'load'; } });
        assert(!hasReadiness(tree)); button(tree, 'Load latest save').props.onClick(); assert.equal(action, 'load');
        tree = gates(league, { playback: { week: 1, done: false, playing: false, nextQuarter() {}, toggle() {} }, currentTab: 'gameday' });
        assert(!hasReadiness(tree)); assert(button(tree, 'Next quarter')); assert(!button(tree, 'Lock lineup'));
        tree = gates({ ...league, weekStage: 'claims' }); assert(!hasReadiness(tree), 'Planning does not become a premature lineup gate');
    });
    await test('no-record starters stay legal, regular byes require a lineup, playoff observers do not', () => {
        assert(!hasReadiness(gates(create())), 'A filled legal lineup is ready even without historical data');
        const odd = create(3), bye = odd.teams.find(team => E.weekParticipation(odd, team.teamId).kind === 'bye');
        assert(hasReadiness(gates(gap(odd, bye.teamId))), 'Regular bye points still require a legal lineup');
        const regular = create(4, { regularSeasonWeeks: 1, playoffTeams: 2 });
        const postseason = { ...E.finalizeCurrentWeek(regular, new Map(), null, stamp), weekStage: 'lineup' };
        const pair = E.playoffPairs(postseason, postseason.currentWeek)[0], observer = postseason.teams.find(team => !pair.includes(team.teamId));
        const watching = gap(postseason, observer.teamId);
        assert(!hasReadiness(gates(watching, { teamId: observer.teamId })), 'An eliminated empty lineup is not a blocker');
        const blocked = gap(watching, pair[0]);
        const tree = gates(blocked, { teamId: observer.teamId, onlineMeta: { role: 'member', seatTeamId: observer.teamId } });
        assert(hasReadiness(tree)); assert(!button(tree, 'Fix my lineup'));
        assert(!content(tree).includes(`${observer.name}: QB slot is empty`));
    });
    const profile = (league, teamId) => { reset(); return render(() => WrTimeLeagueStandingsPanel({ league, profileTeamId: teamId, profileOnly: true })); };
    await test('team history distinguishes a scored bye from an unavailable matchup and playoff observation', () => {
        const regular = create(3), bye = regular.teams.find(team => E.weekParticipation(regular, team.teamId).kind === 'bye');
        const index = S.buildGameLogIndex(regular.teams.map(team => ({ identity: team.roster[0].identity, season: 2020, week: 1, stats: { ...S.emptyStatLine(), passYd: 100 } })));
        const settled = E.finalizeCurrentWeek(regular, index, null, stamp);
        const tree = profile(settled, bye.teamId); assert(content(tree).includes('Bye · lineup points still count')); assert(content(tree).includes('4.0 pts'));
        const damaged = { ...settled, finalizedWeeks: [{ week: 1, results: [], matchups: [] }], schedule: [] };
        assert(content(profile(damaged, bye.teamId)).includes('Matchup not recorded'));
        assert(!content(profile(damaged, bye.teamId)).includes('Bye'));
        const playoff = create(4, { regularSeasonWeeks: 1, playoffTeams: 2 });
        const current = E.finalizeCurrentWeek(playoff, new Map(), null, stamp);
        const final = E.finalizeCurrentWeek(current, new Map(), null, stamp);
        const pair = final.finalizedWeeks.at(-1).matchups[0], observer = final.teams.find(team => ![pair.home, pair.away].includes(team.teamId));
        const completed = content(profile(final, observer.teamId));
        assert(completed.includes('Not in this playoff round')); assert(!completed.includes('Bye')); assert(completed.includes('Season complete.'));
    });
    await test('the active playoff pairing is shown without inventing a future final', () => {
        const league = create(4, { regularSeasonWeeks: 1, playoffTeams: 4 });
        const postseason = E.finalizeCurrentWeek(league, new Map(), null, stamp);
        const pair = E.playoffPairs(postseason, postseason.currentWeek)[0];
        const tree = profile(postseason, pair[0]), schedule = walk(tree).find(node => node.type === 'h3' && content(node) === 'Remaining schedule');
        assert(schedule); assert(content(tree).includes(postseason.teams.find(team => team.teamId === pair[1]).name));
        assert(content(tree).includes('Playoff matchup not yet set')); assert(!content(tree).includes('Season complete.'));
    });
    console.log(`PASS: ${passed} rendered gate/profile cases: legal named repairs, local/online ownership, voting, timed authority, save/auth/playback continuity, regular byes and playoff observers.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
