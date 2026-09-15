'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync('js/components/wr-primitives.js', 'utf8');
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.children)];
function harness(phone = true) {
  const effects = [];
  const document = { body: { style: { overflow: 'auto' } }, head: { appendChild() {} }, getElementById: () => true, activeElement: null };
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useRef: current => ({ current }), useEffect: cb => effects.push(cb) };
  const window = { WR: { useViewport: () => ({ isPhone: phone, width: phone ? 390 : 1200, height: 844 }) } };
  vm.runInNewContext(source, { React, window, document, requestAnimationFrame: cb => cb(), setTimeout, clearTimeout });
  return { WR: window.WR, document, effects };
}
test('asset actions preserve details and do not fire twice for nested controls', () => {
  const { WR } = harness(); let opens = 0;
  const details = { type: 'details', props: {}, children: ['All fields'] };
  const row = WR.AssetRow({ name: 'A long complete player name', tag: 'Team · Age 26', slots: [{ label: 'Score', value: 0 }, { label: 'Age', value: 26 }], details, onClick: () => opens++ });
  const head = walk(row).find(n => n.props.className === 'wr-asset-head');
  assert.equal(head.props['aria-expanded'], undefined, 'opening a player is not falsely announced as a disclosure');
  assert.ok(walk(row).includes(details));
  assert.equal(walk(row).filter(n => n.props.className === 'wr-asset-slot').length, 2);
  const currentTarget = {};
  head.props.onKeyDown({ key: 'Enter', target: {}, currentTarget, preventDefault() {} });
  assert.equal(opens, 0, 'a nested action owns its keyboard activation');
  head.props.onKeyDown({ key: 'Enter', target: currentTarget, currentTarget, preventDefault() {} });
  assert.equal(opens, 1);
});
test('phone sheet traps focus, closes with Escape and restores its opener and scrolling', () => {
  const { WR, document, effects } = harness(); let closed = 0;
  const opener = { isConnected: true, focus() { document.activeElement = this; } };
  document.activeElement = opener;
  const tree = WR.Sheet({ open: true, onClose: () => closed++, title: 'More views', children: 'Views' });
  const node = walk(tree).find(n => n.props.role === 'dialog');
  assert.equal(node.props['aria-label'], 'More views');
  const listeners = {};
  document.addEventListener = (k, fn) => { listeners[k] = fn; };
  document.removeEventListener = k => { delete listeners[k]; };
  const dialog = { contains: el => controls.includes(el), querySelectorAll: () => controls, focus() { document.activeElement = this; }, addEventListener: (k, fn) => { listeners[k] = fn; }, removeEventListener: k => { delete listeners[k]; } };
  const controls = [0, 1].map(() => ({ getClientRects: () => [1], focus() { document.activeElement = this; }, closest: selector => selector.startsWith('details') ? null : dialog }));
  node.props.ref.current = dialog;
  const cleanups = effects.map(fn => fn()).filter(Boolean);
  assert.equal(document.body.style.overflow, 'hidden');
  assert.equal(document.activeElement, controls[0]);
  const key = (key, shiftKey = false) => listeners.keydown({ key, shiftKey, target: document.activeElement, preventDefault() {}, stopPropagation() {} });
  key('Tab', true); assert.equal(document.activeElement, controls[1]);
  key('Tab'); assert.equal(document.activeElement, controls[0]);
  document.activeElement = { closest: () => null };
  key('Escape'); assert.equal(closed, 1, 'Escape still works after the focused row is removed');
  cleanups.reverse().forEach(fn => fn());
  assert.equal(document.activeElement, opener);
  assert.equal(document.body.style.overflow, 'auto');
});
test('optional sections preserve full content and leave desktop children unchanged', () => {
  const children = { type: 'p', props: {}, children: ['The full record'] };
  const phone = harness().WR.MobileSection({ title: 'Career', children });
  assert.equal(phone.type, 'details'); assert.ok(walk(phone).includes(children));
  assert.equal(harness(false).WR.MobileSection({ title: 'Career', children }), children);
});
test('nested sheets restore page scrolling only after the last sheet closes', () => {
  const { WR, document, effects } = harness();
  document.addEventListener=()=>{}; document.removeEventListener=()=>{};
  document.activeElement={isConnected:true,focus(){document.activeElement=this;}};
  function mount(title) {
    const start=effects.length;
    const tree=WR.Sheet({open:true,title,onClose(){},children:title});
    const control={isConnected:true,getClientRects:()=>[1],closest:selector=>selector.startsWith('details')?null:dialog,focus(){document.activeElement=this;}};
    const dialog={contains:el=>el===control,querySelectorAll:()=>[control]};
    walk(tree).find(n=>n.props.role==='dialog').props.ref.current=dialog;
    const cleanups=effects.slice(start).map(fn=>fn()).filter(Boolean);
    return ()=>cleanups.reverse().forEach(fn=>fn());
  }
  const closeParent=mount('Parent'),closeChild=mount('Child');
  closeParent();assert.equal(document.body.style.overflow,'hidden');
  closeChild();assert.equal(document.body.style.overflow,'auto');
});
