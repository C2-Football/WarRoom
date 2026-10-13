'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const P = require('../js/shared/commish-prefs.js');
const F = require('../js/shared/commish-followups.js');
const office = fs.readFileSync('js/tabs/commissioner-office.js', 'utf8');
const helper = office.slice(office.indexOf('async function copyCommishText('), office.indexOf('function CommishIgnoreSyncStatus('));
const copyHandler = office.slice(office.indexOf('    const onCopy = async '), office.indexOf('    // ── Preference + action mutations'));

(async () => {
    let owner = 'account:one', feedback, finishWrite;
    const c = vm.createContext({
        navigator: { clipboard: { writeText: () => new Promise(resolve => { finishWrite = resolve; }) } },
        window: { App: { AccountStorage: { owner: () => owner }, AccountSession: { isCurrent: () => true } } },
        copyRequest: { current: 0 }, copyScope: { current: 'schedule:L1' }, copyOpener: { current: null }, document: { activeElement: null }, setCopyFeedback: value => { feedback = value; },
    });
    vm.runInContext(helper + '\nfunction copyActions() {' + copyHandler + '\nreturn onCopy;}', c);
    const copy = c.copyActions();
    const pending = copy('Exact ballot\nSecond line', 'Ballot text');
    assert.equal(feedback, null, 'a pending clipboard promise never claims success');
    finishWrite(); assert.equal(await pending, true);
    assert.equal(feedback.copied, true); assert.equal(feedback.label, 'Ballot text');
    c.navigator.clipboard.writeText = async () => { throw Error('denied'); };
    assert.equal(await copy('Exact failed\nCSV,bytes', 'Schedule CSV'), false);
    assert.equal(feedback.copied, false); assert.equal(feedback.text, 'Exact failed\nCSV,bytes', 'fallback preserves exact intended content');
    c.navigator.clipboard = undefined;
    assert.equal(await copy('Unavailable clipboard'), false); assert.match(feedback.error, /manually/);
    c.navigator.clipboard = { writeText: () => new Promise(resolve => { finishWrite = resolve; }) };
    const stale = copy('Old account proposal'); owner = 'account:two'; finishWrite();
    assert.equal(await stale, false); assert.equal(feedback, null, 'an old account result cannot display in the next account');
    const oldScope = copy('Old workspace proposal'); c.copyScope.current = 'rulelab:L2'; finishWrite();
    assert.equal(await oldScope, false); assert.equal(feedback, null, 'a late result cannot open a fallback in a different workspace');
    console.log('PASS clipboard pending, success, denied/missing fallback and account-change guards');

    const records = new Map(), remote = {}; let reject = null, rejectRemote = false, closed = 0, intent = null;
    let account = 'account:one', releaseRemote = null, holdRemote = false, requests = 0;
    global.App.AccountStorage = {
        owner: () => account,
        get: (key, fallback) => records.has(key) ? JSON.parse(records.get(key)) : fallback,
        set: (key, value) => { if (key === reject) return false; records.set(key, JSON.stringify(value)); return true; },
    };
    global.App.AccountSession = { isCurrent: () => true };
    const sync = global.App.Commish.IgnoreSync = {
        snapshot: () => ({ owner: 'account:one', records: remote, error: rejectRemote ? 'Connection interrupted. Retry this task choice.' : null, pending: null }),
        async change(item, state) {
            requests++;
            if (holdRemote) await new Promise(resolve => { releaseRemote = resolve; });
            if (rejectRemote) return false;
            remote[item.id] = { taskId: item.id, state, revision: (remote[item.id]?.revision || 0) + 1,
                updatedAt: new Date().toISOString(), snapshot: item, source: 'cloud', confirmed: true };
            return true;
        },
    };
    const item = { id: 'genesis:L1', headline: 'Finish season setup', leagueIds: ['L1'], leagueNames: ['Fixture League'], tier: 'SOON', metric: { value: 33, unit: '% ready' } };
    const hooks = office.slice(office.indexOf('function useCommishLocalSave()'), office.indexOf('function CommissionerOffice('));
    const callbacks = office.slice(office.indexOf('    const bumpPrefs ='), office.indexOf('    const onExportAll ='));
    const slots = []; let cursor = 0; const actionRef = { current: item };
    const context = vm.createContext({ console, P, F, C: global.App.Commish, rawQueue: { items: [item] }, actionItem: item,
        window: { App: global.App, addEventListener() {}, removeEventListener() {} },
        navigator: { clipboard: {} }, setPrefTick() {}, setFollowTick() {}, openHub() {},
        ignoreRun: { current: 0 }, ignoreBusy: { current: false }, actionItemRef: actionRef, setIgnoreIntent: value => { intent = value; },
        setActionItem: value => { actionRef.current = value; if (value === null) closed++; },
        React: {
            useState(init) { const i = cursor++; if (!(i in slots)) slots[i] = init; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
            useRef(init) { const i = cursor++; if (!(i in slots)) slots[i] = { current: init }; return slots[i]; },
            useEffect() {},
        },
    });
    vm.runInContext(hooks + '\nfunction actions(localSave) {' + callbacks + '\nreturn {onItemIgnore,onItemRestore,onRemoveFollowup,onQueueItem};}', context);
    const render = () => { cursor = 0; const local = context.useCommishLocalSave(); return { local, actions: context.actions(local) }; };
    F.save(item, { note: 'Keep this note', dueAt: '2000-01-01' }, { nowMs: 10 });
    rejectRemote = true; let ui = render();
    assert.equal(await ui.actions.onItemIgnore(item), false); ui = render();
    assert.equal(P.stateOf(item.id), null); assert.equal(closed, 0); assert.equal(intent.status, 'failed');
    assert.equal(F.get(item.id).status, 'OPEN', 'failed remote choice does not claim ignored history');
    rejectRemote = false;
    assert.equal(await ui.actions.onItemIgnore(item), true); ui = render();
    assert.equal(closed, 1); assert.equal(P.stateOf(item.id).state, 'ignored'); assert.equal(intent, null);
    assert.equal(F.get(item.id).status, 'IGNORED'); assert.equal(F.get(item.id).note, 'Keep this note');
    const changed = { ...item, tier: 'NOW', metric: { value: 1, unit: '% ready' } };
    assert.equal(P.applyStates([changed], { states: P.allItemStates() }).visible.length, 0);
    context.rawQueue.items = []; rejectRemote = true;
    assert.equal(await ui.actions.onItemRestore(item.id), false); ui = render();
    assert.equal(P.ignoredItems([]).length, 1, 'failed remote restore keeps the remembered ignore');
    rejectRemote = false; assert.equal(await ui.actions.onItemRestore(item.id), true); ui = render();
    assert.equal(P.ignoredItems([]).length, 0); assert.equal(F.get(item.id).status, 'OPEN');
    assert.equal(F.get(item.id).headline, item.headline, 'missing-task restore keeps its original snapshot');
    reject = 'commish_followups_v1';
    assert.equal(await ui.actions.onItemIgnore(item), false); ui = render();
    assert.match(ui.local.failure.key, /IGNORED$/);
    assert.equal(P.stateOf(item.id).state, 'ignored', 'server-confirmed choice stays applied when local history storage fails');
    reject = null; assert.equal(ui.actions.onRemoveFollowup(item.id), true); ui = render();
    assert.equal(ui.local.failure, null, 'removing history clears a failed IGNORED activity retry');
    assert.equal(F.get(item.id), null); assert.equal(P.stateOf(item.id).state, 'ignored', 'removing history does not revoke the account choice');
    const done = { ...item, id: 'local-done:L1' }; P.markDone(done);
    const beforeLocalRestore = requests;
    assert.equal(ui.actions.onItemRestore(done.id), true);
    assert.equal(requests, beforeLocalRestore, 'Done/Snooze restoration remains a local preference');
    holdRemote = true; actionRef.current = null; const beforeBackground = closed;
    const background = ui.actions.onItemIgnore({ ...item, id: 'background:L1' });
    ui.actions.onQueueItem({ ...item, id: 'new-drawer:L1' });
    assert.equal(actionRef.current, null, 'new task opening is guarded while Settings/global sync is pending');
    actionRef.current = { ...item, id: 'new-drawer:L1', note: 'New unsaved note' };
    releaseRemote(); assert.equal(await background, true);
    assert.equal(closed, beforeBackground, 'a Settings request can never close a different newer drawer');
    assert.equal(actionRef.current.id, 'new-drawer:L1');
    holdRemote = true; const beforeStale = closed;
    const pendingIgnore = ui.actions.onItemIgnore({ ...item, id: 'stale:L1' });
    assert.equal(intent.status, 'saving'); assert.equal(closed, beforeStale);
    assert.equal(await ui.actions.onItemIgnore(item), false, 'same-render duplicate activation is blocked');
    account = 'account:two'; releaseRemote();
    assert.equal(await pendingIgnore, false); assert.equal(closed, beforeStale, 'old account response cannot close another account drawer');
    assert.equal(P.stateOf('stale:L1'), null, 'old account choice does not leak into the next account');
    delete global.App.Commish.IgnoreSync;
    console.log('PASS actual account Ignore/Restore awaits confirmed authority, preserves history truth, rejects stale responses and retains missing-task snapshots');
})().catch(error => { console.error(error); process.exitCode = 1; });
