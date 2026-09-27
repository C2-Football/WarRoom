'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), babel = require('@babel/standalone');
const shared = {}; vm.createContext(shared); vm.runInContext(fs.readFileSync('js/shared/league-wire-trends.js', 'utf8'), shared);
const league = { league_id: 'one', season: '2026', rosters: [{ roster_id: 1, players: ['p'] }, { roster_id: 2, players: [] }], scoring_settings: { rec: 1 } };
const players = { p: { full_name: 'Real Player', position: 'WR' } };
const build = (opts = {}) => shared.WrWireTrends.build({ league, throughWeek: 2, weeks: [{ week: 1, stats: { p: { gp: 1, rec: 0 } } }, { week: 2, stats: { p: { gp: 1, rec: 4 } } }], players, calculate: (raw, scoring) => (raw.rec || 0) * scoring.rec, ...opts });
assert.equal(build().rows[0].prior, 0, 'recorded zero is retained');
assert.equal(build().rows[0].delta, 4);
assert.equal(build({ weeks: [{ week: 1, stats: { other: { gp: 1 } } }, { week: 2, stats: { p: { gp: 1, rec: 4 } } }] }).rows.length, 0, 'missing player week is not counted as zero');
assert.match(build({ league: { ...league, scoring_settings: null } }).reason, /scoring is unavailable/);
assert.match(build({ league: { ...league, scoring_settings: {} } }).reason, /scoring is unavailable/);
assert.match(build({ league: { ...league, scoring_settings: { rec: '1' } } }).reason, /scoring is unavailable/);
assert.equal(build({ league: { ...league, scoring_settings: { rec: 0 } } }).reason, '', 'verified zero-point rule remains valid');
assert.equal(build({ weeks: [{ week: 1, stats: { p: { gp: 0, rec: 0 } } }, { week: 2, stats: { p: { gp: 1, rec: 4 } } }] }).rows.length, 0);

const source = babel.transform(fs.readFileSync('js/components/league-wire-trends.js', 'utf8'), { presets: ['react'] }).code;
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : (node.children || []).map(text).join(' ');
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
let cursor = 0, props = { league, players, throughWeek: 2, accountScope: 'a' };
const slots = [], effects = [], calls = [], timers = new Set();
const React = { createElement: (type, props, ...children) => ({ type, props, children: children.flat(Infinity) }),
    useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useEffect: (fn, deps) => { const i = cursor++, old = slots[i]; if (!old || deps.some((v, n) => v !== old.deps[n])) { slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); }); } },
};
const window = { AbortController, WrWireTrends: { load: args => new Promise((resolve, reject) => calls.push({ ...args, resolve, reject })) } };
const context = { React, window, setTimeout: fn => { timers.add(fn); return fn; }, clearTimeout: fn => timers.delete(fn) };
vm.createContext(context); vm.runInContext(source, context);
const render = update => { props = { ...props, ...update }; cursor = 0; return window.WrWireTrendsPanel(props); };
const flush = () => { while (effects.length) effects.shift()(); };
(async () => {
    render(); flush(); await settle(); assert.equal(calls.length, 1);
    calls[0].resolve(build()); await settle(); assert.match(text(render()), /Real Player/);
    const traded = { ...league, rosters: [{ roster_id: 1, players: [] }, { roster_id: 2, players: ['p'] }] };
    assert.doesNotMatch(text(render({ league: traded, teamFilter: '1' })), /Real Player/, 'same-week ownership change hides old compiled rows before effects'); flush(); await settle(); assert.equal(calls.length, 2);
    calls[1].resolve(build({ league: traded })); await settle(); assert.doesNotMatch(text(render()), /Real Player/);
    assert.match(text(render({ teamFilter: '2' })), /Real Player/);
    assert.doesNotMatch(text(render({ accountScope: 'b' })), /Real Player/); flush(); await settle(); assert.equal(calls.length, 3);
    render({ throughWeek: 3 }); flush(); assert(calls[2].signal.aborted, 'edition change cancels stale work');
    slots.forEach(s => s?.cleanup?.());
    console.log('PASS Trends audit: explicit zero vs missing games, verified scoring settings, same-week roster trades, team filters, account/edition isolation');
})().catch(error => { console.error(error); process.exitCode = 1; });
