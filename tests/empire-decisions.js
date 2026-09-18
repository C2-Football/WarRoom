#!/usr/bin/env node
'use strict';
const assert = require('assert');
global.App = {};
const D = require('../js/shared/empire-decisions.js');

let passed = 0;
function test(name, fn) {
  try { D._reset(); fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const move = { type:'sell', leagueId:'L1', leagueName:'Alpha', pid:'p1', ownerName:'Rival', title:'Sell Veteran to Rival', why:'Trim exposure.', accept:68, value:420 };

test('track captures recommendation context once', () => {
  const a = D.track(move, { nowMs:10 });
  const b = D.track(move, { nowMs:20 });
  assert.strictEqual(a.id, b.id);
  assert.strictEqual(D.list().length, 1);
  assert.strictEqual(a.estimatedDelta, 420);
  assert.strictEqual(a.status, 'WATCHING');
});
test('update records workflow, review date, note and realized delta', () => {
  const a = D.track(move, { nowMs:10 });
  const b = D.update(a.id, { status:'won', reviewAt:'2026-09-01', note:'Closed.', actualDelta:'515' }, { nowMs:20 });
  assert.strictEqual(b.status, 'WON');
  assert.strictEqual(b.actualDelta, 515);
  assert.strictEqual(b.updatedAt, 20);
  assert.strictEqual(D.update(a.id, { actualDelta:null }).actualDelta, null);
});
test('summary separates active and terminal decisions', () => {
  const a = D.track(move, { nowMs:10 });
  const b = D.track({ ...move, pid:'p2', title:'Acquire Rookie' }, { nowMs:11 });
  D.update(a.id, { status:'WON', actualDelta:300 }, { nowMs:12 });
  D.update(b.id, { status:'LOST', actualDelta:-80 }, { nowMs:13 });
  assert.deepStrictEqual(D.summary(), { total:2, active:0, closed:2, won:1, lost:1, realizedDelta:220 });
});
test('remove is explicit and safe', () => {
  const a = D.track(move);
  assert.strictEqual(D.remove(a.id), true);
  assert.strictEqual(D.remove(a.id), false);
  assert.strictEqual(D.list().length, 0);
});

test('failed journal writes preserve the saved record and allow one successful retry', () => {
  const records = new Map(); let fail = false;
  global.App.AccountStorage = {
    get: (key, fallback) => records.has(key) ? JSON.parse(records.get(key)) : fallback,
    set: (key, value) => { if (fail) return false; records.set(key, JSON.stringify(value)); return true; },
  };
  try {
    fail = true;
    assert.throws(() => D.track(move), { code: 'LOCAL_SAVE_FAILED' });
    assert.equal(D.list().length, 0, 'failed creation is not a saved decision');
    fail = false; const saved = D.track(move, { nowMs: 10 });
    fail = true;
    assert.throws(() => D.update(saved.id, { note: 'Unsaved note', status: 'WON' }), { code: 'LOCAL_SAVE_FAILED' });
    assert.equal(D.list()[0].note, ''); assert.equal(D.list()[0].status, 'WATCHING');
    assert.throws(() => D.remove(saved.id), { code: 'LOCAL_SAVE_FAILED' });
    assert.equal(D.list().length, 1, 'failed removal preserves saved work');
    fail = false; D.update(saved.id, { note: 'Recovered note', status: 'WON' });
    assert.equal(D.list().length, 1); assert.equal(D.list()[0].note, 'Recovered note');
  } finally { delete global.App.AccountStorage; }
});

test('actual journal UI retains failed drafts, merges newer edits and retries safely', () => {
  const fs = require('node:fs'), vm = require('node:vm'), Babel = require('@babel/standalone');
  const records = new Map(); let fail = false;
  global.App.AccountStorage = {
    get: (key, fallback) => records.has(key) ? JSON.parse(records.get(key)) : fallback,
    set: (key, value) => { if (fail) throw new Error('Quota exceeded'); records.set(key, JSON.stringify(value)); return true; },
  };
  const slots = []; let cursor = 0;
  const context = vm.createContext({window:{App:{}},React:{
    useState(initial) { const i=cursor++; if(!(i in slots))slots[i]=initial; return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}]; },
    useRef(initial) { const i=cursor++; if(!(i in slots))slots[i]={current:initial};return slots[i]; },
    useEffect() {},
  }});
  vm.runInContext(Babel.transform(fs.readFileSync('js/tabs/global-view.js','utf8'),{presets:['react']}).code,context);
  const render=()=>{cursor=0;return context.useEmpireDecisionJournal(D);};
  try {
    let ui=render();fail=true;
    assert.equal(ui.commit({type:'track',move}),false);ui=render();assert(ui.failure);assert(ui.hasPending());assert.equal(D.list().length,0);
    fail=false;assert.equal(ui.retry(),true);ui=render();assert.equal(ui.failure,null);
    const id=D.list()[0].id;
    ui.edit(id,{note:'A note to keep'});fail=true;
    assert.equal(ui.commit({type:'update',id,patch:{status:'WORKING',note:'A note to keep'}}),false);
    ui=render();assert.equal(ui.drafts[id].note,'A note to keep');assert.equal(ui.drafts[id].status,'WORKING');assert.equal(D.list()[0].note,'');
    ui.edit(id,{note:'A newer note to keep'});ui=render();fail=false;
    assert.equal(ui.retry(),true);ui=render();assert.equal(D.list()[0].note,'A newer note to keep');assert.equal(D.list()[0].status,'WORKING');assert.equal(ui.hasPending(),false);
    const secondMove={...move,pid:'p2',title:'Second decision'};
    const second=D.track(secondMove);
    fail=true;assert.equal(ui.commit({type:'update',id,patch:{note:'Keep A after B saves'}}),false);
    ui=render();fail=false;assert.equal(ui.commit({type:'update',id:second.id,patch:{note:'B saved'}}),true);
    ui=render();assert(ui.failure,'another saved record must not hide the failed decision');assert(ui.hasPending());
    assert.equal(ui.retry(),true);ui=render();assert.equal(D.list().find(row=>row.id===id).note,'Keep A after B saves');assert.equal(ui.hasPending(),false);
    const thirdMove={...move,pid:'p3',title:'Retain failed creation'};
    fail=true;assert.equal(ui.commit({type:'track',move:thirdMove}),false);
    assert.equal(ui.commit({type:'update',id,patch:{note:'Another pending edit'}}),false);
    ui=render();fail=false;assert.equal(ui.commit({type:'update',id:second.id,patch:{note:'B changed again'}}),true);
    ui=render();assert(ui.failure);assert.equal(ui.retry(),true);ui=render();assert(ui.failure,'a second failed intent remains recoverable');
    assert.equal(D.list().filter(row=>row.title===thirdMove.title).length,1);
    assert.equal(ui.retry(),true);ui=render();assert.equal(ui.hasPending(),false);
    D.remove(second.id);D.remove(D.list().find(row=>row.title===thirdMove.title).id);
    fail=true;assert.equal(ui.commit({type:'remove',id}),false);ui=render();assert.equal(D.list().length,1);assert(ui.hasPending());
    ui.discard();ui=render();assert.equal(ui.hasPending(),false);assert.equal(D.list().length,1,'discard does not erase the last saved record');
  } finally { delete global.App.AccountStorage; }
});

if (!process.exitCode) console.log('\nPASS ' + passed + ' tests');
