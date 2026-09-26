'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), Babel = require('@babel/standalone');
const source = Babel.transform(fs.readFileSync('js/components/duat-draft-room.js', 'utf8'), {presets: ['react']}).code;
const candidates = Array.from({length: 45}, (_, i) => ({id: 'p' + i, identity: 'identity' + i, name: 'Player ' + i, position: i % 2 ? 'QB' : 'RB', season: 2025, referenceSeason: 2024, referencePoints: i - 2}));
const campaign = {id: 'test-draft', version: 4, dynastySeason: 1, seasons: [2025], factions: [{id: 'egypt', armies: [{id: 'a1', season: 2025, rulerName: 'Djoser', players: []}]}, {id: 'rome', armies: []}], draft: {status: 'active', cursor: 0, totalPicks: 64, picks: [], queue: [{factionId: 'egypt'}, {factionId: 'rome'}], turn: {factionId: 'egypt', round: 1, season: 2025, armyId: 'a1'}}};
const nodes = n => Array.isArray(n) ? n.flatMap(nodes) : n && typeof n === 'object' ? [n, ...nodes(n.children)] : [];
const text = n => JSON.stringify(n);
function harness(phone = false, storage = new Map()) {
    let cells = [], cursor = 0, localReads = 0;
    const calls = [];
    const React = {Fragment: 'fragment', createElement: (type, props, ...children) => ({type, props: props || {}, children}), useMemo: f => f(), useEffect() {}, useLayoutEffect() {}, useRef: initial => {const i = cursor++; if (!(i in cells)) cells[i] = {current: initial}; return cells[i];}, useState: initial => {const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial; return [cells[i], value => cells[i] = typeof value === 'function' ? value(cells[i]) : value];}};
    const Engine = {draftTurn: state => state.draft.turn, draftCandidates: () => {localReads++; return candidates;}, rosterSize: () => 8, settingsOf: () => ({conquest: false, bench: 3}), slotsOf: () => ['QB', 'FLEX', 'FLEX', 'FLEX', 'FLEX'], shortages: () => ({QB: 1, FLEX: 4})};
    const App = {DuatCampaign: Engine, DuatPresentation: {art: () => '', nameOf: id => id, Sigil: 'sigil'}, GameDraftTable: 'board', DuatMystery: {enabled: state => Boolean(state.mystery)}, DuatMysteryUI: {Explorer: 'explorer'}};
    const window = {App, WR: {useViewport: () => ({isPhone: phone})}, localStorage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value)}};
    vm.runInNewContext(source, {window, React, document: {activeElement: null}});
    const render = extra => {cursor = 0; return App.DuatDraftRoom({campaign, factionId: 'egypt', data: {}, online: false, host: true, canAdvance: true, busy: false, onAction: action => calls.push(action), ...extra});};
    return {render, calls, App, storage, localReads: () => localReads, card: props => {cursor = 0; return App.DuatDraftBoard.PlayerCard(props);}};
}
const boardOf = tree => nodes(tree).find(node => node.type === 'board');
for (const [phone, pageSize] of [[true, 20], [false, 40]]) {
    const h = harness(phone), before = JSON.stringify(campaign); let tree = h.render(), board = boardOf(tree);
    assert.equal(board.props.rows.length, 45, 'All available candidates reach the shared searchable/sortable table');
    assert.equal(board.props.pageSize, pageSize);
    assert.equal(board.props.columns[0].label, 'Est. PPG');
    assert.equal(board.props.columns[0].getValue(board.props.rows[0]), -2, 'Zero and negative estimates are preserved');
    if (phone) assert(nodes(tree).filter(node => node.type === 'details').every(node => !node.props.open), 'Phone overviews and queue/army start collapsed');
    board.props.onToggleQueue(board.props.rows[0]); tree = h.render(); board = boardOf(tree);
    assert.deepEqual(Array.from(board.props.queuedIds), ['p0']); assert.equal(h.calls.length, 0, 'Queue never dispatches an automatic pick');
    const key = h.App.DuatDraftBoard.queueKey(campaign, 'egypt', campaign.factions[0].armies[0]);
    assert.equal(h.storage.get(key), '["p0"]', 'Only player IDs are stored locally');
    assert.deepEqual(Array.from(boardOf(harness(phone, h.storage).render()).props.queuedIds), ['p0'], 'Queue survives reload');
    board.props.onSelect(board.props.rows[0]); tree = h.render();
    const card = nodes(tree).find(node => node.type === h.App.DuatDraftBoard.PlayerCard);
    assert.equal(card.props.player.id, 'p0'); assert.equal(card.props.player.season, 2025);
    board.props.onDraft(board.props.rows[0]); assert.equal(h.calls[0].type, 'draft-pick'); assert.equal(h.calls[0].playerId, 'p0');
    const busy = boardOf(h.render({busy: true})); assert(busy.props.rows.every(player => !player.canDraft)); busy.props.onDraft(busy.props.rows[0]); assert.equal(h.calls.length, 1);
    const waiting = h.render({campaign: {...campaign, draft: {...campaign.draft, status: 'waiting'}}, online: true, host: false, canAdvance: false});
    assert(nodes(waiting).find(node => node.type === 'button' && text(node.children).includes('Open the draft')).props.disabled);
    assert.equal(JSON.stringify(campaign), before);
}
{
    const h = harness(); const onlineCampaign = {...campaign, draft: {...campaign.draft, candidates: [candidates[3]]}};
    assert.equal(boardOf(h.render({online: true, campaign: onlineCampaign})).props.rows[0].id, 'p3');
    const board = boardOf(h.render({online: true, campaign: onlineCampaign})); board.props.onToggleQueue(board.props.rows[0]);
    const depleted = h.render({online: true, campaign: {...onlineCampaign, draft: {...onlineCampaign.draft, candidates: [candidates[4]], picks: [{number: 1, factionId: 'rome', sealed: true}]}}});
    assert.equal(boardOf(depleted).props.queuedIds.length, 0, 'A queued player no longer in the on-turn legal pool cannot leave a stale visible queue count');
    const offTurn = {...onlineCampaign, draft: {...onlineCampaign.draft, turn: {...onlineCampaign.draft.turn, factionId: 'rome'}, candidates}};
    const privatePick = h.render({online: false, campaign: {...offTurn, draft: {...offTurn.draft, picks: [{number: 1, factionId: 'rome', playerId: 'p3', playerName: 'PRIVATE_RIVAL_NAME'}]}}});
    const queuePanel = nodes(privatePick).find(node => node.props.className === 'duat-panel duat-draft-queue');
    assert.equal(nodes(queuePanel).find(node => node.props.className === 'duat-pill').children[0], 1, 'Off-turn local queue cannot infer a rival pick from private state');
    assert(!text(queuePanel).includes('Player 3'));
    const tree = h.render({online: true, campaign: offTurn}); assert.equal(boardOf(tree), undefined); assert.equal(h.localReads(), 0, 'Online never derives a pool from the local archive'); assert(!text(tree).includes('Player 3'), 'Off-turn private candidates never render even if stale data remains');
    const sealed = h.render({campaign: {...campaign, draft: {...campaign.draft, picks: [{number: 1, round: 1, armyNumber: 1, factionId: 'rome', playerId: 'PRIVATE_ID', playerName: 'PRIVATE_RIVAL_NAME'}]}}});
    assert(!text(sealed).includes('PRIVATE_RIVAL_NAME')); assert(!text(sealed).includes('PRIVATE_ID'), 'History and recent picks seal rival identities even with full local state');
}
{
    const h = harness(), helpers = h.App.DuatDraftBoard;
    assert.notEqual(helpers.queueKey(campaign, 'egypt', {id: 'a1'}), helpers.queueKey(campaign, 'egypt', {id: 'a2'}));
    assert.notEqual(helpers.queueKey(campaign, 'egypt', {id: 'a1'}), helpers.queueKey({...campaign, id: 'other'}, 'egypt', {id: 'a1'}));
    assert.notEqual(helpers.queueKey(campaign, 'egypt', {id: 'a1'}), helpers.queueKey(campaign, 'rome', {id: 'a1'}));
    const data = {cards: {players: [{identity: 'identity0', seasons: [{season: 2023, games: 10, points: -20}, {season: 2024, games: 16, points: 160}, {season: 2025, games: 17, points: 999999}, {season: 2026, games: 17, points: 999999}]}]}};
    const prior = helpers.priorSeasons(candidates[0], data, {version: 2});
    assert.deepEqual(Array.from(prior, row => row.year), [2024, 2023]); assert.equal(prior[1].ppg, -2);
    assert.equal(helpers.priorSeasons({...candidates[0], decade: 2020}, data, campaign).length, 0, 'Mystery never uses origin as a scoring-season cutoff');
    const card = h.card({player: {...candidates[0], decade: 2020, candidateYears: [2022, 2023], canDraft: true}, campaign, factionId: 'egypt', data, mystery: true});
    assert.equal(nodes(card).find(node => node.type === 'explorer').props.throughWeek, 0, 'Mystery card only consumes pre-draft public evidence');
}
console.log('PASS: Duat board, cards, queue isolation/reload, turn guards, signed estimates, prior-season scouting, rival privacy and mobile disclosures');
