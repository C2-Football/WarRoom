#!/usr/bin/env node
'use strict';
const assert = require('assert');
global.window = globalThis;
global.App = {};
for (const module of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'ai', 'ui', 'player-cards', 'player-stats']) require('../js/shared/time-league-' + module + '.js');
let state = [], refs = [], effects = [], cursor = 0, refCursor = 0;
global.React = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : ({ type, props: props || {}, children }),
    useMemo: fn => fn(),
    useState: initial => {
        const index = cursor++;
        if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
        return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
    },
    useRef: initial => { const index = refCursor++; return refs[index] ||= { current: initial }; },
    useEffect: fn => { effects.push(fn); },
};
require('../js/components/time-league-team-panel.js');
const E = App.TimeLeagueEngine, S = App.TimeLeagueSeason;
const reset = () => { state = []; refs = []; effects = []; };
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.children)];
const text = node => JSON.stringify(node);
const button = (tree, label) => walk(tree).find(node => node.type === 'button' && node.props['aria-label'] === label);
const byClass = (tree, cls) => walk(tree).filter(node => node.props.className?.split(' ').includes(cls));
let league = E.createTimeLeague({ name: 'Named roster swaps', seed: 'roster-ui', createdAt: '2026-01-01',
    settings: { gameDeckVersion: 0, waiversEnabled: true, rosterSlots: { QB: 1, WR: 1, TE: 1, FLEX: 1, SUPER_FLEX: 1, DEF: 1, BN: 4 }, regularSeasonWeeks: 12, playoffTeams: 4, scoring: { passingYd: .04, passTd: 4, turnover: -2, rushRecYd: .1, reception: .5 }, eraRules: { mode: 'any' } },
    seats: Array.from({ length: 4 }, (_, index) => ({ name: index ? `Rival ${index}` : 'Commander', manager: index ? 'ai' : 'human' })),
});
const entry = (entryId, name, position, slot) => ({ entryId, identity: position.toLowerCase() + ':' + entryId, name, position, slot, drawnSeason: 1994 });
const entries = [entry('young', 'Steve Young', 'QB', 'QB'), entry('montana', 'Joe Montana', 'QB', 'BN'), entry('stabler', 'Ken Stabler', 'QB', 'BN'), entry('payton', 'Walter Payton', 'RB', 'BN'), entry('rice', 'Jerry Rice', 'WR', 'WR'), entry('sharpe', 'Shannon Sharpe', 'TE', 'BN')];
const cards = new Map(entries.map(item => [item.identity, { identity: item.identity, name: item.name, position: item.position, peak: 200,
    seasons: [1993, 1994, 1995].map(year => ({ season: year, games: 14, points: 200, passYd: 100, passTd: 2, passInt: 0, rushYd: 20, rushTd: 0, rec: 0, recYd: 0, recTd: 0 })) }]));
for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) cards.set('free:' + pos, { identity: 'free:' + pos, name: 'Free ' + pos, position: pos, peak: 100, seasons: [{ season: 1994, games: 14, points: 100 }] });
const logs = new Map();
for (const item of entries) for (let week = 1; week <= 14; week++) logs.set(S.gameLogKey(item.identity, 1994, week), { stats: { ...S.emptyStatLine(), passYd: week * 10, rushYd: week * 10 } });
league = { ...league, phase: 'season', weekStage: 'lineup', currentWeek: 3, seasonsRevealed: true,
    teams: league.teams.map((team, index) => ({ ...team, roster: index ? [entry('foreign', 'Not Your Player', 'QB', 'QB')] : entries })) };
let applied = [], saveResult = true, browsedSlot = null, selectedTeam;
const render = (extra = {}) => {
    cursor = 0; refCursor = 0; effects = [];
    return WrTimeLeagueTeamPanel({ league, cards, section: 'roster', activeTeamId: league.teams[0].teamId, logIndex: logs,
        onSelectTeam: id => { selectedTeam = id; },
        onBrowseWaivers: slot => { browsedSlot = slot; },
        onUpdate: async (next, action) => { applied.push({ next, action }); return saveResult; }, ...extra });
};
const choices = tree => byClass(tree, 'tl-roster-candidate').map(node => node.props['aria-label']);

(async () => {
    assert(byClass(render(), 'tl-lineup-ytd').length === entries.length, 'Starters and bench each show a YTD points column');
    let tree = render({ activeTeamId: league.teams[1].teamId });
    assert(text(tree).includes('Steve Young'));
    assert(!text(tree).includes('Not Your Player'));
    assert(!walk(tree).some(node => node.props['aria-label'] === 'Teams'));
    assert.equal(byClass(tree, 'tl-roster-dossier').length, 0, 'No empty scouting column on a roster visit');
    assert.equal(byClass(tree, 'tl-lineup-hero').length, 0, 'Roster rows follow one compact toolbar');
    assert(byClass(tree, 'tl-roster-toolbar').length);
    assert(walk(tree).find(node => node.type === 'details' && text(node).includes('Lineup tips')));

    button(tree, 'Move Steve Young').props.onClick();
    tree = render();
    assert.deepEqual(choices(tree), ['Swap Steve Young with Joe Montana', 'Swap Steve Young with Ken Stabler']);
    assert(text(byClass(tree, 'tl-roster-move-sheet')).includes('1994 · Bench'));
    assert(text(byClass(tree, 'tl-roster-move-sheet')).includes('of 5 stars this week'));
    await button(tree, 'Swap Steve Young with Ken Stabler').props.onClick();
    let last = applied.at(-1);
    assert.equal(last.action.targetEntryId, 'stabler');
    assert.equal(last.next.teams[0].roster.find(item => item.entryId === 'young').slot, 'BN');
    assert.equal(last.next.teams[0].roster.find(item => item.entryId === 'stabler').slot, 'QB');
    assert.equal(last.next.teams[0].roster.filter(item => item.slot === 'BN').length, 4, 'A full bench remains legal after an exact swap');
    assert.equal(byClass(render(), 'tl-roster-move-sheet').length, 0, 'Successful save closes the choice sheet');

    button(render(), 'Fill open TE slot').props.onClick();
    tree = render();
    assert.deepEqual(choices(tree), ['Start Shannon Sharpe at TE']);
    await button(tree, 'Start Shannon Sharpe at TE').props.onClick();
    assert.equal(applied.at(-1).next.teams[0].roster.find(item => item.entryId === 'sharpe').slot, 'TE');

    button(render(), 'Fill open Flex slot').props.onClick();
    tree = render();
    assert(choices(tree).includes('Start Walter Payton at Flex'));
    assert(choices(tree).includes('Start Shannon Sharpe at Flex'));
    assert(choices(tree).includes('Start Jerry Rice at Flex'));
    assert(!choices(tree).some(label => /Young|Montana|Stabler/.test(label)));
    button(tree, 'Close lineup choices').props.onClick();
    button(render(), 'Fill open Super flex slot').props.onClick();
    tree = render();
    assert.equal(choices(tree).length, entries.length, 'Super flex offers every eligible rostered QB, RB, WR and TE');
    button(tree, 'Close lineup choices').props.onClick();
    button(render(), 'Fill open D/ST slot').props.onClick();
    tree = render();
    assert.equal(choices(tree).length, 0);
    assert(text(tree).includes('No eligible players on your roster'));
    byClass(tree, 'tl-roster-find-player')[0].props.onClick();
    assert.equal(browsedSlot, 'DEF');

    // The same sheet supports keyboard focus and restores scrolling after dismissal.
    let focusName = '';
    const firstControl = { focus: () => { focusName = 'first'; } };
    const lastControl = { focus: () => { focusName = 'last'; } };
    const previous = { focus: () => { focusName = 'previous'; } };
    global.document = { body: { style: { overflow: 'auto' } }, activeElement: previous };
    button(render(), 'Move Steve Young').props.onClick();
    tree = render();
    const sheet = byClass(tree, 'tl-roster-move-sheet')[0];
    sheet.props.ref.current = { focus: () => { focusName = 'sheet'; }, querySelectorAll: () => [firstControl, lastControl] };
    const cleanupFocus = effects.map(effect => effect()).find(result => typeof result === 'function');
    assert.equal(focusName, 'sheet'); assert.equal(document.body.style.overflow, 'hidden');
    let prevented = false;
    document.activeElement = firstControl;
    sheet.props.onKeyDown({ key: 'Tab', shiftKey: true, preventDefault: () => { prevented = true; } });
    assert(prevented); assert.equal(focusName, 'last');
    document.activeElement = lastControl;
    sheet.props.onKeyDown({ key: 'Tab', shiftKey: false, preventDefault: () => {} });
    assert.equal(focusName, 'first');
    sheet.props.onKeyDown({ key: 'Escape', preventDefault: () => {} });
    assert.equal(byClass(render(), 'tl-roster-move-sheet').length, 0);
    cleanupFocus();
    assert.equal(document.body.style.overflow, 'auto'); assert.equal(focusName, 'previous');
    delete global.document;

    saveResult = false;
    button(render(), 'Move Steve Young').props.onClick();
    await button(render(), 'Swap Steve Young with Joe Montana').props.onClick();
    tree = render();
    assert.equal(byClass(tree, 'tl-roster-move-sheet').length, 1, 'Failed saves retain named choices');
    assert(text(tree).includes('Move was not saved'));
    button(tree, 'Close lineup choices').props.onClick();
    saveResult = true;

    league = { ...league, seasonsRevealed: false };
    button(render(), 'Move Steve Young').props.onClick();
    tree = render();
    assert(!text(byClass(tree, 'tl-roster-move-sheet')).includes('1994'));
    assert(!text(byClass(tree, 'tl-roster-move-sheet')).includes('of 5 stars'));
    button(tree, 'Close lineup choices').props.onClick();
    button(render(), "Explore Steve Young's history").props.onClick();
    assert(text(byClass(render(), 'tl-roster-dossier')).includes('Your edition is sealed'));
    assert(!text(byClass(render(), 'tl-roster-dossier')).includes('1993'));
    league = { ...league, seasonsRevealed: true };
    tree = render();
    assert(text(byClass(tree, 'tl-roster-dossier')).includes('1993'));
    assert(!text(byClass(tree, 'tl-roster-dossier')).includes('1995'), 'Player archive still stops before the drawn season');
    const removedLogs = [];
    for (let week = 4; week <= 11; week++) {
        const key = S.gameLogKey(entries[0].identity, 1994, week);
        removedLogs.push([key, logs.get(key)]); logs.delete(key);
    }
    tree = render();
    const futureWeeks = byClass(tree, 'tl-outlook-week').filter(node => node.props['aria-label'].endsWith(': sealed'));
    assert.equal(futureWeeks.length, 11, 'Every future week stays sealed, including an eight-week missing stretch');
    assert(futureWeeks.every(node => !node.props.className.includes('missing') && text(node).includes('Sealed') && !text(node).includes('★')));
    assert(text(byClass(tree, 'tl-roster-dossier')).includes('Vault weeks left'));
    assert(!text(tree).includes('games left'), 'Roster rows must not disclose exact remaining participation');
    assert(text(byClass(tree, 'tl-archive-season-scope')).includes('Archive GP · W1–14'), 'Legacy counts are never presented as full-season NFL appearances');
    const youngCard = cards.get(entries[0].identity);
    cards.legacyCards = new Map(cards);
    cards.set(entries[0].identity, { ...youngCard, seasons: youngCard.seasons.map(season => season.season === 1994 ? { ...season, games: 16, recordedGames: 16, points: 320, scheduledGames: 16, sourceWeekKind: 'nfl-week' } : season) });
    tree = render();
    const scope = text(byClass(tree, 'tl-archive-season-scope'));
    assert(scope.includes('Recorded GP') && scope.includes('NFL schedule') && scope.includes('16 games') && scope.includes('14 weeks'), 'NFL schedule, logged appearances and Vault length remain distinct');
    assert(scope.includes('Full NFL season') && scope.includes('320.0 pts') && scope.includes('Legacy Vault · W1–14') && scope.includes('200.0 pts'), 'Old saves show full historical totals separately from preserved league pricing');
    const youngRow = byClass(tree, 'tl-lineup-row').find(row => text(row).includes('Steve Young'));
    assert(text(byClass(youngRow, 'tl-lineup-pts')[0]).includes('200.0'), 'Old roster SZN points keep legacy league values');
    assert(!scope.includes('NFL GP'), 'Recorded games are not claimed to be verified official participation');
    const currentKey = S.gameLogKey(entries[0].identity, 1994, 3), currentLog = logs.get(currentKey);
    logs.delete(currentKey); tree = render();
    assert(text(byClass(tree, 'tl-lineup-player')).includes('No recorded game'));
    assert(byClass(tree, 'tl-outlook-week').filter(node => node.props['aria-label'].endsWith(': sealed')).every(node => !node.props.className.includes('missing')), 'A missing current game never reveals future absences');
    logs.set(currentKey, currentLog);
    cards.set(entries[0].identity, youngCard);
    delete cards.legacyCards;
    for (const [key, log] of removedLogs) logs.set(key, log);

    league = { ...league, weekStage: 'postgame' };
    tree = render();
    assert(byClass(tree, 'tl-week-stars').every(node => text(node).includes('Awaiting next week') && !text(node).includes('No recorded game')));
    assert.equal(byClass(tree, 'tl-outlook-week').filter(node => node.props['aria-label'].endsWith(': sealed')).length, 12, 'Postgame keeps the upcoming currentWeek sealed until Advance week');

    league = { ...league, weekStage: 'ready' };
    const before = applied.length;
    tree = render();
    assert(button(tree, 'Move Steve Young').props.disabled);
    assert(button(tree, 'Fill open TE slot').props.disabled);
    assert.equal(walk(tree).filter(node => node.props.draggable).length, 0);
    button(tree, 'Move Steve Young').props.onClick();
    assert.equal(byClass(render(), 'tl-roster-move-sheet').length, 0);
    assert.equal(applied.length, before);
    reset();
    assert(!text(render({ onlineMeta: { seatTeamId: 'outsider' } })).includes('Steve Young'), 'No fallback into another roster for an unseated online viewer');
    league = { ...league, weekStage: 'lineup', teams: league.teams.map((team, index) => index === 1 ? { ...team, manager: 'human' } : team) };
    reset(); tree = render();
    const hotseat = walk(tree).find(node => node.props['aria-label'] === 'Hotseat manager');
    assert(hotseat);
    assert.equal(walk(hotseat).filter(node => node.type === 'option').length, 2);
    hotseat.props.onChange({ target: { value: league.teams[1].teamId } });
    assert.equal(selectedTeam, league.teams[1].teamId);
    reset(); tree = render({ activeTeamId: league.teams[0].teamId, onlineMeta: { seatTeamId: league.teams[1].teamId } });
    assert(text(tree).includes('Not Your Player')); assert(!text(tree).includes('Steve Young'));
    assert(!walk(tree).some(node => node.props['aria-label'] === 'Hotseat manager'));

    league = { ...league, weekStage: 'claims' };
    logs.set(S.gameLogKey('free:WR', 1994, 1), { stats: { ...S.emptyStatLine(), rushYd: 1000 } });
    for (const [pos, stats] of [['WR', { rushYd: 200 }], ['RB', { rushYd: 50 }], ['TE', { passInt: 1 }]]) {
        logs.set(S.gameLogKey('free:' + pos, 1994, 3), { stats: { ...S.emptyStatLine(), ...stats } });
    }
    reset(); tree = render({ section: 'waivers', waiverSlot: 'FLEX' });
    let wire = byClass(tree, 'tl-waiver-table')[0];
    assert(text(wire).includes('Free RB') && text(wire).includes('Free WR') && text(wire).includes('Free TE'));
    assert(!text(wire).includes('Free QB') && !text(wire).includes('Free K') && !text(wire).includes('Free DEF'));
    assert(text(wire).includes('1994 season') && !text(wire).includes('CAREER BEST'), 'The wire names the actual weekly edition');
    assert(!text(wire).includes('G LEFT'), 'Free agency does not disclose future game counts');
    assert.deepEqual(byClass(wire, 'tl-waiver-score').map(node => node.children[0]), ['20.0', '5.0', '-2.0'], 'Free agents rank by points still playable, including negative scores');
    assert(text(byClass(wire, 'tl-waiver-score')[0]).includes('120.0 total'), 'Already-played points only appear in the season total');
    button(tree, 'Claim Free WR').props.onClick(); tree = render({ section: 'waivers' });
    assert(text(byClass(tree, 'tl-waiver-preview')).includes('20.0') && text(byClass(tree, 'tl-waiver-preview')).includes('120.0'), 'Claim builder carries the same remaining and total points');
    assert(text(byClass(tree, 'tl-waiver-preview')).includes('Vault weeks left') && !text(byClass(tree, 'tl-waiver-preview')).includes('Games left'));
    const claimDialog = byClass(tree, 'tl-waiver-claim')[0];
    assert.equal(claimDialog.type, 'dialog', 'Claim selection opens a modal instead of a builder below the wire');
    assert(!walk(tree).some(node => node.type === 'select' && node.props['aria-label'] === 'Drop entry'));
    assert.equal(byClass(tree, 'tl-waiver-drop-option').filter(node => node.props['aria-label']).length, entries.length);
    assert(text(byClass(tree, 'tl-waiver-drop-option')).includes('Est. pts left') && text(byClass(tree, 'tl-waiver-drop-option')).includes('W3'), 'Drop choices carry remaining points and weekly outlook');
    assert(text(claimDialog).includes('Vault W3 vs'), 'The claim includes the actual current Vault opponent');
    const roomySettings = league.settings;
    league = { ...league, settings: { ...league.settings, rosterSlots: { QB: 1, WR: 1, BN: 4 } } };
    tree = render({ section: 'waivers' });
    assert(button(tree, 'Drop Steve Young').props.disabled, 'A full roster cannot trade its only QB slot for a WR');
    assert(!button(tree, 'Drop Joe Montana').props.disabled, 'A bench drop remains eligible on a full roster');
    button(tree, 'Drop Joe Montana').props.onClick(); tree = render({ section: 'waivers' });
    assert(button(tree, 'Drop Joe Montana').props['aria-pressed']);
    saveResult = false;
    const file = page => walk(page).find(node => node.type === 'button' && text(node.children).includes('FILE CLAIM'));
    await file(tree).props.onClick(); tree = render({ section: 'waivers' });
    assert(text(tree).includes('Claim was not saved'));
    assert(button(tree, 'Drop Joe Montana').props['aria-pressed'], 'Failed saves retain the selected drop');
    assert.equal(applied.at(-1).action.dropEntryId, 'montana');
    claimDialog.props.onCancel({ preventDefault() {} });
    button(render({ section: 'waivers' }), 'Claim Free WR').props.onClick(); tree = render({ section: 'waivers' });
    assert(button(tree, 'Drop Joe Montana').props['aria-pressed'], 'Reopening the same claim retains the comparison');
    saveResult = true;
    league = { ...league, settings: roomySettings };
    const legacyLeague = league;
    const legacyPreview = E.waiverPreview;
    E.waiverPreview = (state, ...args) => ({ ...legacyPreview({ ...state, settings: { ...state.settings, gameDeckVersion: 0 } }, ...args), estimated: true });
    league = { ...league, settings: { ...league.settings, gameDeckVersion: 1 } };
    tree = render({ section: 'waivers' });
    assert(text(byClass(tree, 'tl-waiver-table')).includes('EST. PTS LEFT'));
    assert(text(byClass(tree, 'tl-waiver-preview')).includes('Estimated points left') && text(byClass(tree, 'tl-waiver-preview')).includes('Recorded season total'), 'New deck estimates are not represented as guaranteed future points');
    league = legacyLeague; E.waiverPreview = legacyPreview;
    tree = render({ section: 'waivers', logIndex: null });
    assert(byClass(tree, 'tl-waiver-score').every(node => node.children[0] === '—'), 'Missing scoring data stays unknown rather than showing career-best points');
    reset(); tree = render({ section: 'waivers', waiverSlot: 'SUPER_FLEX' });
    wire = byClass(tree, 'tl-waiver-table')[0];
    assert(text(wire).includes('Free QB'));
    assert(!text(wire).includes('Free K') && !text(wire).includes('Free DEF'));
    league = { ...league, settings: { ...league.settings, tradesEnabled: true }, trades: [{ tradeId: 'offer-1', status: 'pending', fromTeamId: league.teams[1].teamId, toTeamId: league.teams[0].teamId, giveEntryIds: ['foreign'], receiveEntryIds: ['young'], week: league.currentWeek }] };
    reset(); tree = render({ section: 'trades' });
    const tradeTab = (tree, title) => walk(tree).find(node => node.type === 'button' && node.props['aria-pressed'] !== undefined && text(node.children).includes(title));
    assert(tradeTab(tree, 'Inbox').props['aria-pressed'], 'Opening Trades with an incoming offer lands directly in Inbox');
    assert(!byClass(tree, 'tl-trade-builder').length);
    tradeTab(tree, 'Trade builder').props.onClick();
    assert(tradeTab(render({ section: 'trades' }), 'Trade builder').props['aria-pressed'], 'The owner can still choose to compose an offer');
    league = { ...league, trades: league.trades.map(trade => ({ ...trade, deferredUntilWeek: league.currentWeek + 1 })) };
    reset(); tree = render({ section: 'trades' });
    assert(tradeTab(tree, 'Trade builder').props['aria-pressed'], 'A delayed offer does not take over the next visit');
    league = { ...league, weekStage: 'claims', trades: [{ tradeId: 'outgoing-ai', status: 'pending', fromTeamId: league.teams[0].teamId,
        toTeamId: league.teams[2].teamId, giveEntryIds: ['young'], receiveEntryIds: ['foreign'], week: league.currentWeek }] };
    reset(); tree = render({ section: 'trades' });
    const ping = page => walk(page).find(node => node.type === 'button' && text(node.children).includes('PING THE GM'));
    assert(text(tree).includes('The GM will respond after the waiver batch runs, during Decisions & lineup.'), 'An outgoing AI offer explains when its response will arrive');
    assert(!text(tree).includes('THE GM IS CONSIDERING') && !ping(tree), 'Claims do not imply active review or show a disabled ping');
    league = { ...league, weekStage: 'lineup' };
    tree = render({ section: 'trades' });
    assert(ping(tree) && !ping(tree).props.disabled, 'The existing ping action remains available during the response gate');
    league = { ...league, trades: league.trades.map(trade => ({ ...trade, deferredUntilWeek: league.currentWeek + 1 })) };
    tree = render({ section: 'trades' });
    assert(!ping(tree) && text(tree).includes(`Delayed until Week ${league.currentWeek + 1}`), 'Deferred AI offers keep their actual review week and cannot be pinged early');
    console.log('PASS: own-roster focus, named atomic full-bench swaps, all eligible open-slot choices, mobile sheet, stars, sealed archive, locks, hotseat/online seat ownership, filtered free agents and failed-save recovery');
})().catch(error => { console.error(error); process.exitCode = 1; });
