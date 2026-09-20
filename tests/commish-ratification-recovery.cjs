'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Bylaws = require('../js/shared/commish-bylaws.js');
const Proposals = require('../js/shared/commish-proposals.js');
const records = new Map(); let failKey = null, writes = [];
const storage = {
    get: (key, fallback) => records.has(key) ? JSON.parse(records.get(key)) : fallback,
    set(key, value) { writes.push(key); if (key === failKey) return false; records.set(key, JSON.stringify(value)); return true; },
};
global.App.AccountStorage = storage;
const source = fs.readFileSync('js/tabs/commissioner-office.js', 'utf8');
const hook = source.slice(source.indexOf('function useCommishLocalSave()'), source.indexOf('function CommissionerOffice('));
const handler = source.slice(source.indexOf('    const onRatifyProposal ='), source.indexOf('    // ── Ballot handlers'));
const slots = []; let cursor = 0, savedTicks = 0, guarded;
const c = vm.createContext({ console, C: { Bylaws, Proposals }, PROPOSALS_KEY: 'commish_rulelab_proposals', savedProposals: [],
    rlScoped: [{ league_id: 'L1', scoring_settings: { rec: 0.5, pass_td: 4 }, roster_positions: ['QB', 'RB'] }, { league_id: 'L2', scoring_settings: { rec: 0, pass_td: 4 }, roster_positions: ['QB', 'WR'] }],
    window: { App: { AccountStorage: storage, NavigationGuard: { register: fn => { guarded = fn; return () => {}; } } }, addEventListener() {}, removeEventListener() {} },
    setAckTick() {}, setSavedTick() { savedTicks++; },
    React: {
        useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => slots[i] = typeof value === 'function' ? value(slots[i]) : value]; },
        useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
        useEffect(fn, deps) { const i = cursor++; if (!(i in slots)) { slots[i] = true; if (!deps.length) fn(); } },
    },
});
vm.runInContext(hook + '\nfunction callback(localSave) {' + handler + ';return onRatifyProposal;}', c);
const render = () => { cursor = 0; const ui = c.useCommishLocalSave(); return { ui, ratify: c.callback(ui) }; };
const proposal = id => ({ id, name: 'PPR and lineup', status: 'draft', overrides: { rec: 1, pass_td: 6 }, rosterProposal: { rosterPositions: ['QB', 'RB', 'WR', 'TE'] } });
try {
    // Engine-level batch rejects atomically and remains compatible with single entries.
    const rows = [{ path: 'scoring.rec', from: 0, to: 1 }, { path: 'scoring.pass_td', from: 4, to: 6 }];
    failKey = 'commish_bylaws_L1';
    assert.throws(() => Bylaws.recordAmendments('L1', rows, { operationId: 'fixture' }), { code: 'LOCAL_SAVE_FAILED' });
    assert.equal(Bylaws.amendments('L1').length, 0);
    failKey = null; writes = []; Bylaws.recordAmendments('L1', rows, { operationId: 'fixture' });
    assert.equal(writes.length, 1); Bylaws.recordAmendments('L1', rows, { operationId: 'fixture' });
    assert.equal(writes.length, 1); assert.equal(Bylaws.amendments('L1').length, 2);
    Bylaws.recordAmendment('L1', { path: 'settings.trade_deadline', from: 10, to: 12 }); assert.equal(Bylaws.amendments('L1').length, 3);
    records.clear();
    c.savedProposals = [proposal('p1')]; records.set(c.PROPOSALS_KEY, JSON.stringify(c.savedProposals));
    failKey = 'commish_bylaws_L2'; let { ui, ratify } = render();
    assert.equal(ratify('p1'), false); ({ ui } = render()); assert.match(ui.failure.message, /incomplete/); assert.equal(guarded(), false);
    assert.equal(Bylaws.amendments('L1').length, 3); assert.equal(Bylaws.amendments('L2').length, 0); assert.equal(savedTicks, 0);
    assert.equal(storage.get(c.PROPOSALS_KEY)[0].status, 'draft');
    failKey = null; writes = []; assert.equal(ui.failure.retry(), true); ({ ui } = render());
    assert.equal(Bylaws.amendments('L1').length, 3); assert.equal(Bylaws.amendments('L2').length, 3); assert(!writes.includes('commish_bylaws_L1'));
    assert.deepEqual(storage.get(c.PROPOSALS_KEY)[0].ratifiedLeagueIds, ['L1', 'L2']); assert.equal(storage.get(c.PROPOSALS_KEY)[0].status, 'ratified'); assert.equal(ui.failure, null);
    const rosterRow = Bylaws.amendments('L2').find(row => row.path === 'roster_positions');
    assert.deepEqual(rosterRow.from, ['QB', 'WR']); assert.deepEqual(rosterRow.to, ['QB', 'RB', 'WR', 'TE']);
    // Failure after every league succeeded must leave status honest and only retry status.
    c.savedProposals = [proposal('p2'), ...storage.get(c.PROPOSALS_KEY)]; records.set(c.PROPOSALS_KEY, JSON.stringify(c.savedProposals));
    failKey = c.PROPOSALS_KEY; ({ ratify } = render()); assert.equal(ratify('p2'), false); ({ ui } = render());
    assert.equal(storage.get(c.PROPOSALS_KEY)[0].status, 'draft'); assert.equal(Bylaws.amendments('L1').length, 6);
    failKey = null; writes = []; assert.equal(ui.failure.retry(), true); assert.deepEqual(writes, [c.PROPOSALS_KEY]);
    assert.equal(Bylaws.amendments('L1').length, 6); assert.equal(Bylaws.amendments('L2').length, 6);
    // A proposal removed in another mounted view cannot be recreated or ratified from stale render data.
    records.set(c.PROPOSALS_KEY, '[]'); writes = []; ({ ratify } = render());
    assert.equal(ratify('p2'), false); assert.equal(writes.length, 0);
    assert.equal(Bylaws.amendments('L1').length, 6);
    console.log('PASS actual ratification commits each league once, retains partial failure truth, records roster/scoring intent, and retries later league/status writes without duplicate amendments');
} finally { delete global.App.AccountStorage; }
