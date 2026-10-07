'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const data = new Map(), events = {};
let denyWrites = false;
const root = { localStorage: { getItem: key => data.get(key) || null, setItem: (key, value) => { if (denyWrites) throw Error('Storage blocked'); data.set(key, value); } },
    dispatchEvent: event => (events[event.type] || []).forEach(fn => fn(event)),
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } } };
vm.runInNewContext(fs.readFileSync('js/shared/player-metrics.js', 'utf8'), { window: root });
const M = root.WR.PlayerMetrics, array = values => Array.from(values);
const a = M.scope('a', 'league'), b = M.scope('b', 'league'), c = M.scope('a', 'other');
assert.deepEqual(array(M.read(a)), ['proj', 'ppg', 'dhq', 'age']);
assert.deepEqual(array(M.normalize(['age','age','bogus','proj'])), array(M.defaults), 'invalid or too few columns falls back safely');
M.write(a, ['age', 'ppg', 'proj']);
assert.deepEqual(array(M.read(a)), ['age', 'ppg', 'proj']);
assert.deepEqual(array(M.read(b)), array(M.defaults), 'different accounts do not inherit columns');
assert.deepEqual(array(M.read(c)), array(M.defaults), 'different leagues do not inherit columns');
const rows = M.slots(['proj', 'ppg', 'dhq', 'age'], { proj: 0, ppg: -2.5, dhq: null, age: NaN });
assert.deepEqual(array(rows).map(row => row.value), ['0.0','-2.5','—','—'], 'zero and negative stats survive while absent metrics remain unavailable');
assert.deepEqual(array(M.slots(['ppg','season','matchup'], { ppg: { value: 19 }, season: 0, matchup: 'A+' })).map(row => row.value), ['—','0.0','A+'], 'objects cannot accidentally become displayed stats');
denyWrites = true;
assert.equal(M.write(a, ['bye', 'age', 'proj']).persistent, false);
assert.deepEqual(array(M.read(a)), ['bye','age','proj'], 'storage failures retain the choice for this visit instead of restoring an older disk value');
console.log('PASS player metrics: 3/4 column validation, ordering, account/league isolation, signed/unknown data and blocked storage');
