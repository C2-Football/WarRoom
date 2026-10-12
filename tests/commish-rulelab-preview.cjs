'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
require('../js/shared/luck-engine.js');
const RuleLab = require('../js/shared/commish-rulelab.js');
const StartSit = require('../js/shared/startsit-engine.js');
const source = fs.readFileSync('js/tabs/commissioner-office.js', 'utf8');
const controls = source.slice(source.indexOf('    const onProposalChange ='), source.indexOf('    const rlLeagueArgs ='));
const replay = source.slice(source.indexOf('    const ruleLabResults ='), source.indexOf('    // ── Wind Tunnel: sweep'));
const ballot = source.slice(source.indexOf('    const proposalSummaryText ='), source.indexOf('    const rlCurrentSlots ='));
const save = source.slice(source.indexOf('    const writeProposals ='), source.indexOf('    const onLoadProposal ='));
const retry = source.slice(source.indexOf('    const onRetryRuleLab ='), source.indexOf('    // ── Schedule Builder: lazy'));
const weekStart = source.indexOf('    const rlRegularWeeks =');
const weekHelper = source.slice(weekStart, source.indexOf('    React.useEffect(', weekStart));
const clone = value => JSON.parse(JSON.stringify(value));
const league = { league_id: 'L1', name: 'Preview fixture', season: '2025', settings: { playoff_teams: 1 },
    scoring_settings: { rec: 0, pass_td: 4 }, roster_positions: ['FLEX'],
    rosters: [{ roster_id: 1, owner_id: 'u1' }, { roster_id: 2, owner_id: 'u2' }],
    users: [{ user_id: 'u1', display_name: 'Passing team' }, { user_id: 'u2', display_name: 'Receiving team' }] };
const args = { league, seasonStats: { 1: { p1: { pass_td: 2 }, p2: { rec: 10 } } },
    startSit: StartSit,
    lineups: { 1: [{ rosterId: 1, matchupId: 1, points: 999, starters: ['p1'] }, { rosterId: 2, matchupId: 1, points: 999, starters: ['p2'] }] },
    playersData: { p1: { position: 'QB', full_name: 'Passer' }, p2: { position: 'WR', full_name: 'Receiver' } },
    calcFn: (stats, scoring) => Object.entries(stats).reduce((total, [key, value]) => total + value * (Number(scoring[key]) || 0), 0) };
const copied = [], exported = [], resolved = [];
let saved = [], saveMode = 'ok', pendingSave, now = 100;
const c = vm.createContext({ console, C: { RuleLab }, proposal: {}, committedProposal: {}, rosterProposal: null, committedRosterProposal: null,
    ruleLab: { status: 'ready', season: '2025' }, state: { status: 'ready' }, rlScoped: [league], rlLeagueArgs: () => args,
    rlRun: { current: { key: 'previous run' } }, rlForceReload: { current: false }, rlSeasonData: { current: { 2025: args, 2024: { retained: true } } }, sweepBusy: null,
    React: { useMemo: fn => fn() }, Date: { now: () => ++now }, localSave: {
        resolve: keys => resolved.push(...keys),
        run: (key, tab, attempt, options) => {
            pendingSave = options;
            try { if (saveMode === 'before') throw new Error('quota'); attempt(); return { ok: true }; }
            catch { return { ok: false }; }
        },
    },
    setSavedTick() {}, setProposalSaveNotice: value => { c.proposalSaveNotice = value; }, setRuleLab: value => { c.ruleLab = value; }, setSweepState: value => { c.sweepState = value; },
    onCopy: text => copied.push(text), window: { wrLog() {}, App: { AccountSession: { isCurrent: () => true } }, wrExport: { capture: (...values) => exported.push(values) } },
    document: { getElementById: id => ({ id }) } });
c.C.Proposals = { update(change) { saved = clone(change(saved)); if (saveMode === 'after') throw new Error('read-back failed'); return saved; } };
for (const [setter, key] of [['setProposal', 'proposal'], ['setCommittedProposal', 'committedProposal'], ['setRosterProposal', 'rosterProposal'], ['setCommittedRosterProposal', 'committedRosterProposal']]) {
    c[setter] = value => { c[key] = value == null ? null : clone(value); };
}
vm.runInContext('function actualOffice() {' + controls + replay + ballot + save + retry + '\nreturn {onProposalStage,onProposalChange,onRosterProposalChange,onAnalyzeProposal,onResetProposal,onCopyBallot,onExportBallot,onSaveProposal,onRetryRuleLab,hasUnanalyzedChanges,ruleLabResults};}', c);
const draw = () => c.actualOffice();
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }

test('Office requests only regular-season lineup weeks, including a configured no-regular-week season', () => {
    vm.runInContext(weekHelper + ';this.regularWeeks = rlRegularWeeks;', c);
    assert.deepEqual(clone(c.regularWeeks({ settings: { playoff_week_start: 3 } })), [1, 2]);
    assert.deepEqual(clone(c.regularWeeks({ settings: { playoff_week_start: 1 } })), []);
    assert.deepEqual(clone(c.regularWeeks({ settings: {} })), Array.from({ length: 18 }, (_, i) => i + 1));
    assert.deepEqual(clone(c.regularWeeks({ settings: { playoff_week_start: 16 } })), Array.from({ length: 15 }, (_, i) => i + 1));
});

test('manual scoring edits retain the last preview and prevent copying or exporting until Preview changes', () => {
    let ui = draw(); const before = clone(ui.ruleLabResults[0].result);
    assert.equal(before.seedOneChanged, null);
    ui.onProposalStage({ rec: 1 }); ui = draw();
    assert.equal(ui.hasUnanalyzedChanges, true); assert.deepEqual(clone(ui.ruleLabResults[0].result), before);
    assert.equal(ui.onCopyBallot(league.name, ui.ruleLabResults[0].result), false);
    assert.equal(ui.onExportBallot(league.name), false);
    assert.equal(copied.length, 0); assert.equal(exported.length, 0);
    ui.onAnalyzeProposal(); ui = draw(); assert.equal(ui.hasUnanalyzedChanges, false);
    assert.equal(ui.ruleLabResults[0].result.seedOneChanged.to, 'Receiving team');
    ui.onCopyBallot(league.name, ui.ruleLabResults[0].result);
    assert.match(copied.at(-1), /Proposal: Reception \(PPR\) → 1/); assert.match(copied.at(-1), /#1 SEED FLIPS: Passing team → Receiving team/);
});
test('later staged negative rules cannot change a previously previewed ballot or its measured impact', () => {
    let ui = draw(); const before = clone(ui.ruleLabResults[0].result);
    ui.onProposalStage({ rec: 1, pass_td: -2 }); ui = draw();
    assert.equal(ui.hasUnanalyzedChanges, true); assert.deepEqual(clone(ui.ruleLabResults[0].result), before);
    const previousCopies = copied.length;
    assert.equal(ui.onCopyBallot(league.name, ui.ruleLabResults[0].result), false);
    assert.equal(copied.length, previousCopies); assert.doesNotMatch(copied.at(-1), /Passing TD → -2/);
    ui.onAnalyzeProposal(); ui = draw(); assert.equal(ui.hasUnanalyzedChanges, false);
    assert.equal(ui.ruleLabResults[0].result.teamDeltas.find(row => row.rosterId === 1).proposedPts, -4);
    ui.onCopyBallot(league.name, ui.ruleLabResults[0].result); assert.match(copied.at(-1), /Passing TD → -2/);
});
test('deliberate scoring and roster actions commit immediately, while a staged roster cannot label an older replay', () => {
    let ui = draw(); ui.onProposalChange({ rec: 0.25 }); ui = draw();
    assert.equal(ui.hasUnanalyzedChanges, false); assert.equal(ui.ruleLabResults[0].result.teamDeltas.find(row => row.rosterId === 2).proposedPts, 2.5);
    c.rosterProposal = { rosterPositions: ['WR', 'FLEX'] }; ui = draw();
    assert.equal(ui.hasUnanalyzedChanges, true); assert.equal(ui.ruleLabResults[0].result.methodology, 'as_played');
    assert.equal(ui.onCopyBallot(league.name, ui.ruleLabResults[0].result), false); assert.doesNotMatch(copied.at(-1), /Lineup:/);
    ui.onRosterProposalChange({ rosterPositions: ['WR', 'FLEX'] }); ui = draw();
    assert.equal(ui.hasUnanalyzedChanges, false); assert.equal(ui.ruleLabResults[0].result.methodology, 'best_lineup');
    ui.onCopyBallot(league.name, ui.ruleLabResults[0].result); assert.match(copied.at(-1), /Lineup: WR\/FLEX/); assert.match(copied.at(-1), /best-lineup replay/);
});
test('Reset all changes restores current-rule replay and sharing and clears only the failed add intent', () => {
    let ui = draw(); ui.onResetProposal(); ui = draw();
    assert.equal(ui.hasUnanalyzedChanges, false); assert.deepEqual(clone(c.proposal), {}); assert.equal(c.rosterProposal, null);
    assert.equal(ui.ruleLabResults[0].result.seedOneChanged, null); assert(ui.ruleLabResults[0].result.teamDeltas.every(row => row.delta === 0));
    ui.onCopyBallot(league.name, ui.ruleLabResults[0].result); assert.match(copied.at(-1), /Proposal: current rules/); assert.doesNotMatch(copied.at(-1), /Lineup:/);
    assert.deepEqual(resolved, ['proposal-add']);
    ui.onExportBallot(league.name); assert.equal(exported.at(-1)[0].id, 'wr-rulelab-ballot-preview-fixture');
});
test('Save draft retry keeps the original scoring and lineup snapshot after live edits, without post-write duplicates', () => {
    for (const failure of ['before', 'after']) {
        saved = []; saveMode = failure;
        c.proposal = { rec: 0.25, pass_td: -2 }; c.rosterProposal = { rosterPositions: ['WR', 'FLEX'] };
        const ui = draw();
        assert.equal(ui.onSaveProposal('Original draft'), false);
        assert.equal(c.proposalSaveNotice, '', 'failed persistence never confirms Saved');
        assert.equal(pendingSave.retryLabel, 'Retry save');
        assert.equal(saved.length, failure === 'after' ? 1 : 0);
        c.proposal.rec = 99; c.rosterProposal.rosterPositions.push('SUPER_FLEX');
        saveMode = 'ok'; assert.equal(pendingSave.retry(), true);
        assert.equal(c.proposalSaveNotice, 'Saved “Original draft” in this browser.');
        assert.equal(saved.length, 1, 'a failed read-back may already have written the entry');
        assert.equal(saved[0].name, 'Original draft');
        assert.deepEqual(saved[0].overrides, { rec: 0.25, pass_td: -2 });
        assert.deepEqual(saved[0].rosterProposal, { rosterPositions: ['WR', 'FLEX'] });
    }
    c.proposal = {}; c.rosterProposal = null;
});
test('Retry replay permits a public viewer, evicts incomplete historical caches and invalidates older in-flight work', () => {
    const oldRun = c.rlRun.current;
    assert.equal(draw().onRetryRuleLab(), true);
    assert.notEqual(c.rlRun.current, oldRun);
    assert.equal(c.rlRun.current.key, null); assert.equal(c.rlForceReload.current, true);
    assert.deepEqual(clone(c.rlSeasonData.current), {}, 'historical threshold packs must also recover on retry');
    assert.equal(c.ruleLab.status, 'idle'); assert.equal(c.sweepState, null);
    const current = c.rlRun.current;
    c.sweepBusy = 'rec'; assert.equal(draw().onRetryRuleLab(), false); assert.equal(c.rlRun.current, current);
    c.sweepBusy = null; c.window.App.AccountSession.isCurrent = () => false;
    assert.equal(draw().onRetryRuleLab(), false); assert.equal(c.rlRun.current, current);
});

const sweepHooks = source.slice(source.indexOf('    const sweepContext ='), source.indexOf('    // Other seasons\' data'));
const sweepAction = source.slice(source.indexOf('    const onSweep ='), source.indexOf('    // ── Saved proposals + ratification'));
function sweepHarness() {
    const timers = [], refs = [], effects = [], calls = [];
    let refCursor = 0, effectCursor = 0, changed = false, accountCurrent = true, releasePack;
    const model = { busy: null, result: null };
    let props = { rlActiveId: 'L1', ruleLab: { status: 'ready', season: 2025, seasonStats: args.seasonStats, perLeague: { L1: { lineups: args.lineups, nameLeague: league } }, seasons: [{ season: 2025, available: true }, { season: 2024, available: true }] },
        proposal: { rec: 0.25 }, committedProposal: { rec: 0.25 }, rosterProposal: null, committedRosterProposal: null, hasUnanalyzedChanges: false, rlScoped: [league] };
    const sandbox = vm.createContext({
        C: { RuleLab: { ...RuleLab, sweep: opts => { calls.push(opts); return RuleLab.sweep(opts); } } },
        React: {
            useRef(initial) { const i = refCursor++; return refs[i] || (refs[i] = { current: initial }); },
            useEffect(fn, deps) {
                const i = effectCursor++, previous = effects[i];
                if (previous && deps.length === previous.deps.length && deps.every((v, j) => v === previous.deps[j])) return;
                previous?.cleanup?.(); effects[i] = { deps, cleanup: fn() };
            },
        },
        window: { App: { AccountSession: { isCurrent: () => accountCurrent } }, wrLog() {} },
        setSweepBusy(value) { changed ||= model.busy !== value; model.busy = value; },
        setSweepState(value) { changed ||= model.result !== value; model.result = value; },
        setTimeout(fn) { timers.push(fn); }, buildLadder: () => [0, 1], rlLeagueArgs: () => args,
        rlArgsFor: (l, pack, stats, season) => pack ? { ...args, seasonStats: stats, lineups: pack.lineups, season } : null,
        loadSeasonPack: () => new Promise(resolve => { releasePack = resolve; }),
    });
    vm.runInContext('function actualSweep(input) { const {rlActiveId,ruleLab,proposal,rosterProposal,committedProposal,committedRosterProposal,hasUnanalyzedChanges,sweepBusy,rlScoped}=input;'
        + sweepHooks + sweepAction + ';return {onSweep,sweepContext,sweepRun};}', sandbox);
    const draw = updates => {
        props = { ...props, ...updates }; let ui;
        for (let tries = 0; tries < 3; tries++) {
            changed = false; refCursor = effectCursor = 0;
            ui = sandbox.actualSweep({ ...props, sweepBusy: model.busy });
            if (!changed) break;
        }
        return ui;
    };
    return { draw, timers, calls, model, props: () => props,
        setAccountCurrent: value => { accountCurrent = value; },
        release: () => releasePack({ seasonStats: args.seasonStats, perLeague: { L1: { lineups: args.lineups, nameLeague: league } } }),
    };
}
test('threshold callback refuses staged edits, concurrent work, and invalidated sessions', () => {
    const h = sweepHarness();
    let ui = h.draw({ hasUnanalyzedChanges: true }); ui.onSweep('rec', [0, 1]); assert.equal(h.timers.length, 0);
    ui = h.draw({ hasUnanalyzedChanges: false }); h.setAccountCurrent(false); ui.onSweep('rec', [0, 1]); assert.equal(h.timers.length, 0);
    h.setAccountCurrent(true); ui.onSweep('rec', [0, 1]); assert.equal(h.timers.length, 1);
    ui = h.draw(); ui.onSweep('pass_td', [4, 6]); assert.equal(h.timers.length, 1, 'a second render observes and guards busy work');
});
test('threshold replay uses committed scoring and the same committed lineup structure', () => {
    const h = sweepHarness();
    const roster = { rosterPositions: ['WR', 'FLEX'] };
    h.draw({ rosterProposal: roster, committedRosterProposal: roster }).onSweep('rec', [0.25, 1]); h.timers.shift()();
    assert.equal(h.calls.length, 1); assert.deepEqual(clone(h.calls[0].baseProposal), { rec: 0.25 });
    assert.deepEqual(clone(h.calls[0].rosterProposal), roster);
    assert.ok(h.model.result.perLeague[0].steps.every(step => !step.empty)); assert.equal(h.model.busy, null);
});
test('league, season, scoring, and lineup changes discard older scheduled threshold results, including A to B to A', () => {
    for (const change of [
        { rlActiveId: 'L2' }, { ruleLab: { status: 'ready', season: 2024 } },
        { proposal: { rec: 1 }, hasUnanalyzedChanges: true }, { rosterProposal: { rosterPositions: ['WR'] }, hasUnanalyzedChanges: true },
    ]) {
        const h = sweepHarness(); h.draw().onSweep('rec', [0, 1]); h.draw(change); h.timers.shift()();
        assert.equal(h.calls.length, 0); assert.equal(h.model.result, null); assert.equal(h.model.busy, null);
    }
    const h = sweepHarness(); h.draw().onSweep('rec', [0, 1]); h.draw({ rlActiveId: 'L2' }); h.draw({ rlActiveId: 'L1' }); h.timers.shift()();
    assert.equal(h.calls.length, 0, 'restoring a matching context does not revive the old operation');
});
test('a newer threshold request in the identical render context supersedes the earlier operation', () => {
    const h = sweepHarness(), ui = h.draw();
    ui.onSweep('rec', [0, 1]); ui.onSweep('pass_td', [4, 6]);
    h.timers.shift()(); assert.equal(h.calls.length, 0); assert.equal(h.model.result, null); assert.equal(h.model.busy, 'pass_td');
    h.timers.shift()(); assert.equal(h.calls.length, 1); assert.equal(h.model.result.key, 'pass_td'); assert.equal(h.model.busy, null);
});
test('a session invalidated before a scheduled threshold run receives no result', () => {
    const h = sweepHarness(); h.draw().onSweep('rec', [0, 1]); h.setAccountCurrent(false); h.timers.shift()();
    assert.equal(h.calls.length, 0); assert.equal(h.model.result, null);
});
(async () => {
    const h = sweepHarness(), prior = h.props().ruleLab;
    h.draw({ ruleLab: { ...prior, seasons: [{ season: 2024, available: true }, { season: 2025, available: true }] } }).onSweep('rec', [0, 1], { allSeasons: true });
    h.draw({ ruleLab: { ...prior, season: 2024 } }); h.release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.calls.length, 0); assert.equal(h.model.result, null); assert.equal(h.model.busy, null);
    passed++; console.log('PASS deferred historical threshold data cannot overwrite a newer selected season');
    console.log(passed + ' actual Rule Lab preview, ballot, and threshold groups passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
