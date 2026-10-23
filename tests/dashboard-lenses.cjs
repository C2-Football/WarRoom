'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Babel = require('@babel/standalone');
const source = name => fs.readFileSync(path.join(__dirname, '../js/shared/', name + '.js'), 'utf8');
const clean = value => JSON.parse(JSON.stringify(value));
const scope = 'account-a:league-a';
const modules = {
    'weekly-matchups': { label: 'Matchups', sizes: ['sm', 'md', 'lg'], metrics: [] },
    'roster-pulse': { label: 'Roster', sizes: ['sm', 'md'], metrics: [] },
};
const layout = [{ id: 'old_matchup', key: 'weekly-matchups', size: 'md' }];
const changed = [{ ...layout[0], size: 'lg' }];
const view = (id = 'alex_age') => ({ id, key: 'custom-view', size: 'md', title: 'Reported age', view: {
    source: 'roster', columns: ['name', 'age'], display: 'table', appearance: { accent: 'blue', density: 'comfortable' },
} });
function setup() {
    const data = new Map();
    const root = { localStorage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) } };
    const context = { window: root, console };
    for (const name of ['dashboard-view-data', 'dashboard-builder', 'dashboard-lenses']) vm.runInNewContext(source(name), context);
    return { root, data, api: root.WR.DashboardLensesStore, builder: root.WR.DashboardBuilder, catalog: root.WR.DashboardBuilder.catalog(modules) };
}
let checks = 0;
function check(name, fn) { fn(); console.log('PASS ' + name); checks++; }

check('legacy fallback imports supported content without letting retired keys, sizes or metrics block lenses', () => {
    const { root, api, builder, catalog, data } = setup();
    const writes = [];
    const setItem = root.localStorage.setItem;
    root.localStorage.setItem = (...args) => { writes.push(args); return setItem(...args); };
    root.App = {};
    const React = { createElement: (type, props) => ({ type, props }) };
    const context = vm.createContext({ window: root, React, console, localStorage: root.localStorage });
    const dashboard = fs.readFileSync(path.join(__dirname, '../js/tabs/dashboard.js'), 'utf8');
    vm.runInContext(Babel.transform(dashboard, { presets: ['react'] }).code, context);
    const canonicalView = clean(builder.validateLayout([view('preserved_custom')], catalog))[0];
    const old = [
        { id: 'old_roster', key: 'roster', size: 'xl', primaryMetric: 'retired-metric' },
        { id: 'old_current', key: 'roster-pulse', size: 'md', primaryMetric: 'retired-metric' },
        { id: 'old_unknown', key: 'removed-module', size: 'sm' },
        { id: 'old_matchup', key: 'weekly-matchups', size: 'not-a-size', primaryMetric: 'retired-metric' },
        canonicalView,
        { ...view('invalid_custom'), view: { ...view().view, source: 'unknown-dataset' } },
        { id: 'old_roster', key: 'weekly-matchups', size: 'sm' },
        null,
        { key: 'weekly-matchups', size: 'sm' },
        { id: '<invalid>', key: 'weekly-matchups', size: 'sm' },
        { id: 'legacy_lens_8', key: 'weekly-matchups', size: 'sm' },
    ];
    data.set('legacy-shared-layout', JSON.stringify(old));
    const before = data.get('legacy-shared-layout');
    const fullCatalog = vm.runInContext('window.WR.DashboardBuilder.catalog(WIDGET_MODULES)', context);
    const imported = clean(context.legacyDashboardLensLayout(old, fullCatalog));
    assert.deepEqual(imported.map(item => item.key), ['roster-pulse', 'roster-pulse', 'weekly-matchups', 'custom-view', 'weekly-matchups', 'weekly-matchups', 'weekly-matchups', 'weekly-matchups']);
    assert.equal(imported[0].id, 'old_roster');
    assert.equal(imported[0].size, 'md');
    assert.equal(imported[0].primaryMetric, 'health-score');
    assert.equal(imported[1].primaryMetric, 'health-score');
    assert.equal(imported[2].size, 'md');
    assert.equal(imported[2].primaryMetric, undefined);
    assert.deepEqual(imported[3], canonicalView, 'valid custom view keeps its data and reminder ID');
    assert.equal(new Set(imported.map(item => item.id)).size, imported.length);
    assert(imported.every(item => /^[a-zA-Z0-9_.:-]{1,100}$/.test(item.id)), 'missing and invalid legacy IDs are repaired');
    assert.equal(imported.at(-1).id, 'legacy_lens_8', 'generated migration IDs never steal a later valid ID');
    assert.deepEqual(clean(api.read(scope, imported, fullCatalog).lenses[0].layout), imported);
    assert.deepEqual(clean(context.legacyDashboardLensLayout(imported, fullCatalog)), imported, 'migration is idempotent');
    assert.deepEqual(clean(context.legacyDashboardLensLayout([], fullCatalog)), []);
    assert.equal(data.get('legacy-shared-layout'), before);
    assert.deepEqual(writes, [], 'legacy import performs no storage writes');
    assert.throws(() => builder.validateLayout([old[0]], fullCatalog), /not available/, 'strict builder validation is unchanged');
    const invalidSaved = { version: 1, revision: 1, activeId: 'lens_home', lenses: [{ id: 'lens_home', name: 'Home', layout: [old[0]], history: [] }], removed: null };
    data.set(api.storageKey(scope), JSON.stringify(invalidSaved));
    assert.throws(() => api.read(scope, imported, fullCatalog), /not available/, 'new lens documents are never repaired silently');
});

check('old Alex layout and undo history migrate without changing their identities or legacy storage', () => {
    const { api, builder, catalog, data } = setup();
    builder.save(scope, changed, catalog, layout);
    const before = [...data];
    const initial = api.read(scope, [], catalog);
    assert.deepEqual(clean(initial), { version: 1, revision: 0, activeId: 'lens_home', lenses: [{ id: 'lens_home', name: 'Home', layout: changed, history: [layout] }], removed: null });
    assert.deepEqual([...data], before, 'reading migration does not write either store');
    const next = api.change(scope, initial, { type: 'rename', id: 'lens_home', name: 'My league' }, catalog);
    assert.equal(next.lenses[0].name, 'My league');
    assert.deepEqual(clean(builder.readSaved(scope).layout), changed);
    assert.equal(data.get('wr_alex_dashboard_v1:' + scope), before[0][1]);
    assert.deepEqual(clean(api.change(scope, next, { type: 'undo', id: 'lens_home' }, catalog).lenses[0].layout), layout);
});

check('custom views survive migration and explicitly empty dashboards remain empty', () => {
    for (const old of [[], [view()]]) {
        const { api, builder, catalog } = setup();
        builder.save(scope, old, catalog, []);
        const initial = api.read(scope, layout, catalog);
        assert.deepEqual(clean(initial.lenses[0].layout), clean(builder.validateLayout(old, catalog)));
        assert.equal(initial.lenses[0].layout[0]?.id, old[0]?.id);
    }
});

check('fresh accounts get their existing fallback in Home, with separate account and league stores', () => {
    const { api, catalog } = setup();
    const initial = api.read(scope, layout, catalog);
    const next = api.change(scope, initial, { type: 'create', name: 'Trade board' }, catalog);
    assert.equal(next.lenses.length, 2);
    assert.deepEqual(clean(next.lenses[0].layout), layout);
    assert.equal(api.read('account-b:league-a', [], catalog).lenses.length, 1);
    assert.equal(api.read('account-a:league-b', [], catalog).lenses.length, 1);
    assert.deepEqual(clean(api.read(scope, [], catalog)), clean(next));
    assert.throws(() => api.change('account-b:league-a', next, { type: 'rename', id: next.activeId, name: 'Wrong account' }, catalog), /account or league changed/);
});

check('create, rename, select and reload keep independent layouts and selected lens', () => {
    const { api, catalog } = setup();
    let doc = api.read(scope, layout, catalog);
    doc = api.change(scope, doc, { type: 'create', name: '  Youth movement  ', layout: [view()] }, catalog);
    const second = doc.activeId;
    assert.notEqual(second, 'lens_home');
    assert.equal(doc.lenses[1].name, 'Youth movement');
    assert.equal(doc.lenses[1].layout[0].id.startsWith(second + '__'), true);
    doc = api.change(scope, doc, { type: 'rename', id: second, name: 'Next season' }, catalog);
    doc = api.change(scope, doc, { type: 'select', id: 'lens_home' }, catalog);
    assert.equal(api.read(scope, [], catalog).activeId, 'lens_home');
    doc = api.change(scope, doc, { type: 'select', id: second }, catalog);
    assert.equal(api.read(scope, [], catalog).activeId, second);
    assert.deepEqual(clean(doc.lenses[0].layout), layout);
    assert.equal(doc.lenses[1].name, 'Next season');
});

check('saved-lens undo affects only that lens and persists across reload', () => {
    const { api, catalog } = setup();
    let doc = api.change(scope, api.read(scope, layout, catalog), { type: 'create', name: 'Roster' }, catalog);
    const id = doc.activeId;
    doc = api.change(scope, doc, { type: 'save', id, layout: [view()] }, catalog);
    const first = clean(doc.lenses[1].layout);
    doc = api.change(scope, doc, { type: 'save', id, layout: [{ ...first[0], title: 'Age detail' }] }, catalog);
    doc = api.change(scope, api.read(scope, [], catalog), { type: 'undo', id }, catalog);
    assert.deepEqual(clean(doc.lenses[1].layout), first);
    assert.deepEqual(clean(doc.lenses[0].layout), layout);
    doc = api.change(scope, doc, { type: 'undo', id }, catalog);
    assert.deepEqual(clean(doc.lenses[1].layout), []);
    const revision = doc.revision;
    doc = api.change(scope, doc, { type: 'undo', id }, catalog);
    assert.equal(doc.revision, revision, 'empty undo is a no-op');
});

check('duplicate creates deep-independent content with fresh IDs and no inherited reminders/history', () => {
    const { api, catalog, builder } = setup();
    builder.save(scope, [view()], catalog, []);
    let doc = api.read(scope, [], catalog);
    doc = api.change(scope, doc, { type: 'duplicate', id: 'lens_home' }, catalog);
    const duplicated = doc.lenses[1];
    assert.equal(duplicated.name, 'Home copy');
    assert.equal(duplicated.history.length, 0);
    assert.notEqual(duplicated.layout[0].id, doc.lenses[0].layout[0].id);
    assert.deepEqual(clean(duplicated.layout[0].view), clean(doc.lenses[0].layout[0].view));
    doc = api.change(scope, doc, { type: 'save', id: duplicated.id, layout: [{ ...duplicated.layout[0], title: 'Only the copy' }] }, catalog);
    assert.equal(doc.lenses[0].layout[0].title, 'Reported age');
    doc = api.change(scope, doc, { type: 'duplicate', id: 'lens_home' }, catalog);
    assert.equal(doc.lenses.at(-1).name, 'Home copy 2');
    assert.equal(new Set(doc.lenses.flatMap(lens => lens.layout.map(item => item.id))).size, 3);
});

check('remove selects a surviving lens, restores exact IDs, and never removes the last lens', () => {
    const { api, catalog } = setup();
    let doc = api.change(scope, api.read(scope, layout, catalog), { type: 'create', name: 'Second', layout: [view()] }, catalog);
    const removed = clean(doc.lenses[1]);
    doc = api.change(scope, doc, { type: 'remove', id: removed.id }, catalog);
    assert.equal(doc.activeId, 'lens_home');
    assert.deepEqual(clean(doc.removed), removed);
    assert.throws(() => api.change(scope, doc, { type: 'remove', id: 'lens_home' }, catalog), /at least one lens/);
    doc = api.change(scope, api.read(scope, [], catalog), { type: 'restore' }, catalog);
    assert.equal(doc.activeId, removed.id);
    assert.deepEqual(clean(doc.lenses[1]), removed);
    assert.equal(doc.removed, null);
    assert.throws(() => api.change(scope, doc, { type: 'restore' }, catalog), /no removed lens/);
});

check('new section IDs cannot collide with another lens, its history or the deleted-lens undo slot', () => {
    const { api, catalog } = setup();
    let doc = api.change(scope, api.read(scope, [view()], catalog), { type: 'create', name: 'Second' }, catalog);
    const secondId = doc.activeId;
    doc = api.change(scope, doc, { type: 'save', id: secondId, layout: [view()] }, catalog);
    const secondSection = doc.lenses[1].layout[0].id;
    assert.notEqual(secondSection, 'alex_age');
    doc = api.change(scope, doc, { type: 'save', id: 'lens_home', layout: [] }, catalog);
    doc = api.change(scope, doc, { type: 'save', id: secondId, layout: [view()] }, catalog);
    assert.notEqual(doc.lenses[1].layout[0].id, 'alex_age');
    doc = api.change(scope, doc, { type: 'remove', id: secondId }, catalog);
    doc = api.change(scope, doc, { type: 'create', name: 'Third', layout: [view(secondSection)] }, catalog);
    assert.notEqual(doc.lenses.at(-1).layout[0].id, secondSection);
    doc = api.change(scope, doc, { type: 'restore' }, catalog);
    assert.equal(new Set(doc.lenses.flatMap(lens => lens.layout.map(item => item.id))).size, 2);
});

check('new long section IDs stay valid, distinct, and stable after save', () => {
    const { api, catalog } = setup();
    let doc = api.change(scope, api.read(scope, [], catalog), { type: 'create', name: 'Long IDs' }, catalog);
    const id = doc.activeId;
    const stem = 'alex_' + 'x'.repeat(90);
    doc = api.change(scope, doc, { type: 'save', id, layout: [view(stem + '1'), view(stem + '2')] }, catalog);
    const saved = clean(doc.lenses[1].layout);
    assert(saved.every(item => item.id.length <= 100));
    assert.notEqual(saved[0].id, saved[1].id);
    const revision = doc.revision;
    doc = api.change(scope, doc, { type: 'save', id, layout: saved }, catalog);
    assert.deepEqual(clean(doc.lenses[1].layout), saved);
    assert.equal(doc.revision, revision);
});

check('preview preparation is pure and keeps reminder view IDs stable through repeated preparation and saving', () => {
    const { api, catalog, data } = setup();
    let doc = api.change(scope, api.read(scope, [view()], catalog), { type: 'create', name: 'Second' }, catalog);
    const id = doc.activeId;
    const before = data.get(api.storageKey(scope));
    const prepared = api.prepareLayout(doc, id, [view()], catalog);
    assert.notEqual(prepared[0].id, 'alex_age', 'the new preview cannot claim the original lens reminder identity');
    const draft = { viewId: prepared[0].id };
    assert.deepEqual(clean(api.prepareLayout(doc, id, prepared, catalog)), clean(prepared));
    assert.equal(data.get(api.storageKey(scope)), before, 'preparing an unsaved preview never writes');
    doc = api.change(scope, doc, { type: 'save', id, layout: prepared }, catalog);
    assert.equal(doc.lenses[1].layout[0].id, draft.viewId);
    assert.deepEqual(clean(api.prepareLayout(doc, id, prepared, catalog)), clean(prepared));
    assert.equal(doc.lenses[0].layout[0].id, 'alex_age', 'original migrated view keeps its reminder identity');
    doc = api.change(scope, doc, { type: 'duplicate', id }, catalog);
    assert.notEqual(doc.lenses.at(-1).layout[0].id, draft.viewId, 'duplication never reuses prepared IDs');
});

check('preview preparation cannot adopt another lens identifier or historical reminder identity', () => {
    const { api, catalog } = setup();
    let doc = api.change(scope, api.read(scope, [view()], catalog), { type: 'create', name: 'Second' }, catalog);
    const secondId = doc.activeId;
    doc = api.change(scope, doc, { type: 'save', id: secondId, layout: api.prepareLayout(doc, secondId, [view()], catalog) }, catalog);
    const secondLayout = clean(doc.lenses[1].layout);
    doc = api.change(scope, doc, { type: 'save', id: secondId, layout: [] }, catalog);
    const homePreview = api.prepareLayout(doc, 'lens_home', secondLayout, catalog);
    assert.notEqual(homePreview[0].id, secondLayout[0].id);
    assert(homePreview[0].id.startsWith('lens_home__'));
    assert.deepEqual(clean(api.prepareLayout(doc, 'lens_home', homePreview, catalog)), clean(homePreview));
    assert.throws(() => api.prepareLayout(doc, 'missing', [], catalog), /no longer available/);
});

check('stale tabs cannot overwrite a changed layout or selected lens, including migration races', () => {
    const { api, catalog, builder } = setup();
    const initial = api.read(scope, layout, catalog);
    let doc = api.change(scope, initial, { type: 'create', name: 'Second' }, catalog);
    assert.throws(() => api.change(scope, initial, { type: 'create', name: 'Stale' }, catalog), /changed in another tab/);
    const beforeSwitch = clean(doc);
    doc = api.change(scope, doc, { type: 'select', id: 'lens_home' }, catalog);
    assert.throws(() => api.change(scope, beforeSwitch, { type: 'rename', id: 'lens_home', name: 'Stale' }, catalog), /changed in another tab/);
    assert.deepEqual(clean(api.read(scope, [], catalog)), clean(doc));
    const other = 'account-a:migration-race';
    const migrating = api.read(other, layout, catalog);
    builder.save(other, changed, catalog, layout);
    assert.throws(() => api.change(other, migrating, { type: 'create', name: 'Stale' }, catalog), /changed in another tab/);
});

check('malformed saved data never falls back to or overwrites an older dashboard', () => {
    const { api, catalog, data } = setup();
    const initial = api.read(scope, layout, catalog);
    const key = api.storageKey(scope);
    for (const bad of ['{unfinished', 'null', JSON.stringify({ ...clean(initial), version: 9 }), JSON.stringify({ ...clean(initial), activeId: 'missing' }), JSON.stringify({ ...clean(initial), extra: 'execute' }), JSON.stringify({ ...clean(initial), revision: -1 }), JSON.stringify({ ...clean(initial), lenses: [] }), JSON.stringify({ ...clean(initial), lenses: [initial.lenses[0], initial.lenses[0]] })]) {
        data.set(key, bad);
        assert.throws(() => api.read(scope, layout, catalog));
        assert.throws(() => api.change(scope, initial, { type: 'rename', id: 'lens_home', name: 'Oops' }, catalog));
        assert.equal(data.get(key), bad);
    }
});

check('malformed layout and duplicate section ownership fail without a write', () => {
    const { api, catalog, data } = setup();
    let doc = api.change(scope, api.read(scope, layout, catalog), { type: 'create', name: 'Second' }, catalog);
    const before = data.get(api.storageKey(scope));
    for (const invalid of [[{ ...layout[0], key: 'unknown' }], [{ ...layout[0], html: '<script>' }], [layout[0], layout[0]]]) {
        assert.throws(() => api.change(scope, doc, { type: 'save', id: doc.activeId, layout: invalid }, catalog));
        assert.equal(data.get(api.storageKey(scope)), before);
    }
    doc = clean(doc);
    doc.lenses[1].layout = layout;
    data.set(api.storageKey(scope), JSON.stringify(doc));
    assert.throws(() => api.read(scope, [], catalog), /duplicate section/);
});

check('storage failures do not report success or change the previous document', () => {
    const { api, catalog, root, data } = setup();
    const doc = api.change(scope, api.read(scope, layout, catalog), { type: 'create', name: 'Second' }, catalog);
    const before = data.get(api.storageKey(scope));
    root.localStorage.setItem = () => { throw new Error('quota'); };
    assert.throws(() => api.change(scope, doc, { type: 'rename', id: doc.activeId, name: 'Unsaved' }, catalog), /could not be saved/);
    assert.equal(data.get(api.storageKey(scope)), before);
    root.localStorage.setItem = () => {};
    assert.throws(() => api.change(scope, doc, { type: 'remove', id: doc.activeId }, catalog), /could not be saved/);
    assert.equal(data.get(api.storageKey(scope)), before);
    root.localStorage.getItem = () => { throw new Error('blocked'); };
    assert.throws(() => api.read(scope, [], catalog), /could not be read/);
    assert.throws(() => api.change(scope, doc, { type: 'rename', id: doc.activeId, name: 'Unsaved' }, catalog), /could not be read/);
});

check('names, missing IDs, scope and maximum lens count are bounded', () => {
    const { api, catalog } = setup();
    let doc = api.read(scope, [], catalog);
    for (const name of ['', '   ', 'x'.repeat(61), 'Bad\u0000name']) {
        assert.throws(() => api.change(scope, doc, { type: 'rename', id: 'lens_home', name }, catalog), /name/);
        assert.throws(() => api.change(scope, doc, { type: 'create', name }, catalog), /name/);
    }
    assert.throws(() => api.change(scope, doc, { type: 'create', name: 'Invalid layout', layout: null }, catalog));
    for (const id of ['', 'missing', null]) assert.throws(() => api.change(scope, doc, { type: 'select', id }, catalog), /no longer available/);
    for (const invalidScope of ['', null, 'x'.repeat(1301), 'account\u007f:league']) assert.throws(() => api.read(invalidScope, [], catalog), /account and league/);
    for (let i = 1; i < api.MAX_LENSES; i++) doc = api.change(scope, doc, { type: 'create', name: 'Lens ' + i }, catalog);
    assert.equal(doc.lenses.length, 12);
    assert.throws(() => api.change(scope, doc, { type: 'create', name: 'Too many' }, catalog), /up to 12/);
    assert.throws(() => api.change(scope, doc, { type: 'duplicate', id: doc.activeId }, catalog), /up to 12/);
    doc = api.change(scope, doc, { type: 'remove', id: doc.activeId }, catalog);
    doc = api.change(scope, doc, { type: 'create', name: 'Replacement' }, catalog);
    assert.throws(() => api.change(scope, doc, { type: 'restore' }, catalog), /up to 12/);
});

check('no-op saves keep undo unchanged and each lens history is capped at ten', () => {
    const { api, catalog } = setup();
    let doc = api.read(scope, layout, catalog);
    for (let i = 0; i < 16; i++) doc = api.change(scope, doc, { type: 'save', id: 'lens_home', layout: i % 2 ? layout : changed }, catalog);
    assert.equal(doc.lenses[0].history.length, 10);
    const revision = doc.revision;
    doc = api.change(scope, doc, { type: 'save', id: 'lens_home', layout: doc.lenses[0].layout }, catalog);
    assert.equal(doc.revision, revision);
    assert.equal(doc.lenses[0].history.length, 10);
});

check('size budgeting discards old history before current content and refuses oversized current content', () => {
    const { api, catalog, data } = setup();
    const largeView = view();
    largeView.view.filters = Array.from({ length: 5 }, () => ({ field: 'name', op: 'in', value: Array.from({ length: 30 }, (_, i) => String(i) + 'x'.repeat(295)) }));
    let doc = api.read(scope, [], catalog);
    for (let i = 0; i < 10; i++) doc = api.change(scope, doc, { type: 'save', id: 'lens_home', layout: Array.from({ length: 2 }, (_, j) => ({ ...clean(largeView), id: 'alex_large_' + j, title: 'Round ' + i })) }, catalog);
    const stored = data.get(api.storageKey(scope));
    assert(stored.length <= 750000);
    assert(doc.lenses[0].history.length < 10, 'old history is pruned to fit');
    assert.equal(doc.lenses[0].layout.length, 2);
    assert.equal(doc.lenses[0].layout[0].title, 'Round 9');
    assert.throws(() => api.change(scope, doc, { type: 'save', id: 'lens_home', layout: Array.from({ length: 24 }, (_, j) => ({ ...clean(largeView), id: 'alex_huge_' + j })) }, catalog), /too large to save/);
    assert.equal(data.get(api.storageKey(scope)), stored, 'oversized current content never replaces the saved document');
});

console.log('\n' + checks + ' dashboard lens checks passed.');
