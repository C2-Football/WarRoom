'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), Babel = require('@babel/standalone');
const hooks = [], effects = [], calls = [];
let cursor = 0, currentWeek = 1, resolveLedger;
const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { hooks[i] = value; }]; },
    useRef(initial) { const i = cursor++; return hooks[i] ||= { current: initial }; },
    useEffect(fn, deps) { effects.push({ fn, deps }); },
};
const survivor = { rosterId: 1, alive: true, chopThisWeekPct: 10, expWeeksLeft: 4, survivePct: 20, winPct: 20 };
const root = { App: {
    WeeklyProj: { currentWeek: () => currentWeek },
    Chopped: { isChopped: () => true },
    Luck: { build: () => resolveLedger ? new Promise(resolve => { resolveLedger = resolve; }) : Promise.resolve({ rows: currentWeek > 1 ? [{}] : [] }) },
    ChopOdds: { simulate(args) { calls.push(args); return { me: { ...survivor, rosterId: args.myRosterId }, rows: [survivor], weeks: [args.week], simCount: 4000, basis: args.ledger.rows.length ? 'played' : 'projected' }; } },
} };
const context = vm.createContext({ React, window: root });
vm.runInContext(Babel.transform(fs.readFileSync('js/components/chop-block-panel.js', 'utf8'), { presets: ['react'] }).code, context);
const league = { league_id: 'shootout', season: '2026', settings: { last_chopped_leg: 4 }, rosters: [{ roster_id: 1, settings: {} }, { roster_id: 2, settings: {} }] };
let props = { active: true, currentLeague: league, myRoster: league.rosters[0], compact: true, phone: true };
function render() { cursor = 0; effects.length = 0; return root.WrChopBlock(props); }
async function start() { render(); effects[0].fn(); render(); effects[1].fn(); await Promise.resolve(); await Promise.resolve(); }
(async () => {
    await start();
    assert.equal(calls[0].week, 1);
    assert.equal(hooks[0].sim.basis, 'projected');
    render(); const initialKey = effects[0].deps[0];
    currentWeek = 5;
    render(); assert.notEqual(effects[0].deps[0], initialKey, 'NFL week hydration invalidates the early baseline');
    await start();
    assert.equal(calls[1].week, 5);
    assert.equal(hooks[0].sim.basis, 'played');
    render(); const beforeChopKey = effects[0].deps[0];
    league.rosters[1].settings.eliminated = 5;
    render(); assert.notEqual(effects[0].deps[0], beforeChopKey, 'Official eliminations invalidate the field');
    // A slow old-team request must not overwrite a newly selected manager.
    resolveLedger = true;
    render(); effects[0].fn(); render(); effects[1].fn();
    const oldRequest = resolveLedger;
    props = { ...props, myRoster: { roster_id: 2 } };
    render(); effects[0].fn(); render(); effects[1].fn();
    const newRequest = resolveLedger;
    oldRequest({ rows: [{}] }); await Promise.resolve(); await Promise.resolve();
    assert.equal(hooks[0].status, 'loading', 'A stale request cannot publish another manager’s outlook');
    newRequest({ rows: [{}] }); await Promise.resolve(); await Promise.resolve();
    assert.equal(hooks[0].sim.me.rosterId, 2);
    console.log('PASS Chopped survival lifecycle: NFL week hydration, official elimination, and stale manager results');
})().catch(error => { console.error(error); process.exitCode = 1; });
