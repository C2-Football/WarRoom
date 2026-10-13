'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Schedule = require('../js/shared/commish-schedule.js');
const source = fs.readFileSync('js/tabs/commissioner-office.js', 'utf8');
const hooks = source.slice(source.indexOf('function useCommishLocalSave()'), source.indexOf('function CommissionerOffice('));
const callbacks = source.slice(source.indexOf('    const persistSchedule ='), source.indexOf('    const scheduleValidation ='));
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const defaults = () => ({ teams: ['1', '2', '3', '4'].map(id => ({ id, name: 'Team ' + id })), config: { weeks: 3, doubleRoundRobin: false },
    schedule: null, mode: 'simple', seasonYear: 2026, priorStandings: null, nflMeta: null, actualsStatus: 'idle', priorStandingsStatus: 'idle' });
const plan = () => ({ config: defaults().config, schedule: [{ week: 1, matchups: [['1', '2'], ['3', '4']], source: 'planned' }],
    mode: 'simple', seasonYear: 2026, priorStandings: null, priorStandingsFallback: [], nflMeta: null });

function harness(shared = {}) {
    const records = shared.records || new Map(), recovery = shared.recovery || new Map();
    const slots = [], effects = [], listeners = new Set();
    let cursor = 0, identity = 'A', valid = true, reject = false, tabReject = false, writes = 0, guard;
    const storage = {
        owner: () => valid ? identity : null,
        get: (key, fallback) => records.has(identity + ':' + key) ? clone(records.get(identity + ':' + key)) : fallback,
        set: (key, value) => {
            writes++;
            if (reject === 'throw') throw new Error('Controlled quota rejection');
            if (!reject || reject === 'unconfirmed') records.set(identity + ':' + key, clone(value));
            return !reject;
        },
    };
    const c = vm.createContext({ console, C: { Schedule: { ...Schedule } }, state: { week: 2, mine: [{ league_id: 'L1' }, { league_id: 'L2' }] }, scheduleActiveId: 'L1', onCopy() {},
        window: { App: { AccountStorage: storage, AccountSession: { isCurrent: () => valid }, WR_KEYS: { COMMISH_SCHEDULE: lid => 'schedule:' + lid },
            NavigationGuard: { register: fn => { guard = fn; return () => {}; } } },
        addEventListener: type => listeners.add(type), removeEventListener: type => listeners.delete(type),
        sessionStorage: { getItem: key => recovery.get(key) || null, setItem: (key, value) => { if (tabReject) throw Error('Tab storage unavailable'); recovery.set(key, value); }, removeItem: key => recovery.delete(key) }, wrLog() {} },
        React: {
            useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
            useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
            useEffect(fn, deps) { const i = cursor++; if (!effects[i] || JSON.stringify(effects[i].deps) !== JSON.stringify(deps)) { effects[i]?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; } },
        },
    });
    vm.runInContext(hooks + '\nfunction actualCallbacks() {' + callbacks + '\nreturn {onScheduleGenerate,onScheduleForcePairing,onScheduleSyncActuals,onScheduleWeeksConfigChange,onScheduleModeChange};}', c);
    const render = () => {
        cursor = 0;
        c.localSave = c.useCommishLocalSave();
        c.schedulePlans = c.useCommishSchedulePlans(c.localSave);
        c.schedulePlans.setScope(c.scheduleActiveId);
        c.schedules = c.schedulePlans.schedules;
        return { ...c.schedulePlans, localSave: c.localSave, actions: c.actualCallbacks() };
    };
    const load = () => { render().load('L1', defaults()); render().load('L2', defaults()); return render(); };
    return { c, records, recovery, render, load, listeners, get writes() { return writes; }, guard: () => guard(),
        rejection: value => { reject = value; }, rejectTab: value => { tabReject = value; },
        scope: lid => { c.scheduleActiveId = lid; c.schedulePlans.setScope(lid); },
        switchAccount: next => { identity = next; valid = false; } };
}

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
(async () => {
    await test('generated drafts survive rejected saves; only confirmed retry reports saved and clears navigation protection', () => {
        const h = harness(); let ui = h.load(); h.rejection(true);
        ui.actions.onScheduleGenerate(); ui = h.render();
        assert.equal(ui.schedules.L1.saveState, 'unsaved');
        assert.equal(ui.schedules.L1.schedule.length, 3);
        assert.equal(h.records.size, 0); assert.equal(h.guard(), false); assert(h.listeners.has('beforeunload'));
        assert.equal(ui.schedules.L1.recoverySaved, true); assert.equal(h.recovery.size, 1);
        const draft = clone(ui.schedules.L1.schedule);
        h.rejection(false); assert.equal(ui.save('L1'), true); ui = h.render();
        assert.equal(ui.schedules.L1.saveState, 'saved'); assert.equal(ui.localSave.failure, null);
        assert.deepEqual(h.records.get('A:schedule:L1').schedule, draft);
        assert.equal(h.guard(), true); assert.equal(h.recovery.size, 0); assert.equal(h.listeners.has('beforeunload'), false);
    });
    await test('failed pairing edits keep the new schedule and editor selection until a verified save', () => {
        const h = harness(); h.records.set('A:schedule:L1', plan()); let ui = h.load(); h.rejection('throw');
        assert.equal(ui.actions.onScheduleForcePairing(1, '1', '3'), false); ui = h.render();
        assert.equal(ui.schedules.L1.saveState, 'unsaved');
        assert.deepEqual(h.records.get('A:schedule:L1'), plan());
        assert(ui.schedules.L1.schedule[0].matchups.some(pair => pair.includes('1') && pair.includes('3')));
        const panel = fs.readFileSync('js/components/commish-schedule-panel.js', 'utf8');
        const apply = panel.slice(panel.indexOf('    const applyEdit ='), panel.indexOf('\n    return (', panel.indexOf('    const applyEdit =')));
        const cleared = []; const context = vm.createContext({ editWeek: 1, editA: '1', editB: '3', onForcePairing: () => false,
            setEditWeek: value => cleared.push(value), setEditA: value => cleared.push(value), setEditB: value => cleared.push(value) });
        vm.runInContext(apply + '\napplyEdit();', context); assert.deepEqual(cleared, []);
        context.onForcePairing = () => true; vm.runInContext('applyEdit();', context); assert.deepEqual(cleared, [null, '', '']);
    });
    await test('same-tab reload restores an unsaved draft without overwriting the saved plan; retry commits it once', () => {
        const first = harness(); first.records.set('A:schedule:L1', plan()); let ui = first.load(); first.rejection(true);
        ui.actions.onScheduleWeeksConfigChange({ weeks: 5, doubleRoundRobin: true }); ui = first.render(); const expected = clone(ui.schedules.L1.config);
        const reopened = harness(first); let recovered = reopened.load();
        assert.equal(recovered.schedules.L1.saveState, 'unsaved'); assert.deepEqual(clone(recovered.schedules.L1.config), expected);
        assert.equal(reopened.records.get('A:schedule:L1').config.weeks, 3); assert.equal(reopened.guard(), false);
        assert.equal(recovered.save('L1'), true); recovered = reopened.render();
        assert.equal(recovered.schedules.L1.saveState, 'saved'); assert.equal(reopened.records.get('A:schedule:L1').config.weeks, 5);
        assert.equal(reopened.writes, 1); assert.equal(reopened.recovery.size, 0);
    });
    await test('unavailable recovery storage retains the in-memory draft and truthfully requires keeping this page open', () => {
        const h = harness(); let ui = h.load(); h.rejection(true); h.rejectTab(true);
        ui.actions.onScheduleGenerate(); ui = h.render();
        assert.equal(ui.schedules.L1.saveState, 'unsaved'); assert.equal(ui.schedules.L1.recoverySaved, false);
        assert.equal(ui.schedules.L1.schedule.length, 3); assert.equal(h.guard(), false); assert.equal(h.records.size, 0);
    });
    await test('other-tab conflicts preserve both plans; discard reopens the latest saved plan and permits a new save', () => {
        const h = harness(); h.records.set('A:schedule:L1', plan()); let ui = h.load(); h.rejection(true);
        ui.actions.onScheduleWeeksConfigChange({ weeks: 5, doubleRoundRobin: false });
        const other = { ...plan(), seasonYear: 2027 }; h.records.set('A:schedule:L1', other); h.rejection(false); ui = h.render();
        assert.equal(ui.save('L1'), false); ui = h.render(); assert.match(ui.schedules.L1.saveError, /another tab/);
        assert.deepEqual(h.records.get('A:schedule:L1'), other); assert.equal(ui.schedules.L1.config.weeks, 5);
        ui.localSave.discard(); ui = h.render();
        assert.equal(ui.schedules.L1.seasonYear, 2027); assert.equal(ui.schedules.L1.config.weeks, 3); assert.equal(h.guard(), true); assert.equal(h.recovery.size, 0);
        ui.actions.onScheduleWeeksConfigChange({ weeks: 4, doubleRoundRobin: false }); assert.equal(h.render().schedules.L1.saveState, 'saved');
    });
    await test('a written but unconfirmed save stays unsaved; matching retry safely confirms it', () => {
        const h = harness(); let ui = h.load(); h.rejection('unconfirmed'); ui.actions.onScheduleGenerate(); ui = h.render();
        assert.equal(ui.schedules.L1.saveState, 'unsaved'); assert(h.records.has('A:schedule:L1'));
        h.rejection(false); assert.equal(ui.save('L1'), true); assert.equal(h.render().schedules.L1.saveState, 'saved');
    });
    await test('late sync cannot write after switching leagues away and back, or after a newer edit', async () => {
        for (const changeScope of [true, false]) {
            const h = harness(); h.records.set('A:schedule:L1', plan()); const ui = h.load();
            let finish; h.c.C.Schedule.fetchActualMatchups = () => new Promise(resolve => { finish = resolve; });
            const pending = ui.actions.onScheduleSyncActuals();
            if (changeScope) { h.scope('L2'); h.scope('L1'); }
            else h.render().actions.onScheduleWeeksConfigChange({ weeks: 6, doubleRoundRobin: false });
            const before = h.writes; finish([['1', '3'], ['2', '4']]); await pending;
            assert.equal(h.writes, before); assert.equal(h.render().schedules.L1.schedule[0].source, 'planned');
            assert.equal(h.records.get('A:schedule:L1').schedule[0].source, 'planned');
        }
    });
    await test('superseded async work clears its busy state even when the newer request fails', async () => {
        const h = harness(); h.records.set('A:schedule:L1', plan()); let ui = h.load();
        const flex = ui.begin('L1'); ui.update('L1', { flexStatus: 'loading' });
        h.c.C.Schedule.fetchActualMatchups = async () => { throw Error('Controlled provider outage'); };
        await h.render().actions.onScheduleSyncActuals(); ui = h.render();
        assert.equal(ui.isCurrent(flex), false); assert.equal(ui.schedules.L1.flexStatus, 'idle');
        assert.equal(ui.schedules.L1.actualsStatus, 'error'); assert.equal(h.writes, 0);
    });
    await test('strict actual-results reads distinguish provider failure from a successful empty week and preserve the saved plan', async () => {
        const original = globalThis.fetch;
        try {
            const h = harness(); h.records.set('A:schedule:L1', plan()); const ui = h.load();
            for (const response of [{ ok: false }, { ok: true, json: async () => ({ error: 'unavailable' }) }]) {
                globalThis.fetch = async () => response;
                await ui.actions.onScheduleSyncActuals();
                assert.equal(h.render().schedules.L1.actualsStatus, 'error'); assert.deepEqual(h.records.get('A:schedule:L1'), plan()); assert.equal(h.writes, 0);
            }
            globalThis.fetch = async () => { throw Error('Offline'); };
            await assert.rejects(Schedule.fetchActualMatchups('L1', 1, { requireComplete: true }), /Offline/);
            assert.deepEqual(await Schedule.fetchActualMatchups('L1', 1), [], 'existing best-effort callers keep their API');
            globalThis.fetch = async () => ({ ok: true, json: async () => [] });
            await h.render().actions.onScheduleSyncActuals();
            assert.equal(h.render().schedules.L1.actualsStatus, 'empty');
        } finally { globalThis.fetch = original; }
    });
    await test('invalidated A-to-B-to-A mount cannot write or recover into another account', async () => {
        const h = harness(); h.records.set('A:schedule:L1', plan()); const ui = h.load();
        let finish; h.c.C.Schedule.fetchActualMatchups = () => new Promise(resolve => { finish = resolve; });
        const pending = ui.actions.onScheduleSyncActuals(); h.switchAccount('B');
        assert.equal(ui.persist('L1', { seasonYear: 2030 }), false); assert.equal(ui.save('L1'), false);
        h.switchAccount('A'); finish([['1', '3'], ['2', '4']]); await pending;
        assert.equal(ui.persist('L1', { seasonYear: 2031 }), false); assert.equal(h.writes, 0);
        assert.deepEqual(h.records.get('A:schedule:L1'), plan()); assert.equal(h.recovery.size, 0);
    });
    await test('cross-league callbacks cannot save their old scope into the selected league', () => {
        const h = harness(); const ui = h.load(); h.scope('L2');
        assert.equal(ui.persist('L1', { seasonYear: 2030 }), false); assert.equal(ui.save('L1'), false);
        assert.equal(ui.persist('L2', { seasonYear: 2027 }), true); assert.equal(h.records.get('A:schedule:L2').seasonYear, 2027);
        assert.equal(h.records.has('A:schedule:L1'), false);
    });
    await test('a missing app session exposes a view-only sign-in path and never creates a planning namespace', () => {
        const h = harness(); h.switchAccount('B'); let ui = h.load();
        assert.equal(Object.keys(ui.schedules).length, 0); assert.equal(ui.persist('L1', { seasonYear: 2030 }), false); assert.equal(h.writes, 0);
        ui.localSave.run('checklist', 'genesis', () => { throw Error('Your season checklist was not saved. Free browser storage.'); }); ui = h.render();
        assert.match(ui.localSave.failure.message, /Sign in to Dynasty HQ/); assert.doesNotMatch(ui.localSave.failure.message, /Free browser storage/);
        const Babel = require('@babel/standalone');
        const notice = source.slice(source.indexOf('function CommishSessionNotice()'), source.indexOf('window.CommissionerOffice ='));
        const c = vm.createContext({ window: { App: { AccountStorage: { owner: () => null } }, location: { pathname: '/WarRoom/' } },
            React: { createElement: (type, props, ...children) => ({ type, props, children }) } });
        vm.runInContext(Babel.transform(notice, { presets: ['react'] }).code, c);
        const view = c.CommishSessionNotice(); const raw = JSON.stringify(view);
        assert.match(raw, /View-only Sleeper connection/); assert.match(raw, /Sign in to save plans/); assert.match(raw, /login.html/);
        c.window.App.AccountStorage.owner = () => 'account:A'; assert.equal(c.CommishSessionNotice(), null);
    });
    await test('activity integration preserves explicit failure status and forwards force on user retry', async () => {
        const h = harness(); assert.equal((await h.c.loadCommishActivity('L1')).status, 'unavailable');
        let requested; h.c.window.WrTxns = { fetchLeagueActivity: async (lid, options) => { requested = { lid, options }; return { status: 'fresh', txns: [], failedWaivers: [], fetchedAt: 1, failedWeeks: [], error: null }; } };
        assert.equal((await h.c.loadCommishActivity('L1', { force: true })).status, 'fresh'); assert.equal(requested.options.force, true);
        h.c.window.WrTxns.fetchLeagueActivity = async () => { throw Error('Offline'); };
        assert.equal((await h.c.loadCommishActivity('L1')).status, 'unavailable');
        const retry = source.slice(source.indexOf('    const onRetryActivity ='), source.indexOf('    // ── Rule Lab dataset'));
        let current = true, allowed = true, restarts = 0;
        const c = vm.createContext({ window: { App: { AccountStorage: { owner: () => null }, AccountSession: { isCurrent: () => current } } },
            localSave: { canLeave: () => allowed }, activityReload: { current: false }, runRef: { current: { key: 'old' } }, setState: () => { restarts++; } });
        vm.runInContext(retry + '\nonRetryActivity();', c); assert.equal(restarts, 1); assert.equal(c.activityReload.current, true); assert.equal(c.runRef.current.key, null);
        current = false; vm.runInContext('onRetryActivity();', c); assert.equal(restarts, 1);
        current = true; allowed = false; vm.runInContext('onRetryActivity();', c); assert.equal(restarts, 1);
    });
    await test('schedule sections keep React identity across parent and settings rerenders', () => {
        const Babel = require('@babel/standalone');
        const panel = fs.readFileSync('js/components/commish-schedule-panel.js', 'utf8');
        // Retain component types instead of expanding them: React remounts a
        // subtree when that function changes, detaching the focused control.
        const c = vm.createContext({ window: { App: {} }, React: {
            Fragment: Symbol('Fragment'),
            createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
            useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
            useMemo: compute => compute(), useEffect() {},
        } });
        vm.runInContext(Babel.transform(panel, { presets: ['react'] }).code, c);
        const copies = [], changes = [];
        const props = { leagues: [{ id: 'L1', name: 'Test League' }], selectedLeagueId: 'L1', teams: defaults().teams,
            weeksConfig: { weeks: 3, doubleRoundRobin: false }, schedule: plan().schedule, currentWeek: 1,
            onCopyText: () => copies.push('text'), onCopyCSV: () => copies.push('csv'),
            onWeeksConfigChange: next => changes.push(next) };
        const walk = (node, predicate, found = []) => {
            if (Array.isArray(node)) node.forEach(child => walk(child, predicate, found));
            else if (node && typeof node === 'object') {
                if (predicate(node)) found.push(node);
                walk(node.children, predicate, found);
            }
            return found;
        };
        const sectionsOf = tree => walk(tree, node => typeof node.type === 'function');
        const initial = sectionsOf(c.WrCommishSchedulePanel(props));
        assert.equal(initial.length, 3, 'Schedule Builder, Build, and Weeks sections');
        for (const next of [props, { ...props, weeksConfig: { ...props.weeksConfig, weeks: 4 }, saveState: 'saved' }]) {
            const sections = sectionsOf(c.WrCommishSchedulePanel(next));
            assert.equal(sections.length, initial.length);
            sections.forEach((section, index) => assert.equal(section.type, initial[index].type,
                'same section type lets React retain its button/input DOM nodes'));
        }
        const empty = c.WrCommishSchedulePanel({ leagues: [] });
        assert.equal(empty.type, initial[0].type, 'empty state uses the same stable section');
        const build = initial.find(section => section.props.title === 'Build');
        const copyButtons = walk(build, node => node.type === 'button' && /^Copy as /.test(node.children.join('')));
        assert.equal(copyButtons.length, 2); copyButtons.forEach(button => button.props.onClick());
        assert.deepEqual(copies, ['text', 'csv']);
        const weeks = walk(build, node => node.type === 'input' && node.props.type === 'number')[0];
        weeks.props.onChange({ target: { value: '4' } });
        assert.equal(changes[0].weeks, 4, 'Weeks input still forwards the edited configuration');
        const shell = initial[0].type({ title: 'Schedule Builder', meta: 'Test meta', children: 'Contents' });
        assert.equal(shell.props.style.background, 'var(--co-surface, #121217)');
        assert.equal(shell.props.style.padding, '14px 16px');
        assert.equal(shell.children[0].children[1].props.style.font,
            '600 var(--text-micro, var(--co-readable-small, 0.6875rem)) var(--font-mono, "JetBrains Mono", monospace)');
        assert.equal(shell.children[1], 'Contents');
    });
    console.log(passed + ' actual schedule and Office recovery groups passed');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
