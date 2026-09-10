'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Babel = require('@babel/standalone');
const Cup = require('../js/shared/woeppel-cup.js');
const source = Babel.transform(fs.readFileSync('js/components/woeppel-cup-panel.js', 'utf8'), { presets: ['react'] }).code;
const league = { league_id: '1234567890123456789', season: '2026', name: 'Test League', rosters: Array.from({ length: 5 }, (_, i) => ({ roster_id: i + 1 })), settings: { playoff_week_start: 15 } };
const walk = node => node == null || typeof node === 'boolean' ? [] : Array.isArray(node) ? node.flatMap(walk) : typeof node === 'object' ? [node, ...walk(node.children)] : [node];
const text = node => walk(node).filter(value => typeof value !== 'object').join('');
const find = (tree, predicate) => walk(tree).find(node => typeof node === 'object' && predicate(node));
const button = (tree, label) => find(tree, node => node.type === 'button' && text(node).startsWith(label));
const writes = app => app.calls.filter(call => call.action !== 'load');
function harness({ canManage = false, saved = null, deny = false } = {}) {
    let slots = [], dependencies = [], pendingEffects = [], index = 0, dirty = true, tree;
    const calls = [], storage = new Map();
    const config = { canManage, saved, deny, matchups: [] };
    const React = {
        useState(initial) { const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; if (next !== slots[i]) { slots[i] = next; dirty = true; } }]; },
        useRef(initial) { const i = index++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
        useMemo(fn) { index++; return fn(); },
        useEffect(fn, deps) { const i = index++; if (!dependencies[i] || deps.some((value, n) => value !== dependencies[i][n])) { dependencies[i] = deps; pendingEffects.push(fn); } },
        createElement(type, props, ...children) { return { type, props: props || {}, children }; }
    };
    const client = { functions: { async invoke(name, { body }) {
        assert.equal(name, 'league-cup');
        calls.push(structuredClone(body));
        if (config.deny) return { data: { error: 'A member sign-in is required.' }, error: null };
        if (body.action === 'save') { config.saved = structuredClone(body.state); return { data: { cup: { state: config.saved, revision: body.revision + 1 }, canManage: config.canManage }, error: null }; }
        return { data: { cup: config.saved ? { state: config.saved, revision: 3 } : null, canManage: config.canManage }, error: null };
    } } };
    const context = { React, console, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }, window: { WoeppelCup: Cup, App: { OD: { getClient: () => client } }, location: { pathname: '/dist-preview/index.html' }, confirm: () => true, prompt: () => 'Verified league tiebreak evidence', fetchMatchups: async () => config.matchups } };
    vm.createContext(context); vm.runInContext(source, context);
    const props = { league, getOwnerName: id => 'Team ' + id, myRoster: { roster_id: 1 } };
    const render = () => { index = 0; dirty = false; tree = context.window.WoeppelCupPanel(props); pendingEffects.splice(0).forEach(effect => effect()); return tree; };
    async function flush() { for (let i = 0; i < 12; i++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)); if (!dirty && !pendingEffects.length) return tree; } throw Error('React mock did not settle'); }
    async function click(label) { const target = button(tree, label); assert(target, 'Button exists: ' + label); assert(!target.props.disabled, 'Button enabled: ' + label); target.props.onClick(); return flush(); }
    async function choose(id) { const format = Cup.tournament.formats.find(f => f.id === id); const target = find(tree, node => node.props?.role === 'radio' && text(node).includes(format.name)); assert(target, 'Format radio exists: ' + id); target.props.onClick(); return flush(); }
    return { calls, config, flush, click, choose, get tree() { return tree; } };
}
(async () => {
    // Rejected authentication never hides the usable gallery or authorizes writes.
    for (const format of Cup.tournament.formats) {
        const app = harness({ deny: true }); await app.flush();
        assert.equal(walk(app.tree).filter(node => node.props?.role === 'radio').length, 6);
        assert(text(app.tree).includes('Explore now. Connect to save.'));
        assert(text(app.tree).includes('A member sign-in is required.'));
        assert.equal(find(app.tree, node => node.type === 'a' && text(node) === 'Open sign-in').props.href, '../login.html');
        assert(!button(app.tree, 'Start league Cup'));
        await app.choose(format.id);
        assert.equal(writes(app).length, 0, 'Choosing ' + format.id + ' is local');
        await app.click('Try a sample Cup');
        assert(text(app.tree).includes('SAMPLE CUP · MADE-UP SCORES'));
        assert(text(app.tree).includes('Your league Cup is unchanged.'));
        let played = 0;
        while (!text(app.tree).includes('SAMPLE CHAMPION') && played++ < 18) await app.click('Play next sample week');
        assert(text(app.tree).includes('SAMPLE CHAMPION'), format.id + ' reaches champion through the visible sample controls');
        assert(!button(app.tree, 'Record in Hall of Fame'), 'No sample archive action');
        assert(!button(app.tree, 'Fetch Sleeper scores'), 'No live-score action in sample');
        assert.equal(writes(app).length, 0, format.id + ' sample never writes');
        await app.click('Restart sample');
        assert(!text(app.tree).includes('SAMPLE CHAMPION'));
        assert(button(app.tree, 'Play next sample week'));
    }
    const member = harness(); await member.flush();
    assert.equal(walk(member.tree).filter(node => node.props?.role === 'radio').length, 6);
    assert(!button(member.tree, 'Start league Cup'));
    // Invoke the form directly as well: server mutation guards cannot depend on hiding buttons.
    find(member.tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await member.flush();
    assert.equal(writes(member).length, 0);

    const commissioner = harness({ canManage: true }); await commissioner.flush();
    await commissioner.choose('knockout');
    assert.equal(writes(commissioner).length, 0, 'Commissioner selection remains a draft');
    assert(button(commissioner.tree, 'Start league Cup'));
    find(commissioner.tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await commissioner.flush();
    assert.equal(writes(commissioner).length, 1, 'Explicit Start saves once');
    assert.equal(writes(commissioner)[0].state.format, 'knockout');
    assert.equal(writes(commissioner)[0].state.locked, true);
    assert.equal(writes(commissioner)[0].state.enabled, true);
    assert.equal(writes(commissioner)[0].revision, 0);

    const saved = { ...Cup.tournament.defaults(league), name: 'Real Shared Cup', locked: true, enabled: true };
    const browsingActive = harness({ canManage: true, saved }); await browsingActive.flush();
    await browsingActive.click('Explore formats'); await browsingActive.choose('survivor');
    find(browsingActive.tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await browsingActive.flush();
    assert.equal(writes(browsingActive).length, 0, 'Setup form cannot overwrite a locked Cup while exploring formats');
    const connected = harness({ canManage: true, saved }); await connected.flush();
    connected.config.deny = true;
    await connected.click('Refresh Cup');
    assert(text(connected.tree).includes('Real Shared Cup'), 'Refresh failure retains the shared tournament');
    assert(!text(connected.tree).includes('SAMPLE CUP'), 'Failed load does not substitute fake results');
    await connected.click('Explore formats'); await connected.choose('survivor'); await connected.click('Try a sample Cup');
    await connected.click('Play next sample week');
    assert(text(connected.tree).includes('SAMPLE CUP · MADE-UP SCORES'));
    assert.equal(writes(connected).length, 0);
    await connected.click('Explore formats'); await connected.click('Back to your Cup');
    assert(text(connected.tree).includes('Real Shared Cup'));
    assert(!text(connected.tree).includes('SAMPLE CUP'));
    assert.equal(Object.keys(connected.config.saved.weeks).length, 0, 'Exploring sample scores never mutates saved Cup');
    assert.equal(find(connected.tree, node => node.type === 'input' && node.props.maxLength === 80).props.value, 'Real Shared Cup', 'Returning to active Cup restores its saved name, not the sample name');

    const scoreApp = harness({ canManage: true, saved: structuredClone(saved) }); await scoreApp.flush();
    scoreApp.config.matchups = league.rosters.map((roster, i) => ({ roster_id: roster.roster_id, points: 100 + i, ...(i === 0 ? { custom_points: 0 } : i === 1 ? { custom_points: -2.25 } : {}) }));
    await scoreApp.click('Fetch Sleeper scores'); await scoreApp.click('Save score preview');
    const fetchedScores = writes(scoreApp).at(-1).state.weeks[saved.startWeek].scores;
    assert.equal(fetchedScores['1'], 0, 'Commissioner override zero takes precedence over standard points');
    assert.equal(fetchedScores['2'], -2.25, 'Commissioner override negative points remains valid');
    assert.equal(fetchedScores['3'], 102, 'Normal score remains when no override');
    assert.equal(writes(scoreApp).at(-1).state.weeks[saved.startWeek].final, false, 'Fetching scores does not finalize the week');

    const tied = { ...Cup.tournament.configure(league, 'knockout', { teams: ['1', '2', '3', '4'] }), locked: true, enabled: true };
    tied.weeks[tied.knockoutStart] = { final: true, scores: { '1': 100, '2': 100, '3': 100, '4': 100 } };
    const pairings = Cup.tournament.knockout(tied)[0];
    const tieApp = harness({ canManage: true, saved: tied }); await tieApp.flush();
    await tieApp.click('Advance Team ' + pairings[0].a);
    await tieApp.click('Advance Team ' + pairings[1].a);
    const rulings = writes(tieApp).at(-1).state.tieRulings;
    assert.equal(Object.keys(rulings).length, 2, 'Resolving a second matchup preserves the first same-week tiebreak');
    assert.equal(rulings[tied.knockoutStart + ':' + pairings[0].a + ':' + pairings[0].b].winner, pairings[0].a);
    assert.equal(rulings[tied.knockoutStart + ':' + pairings[1].a + ':' + pairings[1].b].winner, pairings[1].a);

    const legacy = harness({ saved: { groups: { A: [], B: [], C: [] }, weeks: {}, locked: false, drawMargin: 4 } }); await legacy.flush();
    assert.equal(legacy.tree.type.name, 'LegacyWoeppelCupPanel', 'Existing legacy Cup keeps legacy rendering');
    assert.equal(writes(legacy).length, 0);
    console.log('PASS Cup panel: six complete local sample formats, denied/read-only permissions, explicit commissioner Start, refresh preservation and legacy routing');
})().catch(error => { console.error(error); process.exitCode = 1; });
