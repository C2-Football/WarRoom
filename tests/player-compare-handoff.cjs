'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const shell = fs.readFileSync('js/league-detail.js', 'utf8');
const compare = fs.readFileSync('js/tabs/compare.js', 'utf8');
const helperStart = shell.indexOf('(function installPlayerCompareHandoff()');
const helper = shell.slice(helperStart, shell.indexOf('\n    })();', helperStart) + '\n    })();'.length);
const senderStart = shell.indexOf('window.wrComparePlayers =');
const sender = shell.slice(senderStart, shell.indexOf('\n        };', senderStart) + '\n        };'.length);
const initializers = compare.slice(compare.indexOf('function CompareTab('), compare.indexOf("    const [playerQuery"))
    + '\nreturn { scope: compareScope, players: comparePlayerIds };\n}';
const effectStart = compare.indexOf('    // Scoped replacements seed');
const effect = compare.slice(effectStart, compare.indexOf('    }, [playerHandoffScope, playersData]);', effectStart) + '    }, [playerHandoffScope, playersData]);'.length);
const legacyStart = compare.indexOf('    // Players mode deep-link');
const legacyEffect = compare.slice(legacyStart, compare.indexOf('    }, []);', legacyStart) + '    }, []);'.length);
const plain = value => JSON.parse(JSON.stringify(value));

function setup() {
    let account = 'account:one';
    const handlers = new Map(), timers = [], writes = [], navigation = [], storage = new Map();
    const observed = { scope: 'duel', players: ['old1', 'old2', 'old3', 'old4'], replacements: 0 };
    const currentLeague = { league_id: 'league-one', season: '2026' };
    const playersData = Object.fromEntries(['incoming', 'outgoing', 'other', 'old1', 'old2', 'old3', 'old4'].map(pid => [pid, { full_name: pid }]));
    storage.set('wr_compare_players_league-one', JSON.stringify(observed.players));
    const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => { writes.push([key, value]); storage.set(key, value); } };
    const window = { App: {}, WR: { WaiverPlans: { account: () => account } }, S: { currentLeagueId: 'league-one', platform: 'sleeper' },
        addEventListener(name, handler) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(handler); },
        removeEventListener(name, handler) { handlers.get(name)?.delete(handler); },
        dispatchEvent(event) { [...(handlers.get(event.type) || [])].forEach(handler => handler(event)); },
    };
    const React = { useState: init => [typeof init === 'function' ? init() : init, () => {}], useReducer: (_fn, initial) => [initial, () => {}], useMemo: fn => fn(), useEffect: fn => fn() };
    const ctx = vm.createContext({ window, currentLeague, playersData, sleeperUserId: 'owner', localStorage, React,
        CustomEvent: function (type, options) { this.type = type; this.detail = options.detail; },
        setTimeout: fn => timers.push(fn), setActiveTab: tab => navigation.push(tab),
        setCompareScope: next => { observed.scope = next; },
        setComparePlayerIds: next => { observed.players = plain(typeof next === 'function' ? next(observed.players) : next); observed.replacements++; },
    });
    vm.runInContext(helper, ctx); vm.runInContext(sender, ctx); vm.runInContext(initializers, ctx);
    const options = () => ({ replace: true, ...window.WR.PlayerCompareHandoff.context(currentLeague, 'owner'), source: 'roster-waiver-lens' });
    const mount = () => vm.runInContext('const playerHandoff = window.WR.PlayerCompareHandoff; const playerHandoffScope = "fixture";\n' + effect, ctx);
    const initial = (league = currentLeague) => plain(ctx.CompareTab({ currentLeague: league, playersData, sleeperUserId: 'owner', statsData: {}, stats2025Data: {} }));
    return { ctx, window, currentLeague, playersData, observed, writes, storage, navigation, options, mount, initial,
        flush: () => { while (timers.length) timers.shift()(); }, account: value => { account = value; },
        replace: (ids, opts = options()) => window.wrComparePlayers(ids, opts),
    };
}

// The sender and receiver below are extracted production code, including the
// actual Compare state initializers and mounted replacement effect.
let env = setup();
assert.equal(env.replace(['outgoing', 'incoming']), true);
assert.deepEqual(env.navigation, ['compare']);
assert.equal(env.writes.length, 0, 'A lazy handoff does not prewrite a league-only selection before its scope is checked');
env.flush();
assert.deepEqual(env.initial(), { scope: 'players', players: ['outgoing', 'incoming'] }, 'A lazy mount replaces a full saved list with the exact proposed pair');
env.mount(); env.flush();
assert.deepEqual(env.observed.players, ['outgoing', 'incoming']);
assert.equal(env.observed.scope, 'players');
assert.equal(env.observed.replacements, 1, 'Lazy mount and delayed dispatch cannot apply the intent twice');
assert.equal(env.window._wrPlayerCompareTarget, undefined);

env = setup(); env.mount();
assert.equal(env.replace(['incoming', 'incoming']), true); env.flush();
assert.deepEqual(env.observed.players, ['incoming'], 'An open roster spot can compare one incoming player');
assert.equal(env.observed.scope, 'players');
assert.equal(env.replace(['outgoing', 'incoming']), true); env.flush();
assert.deepEqual(env.observed.players, ['outgoing', 'incoming'], 'An already-mounted comparison also replaces a full or previous list');

env = setup(); env.mount();
env.replace(['outgoing', 'incoming']);
const older = env.window._wrPlayerCompareTarget;
env.replace(['other', 'incoming']);
env.window.dispatchEvent({ type: 'wr:replace-compare-players', detail: older });
assert.equal(env.observed.replacements, 0, 'An older queued event cannot overwrite a newer pending choice');
env.flush();
assert.deepEqual(env.observed.players, ['other', 'incoming']);
assert.equal(env.observed.replacements, 1);

for (const [field, value] of [['accountKey', 'account:other'], ['leagueId', 'league-other'], ['season', '2025'], ['platform', 'mfl']]) {
    env = setup();
    assert.equal(env.replace(['incoming'], { ...env.options(), [field]: value }), false, field + ' mismatch rejects before navigation');
    assert.equal(env.navigation.length, 0); assert.equal(env.writes.length, 0);
    assert.equal(env.window._wrPlayerCompareTarget, undefined);
}
for (const change of [env => env.account('account:other'), env => { env.window.S.currentLeagueId = 'league-other'; },
    env => { env.window.S.platform = 'mfl'; }, env => { env.currentLeague.season = '2027'; }]) {
    env = setup(); env.mount(); env.replace(['outgoing', 'incoming']); change(env); env.flush();
    assert.equal(env.observed.replacements, 0, 'An account, active league, platform or season change blocks the delayed event');
    assert.notDeepEqual(env.initial().players, ['outgoing', 'incoming'], 'A stale pending pair cannot seed a lazy Compare mount');
}
env = setup(); env.replace(['outgoing', 'incoming']); env.account('account:other'); env.mount();
assert.equal(env.observed.replacements, 0); assert.equal(env.window._wrPlayerCompareTarget, undefined, 'A rejected stale intent is discarded');
env = setup(); env.replace(['outgoing', 'incoming']); env.account('account:other');
env.window.WR.PlayerCompareHandoff.discardStale(env.currentLeague, 'owner');
assert.equal(env.window._wrPlayerCompareTarget, undefined, 'The shell drops a stale intent when it exposes navigation for a new context');

env = setup();
for (const ids of [[], [null, '', '0'], ['missing']]) {
    assert.equal(env.replace(ids), false); assert.equal(env.navigation.length, 0);
}
env.replace(['outgoing', 'incoming']);
env.ctx.localStorage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
assert.deepEqual(env.initial(), { scope: 'players', players: ['outgoing', 'incoming'] }, 'A verified pair survives unavailable browser storage');

env = setup(); env.storage.set('wr_compare_players_league-one', JSON.stringify(['outgoing']));
assert.equal(env.window.wrComparePlayers('incoming'), true);
assert.deepEqual(JSON.parse(env.storage.get('wr_compare_players_league-one')), ['outgoing', 'incoming'], 'The player card single-player API remains additive');
assert.equal(env.window._wrAddComparePlayer, 'incoming');
env.observed.players = env.initial().players;
vm.runInContext(legacyEffect, env.ctx); env.flush();
assert(env.observed.players.includes('incoming'));
assert.equal(env.observed.players.filter(pid => pid === 'incoming').length, 1, 'Legacy lazy/event paths remain deduplicated');

env = setup(); env.mount();
env.window.wrComparePlayers('other'); env.replace(['outgoing', 'incoming']); env.flush();
assert.deepEqual(env.observed.players, ['outgoing', 'incoming'], 'A superseded single-player timer cannot contaminate the exact lens pair');
env = setup(); env.ctx.setActiveTab = () => { throw Error('navigation unavailable'); };
assert.equal(env.replace(['outgoing', 'incoming']), false, 'Unexpected navigation failure reports failure to the lens');
assert.equal(env.window._wrPlayerCompareTarget, undefined, 'An unsuccessful navigation leaves no deferred replacement to replay later');
console.log('PASS player comparison handoff: exact pair/open-slot replacement, lazy/mounted delivery, legacy append, unavailable storage and stale-context rejection');
