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

for (const dir of [1, -1]) {
    const values = [null, 10, -3, 0, NaN, undefined, '', '—', 2];
    const sorted = values.slice().sort((a, b) => M.compareValues(a, b, dir));
    assert.deepEqual(sorted.slice(0, 4), dir === 1 ? [-3, 0, 2, 10] : [10, 2, 0, -3], 'Numbers sort numerically and retain zero and negative results');
    assert(sorted.slice(4).every(value => M.numericValue(value) === null), 'Unknown metrics stay last in both directions');
}
assert.deepEqual(['C', 'A+', null, 'F', 'B-'].sort((a, b) => M.compareValues(a, b, -1, { type: 'grade' })), ['A+', 'B-', 'C', 'F', null]);
assert.equal(M.gradeValue('unavailable'), null);
assert.equal(M.compareValues('zebra', 'Alpha', 1, { type: 'text' }) > 0, true);
assert.equal(M.defaultDirection('age'), 1);assert.equal(M.defaultDirection('proj'), -1);
assert.equal(M.nextSort({key:'proj',dir:-1},'proj').dir,1);
assert.equal(M.nextSort({key:'name',dir:1},'ppg').dir,-1);
root.React={createElement:(type,props,...children)=>({type,props:props||{},children})};
let clicked,stopped=false;
const header=M.SortButton({columnKey:'proj',label:'PROJ',sort:{key:'proj',dir:-1},onSort:key=>{clicked=key;}});
assert.equal(header.type,'button');assert.equal(header.props.type,'button');assert.equal(header.props['aria-pressed'],true);
assert.match(header.props['aria-label'],/descending.*reverse/);
header.props.onClick({stopPropagation(){stopped=true;}});assert.equal(clicked,'proj');assert.equal(stopped,true,'Sorting never triggers the parent player action');
assert.equal(M.SortButton({columnKey:'extra',label:'Extra',onSort(){},disabled:true}).type,'span','Non-sortable fields are not fake buttons');
console.log('PASS player header sorting: direction toggle, numeric/grade order, unknowns last, accessible buttons and isolated clicks');
