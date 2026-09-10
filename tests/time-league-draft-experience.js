'use strict';
const assert = require('assert');
global.window = globalThis;
window.App = {};
for (const name of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'ai']) require(`../js/shared/time-league-${name}.js`);

// A stateful component harness tests the reveal-to-scout path without a browser.
let hooks; let cursor; let effects;
const focused = [];
global.React = {
    createElement: (type, props, ...children) => {
        if (typeof type === 'string' && props?.ref) props.ref.current = { focus: () => focused.push(props['aria-label'] || children.join('')) };
        return { type, props: props || {}, children: children.flat(Infinity) };
    },
    useMemo: (fn) => fn(),
    useState(initial) {
        const index = cursor++;
        if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
        return [hooks[index], (value) => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }];
    },
    useRef(initial) {
        const index = cursor++;
        return hooks[index] || (hooks[index] = { current: initial });
    },
    useEffect(callback, dependencies) {
        const index = cursor++;
        const previous = hooks[index];
        if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
            effects.push(() => { previous?.cleanup?.(); hooks[index] = { dependencies, cleanup: callback() }; });
        }
    },
    Fragment: 'fragment'
};
const local = new Map();
window.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value) };
require('../js/components/time-league-draft-roster.js');
require('../js/components/time-league-draft-panel.js');
const Engine = App.TimeLeagueEngine;
function mount(props) {
    const ownHooks = [];
    return (patch = {}) => {
        props = { ...props, ...patch };
        hooks = ownHooks; cursor = 0; effects = [];
        const tree = window.WrTimeLeagueDraftPanel(props);
        effects.forEach(effect => effect());
        return tree;
    };
}
function find(node, predicate) {
    if (!node || typeof node !== 'object') return [];
    return [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap((child) => find(child, predicate))];
}
function text(node) {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    return (node?.children || []).map(text).join(' ');
}
function button(tree, label) { return find(tree, node => node.type === 'button' && (text(node) === label || node.props['aria-label'] === label))[0]; }
const makeCard = (id, position, years, peak = 100) => ({ identity: id, name: `${position} Legend ${id}`, position, peak,
    bio: { college: 'Archive College' }, seasons: years.map((season, index) => ({ season, games: 14, points: peak - index * 4, passYd: 1000, passTd: 10, passInt: 2, rushYd: 200, rushTd: 1, rec: 10, recYd: 100, recTd: 1 })) });
const cards = new Map(Array.from({ length: 8 }, (_, i) => [`p${i}`, makeCard(`p${i}`, 'RB', [1980 + i], 100 + i)]));
let league = Engine.createTimeLeague({ name: 'Grid test', seed: 'grid', createdAt: '2026-01-01',
    settings: { rosterSlots: { RB: 1, BN: 1 }, regularSeasonWeeks: 12, playoffTeams: 0, eraRules: { mode: 'any-era', decades: [] } },
    seats: [{ name: 'Alpha', manager: 'human' }, { name: 'Beta', manager: 'ai' }] });
if (Engine.startDraft) league = Engine.startDraft(league, '2026-01-01T00:00:00.000Z');
// The pinned banner follows the next seat, including the snake-round turn.
{
let turnLeague = league;
for (let i = 0; i < 3; i++) {
    const seat = Engine.currentDraftSeat(turnLeague);
    const manager = turnLeague.teams.find(team => team.teamId === seat.teamId);
    const turnTree = mount({ league: turnLeague, cards, onUpdate() {} })();
    const banner = find(turnTree, node => node.props['aria-label'] === 'Current draft turn')[0];
    assert(banner);
    assert(text(banner).includes('On the clock · #' + seat.overall));
    assert(text(banner).includes(manager.name));
    assert(!text(banner).includes('Just picked'));
    const helmet = find(banner, node => node.props.helmet)[0];
    assert.deepEqual(helmet.props.helmet, manager.helmet);
    turnLeague = Engine.applyDraftPick(turnLeague, [...cards.values()][i], { madeBy: 'human', createdAt: '2026-01-01T00:00:01.000Z' });
}
const pausedTree = mount({ league: { ...league, draftClock: { ...league.draftClock, status: 'paused' } }, cards, onUpdate() {} })();
assert(text(find(pausedTree, node => node.props['aria-label'] === 'Current draft turn')[0]).includes('Paused'));
}

for (const card of [...cards.values()].slice(0, 4)) league = Engine.applyDraftPick(league, card, { madeBy: 'human', createdAt: '2026-01-01T00:00:01.000Z' });
assert.equal(league.seasonsRevealed, true);
const SharedGrid = () => {};
window.DraftCC = { DraftGridPanel: SharedGrid };
let tree = mount({ league, cards, onUpdate: () => {} })();
const shared = find(tree, (node) => node.type === SharedGrid)[0];
assert.ok(shared, 'Completed draft defaults to the actual DHQ grid');
assert.equal(shared.props.state.rounds, 2);
assert.equal(shared.props.state.leagueSize, 2);
for (const pick of shared.props.state.picks) assert.equal(league.teams[pick.teamIdx].teamId, pick.teamId, 'Snake order retains stable team columns');
assert.equal(find(tree, (node) => node.props.className === 'tl-card tl-draft-grade').length, 2, 'Every team has a letter grade');
assert.ok(JSON.stringify(shared.props.renderPick(shared.props.state.picks[0])).includes('1980'), 'Completed cells include drawn season');
assert(text(tree).includes('Your grade') && text(tree).includes('Your class'), 'Recap leads with the owner grade and drawn-season total');
assert(!text(tree).includes('war room moves to week'), 'A completed recap does not pretend the current week is the end of the draft');
assert.equal(shared.props.embedded, true, 'The shared grid does not repeat the recap panel heading');
// Render the actual shared grid: its narrow standard cells previously let
// Vault cards overlap their neighboring team columns on phones.
const gridWindow = { App: {}, DraftCC: { styles: { panelCard: style => style } } };
const gridSource = require('@babel/standalone').transform(require('fs').readFileSync(require('path').join(__dirname, '../js/draft/draft-grid.js'), 'utf8'), { presets: ['react'] }).code;
require('vm').runInNewContext(gridSource, { window: gridWindow, React });
for (const count of [8, 12]) {
    const gridTree = gridWindow.DraftCC.DraftGridPanel({ ...shared.props, state: { ...shared.props.state, leagueSize: count } });
    const table = find(gridTree, node => node.type === 'table')[0];
    assert(parseInt(table.props.style.minWidth) >= count * 140, 'Rich cards keep readable team widths rather than shrinking to fit a phone');
    assert(find(gridTree, node => node.props.role === 'region' && node.props.tabIndex === 0).length, 'Wide grids have a keyboard-accessible scroll region');
    assert(find(gridTree, node => node.type === 'td').every(node => node.props.style.verticalAlign === 'top'), 'Player cards align to the top of each round');
    assert(!text(gridTree).includes('Draft Grid'), 'Embedded grids avoid duplicate headings');
}
const standardGrid = gridWindow.DraftCC.DraftGridPanel({ ...shared.props, embedded: false, renderPick: undefined });
assert(text(standardGrid).includes('Draft Grid'), 'The standard Dynasty HQ grid keeps its own heading');
assert.equal(find(standardGrid, node => node.type === 'table')[0].props.style.minWidth, '170px', 'Standard compact columns remain unchanged');
const auctionRecap = { ...league, settings: { ...league.settings, draftFormat: 'auction' }, draftPicks: league.draftPicks.map((pick, index) => ({
    ...pick, teamId: league.teams[index < 2 ? 0 : 1].teamId, round: index < 2 ? 1 : 2, auctionPrice: 15 + index
})) };
const auctionTree = mount({ league: auctionRecap, cards, onUpdate() {} })();
const auctionGrid = find(auctionTree, node => node.type === SharedGrid)[0];
assert.equal(new Set(auctionGrid.props.state.picks.map(pick => `${pick.round}:${pick.teamIdx}`)).size, 4, 'Auction awards get one cell per team acquisition, never overwrite a nominal round');
assert.deepEqual(auctionGrid.props.state.picks.filter(pick => pick.teamIdx === 0).map(pick => pick.round), [1, 2]);
assert.ok(text(auctionGrid.props.renderPick(auctionGrid.props.state.picks[0])).includes('$15'), 'Auction grid includes winning prices');
delete window.DraftCC;
const fallbackAuction = mount({ league: auctionRecap, cards, onUpdate() {} })();
assert.equal(find(fallbackAuction, node => node.props.className?.startsWith('tl-draft-pick tl-draft-pick-')).length, 4, 'Fallback auction grid also retains every award');
assert.ok(mount({ league, cards, onUpdate: () => {} })(), 'Fallback renders while DHQ loads');

// The pinned room follows the current seat; runs expire as other positions land.
const liveCards = new Map(['RB', 'RB', 'RB', 'WR', 'RB', 'TE', 'QB', ...Array(13).fill('WR')].map((position, index) =>
    [`live${index}`, makeCard(`live${index}`, position, [2000], 200 - index)]));
let liveLeague = Engine.createTimeLeague({ name: 'Room watch', seed: 'room-watch', createdAt: '2026-01-01',
    settings: { rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, BN: 4 }, eraRules: { mode: 'any-era', decades: [] } },
    seats: [{ name: 'Alpha', manager: 'human' }, { name: 'Beta', manager: 'ai' }] });
const liveRender = mount({ league: liveLeague, cards: liveCards, onUpdate() {} });
const roomActivity = page => find(page, node => node.props['aria-label'] === 'Current draft turn')[0];
assert(text(roomActivity(liveRender())).includes('On the clock · #1'));
for (let i = 0; i < 3; i++) liveLeague = Engine.applyDraftPick(liveLeague, liveCards.get(`live${i}`), { madeBy: 'human' });
let livePage = liveRender({ league: liveLeague });
assert(text(roomActivity(livePage)).includes('RB run') && text(roomActivity(livePage)).includes('3 straight picks'));
assert(text(roomActivity(livePage)).includes('On the clock · #4'), 'Banner advances beyond the last completed pick');
assert(!text(roomActivity(livePage)).includes('RB Legend live2'), 'Latest selection stays in the pick feed, not the pinned banner');
assert.equal(find(livePage, node => node.props.className === 'tl-draft-pick-feed').length, 1, 'Live draft defaults to the incoming pick feed');
button(livePage, 'Board grid').props.onClick(); livePage = liveRender();
assert.equal(find(livePage, node => node.props.className?.endsWith(' is-latest') && node.props.className.startsWith('tl-draft-pick ')).length, 1, 'Only the newest grid cell is highlighted');
button(livePage, 'Recent picks').props.onClick();
liveLeague = Engine.applyDraftPick(liveLeague, liveCards.get('live3'), { madeBy: 'human' });
assert(text(roomActivity(liveRender({ league: liveLeague }))).includes('No position run'), 'A WR ends the consecutive RB run');
liveLeague = Engine.applyDraftPick(liveLeague, liveCards.get('live4'), { madeBy: 'human' });
assert(text(roomActivity(liveRender({ league: liveLeague }))).includes('4 of the last 5'), 'Heavy recent demand is identified even with an intervening position');
for (let i = 5; i < 7; i++) liveLeague = Engine.applyDraftPick(liveLeague, liveCards.get(`live${i}`), { madeBy: 'human' });
livePage = liveRender({ league: { ...liveLeague, draftPicks: [...liveLeague.draftPicks].reverse() } });
assert(text(roomActivity(livePage)).includes('No position run'), 'Runs disappear when they fall out of the last-six window');
const feedRows = page => find(page, node => node.type === 'li' && node.props.className?.startsWith('tl-draft-feed-pick'));
assert.equal(feedRows(livePage).length, 6);
assert(text(feedRows(livePage)[0]).includes('QB Legend live6'), 'Feed sorts by pick number rather than storage order');
button(livePage, 'Show earlier picks (1)').props.onClick(); livePage = liveRender();
assert.equal(feedRows(livePage).length, 7, 'Earlier picks remain accessible');
window.DraftCC = { DraftGridPanel: SharedGrid };
const completedFromLive = liveRender({ league });
assert(find(completedFromLive, node => node.type === SharedGrid).length, 'Completing a draft restores the colorful recap grid by default');
assert.equal(roomActivity(completedFromLive), undefined, 'Completed recaps do not show a stale live-run banner');
delete window.DraftCC;

const rouletteCards = new Map([
    ...Array.from({ length: 5 }, (_, i) => [`q${i}`, makeCard(`q${i}`, 'QB', [1977, 1980, 1982], 200 - i)]),
    ...Array.from({ length: 5 }, (_, i) => [`r${i}`, makeCard(`r${i}`, 'RB', [1993, 1995, 2001], 300 - i)])
]);
// This player's best career season is outside the revealed decade.
rouletteCards.get('q4').peak = 9999;
rouletteCards.get('q4').seasons[0].points = 9999;
let roulette = Engine.createTimeLeague({ name: 'Sealed archive', seed: 'sealed', createdAt: '2026-01-01',
    settings: { rosterSlots: { QB: 1, RB: 1, BN: 1 }, eraRules: { mode: 'position-roulette', decades: [], positionDecades: { QB: '1980s', RB: '1990s' } } },
    seats: [{ name: 'Human', manager: 'human' }, { name: 'Rival', manager: 'ai' }] });
roulette = { ...roulette, draftClock: { ...roulette.draftClock, status: 'running' }, teams: roulette.teams.map((team, index) => index ? team : { ...team, queue: ['r0'] }) };
let writes = 0; const readiness = []; const actions = [];
const controls = React.createElement('section', { className: 'clock-controls' }, 'Visible clock');
const render = mount({ league: roulette, cards: rouletteCards, onUpdate: () => { writes++; }, onRevealReadyChange: ready => readiness.push(ready), draftControls: controls, onDraftAction: action => actions.push(action) });
tree = render();
assert.equal(readiness.at(-1), false, 'Clock receives false readiness before any reveal');
for (const hidden of ['QB Legend', 'RB Legend', '1980s', '1990s', 'draftable', 'Find your next legend', 'My queue', 'Opponent intel', 'Visible clock']) {
    assert.ok(!text(tree).includes(hidden), `${hidden} stays out of the sealed view`);
}
assert.equal(find(tree, node => node.props.className === 'tl-draft-dock').length, 0, 'Mobile selected-player fallback cannot leak the pool');
button(tree, 'Reveal QB era').props.onClick();
tree = render();
assert.equal(find(tree, node => node.props.className === 'tl-era-die').length, 0, 'Reveal has no fake spinning years or timer');
assert.equal(readiness.at(-1), false, 'Opening one position does not start the draft');
assert.ok(text(tree).includes('1980s'));
assert.ok(text(tree).includes('1980, 1982'), 'Actual years are shown, including gaps');
assert.ok(!text(tree).includes('1981'), 'Missing seasons are not implied by a decade-wide range');
assert.ok(!text(tree).includes('RB Legend') && !text(tree).includes('1990s'), 'Unopened position remains hidden after a partial reveal');
assert.equal(find(tree, node => node.props.className === 'tl-era-headliner').length, 3, 'Each revealed position shows only three clickable leaders');
assert.ok(!text(tree).includes('Top 10'));
assert.ok(!text(tree).includes('QB Legend q4'), 'A peak outside the drawn decade does not determine the top three');
let restoredFocus = false;
button(tree, 'Scout QB Legend q0 in the 1980s').props.onClick({ currentTarget: { focus: () => { restoredFocus = true; } } });
tree = render();
const dialog = find(tree, node => node.props.role === 'dialog')[0];
assert.ok(dialog, 'Reveal headliner opens an accessible career dialog');
assert.equal(dialog.props['aria-modal'], true);
assert.ok(text(dialog).includes('Archive College'));
assert.ok(text(dialog).includes('Archive totals · Weeks 1–14 · reference scoring'), 'Scouting distinguishes the archive window and reference points from full NFL season totals');
const seasonTable = find(dialog, node => node.props.className === 'tl-scout-seasons')[0];
assert.ok(text(seasonTable).includes('1980') && text(seasonTable).includes('1982'));
assert.ok(!text(seasonTable).includes('1977'), 'Scouting only shows seasons that can be drawn');
const scoutHeaders = find(seasonTable, node => node.type === 'th');
assert.deepEqual(scoutHeaders.slice(0, 2).map(text), ['FPTS', 'Year'], 'Fantasy points lead the scouting table, beside the year');
assert.equal(text(scoutHeaders[2]), 'Recorded GP', 'Archive records are not mislabeled as official NFL appearances');
const scoutRows = find(seasonTable, node => node.type === 'tbody')[0].children;
assert.deepEqual(scoutRows.map(row => Number(text(row.children[1]))), [1982, 1980], 'Scouting seasons run newest first');
assert.deepEqual(scoutRows.map(row => text(row.children[0])), ['192.0', '196.0'], 'Points stay paired with the correct season');
assert.deepEqual(rouletteCards.get('q0').seasons.map(row => row.season), [1977, 1980, 1982], 'Descending display never mutates the source career order');
const originalScoutCard = rouletteCards.get('q0');
rouletteCards.set('q0', { ...originalScoutCard, seasons: originalScoutCard.seasons.map(season => ({ ...season, sourceWeekKind: 'nfl-week', recordedGames: 16, games: 16, scheduledGames: 16 })) });
let fullSeasonDialog = find(render(), node => node.props.role === 'dialog')[0];
assert(text(fullSeasonDialog).includes('NFL regular-season records') && text(fullSeasonDialog).includes(`The Vault plays ${Engine.seasonEndWeek(roulette)} weeks`), 'Full historical records are distinguished from the configured Vault schedule');
assert(!text(fullSeasonDialog).includes('Archive totals · Weeks 1–14'));
assert(text(fullSeasonDialog).includes('not verified official appearances'));
rouletteCards.legacyCards = new Map(rouletteCards);
rouletteCards.legacyCards.set('q0', originalScoutCard);
rouletteCards.set('q0', { ...rouletteCards.get('q0'), seasons: rouletteCards.get('q0').seasons.map(season => ({ ...season, points: season.points + 100 })) });
const legacyDialog = find(render({ league: { ...roulette, settings: { ...roulette.settings, gameDeckVersion: 0 } } }), node => node.props.role === 'dialog')[0];
assert(text(legacyDialog).includes('Full NFL season stats are shown for scouting.') && text(legacyDialog).includes('Legacy Vault W1–14'));
const legacyScoutRows = find(find(legacyDialog, node => node.props.className === 'tl-scout-seasons')[0], node => node.type === 'tbody')[0].children;
assert.deepEqual(legacyScoutRows.map(row => text(row.children[0])), ['292.0', '296.0'], 'Historical full-season points remain available to legacy saves');
assert.deepEqual(legacyScoutRows.map(row => text(row.children[2])), ['16', '16'], 'Historical full-season game counts are not replaced by the legacy archive');
assert.deepEqual(legacyScoutRows.map(row => text(row.children[3])), ['192.0', '196.0'], 'Preserved legacy league points are shown in their own column');
// An edition excluded from the new archive can still be legal in an old save
// (for example, 1999 Kurt Warner). Its legacy row must remain visible and must
// never borrow the full archive's games-played label or totals.
const completeScoutCard = rouletteCards.get('q0');
rouletteCards.set('q0', { ...completeScoutCard, seasons: completeScoutCard.seasons.filter(season => season.season !== 1982) });
const mixedDialog = find(render(), node => node.props.role === 'dialog')[0];
const mixedTable = find(mixedDialog, node => node.props.className === 'tl-scout-seasons')[0];
const mixedRows = find(mixedTable, node => node.type === 'tbody')[0].children;
assert.deepEqual(mixedRows.map(row => Number(text(row.children[1]))), [1982, 1980], 'Legacy eligible years survive a new-archive exclusion');
assert.equal(text(mixedRows[0].children[0]), '192.0 Legacy W1–14');
assert.equal(text(mixedRows[0].children[2]), '14 Vault GP', 'Fallback games count only the preserved legacy window');
assert.equal(text(mixedRows[1].children[0]), '296.0', 'A canonical full-season row is unchanged');
assert.equal(text(mixedRows[1].children[2]), '16', 'Canonical recorded games remain intact beside the fallback');
assert(text(mixedDialog).includes('1 season hidden') && !text(mixedDialog).includes('2 seasons hidden'), 'Only the genuinely out-of-era year is hidden');
rouletteCards.set('q0', { ...completeScoutCard, seasons: completeScoutCard.seasons.filter(season => season.season < 1980) });
const fallbackDialog = find(render(), node => node.props.role === 'dialog')[0];
const fallbackTable = find(fallbackDialog, node => node.props.className === 'tl-scout-seasons')[0];
assert.deepEqual(find(fallbackTable, node => node.type === 'tbody')[0].children.map(row => Number(text(row.children[1]))), [1982, 1980]);
assert.equal(text(find(fallbackTable, node => node.type === 'th')[2]), 'Vault GP', 'Legacy-only scouting never claims full historical game counts');
assert(!text(fallbackDialog).includes('nothing here can be drawn'), 'The old league still has a legal edition to draw');
rouletteCards.set('q0', completeScoutCard);
delete rouletteCards.legacyCards;
rouletteCards.set('q0', originalScoutCard);
render({ league: roulette });
const draftButton = button(dialog, 'DRAFT QB LEGEND Q0');
assert.ok(draftButton.props.disabled, 'Cannot draft from a partial-reveal scout dialog');
draftButton.props.onClick();
button(dialog, 'Queue').props.onClick();
assert.equal(writes, 0, 'Even direct callbacks cannot draft or queue before the final reveal');
button(dialog, '← Back to draft').props.onClick();
tree = render();
assert.equal(find(tree, node => node.props.role === 'dialog').length, 0);
assert.equal(restoredFocus, true, 'Back returns focus to the headliner');
button(tree, 'Reveal all').props.onClick();
tree = render();
assert.equal(readiness.at(-1), false, 'Scouting the final reveal does not start the clock');
assert.ok(!text(tree).includes('Visible clock') && !text(tree).includes('Find your next legend'));
assert.equal(find(tree, node => node.props.className === 'tl-era-headliner').length, 3, 'Only the selected position has a shortlist');
assert.equal(focused.at(-1), 'Enter draft →', 'Final reveal hands keyboard focus to the next step');
const awaitingEntry = mount({ league: roulette, cards: rouletteCards, onUpdate() {} })();
assert.ok(button(awaitingEntry, 'Enter draft →'), 'Reload before entering preserves the scouting break');
assert.ok(!text(awaitingEntry).includes('Visible clock'));
tree = render();
button(tree, 'View RB era · 1990s · 5 players').props.onClick(); tree = render();
assert.ok(text(tree).includes('RB Legend r0') && !text(tree).includes('QB Legend q0'), 'Switching tiles replaces the shortlist');
button(tree, 'Enter draft →').props.onClick(); tree = render();
assert.equal(readiness.at(-1), true, 'Explicit entry unlocks the clock');
assert.equal(focused.at(-1), 'Draft room', 'Entering moves focus to the board without opening a search keyboard');
assert.ok(text(tree).includes('Visible clock') && text(tree).includes('Find your next legend'));
const drawBoard = find(tree, node => node.props.className === 'tl-mobile-player-list')[0];
const drawRows = drawBoard.children;
assert.equal(text(find(drawRows[0], node => node.props.className === 'tl-player-name')[0]).includes('RB Legend r0'), true, 'The board is led by the best eligible season, not an out-of-era career peak');
const outsidePeakRow = drawRows.find(row => text(row).includes('QB Legend q4'));
assert.equal(text(find(outsidePeakRow, node => node.props.className === 'tl-player-peak')[0]), '192 DRAW PEAK');
assert.equal(text(find(outsidePeakRow, node => node.props.className === 'tl-player-number')[0]), '10 QB', 'Career outliers retain their correct in-era rank');
const drawDesktop = find(tree, node => node.props.className === 'tl-desktop-player-board')[0];
const outsidePeakDesktop = find(drawDesktop, node => node.type === 'tr').find(row => text(row).includes('QB Legend q4'));
assert.equal(text(outsidePeakDesktop.children[4]), '192.0', 'Desktop peak agrees with the mobile board and scout');
assert.equal(outsidePeakDesktop.children.length, 6, 'The board omits ambiguous multi-season game totals');
assert(!find(drawDesktop, node => node.type === 'th').some(node => text(node) === 'G'));
const freshBoard = mount({ league: roulette, cards: rouletteCards, onUpdate() {} })();
assert.equal(text(find(freshBoard, node => node.props.className === 'tl-dock-player')[0]).includes('RB Legend r0'), true, 'The default draft dock selects the same in-era board leader');
const anyEraBoard = mount({ league: { ...roulette, leagueId: `${roulette.leagueId}-any-era`, settings: { ...roulette.settings, eraRules: { mode: 'any-era', decades: [] } } }, cards: rouletteCards, onUpdate() {} })();
const anyEraLeader = find(anyEraBoard, node => node.props.className === 'tl-mobile-player-list')[0].children[0];
assert(text(anyEraLeader).includes('QB Legend q4') && text(anyEraLeader).includes('9999 PEAK'), 'Any-era drafting still uses the complete eligible career');
assert.equal(rouletteCards.get('q4').peak, 9999, 'Rendering does not mutate the full-career card or expose its sealed draw');
tree = render();
const eraReview = find(tree, node => node.type === 'details' && node.props.className === 'tl-era-review')[0];
assert.ok(eraReview && !eraReview.props.open, 'After entry the scouting room collapses above the board');
assert.equal(find(tree, node => node.props.className === 'tl-era-headliner').length, 3);
const mobileTarget = find(tree, node => node.props.className === 'tl-mobile-player-pick')[0];
mobileTarget.props.onClick({ currentTarget: { focus() {} } });
tree = render();
assert.ok(find(tree, node => node.props.role === 'dialog').length, 'Mobile player tap opens the career on top of the board, without scrolling');
button(tree, '← Back to draft').props.onClick();
tree = render({ league: { ...roulette, draftClock: { ...roulette.draftClock, status: 'paused' } } });
assert.ok(find(tree, node => node.props.className === 'tl-btn primary').every(node => node.props.disabled), 'Paused draft disables draft actions');
const reload = mount({ league: roulette, cards: rouletteCards, onUpdate() {} })();
assert.ok(text(reload).includes('Find your next legend'), 'Completed reveals survive reload');
local.set(`wr-tl-era-reveal:${roulette.leagueId}`, '1');
local.delete(`wr-tl-era-entered:${roulette.leagueId}`);
assert.ok(text(mount({ league: roulette, cards: rouletteCards, onUpdate() {} })()).includes('Find your next legend'), 'Legacy complete reveal remains compatible');

// Auction player selection must nominate, never use the normal pick pathway.
const auction = { ...roulette, settings: { ...roulette.settings, draftFormat: 'auction' }, draftAuction: { nomination: null } };
tree = render({ league: auction });
const nominate = find(tree, node => node.props['aria-label']?.startsWith('Nominate '))[0];
assert.ok(nominate && !nominate.props.disabled);
nominate.props.onClick();
assert.equal(actions[0].type, 'auction-nominate');
assert.equal(writes, 0, 'Auction nomination bypasses normal pick mutation');
tree = render({ league: { ...auction, draftAuction: { nomination: { identity: 'q0' } } } });
assert.ok(find(tree, node => node.props['aria-label']?.startsWith('Nominate ')).every(node => node.props.disabled), 'An open auction lot prevents a second nomination');
const timedRender = mount({ league: roulette, cards: rouletteCards, onUpdate: () => { writes++; }, onDraftAction: action => actions.push(action) });
const timedTree = timedRender();
find(timedTree, node => node.type === 'button' && node.props['aria-label']?.startsWith('Draft '))[0].props.onClick();
assert.equal(actions.at(-1).type, 'draft', 'A pick goes through the root deadline-checked action dispatcher');
assert.equal(writes, 0, 'Timed pick never directly applies a local draft mutation');

// Composite position filters follow the league's actual lineup eligibility.
const filterCards = new Map(['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].flatMap(position => [
    [`${position}-current`, makeCard(`${position}-current`, position, [1984], 180)],
    [`${position}-outside`, makeCard(`${position}-outside`, position, [2004], 250)],
    [`${position}-second`, makeCard(`${position}-second`, position, [1987], 170)]
]));
const filterSelect = page => find(page, node => node.type === 'select' && node.props['aria-label'] === 'Filter position')[0];
const filterOptions = page => filterSelect(page).children.map(option => option.props.value);
const mobilePlayers = page => find(page, node => node.props.className?.split(' ').includes('tl-mobile-player'));
const shownPositions = page => [...new Set(mobilePlayers(page).map(node => node.props['data-position']))].sort();
for (const draftFormat of ['snake', 'linear', 'auction']) {
    const filterLeague = Engine.createTimeLeague({ name: `Filter ${draftFormat}`, seed: `filters-${draftFormat}`, createdAt: '2026-01-01',
        settings: { draftFormat, rosterSlots: { QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 1, SUPER_FLEX: 1, K: 1, DEF: 1 },
            eraRules: { mode: 'position-roulette', decades: [], positionDecades: Object.fromEntries(['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(position => [position, '1980s'])) } },
        seats: [{ name: 'Human', manager: 'human' }, { name: 'Rival', manager: 'ai' }] });
    // Already-drafted players must stay off the filtered board too.
    const current = { ...filterLeague, draftPicks: [{ identity: 'RB-current', overall: 1, round: 1, teamId: filterLeague.teams[0].teamId }] };
    const renderFilters = mount({ league: current, cards: filterCards, onUpdate() {} });
    let page = renderFilters();
    assert.equal(filterSelect(page), undefined, `${draftFormat}: filters cannot expose the pool before the reveal`);
    button(page, 'Reveal all').props.onClick();
    page = renderFilters();
    assert.ok(filterOptions(page).includes('FLEX') && filterOptions(page).includes('SUPER_FLEX'), `${draftFormat}: configured composite slots appear`);
    assert.equal(text(filterSelect(page).children.find(option => option.props.value === 'SUPER_FLEX')), 'SUPER FLEX');
    filterSelect(page).props.onChange({ target: { value: 'FLEX' } });
    page = renderFilters();
    assert.deepEqual(shownPositions(page), ['RB', 'TE', 'WR'], `${draftFormat}: FLEX excludes quarterbacks, kickers and defenses`);
    assert.ok(mobilePlayers(page).every(node => !text(node).includes('outside') && !text(node).includes('RB-current')), `${draftFormat}: era and drafted exclusions remain intact`);
    const desktopBoard = find(page, node => node.props.className === 'tl-desktop-player-board')[0];
    assert.equal(find(desktopBoard, node => node.type === 'tbody')[0].children.length, mobilePlayers(page).length, 'Mobile and desktop use the same filtered pool');
    filterSelect(page).props.onChange({ target: { value: 'SUPER_FLEX' } });
    page = renderFilters();
    assert.deepEqual(shownPositions(page), ['QB', 'RB', 'TE', 'WR'], `${draftFormat}: SUPER FLEX includes all four offensive positions`);
    const search = find(page, node => node.props['aria-label'] === 'Search players')[0];
    search.props.onChange({ target: { value: 'QB Legend QB-second' } });
    page = renderFilters();
    assert.equal(mobilePlayers(page).length, 1, 'Name search composes with slot eligibility');
    mobilePlayers(page)[0].children[0].props.onClick({ currentTarget: { focus() {} } });
    page = renderFilters();
    assert.ok(text(find(page, node => node.props.role === 'dialog')[0]).includes('QB Legend QB-second'), 'Filtered mobile rows still open career details');
    button(page, '← Back to draft').props.onClick();
    search.props.onChange({ target: { value: '' } });
    const withoutFlex = { ...current, settings: { ...current.settings, rosterSlots: { ...current.settings.rosterSlots, FLEX: 0, SUPER_FLEX: 0 } } };
    page = renderFilters({ league: withoutFlex });
    assert.ok(!filterOptions(page).includes('FLEX') && !filterOptions(page).includes('SUPER_FLEX'), 'Unconfigured slots stay out of the dropdown');
    assert.equal(filterSelect(page).props.value, 'ALL', 'Removed slot filter resets immediately without leaving an empty board');
    page = renderFilters({ league: current });
    assert.equal(filterSelect(page).props.value, 'ALL', 'Restoring the configuration does not restore a stale filter');
    filterSelect(page).props.onChange({ target: { value: 'SUPER_FLEX' } });
    page = renderFilters();
    const nextLeague = { ...current, leagueId: `${current.leagueId}-other`, settings: { ...current.settings, eraRules: { mode: 'any-era', decades: [] } } };
    page = renderFilters({ league: nextLeague });
    assert.equal(filterSelect(page).props.value, 'ALL', 'Another league never inherits the previous slot filter');
}
// Your next turn follows remaining scheduled picks, including the snake wrap,
// and belongs to the online viewer rather than the league's first human.
const turnCards = new Map(Array.from({ length: 12 }, (_, index) => [`turn-${index}`, makeCard(`turn-${index}`, 'RB', [1984], 200 - index)]));
const turnLeague = Engine.createTimeLeague({ name: 'Your next turn', seed: 'turn-countdown', createdAt: '2026-09-08T12:00:00Z',
    seats: [{ name: 'First Human', manager: 'human' }, { name: 'Second Human', manager: 'human' }, { name: 'Rival', manager: 'ai' }],
    settings: { rosterSlots: { RB: 1, BN: 2 }, regularSeasonWeeks: 12, draftOrderMode: 'manual', draftTeamOrder: ['t3', 't2', 't1'],
        eraRules: { mode: 'any-era', decades: [] }, draftFormat: 'snake' } });
const turnLabel = page => text(find(page, node => node.props.className === 'tl-draft-turn-label')[0]);
const turnDetail = page => text(find(page, node => node.props.className === 'tl-draft-turn-detail')[0]);
const hero = page => find(page, node => node.props['aria-label'] === 'Draft room')[0];
const dock = page => find(page, node => node.props.className === 'tl-dock-player')[0];
const clockTools = React.createElement('div', { className: 'fixture-clock-tools' }, 'Clock tools');
const turnRender = mount({ league: turnLeague, cards: turnCards, onUpdate() {}, draftControls: clockTools });
let turnPage = turnRender();
assert.equal(turnLabel(turnPage), 'WAITING TO START');
assert(turnDetail(turnPage).includes('2 picks until your turn'));
assert(!hero(turnPage).props.className.includes('your-turn'));
assert(text(dock(turnPage)).includes('WAITING TO START'));
assert.equal(find(hero(turnPage), node => node.props.className === 'fixture-clock-tools').length, 1, 'Clock controls live inside the draft hero');
assert(hero(turnPage).children.indexOf(clockTools) < hero(turnPage).children.findIndex(node => node?.props?.className === 'tl-draft-turn'), 'Controls lead the unified hero');
assert.equal(find(turnPage, node => node.props.className === 'tl-clock-ring').length, 0, 'The decorative spinning clock is gone');
let picking = Engine.startDraft(turnLeague, '2026-09-08T12:00:00Z');
assert.equal(turnLabel(turnRender({ league: picking })), '2 PICKS UNTIL YOUR TURN');
assert.equal(turnLabel(turnRender({ onlineMeta: { seatTeamId: 't2', role: 'member' } })), 'YOU’RE NEXT');
turnRender({ onlineMeta: null });
for (let index = 0; index < 9; index++) {
    picking = Engine.applyDraftPick(picking, turnCards.get(`turn-${index}`), { madeBy: 'human', createdAt: '2026-09-08T12:00:01Z' });
    if (index === 0) {
        turnPage = turnRender({ league: picking });
        assert.equal(turnLabel(turnPage), 'YOU’RE NEXT', 'The current opposing human counts as a pick before yours');
        assert(!hero(turnPage).props.className.includes('your-turn'), 'Local hotseat access does not pretend another human is your team');
    }
    if (index === 1 || index === 2) {
        turnPage = turnRender({ league: picking });
        assert.equal(turnLabel(turnPage), 'YOUR PICK', 'Both consecutive snake turnaround picks belong to the owner');
        assert(text(dock(turnPage)).includes('YOUR PICK'));
        assert(hero(turnPage).props.className.includes('your-turn'));
        const paused = Engine.pauseDraft(picking, '2026-09-08T12:00:02Z');
        turnPage = turnRender({ league: paused });
        assert.equal(turnLabel(turnPage), 'DRAFT PAUSED');
        assert(turnDetail(turnPage).includes('Your pick when the draft resumes'));
        assert(!hero(turnPage).props.className.includes('your-turn'));
    }
    if (index === 3) assert.equal(turnLabel(turnRender({ league: picking })), '4 PICKS UNTIL YOUR TURN', 'Snake return counts both intervening rounds');
    if (index === 7) assert.equal(turnLabel(turnRender({ league: picking, onlineMeta: { seatTeamId: 't2', role: 'member' } })), 'YOUR DRAFT IS COMPLETE');
}
assert.equal(hero(turnRender({ league: picking })), undefined, 'The completed recap never retains a turn countdown');

const linearTurn = Engine.startDraft({ ...turnLeague, settings: { ...turnLeague.settings, draftFormat: 'linear' },
    draftOrder: App.TimeLeagueDraftRoom.createDraftOrder(['t3', 't2', 't1'], 3, 'linear') }, '2026-09-08T12:00:00Z');
const linearAfterRound = [...turnCards.values()].slice(0, 3).reduce((current, card) => Engine.applyDraftPick(current, card, { madeBy: 'human', createdAt: '2026-09-08T12:00:01Z' }), linearTurn);
assert.equal(turnLabel(mount({ league: linearAfterRound, cards: turnCards, onUpdate() {} })()), '2 PICKS UNTIL YOUR TURN', 'Linear rounds do not inherit snake turnaround logic');

const auctionTurn = Engine.startDraft({ ...turnLeague, settings: { ...turnLeague.settings, draftFormat: 'auction' } }, '2026-09-08T12:00:00Z');
const bidTools = React.createElement('div', { className: 'fixture-auction-tools' }, 'Bid tools');
const auctionTurnRender = mount({ league: auctionTurn, cards: turnCards, onUpdate() {}, draftControls: clockTools, auctionControls: bidTools });
turnPage = auctionTurnRender();
assert.equal(turnLabel(turnPage), '2 NOMINATIONS UNTIL YOURS');
assert(!find(hero(turnPage), node => node.props.className === 'fixture-auction-tools').length, 'The bidding desk stays outside the compact header');
assert(find(turnPage, node => node.props.className === 'fixture-auction-tools').length);
const fullMiddle = { ...auctionTurn, teams: auctionTurn.teams.map(team => team.teamId === 't2' ? { ...team, roster: [{}, {}, {}] } : team) };
assert.equal(turnLabel(auctionTurnRender({ league: fullMiddle })), 'YOU NOMINATE NEXT', 'Full teams are skipped in nomination counts');
const ownNomination = { ...auctionTurn, draftAuction: { ...auctionTurn.draftAuction, nominationIndex: 2 } };
assert.equal(turnLabel(auctionTurnRender({ league: ownNomination })), 'YOUR NOMINATION');
const activeLot = Engine.nominateAuctionPlayer(ownNomination, 't1', turnCards.get('turn-0'), 1, '2026-09-08T12:00:01Z');
turnPage = auctionTurnRender({ league: activeLot });
assert.equal(turnLabel(turnPage), 'BIDDING OPEN');
assert(turnDetail(turnPage).includes('Eligible teams can bid'));
assert(!hero(turnPage).props.className.includes('your-turn'), 'Nominating a player never implies an exclusive bidding turn');
assert.equal(turnLabel(auctionTurnRender({ league: Engine.pauseDraft(activeLot, '2026-09-08T12:00:02Z') })), 'DRAFT PAUSED');
for (const spectatorSeat of [null, 'missing-seat', 't3']) {
    const watch = mount({ league: { ...linearTurn, publicSnapshotVersion: 1 }, cards: turnCards, onUpdate() {}, onlineMeta: { seatTeamId: spectatorSeat, role: 'viewer' } });
    let page = watch();
    assert.equal(turnLabel(page), 'DRAFT IN PROGRESS', 'A viewer without a human team is not told their draft is complete');
    assert.equal(turnDetail(page), 'Watching the draft.');
    assert(!hero(page).props.className.includes('your-turn'));
    assert(text(dock(page)).includes('DRAFT IN PROGRESS'));
    page = watch({ league: { ...turnLeague, publicSnapshotVersion: 1 } });
    assert.equal(turnLabel(page), 'WAITING TO START');
    assert.equal(turnDetail(page), 'The draft has not started.');
    page = watch({ league: { ...Engine.pauseDraft(linearTurn, '2026-09-08T12:00:02Z'), publicSnapshotVersion: 1 } });
    assert.equal(turnLabel(page), 'DRAFT PAUSED');
    assert(!turnDetail(page).includes('Your'));
    page = watch({ league: { ...activeLot, publicSnapshotVersion: 1 } });
    assert.equal(turnLabel(page), 'DRAFT IN PROGRESS');
    assert.equal(turnDetail(page), 'Watching the current auction.');
}
const rosterOwnerPage = mount({ league: linearAfterRound, cards: turnCards, onUpdate() {}, onlineMeta: { seatTeamId: 't2', role: 'member' } })();
const myRosterNode = find(rosterOwnerPage, node => node.type === WrTimeLeagueDraftRoster)[0];
assert.equal(myRosterNode.props.team.teamId, 't2', 'My draft belongs to the signed-in seat, not the first human');
const myRosterWrapper = find(rosterOwnerPage, node => node.props.className === 'tl-draft-my-roster')[0];
let rosterScrolled = false, rosterFocused = false;
const rosterDetails = { open: false, querySelector: () => ({ focus: () => { rosterFocused = true; } }) };
myRosterWrapper.props.ref.current = { querySelector: () => rosterDetails, scrollIntoView: () => { rosterScrolled = true; } };
button(rosterOwnerPage, 'View my drafted team').props.onClick();
assert(rosterDetails.open && rosterScrolled && rosterFocused, 'Mobile shortcut opens your roster and brings it into view');
const rosterSpectatorPage = mount({ league: linearAfterRound, cards: turnCards, onUpdate() {}, onlineMeta: { seatTeamId: null, role: 'viewer' } })();
assert.equal(find(rosterSpectatorPage, node => node.type === WrTimeLeagueDraftRoster).length, 0, 'Spectators do not inherit another team');
assert.equal(find(mount({ league: picking, cards: turnCards, onUpdate() {} })(), node => node.type === WrTimeLeagueDraftRoster).length, 0, 'Completed recap does not retain the live draft roster');
console.log('Vault draft experience: sealed reveals, mobile scouting, recap grids, filters, unified clock header and accurate snake/linear/auction turn countdowns passed');
