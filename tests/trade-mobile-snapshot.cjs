'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Babel = require('@babel/standalone');

// A clone-capable document fixture exercises the actual export callback while
// keeping html2canvas's rasterizer and file download outside this unit test.
class Element {
  constructor(tagName, { id = '', className = '', text = '', open = false } = {}) {
    Object.assign(this, { tagName, id, className, text, open, children: [], parentNode: null });
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
  insertBefore(child, before) { child.parentNode = this; const i = this.children.indexOf(before); this.children.splice(i < 0 ? this.children.length : i, 0, child); return child; }
  get firstChild() { return this.children[0] || null; }
  querySelectorAll(selector) { return walk(this).slice(1).filter(node => node.tagName.toLowerCase() === selector); }
  cloneNode(deep) { const clone = new Element(this.tagName, this); if (deep) this.children.forEach(child => clone.appendChild(child.cloneNode(true))); return clone; }
}
const walk = node => [node, ...node.children.flatMap(walk)];
const text = node => walk(node).map(item => item.text).join(' ');
const structure = node => JSON.stringify({ tag: node.tagName, id: node.id, className: node.className, text: node.text, open: node.open, children: node.children.map(structure) });
const makeDocument = body => ({
  body,
  getElementById: id => walk(body).find(node => node.id === id) || null,
  querySelector: selector => walk(body).find(node => selector.startsWith('.') && node.className.split(' ').includes(selector.slice(1))) || null,
});
const body = new Element('body');
const builder = body.appendChild(new Element('section', { className: 'mc-trade-builder' }));
const summary = builder.appendChild(new Element('section', { className: 'mc-trade-builder-summary', text: 'Value grade B · Acceptance 67% · Helps your season +0.4 projected wins' }));
summary.appendChild(new Element('small', { text: 'Model estimate · Starts Week 7' }));
builder.appendChild(new Element('section', { className: 'mc-trade-builder-sides', text: 'PRIVATE ASSET PICKER CONTENT' }));
const detail = builder.appendChild(new Element('div', { id: 'wr-export-trade', text: 'TRADE ANALYSIS' }));
const modelDisclosure = detail.appendChild(new Element('details', { className: 'tc-season-detail' }));
modelDisclosure.appendChild(new Element('summary', { text: 'Remaining games & model details' }));
modelDisclosure.appendChild(new Element('table', { text: 'Remaining games · Week 7 · Future rival' }));
const nestedDisclosure = modelDisclosure.appendChild(new Element('details', { className: 'nested-model-details' }));
nestedDisclosure.appendChild(new Element('summary', { text: 'Assumptions and limits' }));
nestedDisclosure.appendChild(new Element('p', { text: 'Current injury status held fixed.' }));
const ownerDisclosure = detail.appendChild(new Element('details', { className: 'tc-season-owner-details' }));
ownerDisclosure.appendChild(new Element('summary', { text: 'Owner fit & acceptance' }));
ownerDisclosure.appendChild(new Element('p', { text: 'Acceptance factors: endowment -4%' }));
const opinionDisclosure = detail.appendChild(new Element('details', { className: 'tc-trade-second-opinion', open: true }));
opinionDisclosure.appendChild(new Element('summary', { text: 'Alex second opinion' }));
opinionDisclosure.appendChild(new Element('p', { text: 'Review the outgoing starter.' }));
const original = structure(body), captures = [], downloads = [], revoked = [];
const document = makeDocument(body);
document.createElement = tagName => {
  assert.equal(tagName, 'a', 'A preloaded rasterizer must not require a CDN script');
  const anchor = new Element('a');
  anchor.click = () => downloads.push({ href: anchor.href, name: anchor.download });
  return anchor;
};
const window = { html2canvas: async (target, options) => {
  assert.equal(target, detail, 'Export remains scoped to the analysis, not the whole builder');
  const cloned = makeDocument(body.cloneNode(true));
  options.onclone(cloned);
  captures.push({ target: cloned.getElementById(target.id), cloned, options });
  return { toBlob(callback, type) { assert.equal(type, 'image/png'); callback({ type }); } };
} };
const scope = vm.createContext({ window, document, URL: {
  createObjectURL: () => 'blob:trade-test', revokeObjectURL: url => revoked.push(url),
}, React: { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: initial => [initial, () => {}] }, Tip: () => null });
vm.runInContext(fs.readFileSync('js/export.js', 'utf8'), scope);

// Exercise the actual Snapshot button wiring as well as capture's clone hook.
const source = fs.readFileSync('js/trade-calc.js', 'utf8');
const ast = Babel.packages.parser.parse(source, { plugins: ['jsx'] });
let verdictNode;
Babel.packages.traverse.default(ast, { FunctionDeclaration(path) { if (path.node.id?.name === 'TcVerdictPanel') verdictNode = path.node; } });
assert(verdictNode);
vm.runInContext(Babel.transform(source.slice(verdictNode.start, verdictNode.end), { presets: ['react'] }).code, scope);
window.wrIsPro = () => false;
const verdict = { totalA: 1000, totalB: 1100, grade: { grade: 'B', label: 'Fair' }, diffDisplay: '+100', faabDelta: 0, FAAB_RATE: 1, starterValueDelta: 100, pickCapitalDelta: 0, pickQuantityDelta: 0, otherDna: {}, grudgeTax: { total: 0 }, psychTaxes: [], seasonImpactController: { enabled: false } };
const reactNodes = node => node == null || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(reactNodes) : [node, ...reactNodes(node.children)];
const snapshotButton = mobileDetails => reactNodes(scope.TcVerdictPanel({ ...verdict, mobileDetails })).find(node => node.type === 'button' && node.children.includes('Snapshot'));

(async () => {
  assert.equal(await snapshotButton(true).props.onClick(), true);
  const mobile = captures.at(-1);
  assert.match(text(mobile.target), /Value grade B.*Acceptance 67%.*Helps your season/);
  assert.match(text(mobile.target), /Remaining games/);
  assert.equal(mobile.target.querySelectorAll('details').length, 4, 'The fixture covers season, nested assumptions, owner and opinion disclosures');
  assert(mobile.target.querySelectorAll('details').every(node => node.open), 'Mobile Snapshot expands every analysis disclosure, including nested detail, in the clone');
  assert.equal(modelDisclosure.open, false); assert.equal(nestedDisclosure.open, false); assert.equal(ownerDisclosure.open, false); assert.equal(opinionDisclosure.open, true);
  assert.equal(mobile.target.firstChild.className, 'mc-trade-builder-summary');
  assert.notEqual(mobile.target.firstChild, summary, 'The visible summary is never moved into the analysis');
  assert.equal(walk(mobile.target).filter(node => node.className === 'mc-trade-builder-summary').length, 1);
  assert(!text(mobile.target).includes('PRIVATE ASSET PICKER CONTENT'), 'Snapshot excludes the live asset pickers');
  assert.equal(structure(body), original, 'Mobile snapshot leaves the original DOM completely unchanged');
  assert.equal(summary.parentNode, builder);

  assert.equal(await snapshotButton(false).props.onClick(), true);
  assert(!text(captures.at(-1).target).includes('Value grade B'), 'Desktop Snapshot preserves its ordinary target without the phone summary');
  assert.match(text(captures.at(-1).target), /Remaining games/);
  assert.deepEqual(captures.at(-1).target.querySelectorAll('details').map(node => node.open), [false, false, false, true], 'Desktop Snapshot retains the original disclosure state');

  assert.equal(await window.wrExport.capture(detail, 'legacy-roster'), true, 'Existing two-argument export callers remain supported');
  assert(!text(captures.at(-1).target).includes('Value grade B'));
  assert.deepEqual(captures.at(-1).target.querySelectorAll('details').map(node => node.open), [false, false, false, true], 'Legacy exports do not opt in to disclosure expansion');
  assert.equal(downloads.at(-1).name, 'legacy-roster.png');
  assert.equal(downloads[0].name, 'trade-analysis.png');
  assert.equal(captures[0].options.backgroundColor, '#0a0a0a');
  assert.equal(captures[0].options.scale, 2);
  assert.equal(revoked.length, 3, 'Each downloaded image releases its temporary URL');
  assert.equal(structure(body), original);
  assert.equal(await window.wrExport.capture(null, 'missing'), false);
  console.log('PASS mobile trade Snapshot: real button wiring, cloned summary plus expanded nested analysis, untouched visible disclosure states, picker exclusion and legacy two-argument exports');
})().catch(error => { console.error(error); process.exitCode = 1; });
