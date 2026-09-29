'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), babel = require('@babel/standalone');
const source = babel.transform(fs.readFileSync('js/components/league-wire.js', 'utf8'), { presets: ['react'] }).code;
const nodes = node => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(nodes)] : [];
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : (node.children || []).map(text).join(' ').replace(/\s+/g, ' ');
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const rows = (a, b) => [{ roster_id: 1, matchup_id: 1, points: a }, { roster_id: 2, matchup_id: 1, points: b }];
const weeks = [1, 2, 3].map(week => ({ week, rows: rows(week * 10 + 90, 80) }));
function harness(phone = false) {
    let cursor = 0, owner = 'account:a', tree;
    const slots = [], effects = [], timers = new Map(), intervals = new Map(), listeners = new Set(), history = [], calendar = [], scoreCalls = [];
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
        useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
        useRef: initial => { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
        useMemo: fn => fn(), useCallback: fn => fn,
        useEffect: (fn, deps) => { const i = cursor++, old = slots[i]; if (!old || deps.some((v, n) => v !== old.deps[n])) { slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); }); } },
    };
    const document = { hidden: false, addEventListener: (name, fn) => listeners.add(fn), removeEventListener: (name, fn) => listeners.delete(fn) };
    const window = { document, AbortController, S: { nflState: { season: '2026', season_type: 'regular', week: 3 } }, WR: { useViewport: () => ({ isPhone: phone }) }, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
        App: { AccountStorage: { owner: () => owner }, LeagueLiveScores: {
            useScores: args => { scoreCalls.push(args); const week = args.week || 3; return { week, rows: week === 3 ? rows(120, 80) : rows(0, 0), error: null, refresh() {} }; },
            rosterPoints: r => r.custom_points ?? r.points, supported: () => true,
        }, LeagueLiveTable: { loadHistory: args => new Promise((resolve, reject) => history.push({ ...args, resolve, reject })) } },
        WrWireCalendar: {
            load: args => new Promise((resolve, reject) => calendar.push({ ...args, resolve, reject })),
            period: (league, value) => ({ start: 1, end: value.completedWeek, week: value.completedWeek + 1, live: true, provisional: value.provisional }),
        },
    };
    const ctx = { window, React, console, setTimeout: fn => { const id = {}; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id), setInterval: fn => { const id = {}; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id) };
    vm.createContext(ctx);
    for (const name of ['league-wire-reading', 'league-wire-journal']) vm.runInContext(fs.readFileSync(`js/shared/${name}.js`, 'utf8'), ctx);
    window.WrWireStories.loadArchive = async () => ({ seasons: [], complete: true });
    vm.runInContext(source, ctx);
    const props = { currentLeague: { league_id: 'one', name: 'League One', season: '2026', settings: { playoff_week_start: 15 }, rosters: [{ roster_id: 1, owner_id: 'a' }, { roster_id: 2, owner_id: 'b' }], users: [{ user_id: 'a', display_name: 'Alpha' }, { user_id: 'b', display_name: 'Beta' }] }, transactions: [] };
    return { history, calendar, scoreCalls, window, render() { cursor = 0; tree = window.WrLeagueWire(props); return tree; }, effects() { while (effects.length) effects.shift()(); },
        open() { nodes(tree).find(n => ['wr-wire-brand', 'wr-wire-mobile-launch'].includes(n.props.className)).props.onClick(); },
        tick() { [...intervals.values()].forEach(fn => fn()); }, visible() { [...listeners].forEach(fn => fn()); }, owner(value) { owner = value; }, unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}
(async () => {
    const app = harness(); app.render(); app.effects(); await settle();
    assert.equal(app.calendar.length, 1); assert.equal(app.history[0].week, 3, 'initial fallback only reads completed calendar weeks');
    app.history[0].resolve({ priorWeeks: weeks.slice(0, 2), updatedAt: 1000 }); await settle();
    app.render(); app.open(); app.render(); app.effects(); await settle();
    // Opening cancels the earlier calendar request and checks the edition afresh.
    const completion = { nfl: app.window.S.nflState, completedWeek: 3, provisional: true, checkedAt: 2000 };
    app.calendar.at(-1).resolve(completion); await settle();
    let tree = app.render(); app.effects(); await settle();
    assert.equal(app.history.at(-1).week, 4, 'NFL finals permit this week in the history request before calendar rollover');
    assert.match(text(tree), /Week 2 edition/, 'last readable edition stays visible while its replacement loads');
    assert(app.scoreCalls.some(call => call.week === 4 && call.enabled), 'upcoming previews request a separate Week 4 board');
    app.history.at(-1).resolve({ priorWeeks: weeks, updatedAt: 3000 }); await settle(); tree = app.render();
    assert.match(text(tree), /Week 3 edition/); assert.match(text(tree), /Week 4 matchups/);
    assert.match(text(tree), /All NFL games are final.*stat corrections can still change the scores/);
    const scoreStrip = nodes(tree).find(n => n.props.className === 'wr-journal-scorestrip');
    assert(scoreStrip && /120\.00/.test(text(scoreStrip)), 'actual score rail keeps Week 3 totals rather than upcoming zeros');
    nodes(tree).find(n => n.type === 'button' && text(n) === 'This week').props.onClick(); tree = app.render();
    assert.match(text(tree), /WK 4.*MATCHUP PREVIEW|WK 4.*MATCHUP TO WATCH/);
    nodes(tree).find(n => n.type === 'button' && text(n) === 'Stories').props.onClick(); tree = app.render();
    app.window.document.hidden = true; const hiddenHistory = app.history.length, hiddenCalendar = app.calendar.length; app.tick();
    assert.equal(app.history.length, hiddenHistory); assert.equal(app.calendar.length, hiddenCalendar, 'background views do not poll');
    app.window.document.hidden = false; app.visible(); await settle();
    assert.equal(app.history.length, hiddenHistory + 1); assert.equal(app.calendar.length, hiddenCalendar + 1);
    assert.equal(app.history.at(-1).force, true, 'visibility refresh bypasses the completed-score cache for corrections');
    const corrected = [...weeks.slice(0, 2), { week: 3, rows: rows(75, 80) }];
    app.history.at(-1).resolve({ priorWeeks: corrected, updatedAt: 4000 }); await settle(); tree = app.render();
    assert.match(text(tree), /Beta ended a 3-game winning streak for Alpha|Beta beat Alpha 80\.00–75\.00/, 'fresh corrected totals rewrite the edition');
    const oldCalendar = app.calendar.at(-1); app.owner('account:b'); tree = app.render();
    assert.doesNotMatch(text(tree), /Beta ended a 3-game winning streak/, 'an account switch immediately hides old reporting');
    app.effects(); assert(oldCalendar.signal.aborted, 'scope changes cancel calendar work');
    oldCalendar.resolve({ ...completion, completedWeek: 9 }); await settle(); tree = app.render(); assert.doesNotMatch(text(tree), /Week 9 edition/, 'late calendar response cannot leak across accounts');
    app.unmount(); assert(app.history.at(-1).signal.aborted); assert(app.calendar.at(-1).signal.aborted);
    const phone = harness(true); phone.render(); phone.effects(); await settle(); assert.equal(phone.calendar.length, 0); assert.equal(phone.history.length, 0, 'collapsed phone launcher avoids background edition work');
    phone.open(); phone.render(); phone.effects(); assert.equal(phone.calendar.length, 1); assert.equal(phone.history.length, 1); phone.unmount();
    console.log('PASS single Wire rollover: early results, independent previews, retained editions, corrections, visibility polling, account isolation and cancellation');
})().catch(error => { console.error(error); process.exitCode = 1; });
