'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the shipped component, including its state/effects, without inventing a
// second filtering implementation. Browser layout and game privacy adapters
// have separate coverage; these checks exercise the shared board's contract.
let active;
const React = {
    createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false) }; },
    useState(initial) {
        const slot = active.cursor++, owner = active;
        if (!(slot in owner.hooks)) owner.hooks[slot] = typeof initial === 'function' ? initial() : initial;
        return [owner.hooks[slot], value => {
            const next = typeof value === 'function' ? value(owner.hooks[slot]) : value;
            if (!Object.is(next, owner.hooks[slot])) { owner.hooks[slot] = next; owner.dirty = true; }
        }];
    },
    useEffect(callback, deps) {
        const slot = active.cursor++, owner = active, previous = owner.hooks[slot];
        if (!previous || deps.length !== previous.deps.length || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
            owner.effects.push(() => { previous?.cleanup?.(); owner.hooks[slot] = { deps, cleanup: callback() }; });
        }
    }
};
const root = { App: {} };
for (const key of ['S', 'OD', 'WR', 'fetch', 'localStorage']) Object.defineProperty(root, key, { get() { throw new Error(`Shared board read forbidden global ${key}`); } });
const source = fs.readFileSync(path.join(__dirname, '../js/components/game-draft-table.js'), 'utf8');
vm.runInNewContext(source, { window: root, React }, { filename: 'game-draft-table.js' });
const { GameDraftTable, GameDraftTableModel: { viewRows } } = root.App;
function mount(initial) {
    const owner = { hooks: [], props: initial, cursor: 0, effects: [], dirty: false };
    return function render(patch = {}) {
        owner.props = { ...owner.props, ...patch };
        let tree;
        for (let passes = 0; passes < 12; passes++) {
            active = owner; owner.cursor = 0; owner.effects = []; owner.dirty = false;
            tree = GameDraftTable(owner.props);
            for (const effect of owner.effects) effect();
            if (!owner.dirty) return tree;
        }
        throw new Error('Component did not settle after its effects');
    };
}
function nodes(tree, predicate) {
    if (!tree || typeof tree !== 'object') return [];
    return [...(predicate(tree) ? [tree] : []), ...(tree.children || []).flatMap(child => nodes(child, predicate))];
}
function words(tree) { return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : (tree?.children || []).map(words).join(' '); }
const one = (tree, predicate) => { const found = nodes(tree, predicate); assert.equal(found.length, 1, 'Expected one matching element'); return found[0]; };
const control = (tree, label) => one(tree, node => node.props['aria-label'] === label);
const button = (tree, label) => one(tree, node => node.type === 'button' && words(node) === label);
const bodyRows = tree => one(tree, node => node.type === 'tbody').children;
const rowIds = tree => bodyRows(tree).map(row => String(row.props.key));
const ids = rows => Array.from(rows, row => String(row.id));
const click = node => {
    let stopped = 0;
    node.props.onClick({ stopPropagation() { stopped++; } });
    return stopped;
};
const change = (tree, label, value) => control(tree, label).props.onChange({ target: { value } });
const points = { key: 'points', label: 'Est. PPG', title: 'Archive estimate', getValue: row => row.points, defaultDirection: 'desc' };
const positions = ['QB', 'RB', 'WR', 'TE', { value: 'FLEX', label: 'Flex', positions: ['RB', 'WR', 'TE'] }];
const rows = [
    { id: 'qb', name: 'Quarterback 2', position: 'QB', detail: '2010s', points: 18, canDraft: true },
    { id: 'rb', name: 'José Runner', position: 'RB', detail: '2000s', searchText: 'Archive College', points: 12, canDraft: true },
    { id: 'wr', name: 'Wide Receiver', position: 'WR', detail: '2010s', points: 0, canDraft: false, draftDisabledReason: 'Your roster needs a quarterback' },
    { id: 'te', name: 'Tight End', position: 'TE', detail: '2020s', points: null, canDraft: false },
    { id: 'taken', name: 'Drafted Runner', position: 'RB', detail: '2000s', points: 25, canDraft: true, drafted: true, draftedBy: 'Rival' }
];
const checks = [];
function test(name, run) { run(); checks.push(name); console.log('PASS ' + name); }

test('sorting preserves numeric zero and sends all unavailable observations last in either direction', () => {
    const observations = [
        { id: 'missing', points: null }, { id: 'zero', points: 0 }, { id: 'positive', points: 8 },
        { id: 'negative', points: -2 }, { id: 'blank', points: '' }, { id: 'nan', points: NaN },
        { id: 'infinite', points: Infinity }, { id: 'undefined' }
    ].map((row, index) => Object.freeze({ name: row.id, position: 'RB', rank: index + 1, ...row }));
    Object.freeze(observations);
    assert.deepEqual(ids(viewRows(observations, { columns: [points], sortKey: 'points', direction: 'desc' })), ['positive', 'zero', 'negative', 'missing', 'blank', 'nan', 'infinite', 'undefined']);
    assert.deepEqual(ids(viewRows(observations, { columns: [points], sortKey: 'points', direction: 'asc' })), ['negative', 'zero', 'positive', 'missing', 'blank', 'nan', 'infinite', 'undefined']);
    assert.equal(observations[0].rank, 1);
});

test('search, flex, queue, and availability filters combine without renumbering the board', () => {
    const selected = viewRows(rows, { query: ' JOSE ', position: 'FLEX', positions, queueOnly: true, queuedIds: ['rb', 'wr'] });
    assert.deepEqual(ids(selected), ['rb']);
    assert.equal(selected[0].rank, 2, 'Filtered player retains original board rank');
    assert.deepEqual(ids(viewRows(rows, { query: 'archive college' })), ['rb']);
    assert.deepEqual(ids(viewRows(rows, { query: '2010s' })), ['qb', 'wr']);
    assert.deepEqual(ids(viewRows(rows, { position: 'FLEX', positions })), ['rb', 'wr', 'te']);
    assert(!ids(viewRows(rows)).includes('taken'));
    assert(ids(viewRows(rows, { showDrafted: true })).includes('taken'));
    assert.deepEqual(ids(viewRows([{ id: 7, name: 'Numeric ID', position: 'QB' }], { queueOnly: true, queuedIds: ['7'] })), ['7']);
    assert(!Object.hasOwn(rows[1], 'rank'), 'The adapter rows were not mutated');
});

test('equal metrics keep supplied board rank while text sorting handles accents and number suffixes', () => {
    const tied = [{ id: 'late', name: 'Player 10', rank: 8, points: 5 }, { id: 'early', name: 'Player 2', rank: 2, points: 5 }];
    assert.deepEqual(ids(viewRows(tied, { columns: [points], sortKey: 'points', direction: 'desc' })), ['early', 'late']);
    assert.deepEqual(ids(viewRows(tied, { sortKey: 'name' })), ['early', 'late']);
    assert.deepEqual(ids(viewRows(tied, { sortKey: 'name', direction: 'desc' })), ['late', 'early']);
});

test('a board opens cards separately from queue and draft actions, retaining game-owned row data', () => {
    const selected = [], queued = [], drafted = [];
    const draw = mount({ rows, columns: [points], positionOptions: positions, onSelect: row => selected.push(row), onToggleQueue: row => queued.push(row.id), onDraft: row => drafted.push(row.id) });
    const tree = draw();
    assert.equal(click(control(tree, 'Open player card for José Runner')), 1);
    assert.equal(selected[0].id, 'rb');
    assert.equal(selected[0].points, 12);
    assert.equal(click(control(tree, 'Queue José Runner')), 1);
    assert.equal(click(control(tree, 'Draft José Runner')), 1);
    assert.deepEqual(queued, ['rb']); assert.deepEqual(drafted, ['rb']); assert.equal(selected.length, 1);
    const qbRow = bodyRows(tree).find(row => row.props.key === 'qb');
    qbRow.props.onClick({ currentTarget: 'row' });
    assert.deepEqual(selected.map(row => row.id), ['rb', 'qb']);
    assert.equal(control(tree, 'Open player card for José Runner').type, 'button', 'Native button supplies keyboard activation');
});

test('off-turn, ineligible, and drafted rows cannot dispatch picks even if their handler is called', () => {
    const picks = [];
    const draw = mount({ rows, columns: [points], onDraft: row => picks.push(row.id) });
    let tree = draw();
    const denied = control(tree, 'Draft Wide Receiver');
    assert.equal(denied.props.disabled, true);
    assert.equal(denied.props.title, 'Your roster needs a quarterback');
    assert.equal(click(denied), 1); assert.deepEqual(picks, []);
    click(button(tree, 'Show drafted')); tree = draw();
    const taken = control(tree, 'Draft Drafted Runner');
    assert.equal(taken.props.disabled, true); click(taken); assert.deepEqual(picks, []);
    tree = draw({ rows: rows.map(row => ({ ...row, canDraft: false })) });
    click(control(tree, 'Draft José Runner')); assert.deepEqual(picks, []);
});

test('sort headers expose direction, reverse on repeat, and coordinate with the phone sort picker', () => {
    const draw = mount({ rows, columns: [points], pageSize: 20 });
    let tree = draw();
    const header = key => one(tree, node => node.type === 'th' && node.props.className === 'game-draft-col-' + key);
    assert.equal(header('rank').props['aria-sort'], 'ascending');
    click(header('points').children[0]); tree = draw();
    assert.deepEqual(rowIds(tree), ['qb', 'rb', 'wr', 'te']);
    assert.equal(header('points').props['aria-sort'], 'descending');
    assert.equal(header('points').props.scope, 'col');
    click(header('points').children[0]); tree = draw();
    assert.deepEqual(rowIds(tree), ['wr', 'rb', 'qb', 'te']);
    assert.equal(header('points').props['aria-sort'], 'ascending');
    change(tree, 'Sort draft players', 'name'); tree = draw();
    assert.deepEqual(rowIds(tree), ['rb', 'qb', 'te', 'wr']);
    click(control(tree, 'Sort descending')); tree = draw();
    assert.deepEqual(rowIds(tree), ['wr', 'te', 'qb', 'rb']);
    const metric = bodyRows(tree).find(row => row.props.key === 'wr').children.find(cell => cell.props.className === 'game-draft-metric game-draft-col-points');
    assert.equal(words(metric), '0', 'Zero is displayed as an observed metric');
    const absent = bodyRows(tree).find(row => row.props.key === 'te').children.find(cell => cell.props.className === 'game-draft-metric game-draft-col-points');
    assert.equal(words(absent), '—');
});

test('pagination expands and resets after sort, query, position, or page-size changes', () => {
    const many = Array.from({ length: 7 }, (_, index) => ({ id: String(index), name: `Player ${index}`, position: index % 2 ? 'WR' : 'RB', points: index }));
    const draw = mount({ rows: many, columns: [points], positionOptions: ['RB', 'WR'], pageSize: 2 });
    let tree = draw();
    assert.deepEqual(rowIds(tree), ['0', '1']);
    click(button(tree, 'Show 2 more players · 5 remaining')); tree = draw();
    assert.equal(bodyRows(tree).length, 4);
    change(tree, 'Sort draft players', 'points'); tree = draw();
    assert.deepEqual(rowIds(tree), ['6', '5']);
    click(button(tree, 'Show 2 more players · 5 remaining')); tree = draw();
    change(tree, 'Search draft players', 'Player'); tree = draw();
    assert.equal(bodyRows(tree).length, 2);
    click(button(tree, 'Show 2 more players · 5 remaining')); tree = draw();
    change(tree, 'Draft position', 'RB'); tree = draw();
    assert.deepEqual(rowIds(tree), ['6', '4']);
    tree = draw({ pageSize: 3 }); assert.deepEqual(rowIds(tree), ['6', '4', '2']);
    click(button(tree, 'Show 1 more players · 1 remaining')); tree = draw();
    assert.equal(bodyRows(tree).length, 4);
    assert.equal(nodes(tree, node => node.props.className === 'game-draft-more').length, 0);
});

test('changing an adapter-owned era filter resets pagination while keeping the user search and sort', () => {
    const many = Array.from({ length: 6 }, (_, index) => ({ id: String(index), name: `Legend ${index}`, position: 'RB', points: index }));
    const draw = mount({ rows: many, columns: [points], pageSize: 2, externalFilterKey: 'all', hasExternalFilters: false });
    let tree = draw();
    change(tree, 'Search draft players', 'Legend'); tree = draw();
    change(tree, 'Sort draft players', 'points'); tree = draw();
    click(button(tree, 'Show 2 more players · 4 remaining')); tree = draw();
    assert.deepEqual(rowIds(tree), ['5', '4', '3', '2']);
    tree = draw({ externalFilterKey: '2010s', hasExternalFilters: true });
    assert.deepEqual(rowIds(tree), ['5', '4']);
    assert.equal(control(tree, 'Search draft players').props.value, 'Legend');
    assert.equal(control(tree, 'Sort draft players').props.value, 'points');
});

test('queue and empty states remain actionable and Clear filters clears both internal and external filters', () => {
    let clears = 0;
    const draw = mount({ rows, columns: [points], positionOptions: positions, queuedIds: ['wr'], onToggleQueue() {}, hasExternalFilters: true, onClearFilters() { clears++; } });
    let tree = draw();
    click(button(tree, '★ My queue (1)')); tree = draw();
    assert.deepEqual(rowIds(tree), ['wr']);
    assert.equal(button(tree, '★ My queue (1)').props['aria-pressed'], true);
    assert.equal(control(tree, 'Remove Wide Receiver from queue').props['aria-pressed'], true);
    change(tree, 'Search draft players', 'does not exist'); tree = draw();
    assert.deepEqual(rowIds(tree), []);
    assert(words(tree).includes('No players match these filters.'));
    // Both the visibility bar and empty-state action offer the same recovery.
    const clear = nodes(tree, node => node.type === 'button' && words(node) === 'Clear filters');
    assert.equal(clear.length, 2); click(clear[1]); tree = draw({ hasExternalFilters: false });
    assert.equal(clears, 1); assert.equal(control(tree, 'Search draft players').props.value, '');
    assert.equal(button(tree, '★ My queue (1)').props['aria-pressed'], false); assert.equal(bodyRows(tree).length, 4);
    tree = draw({ queuedIds: [] }); click(button(tree, '★ My queue (0)')); tree = draw();
    assert(words(tree).includes('Your queue is empty. Star a player to add them.'));
});

test('controlled search, removed position choices, and unavailable sort columns recover without an empty stale board', () => {
    const requests = [];
    const draw = mount({ rows, columns: [points], positionOptions: positions, query: '', onQueryChange: value => requests.push(value) });
    let tree = draw();
    change(tree, 'Search draft players', 'Jose'); tree = draw();
    assert.deepEqual(requests, ['Jose']); assert.equal(bodyRows(tree).length, 4, 'Parent controls the displayed query');
    tree = draw({ query: requests.at(-1) }); assert.deepEqual(rowIds(tree), ['rb']);
    tree = draw({ query: '' }); change(tree, 'Draft position', 'FLEX'); tree = draw();
    assert.deepEqual(rowIds(tree), ['rb', 'wr', 'te']);
    tree = draw({ positionOptions: ['QB', 'RB'] });
    assert.equal(control(tree, 'Draft position').props.value, ''); assert.equal(bodyRows(tree).length, 4);
    change(tree, 'Sort draft players', 'points'); tree = draw();
    tree = draw({ columns: [] }); assert.equal(control(tree, 'Sort draft players').props.value, 'rank');
});

test('the shared board displays only public adapter fields and never loads current NFL or account data', () => {
    const privateYear = 'UNREVEALED_2049', publicRow = { id: 'sealed', name: 'Historical Player', position: 'QB', detail: '2010s · 4 possible seasons', points: null, assignedYear: privateYear };
    const tree = mount({ rows: [publicRow], columns: [points], statusText: 'Scouting uses eligible archive seasons.' })();
    assert(!words(tree).includes(privateYear));
    assert(words(tree).includes('2010s · 4 possible seasons'));
    assert.equal(control(tree, 'Draft player table').props.tabIndex, 0, 'Table scroll area is reachable by keyboard');
    assert.equal(control(tree, 'Draft player table').props.role, 'region', 'Scroll area has an exposed accessible name');
    assert.equal(nodes(tree, node => node.type === 'button' && /Draft Historical/.test(node.props['aria-label'] || '')).length, 0, 'Read-only adapters have no pick action');
});

console.log(`Game draft table: ${checks.length} source-real interaction and data-contract checks passed.`);
