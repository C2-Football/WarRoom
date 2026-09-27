'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), babel = require('@babel/standalone');
const compiled = babel.transform(fs.readFileSync('js/components/league-wire-features.js', 'utf8'), { presets: ['react'] }).code;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { resolve, reject, promise }; };
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const nodes = node => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(nodes)] : [];
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : (node.children || []).map(text).join(' ').replace(/\s+/g, ' ');
function harness(props) {
    let cursor = 0, tree, account = 'account-a', timerId = 0;
    const slots = [], pending = [], timers = new Map(), requests = [];
    const React = {
        createElement: (type, attributes, ...children) => ({ type, props: attributes || {}, children: children.flat(Infinity) }),
        useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
        useRef: value => { const i = cursor++; if (!(i in slots)) slots[i] = { current: value }; return slots[i]; },
        useEffect: (fn, deps) => { const i = cursor++, prior = slots[i]; if (!prior || deps.some((value, n) => value !== prior.deps[n])) { slots[i] = { deps, cleanup: prior?.cleanup }; pending.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); }); } },
    };
    const window = { AbortController, App: { AccountStorage: { owner: () => account } }, WrWireReading: { paragraphs: body => body.split('\n\n') } };
    const context = { React, window, console, setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) };
    vm.createContext(context); vm.runInContext(fs.readFileSync('js/shared/league-wire-draft-history.js', 'utf8'), context);
    window.WrWireDraftHistory.load = args => { const item = { ...args, ...deferred() }; requests.push(item); return item.promise; };
    vm.runInContext(compiled, context);
    return {
        requests,
        render(update = {}) { props = { ...props, ...update }; cursor = 0; tree = context.WrWireDraftReceipts(props); return tree; },
        effects() { while (pending.length) pending.shift()(); },
        click(label) { const node = nodes(tree).find(node => node.type === 'button' && text(node).includes(label)); assert(node, 'Button exists: ' + label); node.props.onClick(); },
        select(label, value) { nodes(tree).find(node => node.props['aria-label'] === label).props.onChange({ target: { value } }); },
        account(value) { account = value; },
        timeout() { [...timers.values()].filter(timer => timer.ms === 30000).forEach(timer => timer.fn()); },
        unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    };
}
const league = { league_id: '123', season: '2026', rosters: [{ roster_id: 1, owner_id: 'a' }, { roster_id: 2, owner_id: 'b' }] };
const makeStory = (id, year, ownerId, rosterId, type = 'value') => ({ id, season: String(year), leagueId: year === 2026 ? '123' : '122', featureType: type, text: 'Receipt ' + id, body: 'Starting-lineup evidence for ' + id, participants: [{ ownerId, ownerName: ownerId === 'a' ? 'Alice' : 'Bob', rosterId: String(rosterId), teamName: id }], sources: [], related: [] });
const result = { status: 'ready', message: '', stories: [makeStory('Alice now', 2026, 'a', 1), makeStory('Alice then', 2025, 'a', 9), makeStory('Bob workload', 2026, 'b', 2, 'workload')],
    ownerHistories: [{ ownerId: 'a', ownerName: 'Alice', seasons: [{ season: '2025', leagueId: '122', throughWeek: 14, teamName: 'Earlier identity', picks: [{ name: 'Verified Player', playerId: 'p', pick: 7, round: 1, position: 'WR', points: -4, starts: 4, average: -1 }], sources: [] }] }],
    checkedSeasons: [{ season: '2026', status: 'checked' }, { season: '2025', status: 'checked' }], progress: { checked: 2, total: 2, available: 10, remaining: 8 }, coverage: ['Verified scope.'] };
(async () => {
    const app = harness({ league, throughWeek: 4 }); let tree = app.render(); app.effects(); await settle();
    assert.equal(app.requests.length, 0, 'opening League Life never automatically downloads drafts');
    app.click('Open draft receipts'); app.render(); app.effects(); await settle();
    assert.equal(app.requests.length, 1); assert.equal(app.requests[0].maxSeasons, 8);
    app.requests[0].onProgress({ ...result, status: 'loading' }); tree = app.render();
    assert.equal(nodes(tree).filter(node => node.type === 'article').length, 3, 'verified receipts appear during progressive loading');
    tree = app.render({ search: 'nothing matches' });
    assert.equal(nodes(tree).filter(node => node.type === 'article').length, 0, 'search masks already-loaded receipts synchronously');
    app.requests[0].onProgress({ ...result, status: 'loading' }); tree = app.render();
    assert.equal(nodes(tree).filter(node => node.type === 'article').length, 0, 'later progress cannot bypass the active search');
    tree = app.render({ search: '', ownerFilter: { ownerId: 'a', rosterId: 1 } });
    assert.equal(nodes(tree).filter(node => node.type === 'article').length, 2, 'same owner follows a different historical roster ID');
    assert.match(text(tree), /Alice\s*’s draft notebook/); assert.match(text(tree), /Earlier identity/); assert.match(text(tree), /-4.00/);
    tree = app.render({ ownerFilter: { ownerId: null, rosterId: 1 } });
    assert.equal(nodes(tree).filter(node => node.type === 'article').length, 1, 'unknown ownership never matches a historical roster number');
    app.requests[0].resolve(result); await settle(); app.render({ ownerFilter: null });
    app.select('Draft receipt type', 'workload'); tree = app.render(); assert.equal(nodes(tree).filter(node => node.type === 'article').length, 1);
    assert.match(text(tree), /Bob workload/); assert.doesNotMatch(text(tree), /Receipt Alice/);
    app.select('Draft receipt type', 'all'); app.render(); app.select('Draft receipt season', '2025'); tree = app.render();
    assert.equal(nodes(tree).filter(node => node.type === 'article').length, 1); assert.match(text(tree), /Alice then/);
    app.select('Draft receipt season', 'all'); app.render(); app.select('Draft receipt owner', 'a'); tree = app.render();
    assert.match(text(tree), /Alice\s*’s draft notebook/); assert.equal(nodes(tree).filter(node => node.type === 'article').length, 2);
    app.click('Check 8 older'); app.render(); app.effects(); await settle();
    assert.equal(app.requests[1].maxSeasons, 16); assert.equal(app.requests[1].force, false, 'older expansion reuses checked draft metadata');
    app.requests[1].resolve({ ...result, progress: { ...result.progress, remaining: 0 } }); await settle(); app.render();
    app.click('Refresh draft receipts'); app.render(); app.effects(); await settle();
    assert.equal(app.requests[2].force, true); app.requests[2].onProgress({ status: 'loading', stories: [], ownerHistories: [], message: 'Checking again' });
    app.timeout(); tree = app.render(); assert.match(text(tree), /Previously checked receipts remain/); assert.equal(nodes(tree).filter(node => node.type === 'article').length, 2);
    assert(app.requests[2].signal.aborted); app.requests[2].resolve({ ...result, stories: [] }); await settle(); tree = app.render();
    assert.equal(nodes(tree).filter(node => node.type === 'article').length, 2, 'late completion after timeout cannot erase saved receipts');
    app.render({ priorSeasons: [{ league: { league_id: '122', season: '2025' }, weeks: [] }] }); app.effects(); await settle();
    assert.equal(app.requests.length, 4, 'new loaded archive evidence rechecks an already-open receipt desk');
    assert.equal(app.requests[3].force, false, 'an input update does not inherit the last manual force-refresh');
    app.account('account-b'); tree = app.render(); assert.equal(nodes(tree).filter(node => node.type === 'article').length, 0, 'account scope hides all old receipts before cleanup effects');
    app.effects(); await settle(); assert(app.requests[3].signal.aborted);
    app.requests[3].onProgress(result); app.requests[3].resolve(result); await settle(); tree = app.render();
    assert.equal(nodes(tree).filter(node => node.type === 'article').length, 0, 'late results cannot escape account scope');
    assert.match(text(tree), /Open draft receipts/); app.unmount();
    console.log('PASS draft receipt UI: lazy/progressive loading, immediate search/owner scopes, historical identity, local controls, evidence refresh, timeout retention and account cancellation');
})().catch(error => { console.error(error); process.exitCode = 1; });
