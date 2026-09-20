'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Genesis = require('../js/shared/commish-genesis.js');
const Proposals = require('../js/shared/commish-proposals.js');
const source = fs.readFileSync('js/tabs/commissioner-office.js', 'utf8');
const hook = source.slice(source.indexOf('function useCommishLocalSave()'), source.indexOf('function CommissionerOffice('));
const proposalCallbacks = source.slice(source.indexOf('    const [savedTick,'), source.indexOf('    const onRatifyProposal ='));
const resetCallback = source.slice(source.indexOf('    const onResetProposal ='), source.indexOf('    const proposalsEqual ='));
const genesisCallback = source.slice(source.indexOf('    const onGenesisToggle ='), source.indexOf('    // Governance state:'));
const records = new Map(), slots = []; let cursor = 0, rejected = true, ticks = 0, guarded;
const storage = { get: (key, fallback) => records.has(key) ? JSON.parse(records.get(key)) : fallback, set: (key, value) => { if (rejected) return false; records.set(key, JSON.stringify(value)); return true; } };
global.App.AccountStorage = storage;
const c = vm.createContext({ console, C: { Genesis, Proposals }, proposal: { rec: 1 }, rosterProposal: { rosterPositions: ['QB', 'RB', 'TE'] },
    window: { App: { AccountStorage: storage, NavigationGuard: { register: fn => { guarded = fn; return () => {}; } } }, addEventListener() {}, removeEventListener() {} },
    React: {
        useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => slots[i] = typeof value === 'function' ? value(slots[i]) : value]; },
        useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
        useEffect(fn, deps) { const i = cursor++; if (!(i in slots)) { slots[i] = true; if (!deps.length) fn(); } }, useMemo: fn => fn(),
    },
    setProposal: value => { c.proposal = value; }, setRosterProposal: value => { c.rosterProposal = value; }, setCommittedProposal() {}, setCommittedRosterProposal() {}, setGenTick() { ticks++; },
});
vm.runInContext(hook + '\nfunction callbacks(localSave) {' + resetCallback + proposalCallbacks + genesisCallback + '\nreturn {onSaveProposal,onDeleteProposal,onLoadProposal,onResetProposal,onGenesisToggle};}', c);
const render = () => { cursor = 0; const ui = c.useCommishLocalSave(); return { ui, actions: c.callbacks(ui) }; };
try {
    let { ui, actions } = render();
    assert.equal(actions.onSaveProposal('First proposal'), false); ({ ui, actions } = render()); assert(ui.failure); assert.equal(guarded(), false); assert.equal(records.size, 0);
    c.proposal = { rec: 1.5 }; rejected = false;
    assert.equal(actions.onSaveProposal('First proposal'), true); ({ ui, actions } = render()); assert.equal(ui.failure, null);
    const list = storage.get('commish_rulelab_proposals', []); assert.equal(list.length, 1); assert.equal(list[0].overrides.rec, 1.5);
    assert.deepEqual(list[0].rosterProposal.rosterPositions, ['QB', 'RB', 'TE']);
    ui.run('proposal-ratify:' + list[0].id, 'rulelab', () => { throw Error('Incomplete ratification'); });
    rejected = true; assert.equal(actions.onDeleteProposal(list[0].id), false); assert.equal(storage.get('commish_rulelab_proposals', []).length, 1);
    rejected = false; assert.equal(actions.onDeleteProposal(list[0].id), true); ({ ui, actions } = render()); assert.equal(ui.failure, null, 'deletion cancels the removed proposal\'s pending ratification'); assert.equal(storage.get('commish_rulelab_proposals', []).length, 0);
    rejected = true; actions.onSaveProposal('Discard this failed draft'); ({ ui, actions } = render()); ui.discard(); ({ ui, actions } = render());
    assert.equal(Object.keys(c.proposal).length, 0); assert.equal(c.rosterProposal, null); assert.equal(guarded(), true);
    assert.equal(actions.onGenesisToggle('league', 'dues_noted'), false); assert.equal(ticks, 0); ({ ui, actions } = render()); assert(ui.failure);
    rejected = false; assert.equal(actions.onGenesisToggle('league', 'dues_noted'), true); ({ ui } = render()); assert.equal(ticks, 1); assert.equal(ui.failure, null);
    console.log('PASS actual proposal/checklist callbacks preserve failed records and editor values, retry latest rules, remove only after confirmed save, and discard only unsaved proposal inputs');
} finally { delete global.App.AccountStorage; }
