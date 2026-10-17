'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/standalone');
const compiled = babel.transform(fs.readFileSync('js/components/league-wire-studio.js', 'utf8'), { presets: ['react'] }).code;
const nodes = node => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(nodes)] : [];
const visibleNodes = node => node && typeof node === 'object' && !node.props?.hidden ? [node, ...(node.children || []).flatMap(visibleNodes)] : [];
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : node.type?.name === 'WrWireStudioTeamName' ? text(node.type(node.props)) : (node.children || []).map(text).join(' ').replace(/\s+/g, ' ');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness(name, props, load = async () => ({ status: 'empty', rounds: [], paths: [] })) {
    let cursor = 0, tree, closed = 0, focused = 0, shown = 0, timerId = 0;
    const slots = [], pending = [], timers = new Map(), focusedIds = [], scrollCalls = [];
    const dialog = { showModal: () => shown++ };
    const React = {
        createElement: (type, attributes, ...children) => {
            if (type === 'dialog' && attributes.ref) attributes.ref.current = dialog;
            if (type === 'section' && attributes?.ref) attributes.ref.current = { scrollTo: options => scrollCalls.push(options) };
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
    const context = { React, window, document: {
        activeElement: { isConnected: true, focus: () => focused++ },
        getElementById: id => visibleNodes(tree).some(node => node.props.id === id) ? { focus: () => focusedIds.push(id), scrollIntoView() {} } : null,
    }, console,
        setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) };
    vm.createContext(context); vm.runInContext(fs.readFileSync('js/shared/league-wire-playoffs.js', 'utf8'), context); window.WrWirePlayoffs.load = load; vm.runInContext(compiled, context);
    props = { onClose: () => closed++, ...props };
    return {
        render(update) { if (update) props = { ...props, ...update }; cursor = 0; tree = context[name](props); return tree; },
        effects() { while (pending.length) pending.shift()(); },
        unmount() { slots.forEach(slot => slot?.cleanup?.()); },
        timeout() { [...timers.values()].filter(t => t.ms === 30000).forEach(t => t.fn()); },
        tab(label) { nodes(tree).find(n => n.props.role === 'tab' && text(n) === label).props.onClick(); },
        closed: () => closed, focused: () => focused, focusedIds: () => [...focusedIds], scrollCalls: () => [...scrollCalls], shown: () => shown,
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
    const scrollPanel = nodes(tree).find(n => n.props.role === 'tabpanel');
    assert(!nodes(scrollPanel).some(n => n.props.className === 'wr-studio-mast' || n.props.role === 'tablist'), 'the masthead and view tabs stay outside the scrolling content panel');
    assert.equal(app.scrollCalls().at(-1).top, 0);
    assert.equal(requests.length, 0, 'comparison opens without a playoff request');
    assert.equal(nodes(tree).filter(n => n.props.role === 'tab' && n.props.tabIndex === 0).length, 1, 'one roving tab stop');
    let keyPrevented = false, keyFocused = -1;
    const nav = nodes(tree).find(n => n.props.role === 'tablist');
    nav.props.onKeyDown({ key: 'End', preventDefault: () => { keyPrevented = true; }, currentTarget: { querySelectorAll: () => Array.from({ length: 4 }, (_, i) => ({ focus: () => { keyFocused = i; } })) } });
    tree = app.render(); app.effects(); await settle();
    assert(keyPrevented); assert.equal(keyFocused, 3); assert.equal(requests.length, 0, 'Race is also local');
    assert(app.scrollCalls().length >= 2, 'changing views returns the content panel to its beginning');
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

    const seasonRequests = [];
    const seasonView = harness('WrWireStudio', { league, seasons: [{ league: priorLeague }] }, async args => {
        seasonRequests.push(args.league.league_id);
        return { league: args.league, season: args.league.season, status: 'ready', rounds: [], paths: [], notes: [args.league.season + ' verified edition'], sources: [{ label: args.league.season + ' bracket', url: 'https://api.sleeper.app/v1/league/' + args.league.league_id + '/winners_bracket' }] };
    });
    seasonView.render(); seasonView.effects(); await settle(); let seasonTree = seasonView.render();
    const currentBracket = nodes(seasonTree).find(n => n.type?.name === 'WrWireStudioBracket');
    assert.equal(currentBracket.props.key, '2026-league:2026', 'a season-specific key resets child round and team selection');
    nodes(seasonTree).find(n => n.props['aria-label'] === 'Playoff season').props.onChange({ target: { value: '2025-league:2025' } });
    seasonTree = seasonView.render();
    assert(!nodes(seasonTree).some(n => n.type?.name === 'WrWireStudioBracket'), 'a season change hides the previous edition before loading effects');
    seasonView.effects(); await settle(); seasonTree = seasonView.render();
    const priorBracket = nodes(seasonTree).find(n => n.type?.name === 'WrWireStudioBracket');
    assert.equal(priorBracket.props.key, '2025-league:2025'); assert.equal(priorBracket.props.ownerFirst, true);
    const priorSources = nodes(seasonTree).find(n => n.type?.name === 'WrWireStudioSources');
    assert(priorSources.props.sources.every(source => source.label.startsWith('2025')), 'the selected season carries only its own provenance');
    nodes(seasonTree).find(n => n.props['aria-label'] === 'Playoff season').props.onChange({ target: { value: '2026-league:2026' } });
    seasonView.render(); seasonView.effects(); await settle(); seasonTree = seasonView.render();
    assert.equal(nodes(seasonTree).find(n => n.type?.name === 'WrWireStudioBracket').props.key, currentBracket.props.key);
    assert.deepEqual(seasonRequests, ['2026-league', '2025-league'], 'returning to a loaded season uses only its matching cached edition');
    seasonView.unmount();
    const mismatchedSeason = harness('WrWireStudio', { league }, async () => ({ league: priorLeague, status: 'ready', rounds: [], paths: [] }));
    mismatchedSeason.render(); mismatchedSeason.effects(); await settle(); tree = mismatchedSeason.render();
    assert(nodes(tree).some(n => n.props.role === 'alert')); assert(!nodes(tree).some(n => n.type?.name === 'WrWireStudioBracket'), 'a wrong-season response never appears as the selected bracket');
    mismatchedSeason.unmount();
    const provisionalMessage = 'If the season ended today: this field can change; no place is clinched by this snapshot.';
    const provisionalRefresh = [];
    const provisionalView = harness('WrWireStudio', { league }, async args => {
        provisionalRefresh.push(args.force);
        if (args.force) throw Error('Temporary score outage');
        return { league, season: '2026', status: 'ready', provisional: true, checkedAt: 1700000000000, message: provisionalMessage, notes: [provisionalMessage], sources: [{ label: 'Current official bracket', url: 'https://api.sleeper.app/v1/league/123/winners_bracket' }], rounds: [], paths: [] };
    });
    provisionalView.render(); provisionalView.effects(); await settle(); let provisionalTree = provisionalView.render();
    const snapshotBadges = nodes(provisionalTree).filter(n => n.props.className?.includes('wr-studio-edition-status'));
    assert.equal(snapshotBadges.length, 1); assert.match(text(snapshotBadges[0]), /Provisional field.*Places and byes can change/);
    assert.doesNotMatch(text(provisionalTree), /no place is clinched|Checked/, 'the compact visible status keeps detailed timing and scope in its disclosure');
    const snapshotSourceProps = nodes(provisionalTree).find(n => n.type?.name === 'WrWireStudioSources').props;
    const snapshotDisclosure = harness('WrWireStudioSources', snapshotSourceProps).render();
    assert.equal((text(snapshotDisclosure).match(/no place is clinched/g) || []).length, 1, 'message and notes retain one copy of the same provisional explanation');
    assert.match(text(snapshotDisclosure), /Checked/); assert.match(text(snapshotDisclosure), /Current official bracket/);
    nodes(provisionalTree).find(n => n.props['aria-label'] === 'Refresh playoffs').props.onClick(); provisionalView.render(); provisionalView.effects(); await settle(); provisionalTree = provisionalView.render();
    assert.deepEqual(provisionalRefresh, [false, true]); assert.match(text(provisionalTree), /Temporary score outage.*last available edition/);
    assert.equal(nodes(provisionalTree).find(n => n.type?.name === 'WrWireStudioBracket').props.data.checkedAt, 1700000000000, 'a failed refresh retains the same snapshot timestamp');
    assert.deepEqual(nodes(provisionalTree).find(n => n.type?.name === 'WrWireStudioSources').props.sources, snapshotSourceProps.sources, 'a failed refresh cannot relabel the retained edition’s sources');
    provisionalView.unmount();
    for (const issue of [
        { status: 'partial', message: 'The NFL calendar could not be verified. Advancement and final scores are withheld until timing can be checked.' },
        { status: 'unsupported', message: 'This playoff structure is not yet verified for bracket coverage.' },
    ]) {
        const limitedView = harness('WrWireStudio', { league }, async () => ({ league, season: '2026', provisional: true, rounds: [], paths: [], notes: [], sources: [], ...issue }));
        limitedView.render(); limitedView.effects(); await settle(); const limitedTree = limitedView.render();
        assert(nodes(limitedTree).some(n => n.props.className === 'wr-studio-notice' && text(n) === issue.message), 'a provisional field must not hide calendar or unsupported-format limitations inside its disclosure');
        assert(nodes(limitedTree).some(n => n.type?.name === 'WrWireStudioSources' && n.props.notes.includes(issue.message)), 'the visible limitation also remains part of the edition provenance');
        limitedView.unmount();
    }

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
    tree = bracket.render(); assert.match(text(tree), /First-round byes.*Steve/); assert.match(text(tree), /Awaiting verification/); assert.doesNotMatch(text(tree), /Final|0.00/);
    assert.match(text(tree), /Advanced/, 'verified advancement remains distinct from an unavailable final score');
    tree = bracket.render({ data: { provisional: true, rounds: [{ label: 'First round', weeks: [15], byes: [{ id: 1, name: 'Steve' }], games: [{ id: 1, status: 'scheduled', winnerId: 2, teams: [{ id: 2, name: 'A', points: 100 }, { id: 3, name: 'B', points: 90 }] }] }] } });
    assert.match(text(tree), /Current byes.*Would enter.*Steve/); assert.doesNotMatch(text(tree), /Scheduled|Bracket winner|Advanced|Through to|100.00|90.00/);
    assert(!nodes(tree).some(n => n.props.className?.includes('is-winner')), 'a provisional provider winner cannot become advancement styling');
    const pathData = { season: '2025', paths: [{ champion: true, team: { id: 1, name: 'Steve' }, rounds: [{ label: 'First round', weeks: [15], bye: true }, { label: 'Semifinal', weeks: [16], status: 'final', opponent: { name: 'A Kupp of STFU' }, points: [134.98, 102.57] }, { label: 'Championship', weeks: [17], status: 'final', opponent: { name: 'Ivan' }, points: [133.37, 92.4] }] }] };
    const path = harness('WrWireStudioPath', { data: pathData });
    tree = path.render(); assert.match(text(tree), /2025 champion/); assert.match(text(tree), /133.37/); assert.match(text(tree), /92.40/);
    nodes(tree).find(n => n.type === 'button' && text(n).includes('Semifinal')).props.onClick(); tree = path.render(); assert.match(text(tree), /134.98/); assert.match(text(tree), /102.57/);
    nodes(tree).find(n => n.type === 'button' && text(n).includes('First round')).props.onClick(); tree = path.render(); assert.match(text(tree), /First-round bye/); assert.doesNotMatch(text(tree), /133.37|134.98/);
    tree = path.render({ data: { ...pathData, provisional: true } });
    assert.match(text(tree), /Bye in this snapshot/); assert.doesNotMatch(text(tree), /2025 champion|First-round bye/);
    nodes(tree).find(n => n.type === 'button' && text(n).includes('Semifinal')).props.onClick(); tree = path.render();
    assert.match(text(tree), /Matchup in the current field/); assert.doesNotMatch(text(nodes(tree).find(n => n.props.className === 'wr-studio-path-result')), /134.98|102.57|Final/);
    const conditionalPath = harness('WrWireStudioPath', { data: { season: '2026', paths: [
        { team: { id: 'one', name: 'Current team', ownerName: 'First owner' }, rounds: [
            { label: 'Semifinal', weeks: [16], status: 'scheduled', opponent: { name: 'Known opponent' }, points: [null, null] },
            { label: 'Championship', weeks: [17], conditional: true, opponent: { name: 'Unconfirmed opponent' }, points: [999, 888] },
        ] },
        { team: { id: 'two', name: 'Other team' }, rounds: [{ label: 'First round', weeks: [15], status: 'final', opponent: { name: 'Earlier opponent' }, points: [0, -1] }] },
    ] } });
    let conditionalTree = conditionalPath.render();
    assert.match(text(conditionalTree), /Known opponent/); assert.doesNotMatch(text(conditionalTree), /Unconfirmed opponent|999|888/, 'the path opens at the latest known round, not a conditional destination');
    nodes(conditionalTree).find(n => n.props.className === 'wr-studio-path-next').props.onClick(); conditionalTree = conditionalPath.render();
    assert.match(text(conditionalTree), /If .*advances/); assert.doesNotMatch(text(conditionalTree), /Unconfirmed opponent|999|888/, 'a conditional route cannot imply the next opponent or score');
    nodes(conditionalTree).find(n => n.props['aria-label'] === 'Playoff path team').props.onChange({ target: { value: 'two' } }); conditionalTree = conditionalPath.render();
    assert.match(text(conditionalTree), /Earlier opponent/); assert.match(text(conditionalTree), /0\.00/); assert.match(text(conditionalTree), /-1\.00/);
    assert.doesNotMatch(text(conditionalTree), /Known opponent|If .*advances/, 'choosing another team resets its selected round and retains valid signed scores');
    const race = harness('WrWireStudioRace', { season: 2026, race: { supported: false, reason: 'Division rules need confirmation', throughWeek: 0, slots: 6, remainingWeeks: 14, rows: [{ id: 1, name: 'A', record: '0–0', status: 'Record range', minWins: 0, maxWins: 28, needed: 'Includes median wins; tiebreaks still apply.' }] } });
    tree = race.render(); assert.match(text(tree), /division or seeding rules/); assert.match(text(tree), /not playoff seeds/);
    assert.doesNotMatch(text(tree), /Week 0|Clinched|Record range|Possible final wins|Includes median wins/);
    assert(nodes(tree).some(n => n.type?.name === 'WrWireStudioSources' && n.props.notes.includes('Division rules need confirmation')), 'the full rule limitation remains available in the source disclosure');
    nodes(tree).find(n => n.props['aria-label'] === 'Explore A’s finish').props.onClick(); tree = race.render();
    assert.match(text(tree), /Possible final wins: 0–28/); assert.match(text(tree), /Includes median wins/);
    assert(!nodes(tree).some(n => n.props['aria-label'] === 'Additional wins'), 'missing future decisions never become zero or fabricated scenario controls');
    const timeline = harness('WrWireStudioComparison', { model });
    let timelineTree = timeline.render();
    const firstMeeting = nodes(timelineTree).find(n => n.props.className === 'wr-studio-meeting-timeline').children[0];
    nodes(firstMeeting).find(n => n.type === 'button').props.onClick(); timelineTree = timeline.render();
    assert.match(text(timelineTree), /128.73/); assert.match(text(timelineTree), /Original A/);
    const timelineModel = { ...model, teams: [{ name: 'First owner' }, { name: 'Ivan Hartung' }], series: [{ id: 'timeline-order', meetings: [
        { id: 'second-team-win', label: '2025 · Week 1', points: [88.50, 117.85], winnerIndex: 1, ownerNames: ['First owner', 'Ivan Hartung'] },
        { id: 'tied-result', label: '2025 · Week 2', points: [100, 100] },
        { id: 'recorded-winner', label: '2025 final', points: [90, 90], winnerIndex: 1 },
        { id: 'missing-score', label: '2024 final', points: [0, null], winnerIndex: 1 },
    ] }] };
    const originalTimelineData = JSON.stringify(timelineModel);
    const orderedTimeline = harness('WrWireStudioComparison', { model: timelineModel });
    let orderedTree = orderedTimeline.render();
    const timelineItems = nodes(orderedTree).find(n => n.props.className === 'wr-studio-meeting-timeline').children;
    assert.match(text(timelineItems[0]), /Ivan Hartung won 117.85–88.50/, 'the winner caption and first timeline score describe the same team');
    assert.match(text(timelineItems[1]), /Tied 100.00–100.00/);
    assert.match(text(timelineItems[2]), /Ivan Hartung · recorded winner Tied · 90.00–90.00/, 'a recorded winner on level points does not invent a scoring win or tiebreak rule');
    assert.match(text(timelineItems[3]), /Ivan Hartung won Score unavailable/, 'known advancement does not turn a missing score into zero');
    nodes(timelineItems[0]).find(n => n.type === 'button').props.onClick(); orderedTree = orderedTimeline.render();
    const mainResultTeams = nodes(orderedTree).find(n => n.props.className === 'wr-studio-result-teams').children;
    assert.match(text(mainResultTeams[0]), /First owner 88.50/);
    assert.match(text(mainResultTeams[1]), /Ivan Hartung 117.85/, 'the main comparison retains its established team order');
    assert.equal(JSON.stringify(timelineModel), originalTimelineData, 'timeline ordering never mutates source scores');
    const trajectory = harness('WrWireStudioTrajectory', { model: { ...model, trajectory: { season: 2026, startWeek: 1, throughWeek: 2, recordScope: 'Includes median', weeks: [{ week: 1, teams: [{ points: 0, record: '0–2', h2hRecord: '0–1' }, { points: 100, record: '2–0', h2hRecord: '1–0' }] }, { week: 2, teams: [{ points: 90, record: '2–2', h2hRecord: '1–1' }, { points: 80, record: '2–2', h2hRecord: '1–1' }] }] } } });
    let trajectoryTree = trajectory.render(); assert.match(text(trajectoryTree), /After Week 2/);
    nodes(trajectoryTree).find(n => n.type === 'button' && text(n) === 'Week 1').props.onClick(); trajectoryTree = trajectory.render();
    assert.match(text(trajectoryTree), /After Week 1/); assert.match(text(trajectoryTree), /0.00 pts/); assert.match(text(trajectoryTree), /0–2 · H2H 0–1/);
    const scenarioRace = { supported: true, slots: 1, remainingWeeks: 1, futureDecisions: 1, decisionsPerWeek: 1, throughWeek: 3, rows: [{ id: '1', name: 'Alpha', record: '2–1', wins: 2, losses: 1, ties: 0 }, { id: '2', name: 'Bravo', record: '1–2', wins: 1, losses: 2, ties: 0 }] };
    const scenarioView = harness('WrWireStudioRace', { race: scenarioRace, season: 2026 });
    let scenarioTree = scenarioView.render();
    assert(nodes(scenarioTree).some(n => n.type === 'table')); assert(!nodes(scenarioTree).some(n => n.props['aria-label'] === 'Additional wins'), 'the first view is the compact record table, with scenario controls closed');
    const scenarioToggle = nodes(scenarioTree).find(n => n.type === 'button' && text(n) === 'Explore a team’s finish');
    assert.equal(scenarioToggle.props['aria-expanded'], false); scenarioToggle.props.onClick(); scenarioTree = scenarioView.render(); scenarioView.effects();
    assert.match(text(scenarioTree), /Still depends on the field/);
    const detailPanel = nodes(scenarioTree).find(n => n.props['aria-label'] === 'Selected team finish');
    assert.equal(scenarioView.focusedIds().at(-1), detailPanel.props.id, 'opening a scenario moves focus to its mounted panel');
    assert(nodes(scenarioTree).findIndex(n => n.type === 'table') < nodes(scenarioTree).indexOf(detailPanel), 'the standings stay before the optional controls');
    nodes(scenarioTree).find(n => n.props['aria-label'] === 'Additional wins').props.onChange({ target: { value: '1' } }); scenarioTree = scenarioView.render();
    assert.match(text(scenarioTree), /3–1/); assert.match(text(scenarioTree), /Top record secured/);
    nodes(scenarioTree).find(n => n.props['aria-label'] === 'Explore Bravo’s finish').props.onClick(); scenarioTree = scenarioView.render(); scenarioView.effects();
    assert.equal(nodes(scenarioTree).find(n => n.props['aria-label'] === 'Race scenario team').props.value, '2');
    assert.equal(nodes(scenarioTree).find(n => n.props['aria-label'] === 'Additional wins').props.value, 0, 'selecting a table row resets added wins');
    assert.match(text(scenarioTree), /1–3/); assert.match(text(scenarioTree), /Outside by record/);
    scenarioTree = scenarioView.render({ race: { ...scenarioRace, supported: false, reason: 'Custom seeding', rows: scenarioRace.rows.map(row => ({ ...row, status: 'Clinched' })) } });
    assert.match(text(scenarioTree), /Record only/); assert.doesNotMatch(text(scenarioTree), /Record-based finish bounds|Top record secured|Clinched/, 'unsupported rules suppress stale finish bounds and row qualification claims');
    nodes(scenarioTree).find(n => n.type === 'button' && text(n) === 'Close details').props.onClick(); scenarioTree = scenarioView.render();
    assert(!nodes(scenarioTree).some(n => n.props['aria-label'] === 'Race scenario team'));
    assert.equal(scenarioView.focusedIds().at(-1), nodes(scenarioTree).find(n => n.props['aria-label'] === 'Explore Bravo’s finish').props.id, 'closing details restores focus to the selected team');
    nodes(scenarioTree).find(n => n.props['aria-label'] === 'Explore Alpha’s finish').props.onClick(); scenarioTree = scenarioView.render();
    nodes(scenarioTree).find(n => n.props['aria-label'] === 'Additional wins').props.onChange({ target: { value: '1' } }); scenarioTree = scenarioView.render();
    nodes(scenarioTree).find(n => n.props['aria-label'] === 'Race scenario team').props.onChange({ target: { value: '2' } }); scenarioTree = scenarioView.render();
    assert.equal(nodes(scenarioTree).find(n => n.props['aria-label'] === 'Additional wins').props.value, 0, 'the scenario selector also resets added wins');
    scenarioTree = scenarioView.render({ season: 2027 });
    assert(!nodes(scenarioTree).some(n => n.props['aria-label'] === 'Additional wins'), 'a new season closes the old finish scenario synchronously');
    const medianScenario = harness('WrWireStudioRace', { race: { ...scenarioRace, futureDecisions: 2, decisionsPerWeek: 2 }, season: 2026 });
    let medianTree = medianScenario.render(); assert.match(text(medianTree), /1 regular-season week left/); assert.match(text(medianTree), /2 win opportunities remain, two per week/);
    nodes(medianTree).find(n => n.props['aria-label'] === 'Explore Alpha’s finish').props.onClick(); medianTree = medianScenario.render();
    const medianSlider = nodes(medianTree).find(n => n.props['aria-label'] === 'Additional wins');
    assert.equal(medianSlider.props.max, 2); assert.match(text(medianTree), /remaining head-to-head \+ median decisions/);
    const completedScenario = harness('WrWireStudioRace', { race: { ...scenarioRace, remainingWeeks: 0, futureDecisions: 0 }, season: 2026 });
    let completedTree = completedScenario.render(); nodes(completedTree).find(n => n.props['aria-label'] === 'Explore Alpha’s finish').props.onClick(); completedTree = completedScenario.render();
    const completedSlider = nodes(completedTree).find(n => n.props['aria-label'] === 'Additional wins');
    assert.equal(completedSlider.props.max, 0); assert.equal(completedSlider.props.disabled, true, 'a verified completed schedule preserves zero remaining decisions');
    const connectedBracket = harness('WrWireStudioBracket', { data: { rounds: [{ label: 'Semifinal', weeks: [16], games: [{ id: 's', teams: [], nextGames: [{ id: 'f', label: 'Championship' }] }] }, { label: 'Championship', weeks: [17], games: [{ id: 'f', teams: [{ id: null, name: 'To be decided', points: null }], fromGames: [{ id: 's', label: 'Semifinal', side: 0 }] }] }] } });
    const visibleRounds = view => visibleNodes(view).filter(n => n.props.className === 'wr-studio-round');
    let connectedTree = connectedBracket.render(); connectedBracket.effects();
    assert.equal(visibleRounds(connectedTree).length, 1); assert.equal(visibleRounds(connectedTree)[0].props['aria-label'], 'Semifinal');
    visibleNodes(connectedTree).find(n => n.type === 'button' && text(n).includes('Winner →')).props.onClick();
    assert.equal(connectedBracket.focusedIds().length, 0, 'a winner link waits for the next round to mount before moving focus');
    connectedTree = connectedBracket.render(); connectedBracket.effects();
    assert.equal(visibleRounds(connectedTree).length, 1); assert.equal(visibleRounds(connectedTree)[0].props['aria-label'], 'Championship');
    const finalGame = visibleNodes(connectedTree).find(n => n.type === 'article' && n.props.className.includes('is-selected') && n.props.id.endsWith('-f'));
    assert(finalGame); assert.equal(connectedBracket.focusedIds().at(-1), finalGame.props.id, 'the connection focuses the revealed destination game');
    visibleNodes(connectedTree).find(n => n.type === 'button' && text(n).includes('Winner of Game s')).props.onClick(); connectedTree = connectedBracket.render(); connectedBracket.effects();
    assert.equal(visibleRounds(connectedTree)[0].props['aria-label'], 'Semifinal'); assert(connectedBracket.focusedIds().at(-1).endsWith('-s'), 'an unresolved participant links back to its actual source game');
    nodes(connectedTree).find(n => n.props.className === 'wr-studio-all-rounds').props.onClick(); connectedTree = connectedBracket.render(); connectedBracket.effects();
    assert.equal(visibleRounds(connectedTree).length, 2, 'the optional overview reveals all rounds');
    assert.equal(nodes(connectedTree).find(n => n.props.className === 'wr-studio-all-rounds').props['aria-pressed'], true);
    const roundNav = nodes(connectedTree).find(n => n.props['aria-label'] === 'Bracket rounds');
    nodes(roundNav).find(n => n.type === 'button' && text(n).includes('Final')).props.onClick(); connectedTree = connectedBracket.render(); connectedBracket.effects();
    assert.equal(visibleRounds(connectedTree).length, 1); assert.equal(visibleRounds(connectedTree)[0].props['aria-label'], 'Championship');
    assert.equal(nodes(nodes(connectedTree).find(n => n.props['aria-label'] === 'Bracket rounds')).filter(n => n.type === 'button' && n.props['aria-pressed']).length, 1, 'manual round selection returns from overview to a single selected round');
    console.log('PASS mobile Studio: focused rounds, reveal-before-focus links, compact race controls, selected-team resets, season isolation and retained snapshot provenance');
    console.log('PASS Studio interactions: timeline replay, trajectory week inspection, bracket connections and conservative race slider');
    console.log('PASS Wire Studio: lazy requests, scoped seasons, cancellation, retry/timeout, keyboard tabs, focus/Escape, comparisons, byes, verified scores and conservative race ranges');
})().catch(error => { console.error(error); process.exitCode = 1; });

const ownerLabels = harness('WrWireStudioTeamName', { team: { name: 'A rotating team name', ownerName: 'Malcolm Wohler' }, ownerFirst: true });
assert.equal(text(ownerLabels.render()), 'Malcolm Wohler A rotating team name');
assert.equal(text(ownerLabels.render({ ownerFirst: false })), 'A rotating team name Malcolm Wohler');

const sourceView = harness('WrWireStudioSources', { notes: ['Official advancement; some scores are unavailable.', { text: 'Original season names retained.' }], sources: [
    { label: 'Official bracket', url: 'https://api.sleeper.app/v1/league/123/winners_bracket' },
    { label: 'Same bracket again', url: 'https://api.sleeper.app/v1/league/123/winners_bracket' },
    { workbook: 'League history', sheet: '2024', range: 'B2:F6' },
    { label: 'Unlinked source', url: 'javascript:alert(1)' },
] });
const sourceTree = sourceView.render();
assert.equal(sourceTree.type, 'details'); assert(!sourceTree.props.open, 'supporting provenance starts collapsed');
assert.match(text(sourceTree), /Official advancement; some scores are unavailable/); assert.match(text(sourceTree), /Original season names retained/);
assert.match(text(sourceTree), /League history · 2024!B2:F6/);
assert.equal(nodes(sourceTree).filter(n => n.type === 'a').length, 1, 'duplicate source URLs collapse and unsafe URLs never become links');
assert.equal(nodes(sourceTree).find(n => n.type === 'a').props.rel, 'noopener noreferrer');
