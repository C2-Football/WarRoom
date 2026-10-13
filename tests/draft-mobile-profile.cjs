'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Babel = require('@babel/standalone');

const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(v => v != null && v !== false) });
const nodes = value => value && typeof value === 'object' ? [value, ...(value.children || []).flatMap(nodes)] : [];
const text = value => value == null ? '' : typeof value === 'object' ? (value.children || []).map(text).join(' ') : String(value);
const React = { createElement: h, Fragment: 'fragment', useState: init => [typeof init === 'function' ? init() : init, () => {}], useRef: () => ({ current: null }), useMemo: fn => fn(), useEffect() {} };
let phone = true;
const Sheet = function Sheet() {};
const root = {
    WR: { useViewport: () => ({ isPhone: phone }), Sheet },
    App: { LI: { playerScores: { p: 8589 }, playerMeta: { p: { statusReason: 'Generic status summary' } } }, computeNFLFit: () => ({ narrative: 'Starting back with no elite touch competition.' }) },
    S: { currentLeagueId: 'l', leagues: [{ league_id: 'l', season: '2026', scoring_settings: { rec: 1 } }] },
    wrAlpha: value => value,
    wrIsPro: () => true,
};
const ctx = vm.createContext({ window: root, React, console, localStorage: { length: 0, getItem: () => null }, document: { readyState: 'complete', getElementById: () => ({}) }, setTimeout });
vm.runInContext(fs.readFileSync('js/components/player-card.js', 'utf8'), ctx);
const props = { pid: 'p', playersData: { p: { full_name: 'Bijan Robinson', position: 'RB', team: 'ATL', age: 24, years_exp: 3 } }, statsData: {}, context: 'draft-board', embedded: true, nflFitText: 'Alex has verified the touch path.' };
let card = root.PlayerCard(props);
assert.equal(card.type, 'section', 'Expanded draft profiles render in the page');
assert.equal(card.props.className, 'wr-player-card-embedded');
assert(text(card).includes('Bijan Robinson'));
assert(text(card).includes('Alex NFL Fit'));
assert(text(card).includes(props.nflFitText), 'Live draft fit supersedes the deterministic fallback');
assert(!text(card).includes('Generic status summary'), 'Expanded draft profile has one analysis read');
assert(!text(card).includes('Starting back with no elite touch competition.'));
for (const label of ['Overview', 'Season Stats', 'Career Stats', 'Scouting', 'Value']) assert(nodes(card).some(node => node.type === 'button' && text(node) === label), 'Normal player card retains ' + label);
assert(!nodes(card).some(node => node.type === Sheet), 'Inline profile never opens a nested sheet');
assert(!nodes(card).some(node => node.type === 'button' && ['Close', '✕'].includes(text(node))), 'Inline profile omits modal close controls');
root.wrIsPro = () => false;
assert(!text(root.PlayerCard(props)).includes('Alex NFL Fit'), 'Embedding does not bypass the existing Pro boundary');
root.wrIsPro = () => true;
card = root.PlayerCard({ ...props, embedded: false });
assert.equal(card.type, Sheet, 'Normal phone player cards retain their sheet');
assert(text(card).includes('Generic status summary'), 'Normal player-card overview retains its existing details');
phone = false;
card = root.PlayerCard({ ...props, embedded: false });
assert.equal(card.props.style.position, 'fixed', 'Desktop player cards retain their modal');

const draftSource = fs.readFileSync('js/draft-room.js', 'utf8');
const dossierStart = draftSource.indexOf('                        const phDossier =');
const fitStart = draftSource.indexOf('                            const _fit =', dossierStart);
const fitSource = draftSource.slice(fitStart, draftSource.indexOf('                            const fitText =', fitStart));
let fitOptions;
const fitCtx = vm.createContext({ window: { App: { computeNFLFit: (pid, options) => { fitOptions = options; return { narrative: 'Role read' }; } } },
    r: { pid: 'p', p: props.playersData.p, dhq: 8589 }, pos: 'RB', team: 'ATL', cs: {}, draftRound: 0, draftPick: 0, isRookieDraft: false, isTrueUdfa: () => true });
vm.runInContext('function fitForBoardRow() { ' + fitSource + ' return _fit; }', fitCtx);
fitCtx.fitForBoardRow();
assert.equal(fitOptions.isRookie, false);
assert(!Object.hasOwn(fitOptions, 'capital'), 'Veterans with no joined rookie CSV never inherit invented UDFA capital');
fitCtx.isRookieDraft = true;
fitCtx.fitForBoardRow();
assert.equal(fitOptions.capital.nflTeam, 'ATL', 'Actual rookie boards retain their supplied capital context');
const navSource = draftSource.slice(draftSource.indexOf('        const navDraftView ='), draftSource.indexOf('\n\n        useEffect(() => {', draftSource.indexOf('        const navDraftView =')));
const navStart = draftSource.indexOf('                    <div className="mc-draft-navigation">');
const navEnd = draftSource.indexOf('\n                )}', navStart);
const navigation = draftSource.slice(navStart, navEnd);
const seen = [];
const navCtx = vm.createContext({ React, window: { wrNavigateTab: route => seen.push(['route', route]) }, draftNavTouchedRef: { current: false }, _phone: true, setDraftView: view => seen.push(['view', view]), setShowDraftHistory() {}, launchLiveDraft() {}, activeView: 'board', commandTabAllowed: false, showDraftHistory: false });
vm.runInContext(Babel.transform(navSource + '\n function renderDraftNav() { return (' + navigation + '); }', { presets: ['react'] }).code, navCtx);
let nav = navCtx.renderDraftNav();
assert(draftSource.includes("{_phone && activeView !== 'mock' && ("), 'Mock Draft stays on its separate phone destination rather than adding a redundant workspace switcher');
assert(!nodes(nav).some(node => node.props['aria-label'] === 'Draft workspaces'), 'Phone Draft does not duplicate the global Draft/Mock navigation');
assert(nodes(nav).some(node => node.props['aria-label'] === 'Draft views'), 'Phone Draft keeps its useful room views');
assert(!text(nav).includes('Mock draft'), 'Mock Draft is absent from the Draft room inner tabs');
assert(text(nav).includes('Big Board') && text(nav).includes('Live'), 'Phone Draft retains direct board and live-room navigation');
console.log('PASS inline normal player profile, fit-only draft analysis, Pro boundary, modal compatibility, and focused phone Draft navigation');
