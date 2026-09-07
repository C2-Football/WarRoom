'use strict';
const assert = require('assert');
global.window = globalThis;
window.App = {};
for (const name of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'ai']) require(`../js/shared/time-league-${name}.js`);

// A stateful component harness tests the reveal-to-scout path without a browser.
let hooks; let cursor; let effects;
global.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
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
const originalTimeout = global.setTimeout; const originalClearTimeout = global.clearTimeout;
let completeReveal;
global.setTimeout = callback => { completeReveal = callback; return 1; };
global.clearTimeout = () => {};
button(tree, '✦ Open  QB  archive').props.onClick();
tree = render();
assert.ok(!text(tree).includes('QB Legend'), 'Rolling animation does not expose the result early');
completeReveal();
global.setTimeout = originalTimeout; global.clearTimeout = originalClearTimeout;
tree = render();
assert.equal(readiness.at(-1), false, 'Opening one position does not start the draft');
assert.ok(text(tree).includes('1980s'));
assert.ok(text(tree).includes('Available years: 1980, 1982'), 'Actual years are shown, including gaps');
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
const seasonTable = find(dialog, node => node.props.className === 'tl-scout-seasons')[0];
assert.ok(text(seasonTable).includes('1980') && text(seasonTable).includes('1982'));
assert.ok(!text(seasonTable).includes('1977'), 'Scouting only shows seasons that can be drawn');
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
assert.equal(readiness.at(-1), true, 'Final reveal unlocks the clock');
assert.ok(text(tree).includes('Visible clock') && text(tree).includes('Find your next legend'));
assert.equal(find(tree, node => node.props.className === 'tl-era-headliner').length, 6);
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
console.log('Vault draft experience: sealed reveals, top three, actual years, mobile career dialog, draft gates, auction nomination, shared grid and grades passed');
