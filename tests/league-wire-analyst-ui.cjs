'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), babel = require('@babel/standalone');
const compiled = babel.transform(fs.readFileSync('js/components/league-wire-analyst.js', 'utf8'), { presets: ['react'] }).code;
const nodes = node => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(nodes)] : [];
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : (node.children || []).map(text).join(' ').replace(/\s+/g, ' ');
function harness(initial) {
    let cursor = 0, props = initial, tree;
    const slots = [], window = {};
    const React = {
        createElement: (type, attributes, ...children) => ({ type, props: attributes || {}, children: children.flat(Infinity) }),
        useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    };
    const context = { window, React }; vm.createContext(context);
    vm.runInContext(fs.readFileSync('js/shared/league-wire-reading.js', 'utf8'), context);
    vm.runInContext(compiled, context);
    const expand = node => {
        if (!node || typeof node !== 'object') return node;
        if (typeof node.type === 'function') return expand(node.type(node.props));
        return { ...node, children: node.children.map(expand) };
    };
    return {
        render(update = {}) { props = { ...props, ...update }; cursor = 0; tree = expand(context.WrWireAnalystDesk(props)); return tree; },
        card(story, compact = false) { return expand(context.WrWireOpinionCard({ story, compact, leagueName: 'Sample league' })); },
        click(label) { const node = nodes(tree).find(node => node.type === 'button' && text(node) === label); assert(node, 'Button exists: ' + label); node.props.onClick(); },
    };
}
const league = { league_id: 'one', name: 'Sample league', season: '2026' };
const story = (id, desk, extra = {}) => ({ id, desk, season: '2026', text: id, body: 'Our take has a clear first paragraph.\n\nThe second paragraph explains the tradeoff.', label: 'THE ANALYST · OPINION', timingLabel: '2026 settings', rosterIds: [], participants: [], sources: [], related: [], ...extra });
const alice = { ownerId: 'alice', ownerName: 'Alice', rosterId: 1, teamName: 'New jersey' };
const stories = [
    story('League scoring', 'scoring'),
    story('Roster demand', 'format'),
    story('Alice depth', 'rosters', { rosterIds: [1], participants: [alice] }),
    story('Bob depth', 'rosters', { rosterIds: [2], participants: [{ ownerId: 'bob', ownerName: 'Bob', rosterId: 2 }] }),
    story('Alice then', 'form', { season: '2025', rosterIds: [9], participants: [{ ...alice, rosterId: 9, teamName: 'Old jersey' }] }),
    story('Unknown old slot', 'form', { season: '2025', rosterIds: [1] }),
    story('League median', 'format'),
];
const analysis = { stories, coverage: ['Settings examples use explicit rules. No missing statistic becomes zero.'] };
const draft = { type: 'section', props: { 'aria-label': 'Lazy draft opinions' }, children: ['Open draft opinions'] };
const app = harness({ league, analysis, scope: 'account-a|one|2026|2', draft });
let tree = app.render();
assert.equal(nodes(tree).filter(node => node.type === 'article').length, 4, 'the opinion desk opens with four concise columns');
assert(nodes(tree).some(node => node.props['aria-label'] === 'Lazy draft opinions'), 'the draft desk remains available without pretending receipts already loaded');
app.click('More opinions · 3 remaining'); tree = app.render();
assert.equal(nodes(tree).filter(node => node.type === 'article').length, 7);
tree = app.render({ ownerFilter: { ownerId: 'alice', rosterId: 1 } });
assert.match(text(tree), /Alice depth/); assert.match(text(tree), /Alice then/, 'a known owner follows a different archived roster slot');
assert.match(text(tree), /League scoring/); assert.match(text(tree), /league-wide rules that affect every team/);
assert.doesNotMatch(text(tree), /Bob depth|Unknown old slot/);
tree = app.render({ ownerFilter: { ownerId: null, rosterId: 1 } });
assert.match(text(tree), /Alice depth/); assert.doesNotMatch(text(tree), /Alice then|Unknown old slot/, 'unknown ownership cannot inherit a past roster slot');
tree = app.render({ ownerFilter: null, search: 'old jersey' });
assert.equal(nodes(tree).filter(node => node.type === 'article').length, 1, 'team context participates in search immediately');
assert.match(text(tree), /Alice then/);
tree = app.render({ search: '' }); app.click('Scoring'); tree = app.render();
assert.equal(nodes(tree).filter(node => node.type === 'article').length, 1);
assert.match(text(tree), /League scoring/); assert(!nodes(tree).some(node => node.props['aria-label'] === 'Lazy draft opinions'), 'non-draft subjects do not mount the draft desk');
app.click('Drafts'); tree = app.render();
assert.equal(nodes(tree).filter(node => node.type === 'article').length, 0);
assert(nodes(tree).some(node => node.props['aria-label'] === 'Lazy draft opinions'));
assert.doesNotMatch(text(tree), /No supported take|No columns match/, 'draft loading has its own empty state');
tree = app.render({ scope: 'account-b|one|2026|2' });
assert.equal(nodes(tree).filter(node => node.type === 'article').length, 4, 'account/edition scope resets the subject and page length synchronously');
assert.equal(nodes(tree).find(node => node.type === 'button' && text(node) === 'All takes').props['aria-pressed'], true);
tree = app.render({ scope: 'account-b|two|2025|14', league: { ...league, league_id: 'two', season: '2025' }, analysis: { stories: [story('Other league opinion', 'scoring', { season: '2025' })] }, draft: null });
assert.match(text(tree), /Other league opinion/); assert.doesNotMatch(text(tree), /Alice depth|League scoring|Open draft opinions/);
assert(!nodes(tree).some(node => node.type === 'button' && text(node) === 'Drafts'), 'a missing draft integration does not advertise an empty subject');
tree = app.render({ search: 'unmatched' }); assert.match(text(tree), /No columns match this view/);
tree = app.render({ search: '', analysis: { stories: [], coverage: ['Only verified evidence.'] } }); assert.match(text(tree), /need a fuller picture/);

const receipt = story('An opinion with evidence', 'scoring', {
    related: [{ label: 'The arithmetic', text: 'A six-point touchdown.\n\nA three-point penalty.' }],
    sources: [{ label: 'League rules', url: 'https://api.sleeper.app/v1/league/one' }, { label: 'Unsafe source', url: 'javascript:alert(1)' }, { label: 'Missing URL' }],
});
tree = app.card(receipt);
assert.equal(nodes(tree).filter(node => node.type === 'p' && /^Our take|^The second/.test(text(node))).length, 2, 'readable body paragraphs remain separate');
assert.match(text(tree), /THE ANALYST · OPINION.*Sample league/); assert.match(text(tree), /2026 settings/);
const evidence = nodes(tree).find(node => node.type === 'details' && text(node).includes('The numbers and sources'));
assert(evidence); assert.match(text(evidence), /The arithmetic.*six-point touchdown.*three-point penalty/);
assert.equal(nodes(tree).filter(node => node.type === 'a').length, 1, 'receipts render only usable web source links');
assert.equal(nodes(tree).find(node => node.type === 'a').props.rel, 'noreferrer');
tree = app.card(receipt, true);
assert(nodes(tree).some(node => node.type === 'details' && text(node).startsWith('Read the column')), 'the front-page card offers the complete column on demand');
assert(!nodes(tree).some(node => ['img', 'svg', 'canvas', 'video', 'picture'].includes(node.type)), 'opinion cards stay text-only for the multi-league Wire');
console.log('PASS analyst UI: clear opinion labels, narrative receipts, immediate search/owner scopes, historical identity, bounded pagination, optional lazy drafts, scope reset and text-only cards');
