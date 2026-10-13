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
function harness({ canManage = false, saved = null, deny = false, saveError = '', deferSaves = false, legacy = false } = {}) {
    let slots = [], dependencies = [], pendingEffects = [], index = 0, dirty = true, tree;
    const calls = [], storage = new Map(), intervals = [];
    const config = { canManage, saved, deny, saveError, deferSaves, pendingSaves: [], deferLoads: false, pendingLoads: [], matchups: [] };
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
        if (body.action === 'save') {
            if (config.deferSaves) await new Promise(resolve => config.pendingSaves.push(resolve));
            if (config.saveError) return { data: { error: config.saveError }, error: null };
            config.saved = structuredClone(body.state);
            return { data: { cup: { state: config.saved, revision: body.revision + 1 }, canManage: config.canManage }, error: null };
        }
        const data = { cup: config.saved ? { state: structuredClone(config.saved), revision: 3 } : null, canManage: config.canManage };
        if (config.deferLoads) await new Promise(resolve => config.pendingLoads.push(resolve));
        return { data, error: null };
    } } };
    const context = { React, console, document: { visibilityState: 'visible' }, setInterval: fn => intervals.push(fn), clearInterval() {}, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }, window: { WoeppelCup: Cup, App: { OD: { getClient: () => client } }, location: { pathname: '/dist-preview/index.html' }, confirm: () => true, prompt: () => 'Verified league tiebreak evidence', fetchMatchups: async () => config.matchups } };
    vm.createContext(context); vm.runInContext(source, context);
    const props = { league: legacy ? { ...league, rosters: Array.from({ length: 12 }, (_, i) => ({ roster_id: i + 1 })) } : league, getOwnerName: id => 'Team ' + id, myRoster: { roster_id: 1 } };
    const render = () => { index = 0; dirty = false; tree = (legacy ? context.LegacyWoeppelCupPanel : context.window.WoeppelCupPanel)(props); pendingEffects.splice(0).forEach(effect => effect()); return tree; };
    async function flush() { for (let i = 0; i < 12; i++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)); if (!dirty && !pendingEffects.length) return tree; } throw Error('React mock did not settle'); }
    async function click(label) { const target = button(tree, label); assert(target, 'Button exists: ' + label); assert(!target.props.disabled, 'Button enabled: ' + label); target.props.onClick(); return flush(); }
    async function choose(id) { const format = Cup.tournament.formats.find(f => f.id === id); const target = find(tree, node => node.props?.role === 'radio' && text(node).includes(format.name)); assert(target, 'Format radio exists: ' + id); target.props.onClick(); return flush(); }
    async function rename(value) { const input = find(tree, node => node.type === 'input' && node.props.maxLength === 80); assert(input, 'Cup name remains editable'); input.props.onChange({ target: { value } }); return flush(); }
    async function finishSave() { assert.equal(config.pendingSaves.length, 1, 'Exactly one save is awaiting the server'); config.pendingSaves.shift()(); return flush(); }
    async function backgroundRefresh() { intervals.forEach(fn => fn()); return flush(); }
    async function finishLoad() { assert.equal(config.pendingLoads.length, 1, 'Exactly one refresh is awaiting the server'); config.pendingLoads.shift()(); return flush(); }
    return { calls, config, storage, flush, click, choose, rename, finishSave, backgroundRefresh, finishLoad, get tree() { return tree; } };
}
(async () => {
    // Rejected authentication never hides the usable gallery or authorizes writes.
    for (const format of Cup.tournament.formats) {
        const app = harness({ deny: true }); await app.flush();
        assert.equal(walk(app.tree).filter(node => node.props?.role === 'radio').length, 6);
        assert(text(app.tree).includes('Explore now. Connect to save.'));
        assert(text(app.tree).includes('A member sign-in is required.'));
        assert.equal(find(app.tree, node => node.type === 'a' && text(node) === 'Open sign-in').props.href, '../login.html?reauth=1');
        assert(!button(app.tree, 'Save & lock Cup'));
        assert(!button(app.tree, 'Save draft'));
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
    assert(!button(member.tree, 'Save & lock Cup'));
    assert(!button(member.tree, 'Save draft'));
    assert.equal(find(member.tree, node => node.type === 'a' && text(node) === 'Open sign-in').props.href, '../login.html?reauth=1', 'Read-only members can reopen sign-in instead of returning to the current session');
    // A retained setup form must not authorize a member's write through Enter/submit.
    const memberForm = find(member.tree, node => node.type === 'form');
    if (memberForm) { memberForm.props.onSubmit({ preventDefault() {} }); await member.flush(); }
    assert.equal(writes(member).length, 0);

    const commissioner = harness({ canManage: true }); await commissioner.flush();
    await commissioner.choose('knockout');
    assert.equal(writes(commissioner).length, 0, 'Commissioner selection remains a draft');
    const selectedDetail = find(commissioner.tree, node => node.props?.className === 'cup-format-detail');
    assert(selectedDetail && text(selectedDetail).includes('seeded elimination bracket'), 'Selected format keeps its explanation available for the compact phone chooser');
    const lockButton = button(commissioner.tree, 'Save & lock Cup');
    assert(lockButton, 'Commissioner has an explicit save-and-lock action');
    assert.equal(lockButton.props.type, 'button', 'Phone save does not depend on browser form validation');
    assert.equal(typeof lockButton.props.onClick, 'function', 'Save-and-lock runs directly from the tapped button');
    assert(lockButton.props.className.includes('cup-primary'), 'Save-and-lock is the primary action');
    assert(button(commissioner.tree, 'Try a sample Cup'), 'Samples remain available alongside the real save action');
    await commissioner.click('Save & lock Cup');
    assert.equal(writes(commissioner).length, 1, 'Explicit save-and-lock saves once');
    assert.equal(writes(commissioner)[0].state.format, 'knockout');
    assert.equal(writes(commissioner)[0].state.locked, true);
    assert.equal(writes(commissioner)[0].state.enabled, true);
    assert.equal(writes(commissioner)[0].revision, 0);
    assert(text(commissioner.tree).includes('Saved & locked'), 'Successful server save confirms the Cup is locked');
    assert(!button(commissioner.tree, 'Save & lock Cup'), 'Locked Cup leaves setup mode');
    const reopened = harness({ canManage: true, saved: structuredClone(commissioner.config.saved) }); await reopened.flush();
    assert(text(reopened.tree).includes('Saved & locked'), 'A fresh mount restores the saved locked Cup');
    assert(text(reopened.tree).includes(Cup.tournament.formats.find(format => format.id === 'knockout').name));
    assert(!button(reopened.tree, 'Save & lock Cup'), 'Reopening does not ask the commissioner to save again');
    assert.equal(writes(reopened).length, 0, 'Loading a saved Cup never creates another save');

    const draftApp = harness({ canManage: true }); await draftApp.flush();
    await draftApp.choose('survivor'); await draftApp.rename('Friday Night Cup');
    await draftApp.click('Save draft');
    assert.equal(writes(draftApp).length, 1);
    assert.equal(writes(draftApp)[0].state.locked, false, 'Save draft does not lock the tournament');
    assert.equal(draftApp.config.saved.name, 'Friday Night Cup');
    assert.equal(draftApp.config.saved.format, 'survivor');
    assert(button(draftApp.tree, 'Save & lock Cup'), 'Saved draft remains ready to edit or lock');
    assert(!text(draftApp.tree).includes('Saved & locked'), 'Draft save never claims a lock');
    const reopenedDraft = harness({ canManage: true, saved: structuredClone(draftApp.config.saved) }); await reopenedDraft.flush();
    assert.equal(find(reopenedDraft.tree, node => node.type === 'input' && node.props.maxLength === 80).props.value, 'Friday Night Cup');
    assert(text(find(reopenedDraft.tree, node => node.props?.role === 'radio' && node.props['aria-checked'])).includes(Cup.tournament.formats.find(format => format.id === 'survivor').name), 'Reopening restores the saved draft format');
    await draftApp.click('Save & lock Cup');
    assert.equal(writes(draftApp).at(-1).revision, 1, 'Locking a draft uses the saved revision');
    assert.equal(writes(draftApp).at(-1).state.locked, true);
    assert.equal(writes(draftApp).at(-1).state.enabled, true);
    assert(text(draftApp.tree).includes('Saved & locked'));

    const failed = harness({ canManage: true, saveError: 'Cup save failed. Try again.' }); await failed.flush();
    await failed.choose('knockout'); await failed.rename('Keep My Cup');
    await failed.click('Save & lock Cup');
    assert.equal(writes(failed).length, 1);
    assert.equal(failed.config.saved, null, 'Failed request does not persist a Cup');
    assert(text(failed.tree).includes('Cup save failed. Try again.'), 'Save failure is shown inline');
    assert(!text(failed.tree).includes('Saved & locked'), 'Rejected save never claims a lock');
    assert.equal(find(failed.tree, node => node.type === 'input' && node.props.maxLength === 80).props.value, 'Keep My Cup', 'Save rejection preserves the commissioner draft');
    await failed.rename('Keep My Edited Cup');
    failed.config.saveError = '';
    await failed.click('Save & lock Cup');
    assert.equal(writes(failed).length, 2, 'A rejected save can be retried');
    assert.equal(writes(failed).at(-1).state.name, 'Keep My Edited Cup', 'Retry saves the editable retained draft');
    assert.equal(writes(failed).at(-1).state.format, 'knockout');
    assert.equal(writes(failed).at(-1).revision, 0, 'Rejected save does not advance the revision');
    assert(text(failed.tree).includes('Saved & locked'));
    assert(!text(failed.tree).includes('Cup save failed. Try again.'));

    const pending = harness({ canManage: true, deferSaves: true }); await pending.flush();
    const rapidTap = button(pending.tree, 'Save & lock Cup').props.onClick;
    const competingDraftSave = button(pending.tree, 'Save draft').props.onClick;
    const competingRefresh = button(pending.tree, 'Refresh Cup').props.onClick;
    rapidTap(); rapidTap(); competingDraftSave(); competingRefresh(); await pending.flush();
    assert.equal(writes(pending).length, 1, 'Two phone taps before rerender send only one save request');
    assert.equal(pending.calls.filter(call => call.action === 'load').length, 1, 'Refresh is guarded before buttons rerender during a pending save');
    assert.equal(pending.config.saved, null, 'Cup is not treated as saved before the server responds');
    assert(!text(pending.tree).includes('Saved & locked'), 'Pending request never claims a lock');
    assert(button(pending.tree, 'Save draft').props.disabled, 'Draft save cannot race the lock request');
    assert(find(pending.tree, node => node.type === 'fieldset' && node.props.className === 'cup-plan-controls').props.disabled, 'Setup fields stay fixed while a save is pending');
    assert(walk(pending.tree).filter(node => node.props?.role === 'radio').every(node => node.props.disabled), 'Format selection stays fixed while a save is pending');
    assert(button(pending.tree, 'Refresh Cup')?.props.disabled || button(pending.tree, 'Connecting…')?.props.disabled, 'Refresh cannot overwrite a pending save');
    await pending.finishSave();
    assert.equal(writes(pending).length, 1);
    assert(text(pending.tree).includes('Saved & locked'), 'Lock status appears after the pending save succeeds');

    const saved = { ...Cup.tournament.defaults(league), name: 'Real Shared Cup', locked: true, enabled: true };
    const browsingActive = harness({ canManage: true, saved }); await browsingActive.flush();
    await browsingActive.click('Explore formats'); await browsingActive.choose('survivor');
    const browsingForm = find(browsingActive.tree, node => node.type === 'form');
    if (browsingForm) { browsingForm.props.onSubmit({ preventDefault() {} }); await browsingActive.flush(); }
    assert(!button(browsingActive.tree, 'Save & lock Cup'), 'Exploring formats cannot replace a locked Cup');
    assert(!button(browsingActive.tree, 'Save draft'));
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

    const legacyDraw = { groups: { A: ['1', '2', '3', '4'], B: ['5', '6', '7', '8'], C: ['9', '10', '11', '12'] }, weeks: {}, locked: false, drawMargin: 4 };
    const legacyRace = harness({ legacy: true, canManage: true, saved: legacyDraw, deferSaves: true }); await legacyRace.flush();
    await legacyRace.click('Manage Cup');
    legacyRace.config.deferLoads = true;
    await legacyRace.backgroundRefresh();
    assert.equal(legacyRace.config.pendingLoads.length, 1, 'Legacy background refresh is pending with the old unlocked draw');
    const lockGroups = button(legacyRace.tree, 'Lock groups & create fixtures').props.onClick;
    lockGroups(); lockGroups(); await legacyRace.flush();
    assert.equal(writes(legacyRace).length, 1, 'Legacy duplicate lock taps send one request');
    assert.equal(writes(legacyRace)[0].state.locked, true, 'Legacy lock supersedes a pending refresh');
    await legacyRace.backgroundRefresh();
    assert.equal(legacyRace.calls.filter(call => call.action === 'load').length, 2, 'Legacy automatic refresh is skipped while saving');
    await legacyRace.finishSave();
    assert(!button(legacyRace.tree, 'Lock groups & create fixtures'), 'Legacy save success leaves draw setup');
    assert(text(legacyRace.tree).includes('Twelve teams. One name on the trophy.'));
    await legacyRace.finishLoad();
    assert(!button(legacyRace.tree, 'Lock groups & create fixtures'), 'Stale refresh cannot unlock a saved legacy Cup');
    assert(text(legacyRace.tree).includes('Twelve teams. One name on the trophy.'));
    const backup = JSON.parse(legacyRace.storage.get('wr_woeppel_v1_' + league.league_id + '_' + league.season));
    assert.equal(backup.locked, true, 'Legacy local backup records the confirmed server lock');
    assert.deepEqual(backup.groups, legacyDraw.groups);
    console.log('PASS Cup panel: explicit save-and-lock, draft/remount persistence, retry and duplicate-tap guards, six sample formats, permissions, score overrides, refresh preservation, legacy routing and save/refresh races');
})().catch(error => { console.error(error); process.exitCode = 1; });
