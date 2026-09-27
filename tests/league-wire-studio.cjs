'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/standalone');
const compiled = babel.transform(fs.readFileSync('js/components/league-wire-studio.js', 'utf8'), { presets: ['react'] }).code;
const nodes = node => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(nodes)] : [];
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : node.type?.name === 'WrWireStudioTeamName' ? text(node.type(node.props)) : (node.children || []).map(text).join(' ').replace(/\s+/g, ' ');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness(name, props, load = async () => ({ status: 'empty', rounds: [], paths: [] })) {
    let cursor = 0, tree, closed = 0, focused = 0, shown = 0, timerId = 0;
    const slots = [], pending = [], timers = new Map();
    const dialog = { showModal: () => shown++ };
    const React = {
        createElement: (type, attributes, ...children) => {
            if (type === 'dialog' && attributes.ref) attributes.ref.current = dialog;
            return { type, props: attributes || {}, children: children.flat(Infinity) };
        },
        Fragment: 'fragment',
        useId: () => { cursor++; return ':studio-test:'; },
        useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
        useRef: initial => { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
        useEffect: (fn, deps) => {
            const i = cursor++, prior = slots[i];
            if (!prior || deps.some((value, n) => value !== prior.deps[n])) {
                slots[i] = { deps, cleanup: prior?.cleanup };
                pending.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); });
            }
        },
    };
    const window = { AbortController, WrWirePlayoffs: { load }, requestAnimationFrame: fn => fn() };
    const context = { React, window, document: { activeElement: { isConnected: true, focus: () => focused++ } }, console,
        setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) };
    vm.createContext(context); vm.runInContext(fs.readFileSync('js/shared/league-wire-playoffs.js', 'utf8'), context); window.WrWirePlayoffs.load = load; vm.runInContext(compiled, context);
    props = { onClose: () => closed++, ...props };
    return {
        render(update) { if (update) props = { ...props, ...update }; cursor = 0; tree = context[name](props); return tree; },
        effects() { while (pending.length) pending.shift()(); },
        unmount() { slots.forEach(slot => slot?.cleanup?.()); },
        timeout() { [...timers.values()].filter(t => t.ms === 30000).forEach(t => t.fn()); },
        tab(label) { nodes(tree).find(n => n.props.role === 'tab' && text(n) === label).props.onClick(); },
        closed: () => closed, focused: () => focused, shown: () => shown,
    };
}
const league = { league_id: '2026-league', season: '2026', name: 'The One' };
const priorLeague = { league_id: '2025-league', season: '2025', name: 'The One' };
const model = { kind: 'comparison', headline: 'A rivalry with context', eyebrow: 'Rivalry profile', season: 2026, throughWeek: 2,
    teams: [{ name: 'Malcolm', ownerId: 'a', record: '2–2', h2hRecord: '1–1', average: 100 }, { name: 'Brooks', ownerId: 'b', record: '2–2', h2hRecord: '1–1', average: 90 }],
    recordScope: 'Records include median results', series: [
        { id: 'finals', label: 'Title games', scope: '2023–24 finals only', wins: [2, 0], ties: 0, meetings: [
            { id: '2023', label: '2023 final', points: [128.73, 114.2], names: ['Original A', 'Original B'], caption: 'A 14.53-point win.' },
            { id: '2024', label: '2024 final', points: [164.02, 107.07], caption: 'A 56.95-point win.' },
        ] },
        { id: 'regular', label: 'Regular season', scope: 'Verified loaded meetings', wins: [1, 1], ties: 0, meetings: [{ id: 'zero', label: 'Week 1', points: [0, null] }] },
    ], notes: ['Title games are separate from the regular-season series.'], sources: [] };

(async () => {
    const requests = [];
    const app = harness('WrWireStudio', { league, seasons: [{ league: priorLeague }], story: { id: 'story', broadcast: model }, race: { supported: false, rows: [] } }, args => { const d = deferred(); requests.push({ ...args, ...d }); return d.promise; });
    let tree = app.render(); app.effects(); await settle();
    assert.equal(app.shown(), 1);
    assert.equal(requests.length, 0, 'comparison opens without a playoff request');
    assert.equal(nodes(tree).filter(n => n.props.role === 'tab' && n.props.tabIndex === 0).length, 1, 'one roving tab stop');
    let keyPrevented = false, keyFocused = -1;
    const nav = nodes(tree).find(n => n.props.role === 'tablist');
    nav.props.onKeyDown({ key: 'End', preventDefault: () => { keyPrevented = true; }, currentTarget: { querySelectorAll: () => Array.from({ length: 4 }, (_, i) => ({ focus: () => { keyFocused = i; } })) } });
    tree = app.render(); app.effects(); await settle();
    assert(keyPrevented); assert.equal(keyFocused, 3); assert.equal(requests.length, 0, 'Race is also local');
    app.tab('Bracket'); tree = app.render(); app.effects(); await settle();
    assert.equal(requests.length, 1); assert.equal(requests[0].league.league_id, league.league_id);
    requests[0].resolve({ league, season: '2026', status: 'ready', rounds: [{ label: 'Current round', games: [] }], paths: [] }); await settle();
    tree = app.render();
    assert(nodes(tree).some(n => n.type?.name === 'WrWireStudioBracket' && n.props.data.season === '2026'));
    app.tab('Playoff path'); tree = app.render(); app.effects(); await settle();
    assert.equal(requests.length, 1, 'switching bracket/path shares the loaded snapshot');
    nodes(tree).find(n => n.props['aria-label'] === 'Playoff season').props.onChange({ target: { value: '2025-league:2025' } });
    tree = app.render();
    assert(!nodes(tree).some(n => n.type?.name === 'WrWireStudioPath'), 'new season never displays previous season data even before effects');
    app.effects(); await settle(); assert.equal(requests.length, 2);
    app.tab('Comparison'); tree = app.render(); app.effects();
    assert.equal(requests[1].signal.aborted, true, 'inactive playoff fetch aborts');
    requests[1].resolve({ league: priorLeague, season: '2025', status: 'ready', rounds: [], paths: [] }); await settle();
    tree = app.render();
    assert(!nodes(tree).some(n => n.type?.name === 'WrWireStudioPath'), 'late completion cannot change the active comparison');
    let stopped = 0, prevented = 0;
    tree.props.onCancel({ stopPropagation: () => stopped++, preventDefault: () => prevented++ });
    assert.equal(stopped, 1); assert.equal(prevented, 1); assert.equal(app.closed(), 1, 'Escape closes only Studio');
    app.unmount(); assert.equal(app.focused(), 1, 'close restores the connected opener');

    const retries = [];
    const errors = harness('WrWireStudio', { league }, async args => { retries.push(args.force); return retries.length === 1 ? { league, status: 'error', message: 'Scores unavailable' } : { league, status: 'ready', rounds: [], paths: [] }; });
    errors.render(); errors.effects(); await settle(); tree = errors.render();
    assert.match(text(tree), /Scores unavailable/);
    nodes(tree).find(n => n.type === 'button' && text(n) === 'Try again').props.onClick();
    tree = errors.render(); errors.effects(); await settle(); tree = errors.render();
    assert.deepEqual(retries, [false, true]); assert.doesNotMatch(text(tree), /Scores unavailable/);
    const slow = harness('WrWireStudio', { league }, () => new Promise(() => {}));
    slow.render(); slow.effects(); await settle(); slow.timeout(); tree = slow.render();
    assert.match(text(tree), /took too long/); slow.unmount();
    const historical = harness('WrWireStudio', { league, story: { documentary: true, eventSeason: 2020 } });
    tree = historical.render(); assert.match(text(tree), /2020.*whose playoff bracket/);
    const historicalModel = { ...model, playoffSeasons: [{ league_id: 'verified-2024', season: 2024 }] };
    const historic = harness('WrWireStudio', { league, story: { documentary: true, eventSeason: 2024, broadcast: historicalModel }, initialTab: 'path' }, args => { assert.equal(args.league.league_id, 'verified-2024'); return Promise.resolve({ league: args.league, status: 'empty', rounds: [], paths: [] }); });
    tree = historic.render(); historic.effects(); await settle();
    assert.equal(nodes(tree).find(n => n.props['aria-label'] === 'Playoff season').props.value, 'verified-2024:2024');
    historic.unmount(); errors.unmount();

    const comparison = harness('WrWireStudioComparison', { model });
    tree = comparison.render();
    assert.match(text(tree), /2023–24 finals only/); assert.match(text(tree), /Records include median/); assert.match(text(tree), /Season H2H: 1–1/);
    assert.match(text(tree), /164.02/);
    nodes(tree).find(n => n.props['aria-label'] === 'Recorded meeting').props.onChange({ target: { value: '2023' } });
    tree = comparison.render(); assert.match(text(tree), /128.73/); assert.match(text(tree), /Original A/);
    nodes(tree).find(n => n.props['aria-label'] === 'Comparison scope').props.onChange({ target: { value: 'regular' } });
    tree = comparison.render(); assert.match(text(tree), /0.00/); assert.match(text(tree), /—/); assert(!nodes(tree).some(n => n.props.className === 'wr-studio-result-track'), 'missing result never becomes a score graphic');
    assert.doesNotMatch(text(tree), /128.73|164.02/, 'switching scopes never carries the title-game score over');

    const bracket = harness('WrWireStudioBracket', { data: { rounds: [{ label: 'First round', weeks: [15], byes: [{ id: 1, name: 'Steve' }], games: [{ id: 1, status: 'pending', winnerId: 2, note: 'Score not verified', teams: [{ id: 2, name: 'A', points: null }, { id: 3, name: 'B', points: null }] }] }] } });
    tree = bracket.render(); assert.match(text(tree), /Steve · Bye/); assert.match(text(tree), /Awaiting verification/); assert.doesNotMatch(text(tree), /Final|0.00/);
    tree = bracket.render({ data: { provisional: true, rounds: [{ label: 'First round', weeks: [15], byes: [{ id: 1, name: 'Steve' }], games: [{ id: 1, status: 'scheduled', winnerId: 2, teams: [{ id: 2, name: 'A', points: 100 }, { id: 3, name: 'B', points: 90 }] }] }] } });
    assert.match(text(tree), /Provisional playoff bracket/); assert.match(text(tree), /Steve · Provisional bye/); assert.match(text(tree), /Provisional matchup/); assert.doesNotMatch(text(tree), /Scheduled|Bracket winner|100.00|90.00/);
    const pathData = { season: '2025', paths: [{ champion: true, team: { id: 1, name: 'Steve' }, rounds: [{ label: 'First round', weeks: [15], bye: true }, { label: 'Semifinal', weeks: [16], status: 'final', opponent: { name: 'A Kupp of STFU' }, points: [134.98, 102.57] }, { label: 'Championship', weeks: [17], status: 'final', opponent: { name: 'Ivan' }, points: [133.37, 92.4] }] }] };
    const path = harness('WrWireStudioPath', { data: pathData });
    tree = path.render(); assert.match(text(tree), /2025 champion/); assert.match(text(tree), /133.37/); assert.match(text(tree), /92.40/);
    nodes(tree).find(n => n.type === 'button' && text(n).includes('Semifinal')).props.onClick(); tree = path.render(); assert.match(text(tree), /134.98/); assert.match(text(tree), /102.57/);
    nodes(tree).find(n => n.type === 'button' && text(n).includes('First round')).props.onClick(); tree = path.render(); assert.match(text(tree), /First-round bye/); assert.doesNotMatch(text(tree), /133.37|134.98/);
    tree = path.render({ data: { ...pathData, provisional: true } });
    assert.match(text(tree), /A provisional playoff path/); assert.match(text(tree), /Provisional bye/); assert.match(text(tree), /not a confirmed matchup or bye/); assert.doesNotMatch(text(tree), /2025 champion|First-round bye/);
    nodes(tree).find(n => n.type === 'button' && text(n).includes('Semifinal')).props.onClick(); tree = path.render();
    assert.match(text(tree), /Provisional matchup/); assert.doesNotMatch(text(tree), /134.98|102.57|Final/);
    const race = harness('WrWireStudioRace', { season: 2026, race: { supported: false, reason: 'Division rules need confirmation', throughWeek: 0, slots: 6, remainingWeeks: 14, rows: [{ id: 1, name: 'A', record: '0–0', status: 'Record range', minWins: 0, maxWins: 28, needed: 'Includes median wins; tiebreaks still apply.' }] } });
    tree = race.render(); assert.match(text(tree), /Division rules need confirmation/); assert.match(text(tree), /Possible final win total/); assert.match(text(tree), /Includes median wins/); assert.doesNotMatch(text(tree), /Week 0|Clinched/);
    const timeline = harness('WrWireStudioComparison', { model });
    let timelineTree = timeline.render();
    const firstMeeting = nodes(timelineTree).find(n => n.props.className === 'wr-studio-meeting-timeline').children[0];
    nodes(firstMeeting).find(n => n.type === 'button').props.onClick(); timelineTree = timeline.render();
    assert.match(text(timelineTree), /128.73/); assert.match(text(timelineTree), /Original A/);
    const trajectory = harness('WrWireStudioTrajectory', { model: { ...model, trajectory: { season: 2026, startWeek: 1, throughWeek: 2, recordScope: 'Includes median', weeks: [{ week: 1, teams: [{ points: 0, record: '0–2', h2hRecord: '0–1' }, { points: 100, record: '2–0', h2hRecord: '1–0' }] }, { week: 2, teams: [{ points: 90, record: '2–2', h2hRecord: '1–1' }, { points: 80, record: '2–2', h2hRecord: '1–1' }] }] } } });
    let trajectoryTree = trajectory.render(); assert.match(text(trajectoryTree), /After Week 2/);
    nodes(trajectoryTree).find(n => n.type === 'button' && text(n) === 'Week 1').props.onClick(); trajectoryTree = trajectory.render();
    assert.match(text(trajectoryTree), /After Week 1/); assert.match(text(trajectoryTree), /0.00 pts/); assert.match(text(trajectoryTree), /0–2 · H2H 0–1/);
    const scenarioRace = { supported: true, slots: 1, remainingWeeks: 1, futureDecisions: 1, decisionsPerWeek: 1, throughWeek: 3, rows: [{ id: '1', name: 'Alpha', record: '2–1', wins: 2, losses: 1, ties: 0 }, { id: '2', name: 'Bravo', record: '1–2', wins: 1, losses: 2, ties: 0 }] };
    const scenarioView = harness('WrWireStudioRace', { race: scenarioRace, season: 2026 });
    let scenarioTree = scenarioView.render(); assert.match(text(scenarioTree), /Still depends on the field/);
    nodes(scenarioTree).find(n => n.props['aria-label'] === 'Additional wins').props.onChange({ target: { value: '1' } }); scenarioTree = scenarioView.render();
    assert.match(text(scenarioTree), /3–1/); assert.match(text(scenarioTree), /Top record secured/);
    nodes(scenarioTree).find(n => n.props['aria-label'] === 'Race scenario team').props.onChange({ target: { value: '2' } }); scenarioTree = scenarioView.render();
    assert.match(text(scenarioTree), /1–3/); assert.match(text(scenarioTree), /Outside by record/);
    scenarioTree = scenarioView.render({ race: { ...scenarioRace, supported: false, reason: 'Custom seeding' } });
    assert.match(text(scenarioTree), /Record only/); assert.doesNotMatch(text(scenarioTree), /Record-based finish bounds|Top record secured/);
    const connectedBracket = harness('WrWireStudioBracket', { data: { rounds: [{ label: 'Semifinal', games: [{ id: 's', teams: [], nextGames: [{ id: 'f', label: 'Championship' }] }] }, { label: 'Championship', games: [{ id: 'f', teams: [], fromGames: [{ id: 's', label: 'Semifinal' }] }] }] } });
    let connectedTree = connectedBracket.render(); nodes(connectedTree).find(n => n.type === 'button' && text(n).includes('Winner →')).props.onClick(); connectedTree = connectedBracket.render();
    assert(nodes(connectedTree).some(n => n.type === 'article' && n.props.className.includes('is-selected') && n.props.id.endsWith('-f')));
    console.log('PASS Studio interactions: timeline replay, trajectory week inspection, bracket connections and conservative race slider');
    console.log('PASS Wire Studio: lazy requests, scoped seasons, cancellation, retry/timeout, keyboard tabs, focus/Escape, comparisons, byes, verified scores and conservative race ranges');
})().catch(error => { console.error(error); process.exitCode = 1; });

const ownerLabels = harness('WrWireStudioTeamName', { team: { name: 'A rotating team name', ownerName: 'Malcolm Wohler' }, ownerFirst: true });
assert.equal(text(ownerLabels.render()), 'Malcolm Wohler A rotating team name');
assert.equal(text(ownerLabels.render({ ownerFirst: false })), 'A rotating team name Malcolm Wohler');
