// ══════════════════════════════════════════════════════════════════
// js/tabs/commissioner-office.js — window.CommissionerOffice
// The multi-league commissioner's desk (vision doc §7): every league the
// user commissions, one surface. Composes the commish-* engines into four
// walls: the Coefficient (rank the human), the People desk (Dave Alarm /
// open seats / Bench / Day One), the Ops desk (Drift Sentinel / master
// calendar / conflicts), and the Matchday Programme rack.
//
// Orchestration lives HERE — panels are dumb (props in, callbacks out).
// Load pipeline per commissioned league: users+rosters (hydrate) → txns
// (WrTxns) → luck ledger (App.Luck) → drift check → drafts. Engines then
// compute person-level views off the member graph. All Sleeper reads; the
// office never executes anything on a platform.
// Deferred module group "commish" — loaded when the hub card is opened.
// ══════════════════════════════════════════════════════════════════
function CommissionerOffice({ leagues, myUserId, onBack, onEnterLeague }) {
    // ── The token ladder ─────────────────────────────────────────────
    // The office used to read as translucent for a reason that had nothing to
    // do with opacity: --panel, --ov-4, --text, --acc-fill2 and --k-* are all
    // UNDEFINED in this app, so every surface silently fell back to #15151b —
    // four RGB points off the page, which is no figure/ground at all. Worse,
    // --text-muted resolves identical to --silver (so there was no third text
    // tier) and --charcoal is a translucent gold. These CO_* customs are
    // defined on the shell below and are the only colors the office uses.
    const GOLD = 'var(--gold, #D4AF37)', SILVER = 'var(--silver, #BDB8AD)', TEXT = 'var(--white, #F5F2EA)';
    const MUTED = '#8D887E', ACCENT = 'var(--co-accent, #5DADE2)';
    const PANEL = 'var(--co-surface, #121217)', LINE = 'var(--co-line, #27262E)';
    const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
    const CO_TOKENS = {
        '--co-page': '#08080B', '--co-surface': '#121217', '--co-surface-2': '#1B1B22',
        '--co-surface-3': '#17171D', '--co-well': '#0F0F14',
        '--co-line': '#27262E', '--co-line-soft': '#201F27',
        '--co-accent': '#5DADE2', '--co-accent-fill': '#12212B', '--co-accent-line': '#2B4B63',
        '--co-fill-bad': '#2A1512', '--co-fill-warn': '#2A2010', '--co-fill-good': '#14281C',
    };

    const C = window.App && window.App.Commish;
    const [state, setState] = React.useState({ status: 'idle' });
    // View state. 'command' is the front door — the office used to land on the
    // Coefficient, which is an empty table all offseason, which is a large part
    // of why it read as broken. Hubs are reached FROM the command view and
    // always have one fixed way back.
    const [tab, setTab] = React.useState('command'); // command | network | people | ops | programmes | rulelab | genesis | governance
    const [scopeLeagueId, setScopeLeagueId] = React.useState(null);
    // Rule Lab league scope: a league id, or '__all' for the omnibus. null =
    // "not chosen yet" and resolves to the first league — the owner amends ONE
    // constitution at a time, so single-league is the default posture.
    const [rlLeagueId, setRlLeagueId] = React.useState(null);
    // Command opens on the work that needs intervention now. Soon/backlog
    // remain one tap away, but they no longer turn the front door into a
    // multi-thousand-pixel audit log before the commissioner has acted today.
    const [queueFilter, setQueueFilter] = React.useState({ tier: 'NOW', leagueId: null, domain: null });
    const openHub = React.useCallback((hub, opts) => {
        // Accept BOTH shapes: openHub(hub, {leagueId}) and the older
        // openHub(hub, leagueId) the command panel emits. Before this, a bare
        // string made opts.leagueId undefined and scoping silently no-opped.
        const lid = !opts ? null
            : (typeof opts === 'string' || typeof opts === 'number') ? String(opts)
            : (opts.leagueId != null ? String(opts.leagueId) : null);
        setScopeLeagueId(lid);
        // Arriving from a league-specific row selects that league in the Lab.
        if (lid) setRlLeagueId(lid);
        setTab(hub);
        try { window.scrollTo(0, 0); } catch (e) { /* headless */ }
    }, []);
    const [ackTick, setAckTick] = React.useState(0);
    const [genTick, setGenTick] = React.useState(0);
    // Preferences (managed leagues / alert types / per-item state) live in
    // storage; prefTick is the single re-read signal after any mutation.
    const [prefTick, setPrefTick] = React.useState(0);
    const [followTick, setFollowTick] = React.useState(0);
    // Commissioner's manual board (tasks/milestones/events) — same re-read
    // signal shape as every other storage-backed piece of the office.
    const [tasksTick, setTasksTick] = React.useState(0);
    const [actionItem, setActionItem] = React.useState(null); // the open action drawer
    const [navOpen, setNavOpen] = React.useState(false);      // phone sidebar
    // Rule Lab data loads lazily on first open — 18 weeks of league-independent
    // stat lines plus per-league as-played lineups is too heavy for office boot.
    const [ruleLab, setRuleLab] = React.useState({ status: 'idle' });
    const [proposal, setProposal] = React.useState({});
    // Wind Tunnel free-typing stages into `proposal` on every keystroke, but
    // the replay only ever runs off this COMMITTED snapshot — updated when
    // the commissioner clicks Analyze (or by any single deliberate action:
    // a preset chip, a roster-slot button, Reset, Load). See the Analyze
    // wiring below `ruleLabResults`.
    const [committedProposal, setCommittedProposal] = React.useState({});
    const [committedRosterProposal, setCommittedRosterProposal] = React.useState(null);
    // Run-identity ref, not a cleanup kill switch (see season-odds-panel.js —
    // a status-dependent effect's own setState would orphan the run).
    const runRef = React.useRef({ key: null });
    const runKey = (leagues || []).map(l => l.league_id || l.id).join(',');

    React.useEffect(() => {
        if (state.status !== 'idle') return;
        if (runRef.current.key === runKey) return;
        if (!C || !window.App?.Luck) { setState({ status: 'unavailable' }); return; }
        runRef.current.key = runKey;
        const live = () => runRef.current.key === runKey;
        setState({ status: 'loading', step: 'Reading your leagues…' });
        (async () => {
            try {
                const now = Date.now();
                // 1. Which of these leagues do I actually commission?
                await C.hydrateCommissioned(leagues);
                const mine = C.discoverCommissioned({ leagues, myUserId });
                if (!mine.length) { if (live()) setState({ status: 'none' }); return; }

                if (live()) setState({ status: 'loading', step: 'Building the member graph…' });
                const graph = C.buildMemberGraph({ leagues: mine, myUserId });

                // 2. Per-league data: txns, weekly scores → ledgers, drift, drafts.
                const nfl = (window.S && window.S.nflState) || {};
                const week = Number(nfl.display_week || nfl.week || 0);
                const txnsByLeague = {}, rostersByLeague = {}, ledgers = {}, weeklyScoresByLeague = {};
                await Promise.all(mine.map(async l => {
                    const lid = String(l.league_id || l.id);
                    rostersByLeague[lid] = l.rosters || [];
                    try { txnsByLeague[lid] = (await window.WrTxns?.fetchLeagueTxns?.(lid)) || []; } catch (e) { txnsByLeague[lid] = []; }
                    try {
                        const built = await window.App.Luck.build({ league: l });
                        ledgers[lid] = built; weeklyScoresByLeague[lid] = built.weeklyScores || {};
                    } catch (e) { ledgers[lid] = { rows: [], weeks: [] }; weeklyScoresByLeague[lid] = {}; }
                }));
                // loadDrafts takes the whole league list and returns a per-league map.
                let draftsByLeague = {};
                try { draftsByLeague = C.Calendar?.loadDrafts ? await C.Calendar.loadDrafts(mine) : {}; } catch (e) { draftsByLeague = {}; }
                const playersData = window.App.fetchAllPlayers ? await window.App.fetchAllPlayers().catch(() => ({})) : {};

                if (live()) setState({ status: 'loading', step: 'Running the desk…' });
                // 3. Engines (each guarded — a failed engine empties its wall, not the office).
                let coefficient = null, radar = null, drift = [], calendar = { events: [] }, conflicts = [], programmes = [], renewal = null;
                try { coefficient = C.Coefficient?.buildCoefficient ? C.Coefficient.buildCoefficient({ graph, ledgers }) : null; } catch (e) { window.wrLog?.('commish.coefficient', e); }
                try { radar = C.Radar?.buildRadar ? C.Radar.buildRadar({ graph, txnsByLeague, rostersByLeague, playersData, week, nowMs: now }) : null; } catch (e) { window.wrLog?.('commish.radar', e); }
                try {
                    drift = mine.map(l => ({
                        leagueId: String(l.league_id || l.id), leagueName: l.name,
                        result: C.Drift?.checkLeague ? C.Drift.checkLeague(l, { nowMs: now }) : { firstRun: true, changes: [] },
                    }));
                } catch (e) { window.wrLog?.('commish.drift', e); }
                try {
                    // buildCalendar returns a bare sorted event array (per its contract).
                    const events = C.Calendar?.buildCalendar ? C.Calendar.buildCalendar({ leagues: mine, draftsByLeague, seasonStartDate: nfl.season_start_date, nowMs: now }) : [];
                    calendar = { events: Array.isArray(events) ? events : (events?.events || []) };
                    conflicts = C.Calendar?.findConflicts ? C.Calendar.findConflicts({ events: calendar.events, graph, nowMs: now }) : [];
                } catch (e) { window.wrLog?.('commish.calendar', e); }
                try { programmes = C.Programme?.buildAll ? C.Programme.buildAll({ leagues: mine, ledgers, weeklyScoresByLeague, graph, nowMs: now }) : []; } catch (e) { window.wrLog?.('commish.programme', e); }
                try { renewal = C.Renewal?.buildForecast ? C.Renewal.buildForecast({ graph, radar, ledgers, week, nowMs: now }) : null; } catch (e) { window.wrLog?.('commish.renewal', e); }
                // Bylaws: constitution text per league (league_docs, best-effort)
                // → clause-parsed for search/rulings. Absence is a first-class
                // state the governance wall renders honestly.
                const constitutions = {};
                if (C.Bylaws?.parseClauses && window.OD?.getLeagueDocsContext) {
                    await Promise.all(mine.map(async l => {
                        const lid = String(l.league_id || l.id);
                        try {
                            const text = await window.OD.getLeagueDocsContext(lid);
                            constitutions[lid] = text ? { text, clauses: C.Bylaws.parseClauses(text) } : null;
                        } catch (e) { constitutions[lid] = null; }
                    }));
                }

                // 4. Seats → bench shortlists, prospectuses, day-one previews.
                const seats = graph.seats || [];
                const benches = [], prospectuses = [], folders = [];
                for (const seat of seats) {
                    const league = mine.find(l => String(l.league_id || l.id) === seat.leagueId) || {};
                    let bench = [];
                    try { bench = C.Bench?.candidatesForSeat ? C.Bench.candidatesForSeat({ graph, radar, seat, limit: 5 }) : []; } catch (e) { /* empty bench */ }
                    benches.push(bench);
                    try { prospectuses.push(C.Bench?.buildProspectus ? C.Bench.buildProspectus({ seat, league, graph, playersData, values: null }) : null); } catch (e) { prospectuses.push(null); }
                    try {
                        folders.push(bench[0] && C.Bench?.buildDayOneFolder
                            ? C.Bench.buildDayOneFolder({ league, seat, recruitName: bench[0].name, graph, playersData, values: null, constitutionDigest: null })
                            : null);
                    } catch (e) { folders.push(null); }
                }

                if (live()) setState({
                    status: 'ready',
                    mine, graph, week, playersData, ledgers, constitutions,
                    coefficient, radar, drift, calendar, conflicts, programmes, renewal,
                    seats, benches, prospectuses: prospectuses.filter(Boolean).length ? prospectuses : prospectuses,
                    folders: folders.filter(Boolean),
                });
            } catch (e) {
                window.wrLog?.('commish.office', e);
                if (live()) setState({ status: 'error' });
            }
        })();
    }, [state.status, runKey]);

    // ── Rule Lab dataset (lazy, first open of the tab) ────────────────
    // Any season the history chain reaches is replayable: Sleeper renews
    // league ids yearly, so season N-k lives k hops down previous_league_id.
    // The chain is resolved once per league (cached in a ref) and each
    // requested season loads that hop's lineups with that year's users and
    // rosters for naming — scored under THIS year's rules as the baseline
    // being amended.
    const [rlSeason, setRlSeason] = React.useState(null);   // null = auto-pick
    const rlChains = React.useRef(null);                    // { [lid]: { [season]: leagueIdForThatSeason } }
    const RL_CHAIN_HOPS = 3;
    const rlRun = React.useRef({ key: null });
    React.useEffect(() => {
        if (tab !== 'rulelab' || ruleLab.status !== 'idle' || state.status !== 'ready') return;
        const RL = C && C.RuleLab;
        if (!RL) { setRuleLab({ status: 'error' }); return; }
        const nfl = (window.S && window.S.nflState) || {};
        const curSeason = Number(nfl.season || state.mine[0]?.season || 0);
        const anyCounted = Object.values(state.ledgers || {}).some(ld => (ld.weeks || []).length >= 4);
        const wantSeason = rlSeason != null ? rlSeason : (anyCounted ? curSeason : curSeason - 1);
        const wantKey = runKey + '|' + wantSeason;
        if (rlRun.current.key === wantKey) return;
        rlRun.current.key = wantKey;
        const live = () => rlRun.current.key === wantKey;
        setRuleLab({ status: 'loading' });
        (async () => {
            try {
                // Resolve each league's previous_league_id chain once.
                if (!rlChains.current) {
                    const chains = {};
                    await Promise.all(state.mine.map(async l => {
                        const lid = String(l.league_id || l.id);
                        chains[lid] = { [curSeason]: lid };
                        let walkId = lid;
                        for (let hop = 1; hop <= RL_CHAIN_HOPS; hop++) {
                            let prevId = hop === 1 ? l.previous_league_id : null;
                            if (!prevId && typeof window.fetchLeagueInfo === 'function') {
                                try { prevId = (await window.fetchLeagueInfo(walkId))?.previous_league_id; } catch (e) { break; }
                            }
                            if (!prevId) break;
                            chains[lid][curSeason - hop] = String(prevId);
                            walkId = String(prevId);
                        }
                    }));
                    if (!live()) return;
                    rlChains.current = chains;
                }
                const chains = rlChains.current;
                const seasonStats = await RL.loadSeasonStats(wantSeason);
                const perLeague = {};
                await Promise.all(state.mine.map(async l => {
                    const lid = String(l.league_id || l.id);
                    const lineupLid = chains[lid] && chains[lid][wantSeason];
                    if (!lineupLid) { perLeague[lid] = null; return; }   // chain doesn't reach that year
                    let nameLeague = l;
                    if (lineupLid !== lid) {
                        try {
                            const [users, rosters] = await Promise.all([window.fetchLeagueUsers(lineupLid), window.fetchRosters(lineupLid)]);
                            nameLeague = { ...l, users: users || l.users, rosters: rosters || l.rosters };
                        } catch (e) { /* fall back to current names */ }
                    }
                    const weeks = []; for (let w = 1; w <= 18; w++) weeks.push(w);
                    const lineups = await RL.loadSeasonLineups(lineupLid, weeks);
                    perLeague[lid] = { lineups, nameLeague };
                }));
                if (live()) {
                    const reachable = {};
                    Object.values(chains).forEach(ch => Object.keys(ch).forEach(s => { reachable[s] = true; }));
                    const seasons = [];
                    for (let s = curSeason; s >= curSeason - RL_CHAIN_HOPS; s--) {
                        // The current season is only offered once it has real weeks.
                        if (s === curSeason && !anyCounted) continue;
                        seasons.push({ season: s, available: !!reachable[s] });
                    }
                    setRuleLab({ status: 'ready', season: wantSeason, seasonStats, perLeague, seasons });
                }
            } catch (e) { window.wrLog?.('commish.rulelab', e); if (live()) setRuleLab({ status: 'error' }); }
        })();
    }, [tab, ruleLab.status, state.status, rlSeason]);
    const onRlSeason = (s) => { setRlSeason(s); setRuleLab({ status: 'idle' }); };

    // Proposal recompute is pure and fast (as-played sums over ~18 weeks) —
    // but the Wind Tunnel's multi-stat grid free-types, so re-running the
    // whole omnibus on every keystroke thrashed the replay mid-type. Only
    // the COMMITTED proposal (declared above, near `proposal`) drives
    // ruleLabResults now; every deliberate single-click action (preset
    // chips, roster-slot buttons, Reset, Load) commits immediately, and
    // free-typed number fields commit only when Analyze is clicked.
    const [rosterProposal, setRosterProposal] = React.useState(null);
    // Deliberate-action setters: stage AND commit in the same tick — these
    // back every control except the Wind Tunnel's number inputs.
    const onProposalChange = (next) => { setProposal(next); setCommittedProposal(next); };
    const onRosterProposalChange = (next) => { setRosterProposal(next); setCommittedRosterProposal(next); };
    // Wind Tunnel free-typing: stage only. `committedProposal` is untouched
    // until the commissioner clicks Analyze.
    const onProposalStage = (next) => { setProposal(next); };
    const onAnalyzeProposal = () => { setCommittedProposal(proposal); setCommittedRosterProposal(rosterProposal); };
    const onResetProposal = () => {
        setProposal({}); setRosterProposal(null);
        setCommittedProposal({}); setCommittedRosterProposal(null);
    };
    const proposalsEqual = (a, b) => {
        const ao = a || {}, bo = b || {};
        const ak = Object.keys(ao), bk = Object.keys(bo);
        return ak.length === bk.length && ak.every(k => Object.prototype.hasOwnProperty.call(bo, k) && Number(ao[k]) === Number(bo[k]));
    };
    const rosterProposalsEqual = (a, b) => {
        const as = (a && Array.isArray(a.rosterPositions)) ? a.rosterPositions : null;
        const bs = (b && Array.isArray(b.rosterPositions)) ? b.rosterPositions : null;
        if (!as && !bs) return true;
        if (!as || !bs) return false;
        return as.length === bs.length && as.every((s, i) => s === bs[i]);
    };
    // Drives the Analyze button's enabled state and "staged, not yet
    // analyzed" messaging in the panel.
    const hasUnanalyzedChanges = React.useMemo(
        () => !proposalsEqual(proposal, committedProposal) || !rosterProposalsEqual(rosterProposal, committedRosterProposal),
        [proposal, committedProposal, rosterProposal, committedRosterProposal]
    );
    const rlLeagueArgs = React.useCallback((l) => {
        const lid = String(l.league_id || l.id);
        const pack = ruleLab.perLeague && ruleLab.perLeague[lid];
        if (!pack) return null;
        const mine = (pack.nameLeague.rosters || []).find(r => String(r.owner_id) === String(myUserId));
        return {
            league: { ...pack.nameLeague, scoring_settings: l.scoring_settings, settings: l.settings, roster_positions: l.roster_positions },
            seasonStats: ruleLab.seasonStats, lineups: pack.lineups,
            playersData: state.playersData, myRosterId: mine ? mine.roster_id : null,
            season: ruleLab.season, startSit: window.App && window.App.StartSit,
        };
    }, [ruleLab.perLeague, ruleLab.seasonStats, ruleLab.season, state.playersData, myUserId]);

    // ── Rule Lab scope ───────────────────────────────────────────────
    // Every league keeps its OWN scoring, so an omnibus can't honestly show a
    // "from" value or offer a per-league key set. Scoping to one league is
    // what makes the full editor truthful; '__all' restores the omnibus for
    // the cross-league question ("does this rule move anybody?").
    const RL_ALL = '__all';
    const rlActiveId = React.useMemo(() => {
        const list = state.mine || [];
        if (rlLeagueId === RL_ALL) return RL_ALL;
        const ids = new Set(list.map(l => String(l.league_id || l.id)));
        if (rlLeagueId && ids.has(String(rlLeagueId))) return String(rlLeagueId);
        const first = list[0];
        return first ? String(first.league_id || first.id) : RL_ALL;
    }, [rlLeagueId, state.mine]);
    const rlScoped = React.useMemo(() => {
        const list = state.mine || [];
        return rlActiveId === RL_ALL ? list : list.filter(l => String(l.league_id || l.id) === rlActiveId);
    }, [rlActiveId, state.mine]);
    // The editor's from-values: a real league's scoring when scoped, null in
    // omnibus (the panel then refuses to claim a "from" it doesn't know).
    const rlBaselineScoring = React.useMemo(() => (
        rlActiveId === RL_ALL ? null : ((rlScoped[0] && rlScoped[0].scoring_settings) || {})
    ), [rlActiveId, rlScoped]);
    // Editable key set: the scoped league's own keys, or the union across
    // leagues in omnibus — so a league's oddball keys (IDP, bonuses) are
    // never invisible just because league #1 doesn't score them.
    const rlEditorKeys = React.useMemo(() => {
        const set = new Set();
        rlScoped.forEach(l => Object.keys(l.scoring_settings || {}).forEach(k => set.add(k)));
        return Array.from(set).sort();
    }, [rlScoped]);

    const ruleLabResults = React.useMemo(() => {
        if (ruleLab.status !== 'ready' || state.status !== 'ready' || !C?.RuleLab?.runProposal) return null;
        return rlScoped.map(l => {
            const lid = String(l.league_id || l.id);
            const args = rlLeagueArgs(l);
            if (!args) return { leagueId: lid, leagueName: l.name, result: { empty: true, reason: "This league's history chain doesn't reach the selected season." } };
            try {
                return { leagueId: lid, leagueName: l.name, result: C.RuleLab.runProposal({ ...args, proposal: committedProposal, rosterProposal: committedRosterProposal }) };
            } catch (e) { window.wrLog?.('commish.rulelab.run', e); return { leagueId: lid, leagueName: l.name, result: { empty: true, reason: 'error' } }; }
        });
    }, [ruleLab.status, state.status, committedProposal, committedRosterProposal, rlLeagueArgs, rlScoped]);

    // ── Wind Tunnel: sweep one knob across all leagues ───────────────
    const [sweepState, setSweepState] = React.useState(null);   // { key, perLeague, multi? } | null
    const [sweepBusy, setSweepBusy] = React.useState(null);
    // Other seasons' data, loaded lazily on the first every-season sweep and
    // kept for the session — {[season]: {seasonStats, perLeague}}. The
    // engine's own loaders are module-cached too; this ref just skips
    // re-fanning the per-league name/roster fetches.
    const rlSeasonData = React.useRef({});
    const loadSeasonPack = async (season) => {
        if (rlSeasonData.current[season]) return rlSeasonData.current[season];
        const RL = C.RuleLab;
        const chains = rlChains.current || {};
        const seasonStats = await RL.loadSeasonStats(season);
        const perLeague = {};
        await Promise.all(state.mine.map(async l => {
            const lid = String(l.league_id || l.id);
            const lineupLid = chains[lid] && chains[lid][season];
            if (!lineupLid) { perLeague[lid] = null; return; }
            let nameLeague = l;
            if (lineupLid !== lid) {
                try {
                    const [users, rosters] = await Promise.all([window.fetchLeagueUsers(lineupLid), window.fetchRosters(lineupLid)]);
                    nameLeague = { ...l, users: users || l.users, rosters: rosters || l.rosters };
                } catch (e) { /* fall back to current names */ }
            }
            const weeks = []; for (let w = 1; w <= 18; w++) weeks.push(w);
            const lineups = await RL.loadSeasonLineups(lineupLid, weeks);
            perLeague[lid] = { lineups, nameLeague };
        }));
        rlSeasonData.current[season] = { seasonStats, perLeague };
        return rlSeasonData.current[season];
    };
    // rlLeagueArgs pinned to the SELECTED season; this variant takes any
    // season's pack. Same baseline law: that year's lineups, scored under
    // THIS year's rules.
    const rlArgsFor = (l, pack, seasonStats, season) => {
        if (!pack) return null;
        const mine = (pack.nameLeague.rosters || []).find(r => String(r.owner_id) === String(myUserId));
        return {
            league: { ...pack.nameLeague, scoring_settings: l.scoring_settings, settings: l.settings, roster_positions: l.roster_positions },
            seasonStats, lineups: pack.lineups,
            playersData: state.playersData, myRosterId: mine ? mine.roster_id : null,
            season, startSit: window.App && window.App.StartSit,
        };
    };
    // Ladder for an arbitrary key: anchor on the largest live value across
    // managed leagues, then union in every league's own current value so each
    // one's NOW marker lands on a real step.
    const buildLadder = (key) => {
        let anchor = 0;
        rlScoped.forEach(l => { const v = Number((l.scoring_settings || {})[key]) || 0; if (Math.abs(v) > Math.abs(anchor)) anchor = v; });
        const vals = C.RuleLab.sweepValuesFor(key, anchor);
        rlScoped.forEach(l => { const v = Number((l.scoring_settings || {})[key]) || 0; if (!vals.includes(v)) vals.push(v); });
        return vals.sort((a, b) => a - b);
    };
    const onSweep = (key, values, opts) => {
        if (ruleLab.status !== 'ready' || !C?.RuleLab?.sweep) return;
        const RL = C.RuleLab;
        const vals = (values && values.length) ? values : buildLadder(key);
        const seasonsToRun = (ruleLab.seasons || []).filter(s => s.available).map(s => s.season);
        const multi = !!(opts && opts.allSeasons) && seasonsToRun.length > 1;
        setSweepBusy(key);
        if (!multi) {
            // Rescoring is fast but 7 steps × N leagues deserves a yield so
            // the button repaints before the crunch.
            setTimeout(() => {
                try {
                    const perLeague = rlScoped.map(l => {
                        const args = rlLeagueArgs(l);
                        if (!args) return { leagueName: l.name, steps: [], firstFlipAt: null };
                        const s = RL.sweep({ ...args, baseProposal: proposal, key, values: vals });
                        return { leagueName: l.name, steps: s.steps, firstFlipAt: s.firstFlipAt };
                    });
                    setSweepState({ key, perLeague });
                } catch (e) { window.wrLog?.('commish.rulelab.sweep', e); setSweepState(null); }
                setSweepBusy(null);
            }, 30);
            return;
        }
        // Every-season: one sweep per reachable year, merged into the
        // consensus grid. Off-season data loads lazily (network) — hence
        // async rather than the repaint-yield timeout.
        (async () => {
            try {
                const seasonSweeps = [];
                for (const season of seasonsToRun) {
                    const packData = season === ruleLab.season
                        ? { seasonStats: ruleLab.seasonStats, perLeague: ruleLab.perLeague }
                        : await loadSeasonPack(season);
                    const perLeague = rlScoped.map(l => {
                        const lid = String(l.league_id || l.id);
                        const args = rlArgsFor(l, packData.perLeague[lid], packData.seasonStats, season);
                        // Unreachable year for this league → an all-empty run,
                        // which mergeSweeps books as "no data", not a veto.
                        if (!args) return { leagueName: l.name, steps: [{ value: vals[0], empty: true }], firstFlipAt: null };
                        const s = RL.sweep({ ...args, baseProposal: proposal, key, values: vals });
                        return { leagueName: l.name, steps: s.steps, firstFlipAt: s.firstFlipAt };
                    });
                    seasonSweeps.push({ season, perLeague });
                }
                setSweepState({ key, multi: true, perLeague: RL.mergeSweeps(seasonSweeps) });
            } catch (e) { window.wrLog?.('commish.rulelab.sweep', e); setSweepState(null); }
            setSweepBusy(null);
        })();
    };

    // ── Saved proposals + ratification ───────────────────────────────
    const PROPOSALS_KEY = 'commish_rulelab_proposals';
    const [savedTick, setSavedTick] = React.useState(0);
    const savedProposals = React.useMemo(() => {
        try { return (window.App?.DhqStorage?.get?.(PROPOSALS_KEY, []) || []); } catch (e) { return []; }
    }, [savedTick]);
    const writeProposals = (list) => {
        try { window.App?.DhqStorage?.set?.(PROPOSALS_KEY, list); } catch (e) { /* best effort */ }
        setSavedTick(t => t + 1);
    };
    const onSaveProposal = (name) => {
        const list = savedProposals.slice();
        list.unshift({ id: 'p' + Date.now(), name, overrides: { ...proposal }, rosterProposal, status: 'draft', ts: Date.now() });
        writeProposals(list.slice(0, 20));
    };
    const onLoadProposal = (id) => {
        const sp = savedProposals.find(p => p.id === id);
        if (!sp) return;
        // Loading a saved proposal is a deliberate action, not free typing —
        // commit it immediately, same as a preset chip.
        const nextProposal = { ...(sp.overrides || {}) };
        const nextRoster = sp.rosterProposal || null;
        setProposal(nextProposal);
        setRosterProposal(nextRoster);
        setCommittedProposal(nextProposal);
        setCommittedRosterProposal(nextRoster);
    };
    const onDeleteProposal = (id) => writeProposals(savedProposals.filter(p => p.id !== id));
    // Ratify: the Rule Lab → Bylaws bridge. Every override lands in each
    // league's amendment ledger, so when the commissioner applies the change
    // on Sleeper, Drift recognizes it as already-ratified history.
    const onRatifyProposal = (id) => {
        const sp = savedProposals.find(p => p.id === id);
        if (!sp || !C?.Bylaws?.recordAmendment) return;
        rlScoped.forEach(l => {
            const lid = String(l.league_id || l.id);
            Object.keys(sp.overrides || {}).forEach(k => {
                try {
                    C.Bylaws.recordAmendment(lid, {
                        path: 'scoring.' + k,
                        from: (l.scoring_settings || {})[k] != null ? (l.scoring_settings || {})[k] : null,
                        to: sp.overrides[k],
                        note: 'Rule Lab ratification: ' + sp.name,
                        source: 'manual', nowMs: Date.now(),
                    });
                } catch (e) { /* ledger only */ }
            });
        });
        writeProposals(savedProposals.map(p => p.id === id ? { ...p, status: 'ratified', ratifiedTs: Date.now() } : p));
        setAckTick(t => t + 1);   // governance wall re-reads amendments
    };

    // ── Ballot handlers ──────────────────────────────────────────────
    const proposalSummaryText = () => {
        const bits = Object.keys(proposal).map(k => k + ' → ' + proposal[k]);
        if (rosterProposal) bits.push('slots: ' + rosterProposal.rosterPositions.join('/'));
        return bits.join(', ') || 'current rules';
    };
    const onCopyBallot = (leagueName, result) => {
        try { onCopy(C.RuleLab.ballotText(leagueName, result, proposalSummaryText())); } catch (e) { /* clipboard */ }
    };
    const onExportBallot = (leagueName) => {
        const el = document.getElementById('wr-rulelab-ballot-' + String(leagueName || 'league').replace(/\W+/g, '-').toLowerCase());
        if (el && window.wrExport) window.wrExport.capture(el, 'impact-statement-' + String(leagueName).replace(/\W+/g, '-').toLowerCase());
    };
    const rlCurrentSlots = React.useMemo(() => {
        const out = {};
        if (state.status !== 'ready') return out;
        rlScoped.forEach(l => {
            out[l.name] = (l.roster_positions || []).filter(s => s && !/^(BN|BE|BENCH|IR|TAXI|RES)$/i.test(String(s)));
        });
        return out;
    }, [state.status, rlScoped]);

    // Season Genesis readiness — recomputes on drift acknowledgment and
    // manual checklist toggles.
    const genesis = React.useMemo(() => {
        if (state.status !== 'ready' || !C?.Genesis?.buildAll) return null;
        try {
            return C.Genesis.buildAll({
                leagues: state.mine,
                calendarEvents: state.calendar.events,
                driftByLeague: Object.fromEntries(state.drift.map(d => [d.leagueId, d.result])),
                seats: state.seats,
                constitutionByLeague: Object.fromEntries(state.mine.map(l => {
                    const lid = String(l.league_id || l.id);
                    return [lid, !!(state.constitutions && state.constitutions[lid] && state.constitutions[lid].clauses.length)];
                })),
                nowMs: Date.now(),
            });
        } catch (e) { window.wrLog?.('commish.genesis', e); return null; }
    }, [state.status, ackTick, genTick]);
    // ── Command view derivations ─────────────────────────────────────
    // The triage queue is the office's single ranked work list; the KPI band,
    // pressure grid and desk cards are all views onto it, so they can never
    // disagree with each other.
    const isPhone = !!(window.WR && window.WR.useViewport && window.WR.useViewport().isPhone);
    // Declared HERE, above every memo that reads them. Babel compiles const to
    // a hoisted var, so a dep referenced above its declaration is silently
    // `undefined` at memo-evaluation time rather than a loud TDZ error — the
    // same trap that froze the Season Odds effect.
    const darkCount = state.status === 'ready' && state.radar ? state.radar.people.filter(p => p.status === 'DARK_ALL' || p.status === 'DARK_ONE').length : 0;
    const DOMAINS = [
        { key: 'coefficient', label: 'Coefficient', hub: 'network' },
        { key: 'people', label: 'People', hub: 'people' },
        { key: 'operations', label: 'Operations', hub: 'ops' },
        { key: 'programmes', label: 'Programmes', hub: 'programmes' },
        { key: 'rulelab', label: 'Rule Lab', hub: 'rulelab' },
        { key: 'genesis', label: 'Season Setup', hub: 'genesis' },
        { key: 'bylaws', label: 'Bylaws + Dues', hub: 'governance' },
    ];
    const tagFor = (name) => String(name || '').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 3).map(w => w[0]).join('').toUpperCase().slice(0, 3) || '???';
    // Settings copy: what each alert category actually covers, in the
    // commissioner's terms rather than the engine's domain keys.
    const DOMAIN_ALERT_LABELS = [
        { key: 'genesis', label: 'Season setup', sub: 'Unscheduled drafts, unfinished opening-day checklists.' },
        { key: 'operations', label: 'Settings & calendar', sub: 'Unratified settings changes, draft collisions, deadline stacks.' },
        { key: 'people', label: 'People going quiet', sub: 'Owners drifting dark, open seats, renewal risk.' },
        { key: 'bylaws', label: 'Bylaws & dues', sub: 'Missing constitutions, uncollected dues.' },
        { key: 'programmes', label: 'Weekly broadcast', sub: 'Recaps composed but not sent. Quiet until Week 1.' },
        { key: 'coefficient', label: 'Cross-league ratings', sub: 'The human leaderboard. Quiet until Week 1.' },
        { key: 'rulelab', label: 'Rule Lab', sub: 'A tool rather than an obligation — never queues work.' },
    ];

    // Preferences read fresh on every prefTick so a toggle is reflected
    // everywhere at once — queue, grid, badges and settings can't disagree.
    const P = C && C.Prefs;
    const F = C && C.Followups;
    const prefs = React.useMemo(() => {
        if (!P) return { alerts: { domains: {}, floor: 'BACKLOG' }, states: {}, managedIds: null };
        return { alerts: P.getAlerts(), states: P.allItemStates(), managedIds: null };
    }, [prefTick]);
    const followups = React.useMemo(() => F?.list?.() || [], [followTick]);
    const actionFollowup = React.useMemo(() => actionItem && F?.get?.(actionItem.id) || null, [actionItem, followTick]);
    const managedLeagues = React.useMemo(() => {
        if (state.status !== 'ready') return [];
        if (!P) return state.mine;
        return state.mine.filter(l => P.isManaged(l.league_id || l.id));
    }, [state.status, prefTick]);
    const managedIdSet = React.useMemo(
        () => new Set(managedLeagues.map(l => String(l.league_id || l.id))),
        [managedLeagues]
    );

    // "Open this league" — onEnterLeague is wired all the way from app.js to
    // handleSelectLeague (the same navigation a normal league-picker click
    // uses) but nothing inside the office ever called it: clicking a queue
    // item only opened its alert drawer, and the drawer's own action button
    // only jumps between commissioner desks, never out to a real league
    // dashboard. The Grid's per-league "Open" button (commish-command-panel.js)
    // is the one place a row unambiguously means exactly one league.
    const leagueById = React.useMemo(() => {
        const m = new Map();
        managedLeagues.forEach(l => m.set(String(l.league_id || l.id), l));
        return m;
    }, [managedLeagues]);
    const handleEnterLeague = (leagueId) => {
        const full = leagueById.get(String(leagueId));
        if (full && onEnterLeague) onEnterLeague(full);
    };

    // Declared above rawQueue, which consumes treasuries: these are real
    // const bindings, so a forward reference is a hard TDZ error, not the
    // silent undefined the hoisted-var cases produce.
    const [treasuryTick, setTreasuryTick] = React.useState(0);
    const treasuries = React.useMemo(() => {
        if (state.status !== 'ready' || !C?.Treasury?.buildTreasury) return {};
        const out = {};
        for (const l of state.mine) {
            const lid = String(l.league_id || l.id);
            try { out[lid] = C.Treasury.buildTreasury({ graph: state.graph, leagueId: lid, ledger: C.Treasury.getLedger(lid) }); } catch (e) { out[lid] = null; }
        }
        return out;
    }, [state.status, treasuryTick]);
    const bylawAmendments = React.useMemo(() => {
        if (state.status !== 'ready' || !C?.Bylaws?.amendments) return {};
        const out = {};
        for (const l of state.mine) { const lid = String(l.league_id || l.id); try { out[lid] = C.Bylaws.amendments(lid); } catch (e) { out[lid] = []; } }
        return out;
    }, [state.status, ackTick]);

    // ── Manual board: tasks/milestones/events the commissioner adds by hand
    // ── (js/shared/commish-tasks.js). Merged into the Master Calendar's
    // event feed for display only — Genesis/Triage keep reading the
    // auto-derived state.calendar.events untouched, so a hand-added "collect
    // dues" note never masquerades as a Sleeper-sourced readiness signal.
    const taskItems = React.useMemo(() => {
        try { return C?.Tasks?.list ? C.Tasks.list() : []; } catch (e) { return []; }
    }, [tasksTick]);
    const opsCalendar = React.useMemo(() => {
        const auto = (state.status === 'ready' && state.calendar && state.calendar.events) || [];
        if (!C?.Tasks) return { events: auto };
        const leagueNameOf = (lid) => {
            const l = (state.mine || []).find(l => String(l.league_id || l.id) === String(lid));
            return l ? l.name : null;
        };
        const manual = C.Tasks.asEvents(taskItems, { leagueNameOf, nowMs: Date.now() });
        return { events: C.Tasks.mergeSorted(auto, manual) };
    }, [state.status, state.calendar, taskItems]);
    const onAddTask = (input) => { try { C?.Tasks?.add?.(input, { nowMs: Date.now() }); } catch (e) { /* board is best-effort */ } setTasksTick(t => t + 1); };
    const onToggleTask = (id) => { try { C?.Tasks?.toggleDone?.(id, { nowMs: Date.now() }); } catch (e) { /* unchanged */ } setTasksTick(t => t + 1); };
    const onRemoveTask = (id) => { try { C?.Tasks?.remove?.(id); } catch (e) { /* unchanged */ } setTasksTick(t => t + 1); };

    const rawQueue = React.useMemo(() => {
        if (state.status !== 'ready' || !C?.Triage?.buildQueue) return null;
        try {
            return C.Triage.buildQueue({
                radar: state.radar, renewal: state.renewal, drift: state.drift,
                calendar: state.calendar, conflicts: state.conflicts, genesis,
                treasuries, constitutions: state.constitutions || {}, seats: state.seats,
                graph: state.graph, mine: state.mine, week: state.week, nowMs: Date.now(),
            });
        } catch (e) { window.wrLog?.('commish.triage', e); return null; }
    }, [state.status, genesis, treasuries, ackTick, genTick, treasuryTick]);

    // The queue the office actually renders: raw findings minus unmanaged
    // leagues, silenced categories, items below the severity floor, and
    // anything the commissioner marked done / skipped / hidden. Counts are
    // recomputed over the survivors so the pills can never disagree with the
    // rows underneath them. `suppressed` is kept so Settings can restore.
    const queue = React.useMemo(() => {
        if (!rawQueue) return null;
        if (!P) return rawQueue;
        const split = P.applyStates(rawQueue.items, {
            states: prefs.states, alerts: prefs.alerts,
            managedIds: managedIdSet, nowMs: Date.now(),
        });
        const visibleIds = new Set(split.visible.map(i => i.id));
        const byCell = {};
        Object.keys(rawQueue.byCell || {}).forEach(k => { byCell[k] = 0; });
        split.visible.forEach(it => {
            (it.leagueIds || []).forEach(lid => {
                const k = lid + ':' + it.domain;
                byCell[k] = (byCell[k] || 0) + 1;
            });
        });
        return {
            ...rawQueue,
            items: split.visible,
            counts: P.countTiers(split.visible),
            byCell,
            suppressed: split.suppressed,
            hiddenByMe: split.suppressed.filter(s => s.state),
            visibleIds,
        };
    }, [rawQueue, prefs, managedIdSet]);

    const commandKpis = React.useMemo(() => {
        if (state.status !== 'ready') return null;
        const readiness = (genesis || []).map(g => ({ leagueId: g.leagueId, tag: tagFor(g.leagueName), pct: g.pct }));
        const avg = readiness.length ? Math.round(readiness.reduce((s, r) => s + r.pct, 0) / readiness.length) : 0;
        const upcoming = (state.calendar.events || []).filter(e => e.ts && e.ts >= Date.now()).sort((a, b) => a.ts - b.ts).slice(0, 4);
        const dated = upcoming[0];
        return {
            leagues: managedLeagues.length,
            humans: Object.keys(state.graph.people || {}).length,
            crossover: (state.graph.overlap || []).length,
            needsYou: (queue && queue.counts) || { now: 0, soon: 0, backlog: 0 },
            openSeats: (state.seats || []).length,
            readiness, readinessAvg: avg,
            nextDate: dated ? {
                label: new Date(dated.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase(),
                sub: dated.leagueName + ' ' + dated.type + ' · in ' + Math.max(0, Math.round((dated.ts - Date.now()) / 86400000)) + 'd',
                ts: dated.ts,
            } : null,
            // The next few dated events after the very next one — a short
            // lookahead strip so "Next date" reads as a runway, not just a
            // single point. Same upcoming/sorted list, just not re-fetched.
            upcoming: upcoming.slice(1).map(e => ({
                label: new Date(e.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase(),
                leagueName: e.leagueName, type: e.type,
            })),
        };
    }, [state.status, queue, genesis]);

    const commandGrid = React.useMemo(() => {
        if (state.status !== 'ready') return null;
        const byCell = (queue && queue.byCell) || {};
        const notYet = (queue && queue.notYet) || {};
        const worst = {};
        ((queue && queue.items) || []).forEach(it => {
            (it.leagueIds || []).forEach(lid => {
                const k = lid + ':' + it.domain;
                const rank = { NOW: 3, SOON: 2, BACKLOG: 1 }[it.tier] || 0;
                if (!worst[k] || rank > worst[k]) worst[k] = rank;
            });
        });
        return {
            leagues: managedLeagues.map(l => {
                const lid = String(l.league_id || l.id);
                const openSeats = (state.seats || []).filter(s => String(s.leagueId) === lid).length;
                return { leagueId: lid, tag: tagFor(l.name), name: l.name, pct: (genesis || []).find(g => g.leagueId === lid)?.pct ?? null, openSeats };
            }),
            domains: DOMAINS,
            cell: (leagueId, domainKey) => {
                const k = leagueId + ':' + domainKey;
                if (notYet[k]) return { n: 0, state: 'NOT_YET' };
                const n = byCell[k] || 0;
                if (!n) return { n: 0, state: 'CLEAR' };
                return { n, state: ({ 3: 'NOW', 2: 'SOON', 1: 'BACKLOG' })[worst[k]] || 'BACKLOG' };
            },
        };
    }, [state.status, queue, genesis]);

    const commandDesks = React.useMemo(() => {
        if (state.status !== 'ready') return null;
        const items = (queue && queue.items) || [];
        const forHub = (hub) => items.filter(it => it.hub === hub);
        const worstSev = (rows) => rows.some(r => r.tier === 'NOW') ? 'bad' : rows.some(r => r.tier === 'SOON') ? 'warn' : null;
        const badge = (hub) => { const rows = forHub(hub).filter(r => r.tier !== 'BACKLOG'); return rows.length ? { n: forHub(hub).length, severity: worstSev(rows) } : null; };
        const scored = (state.week || 0) > 0 && Object.values(state.ledgers || {}).some(l => (l.weeks || []).length);
        const lowest = [...(genesis || [])].sort((a, b) => a.pct - b.pct)[0];
        const driftN = state.drift.reduce((s, d) => s + ((d.result && d.result.changes) || []).length, 0);
        const duesTotals = Object.values(treasuries || {}).filter(Boolean).reduce((a, t) => ({ paid: a.paid + t.summary.paid, total: a.total + t.summary.total }), { paid: 0, total: 0 });
        const noCon = managedLeagues.filter(l => !(state.constitutions || {})[String(l.league_id || l.id)]).length;
        const avg = (genesis || []).length ? Math.round(genesis.reduce((s, g) => s + g.pct, 0) / genesis.length) : 0;
        return [
            { group: 'OPEN THE SEASON', hub: 'genesis', name: 'Season Setup', badge: badge('genesis'), stat: avg + '%', unit: 'AVG READINESS', status: lowest ? ('Lowest: ' + lowest.leagueName + ' ' + lowest.pct + '% — ' + (lowest.blockers?.[0] || 'blockers open') + '.') : 'Readiness pending.', dormant: false },
            { group: 'OPEN THE SEASON', hub: 'ops', name: 'Operations', badge: badge('ops'), stat: String(driftN), unit: 'UNRATIFIED EDITS', status: (state.conflicts.length ? state.conflicts.length + ' calendar conflict' + (state.conflicts.length === 1 ? '' : 's') : 'No collisions') + ' · ' + driftN + ' settings change' + (driftN === 1 ? '' : 's'), dormant: false },
            { group: 'OPEN THE SEASON', hub: 'rulelab', name: 'Rule Lab', badge: null, stat: ruleLab.season ? String(ruleLab.season) : '—', unit: 'REPLAY SEASON', status: 'Test a scoring change against a finished season.', dormant: false },
            { group: 'HOLD THE ROOM', hub: 'people', name: 'People', badge: badge('people'), stat: String(darkCount), unit: 'FLAGGED DARK', status: ((state.renewal?.summary?.atRisk ?? 0) + ' renewals at risk · ' + state.seats.length + ' seat' + (state.seats.length === 1 ? '' : 's') + ' open'), dormant: false },
            { group: 'HOLD THE ROOM', hub: 'governance', name: 'Bylaws & Dues', badge: badge('governance'), stat: duesTotals.total ? (duesTotals.paid + '/' + duesTotals.total) : '—', unit: 'DUES MARKED', status: noCon ? ('No constitution on file in ' + noCon + ' of ' + managedLeagues.length + ' leagues.') : 'Constitutions on file.', dormant: false },
            { group: 'THE BROADCAST', hub: 'network', name: 'The Coefficient', badge: scored ? badge('network') : null, stat: scored ? String((state.coefficient?.rows || []).length) : '—', unit: scored ? 'HUMANS RATED' : 'NO SCORED WEEKS', status: 'Rates every human across your leagues on one all-play scale. Starts Week 1 — ' + Object.keys(state.graph.people || {}).length + ' humans staged.', dormant: !scored },
            { group: 'THE BROADCAST', hub: 'programmes', name: 'Programmes', badge: scored ? badge('programmes') : null, stat: '—', unit: 'WEEKS PUBLISHED', status: 'One shareable recap per league per week. The first one prints after Week 1.', dormant: !scored },
        ];
    }, [state.status, queue, genesis, treasuries, ruleLab.season]);

    const onGenesisToggle = (leagueId, itemId) => {
        try { C?.Genesis?.toggleManual?.(leagueId, itemId, { nowMs: Date.now() }); } catch (e) { /* unchanged */ }
        setGenTick(t => t + 1);
    };

    // Governance state: treasuries re-read on any bookkeeping change.
    const onMarkPaid = (lid, uid, paid) => { try { C?.Treasury?.markPaid?.(lid, uid, { paid }); } catch (e) { /* unchanged */ } setTreasuryTick(t => t + 1); };
    const onSetLeagueSafe = (lid, url) => { const ok = !!C?.Treasury?.setLeagueSafeUrl?.(lid, url); setTreasuryTick(t => t + 1); return ok; };
    const onSetSheet = (lid, url) => { const ok = !!C?.Treasury?.setSheetUrl?.(lid, url); setTreasuryTick(t => t + 1); return ok; };
    const onPasteCsv = (lid, text) => {
        try {
            const members = Object.values(state.graph.people).filter(p => p.leagueIds.includes(lid));
            const parsed = C.Treasury.parseDuesCsv(text, members);
            if (!parsed.matched.length) return null;
            const applied = C.Treasury.applyCsv(lid, parsed, { nowMs: Date.now() });
            setTreasuryTick(t => t + 1);
            return { applied, unmatched: parsed.unmatched };
        } catch (e) { return null; }
    };
    const onFetchSheet = async (lid) => {
        try {
            const url = C.Treasury.getLedger(lid).sheetUrl;
            const text = url ? await C.Treasury.fetchPublishedSheet(url) : null;
            return text ? onPasteCsv(lid, text) : null;
        } catch (e) { return null; }
    };
    // Ruling card: one-shot, grounded ONLY in quoted clauses (the context block
    // carries the never-invent instruction) — same idiom as every AI card.
    const onAsk = async (lid, q) => {
        try {
            const con = state.constitutions?.[lid];
            if (!con || !window.AlexVoice?.enhance) return null;
            const ctx = C.Bylaws.buildRulingContext({ clauses: con.clauses, question: q });
            return await window.AlexVoice.enhance({
                type: 'strategy-analysis',
                message: 'Rule on this constitution question in 2-4 sentences, citing clause ids like [art-4]. Follow the INSTRUCTION in the context exactly.',
                context: ctx,
                fallback: null,
                cacheKey: 'commish-ruling:' + lid + ':' + q.toLowerCase().trim(),
            });
        } catch (e) { return null; }
    };

    const onAcknowledge = (leagueId) => {
        // The constitutional-history link: an acknowledged drift change IS an
        // amendment — record it before folding the baseline.
        try {
            const pending = (state.drift.find(d => d.leagueId === leagueId)?.result?.changes) || [];
            pending.forEach(ch => C.Bylaws?.recordAmendment?.(leagueId, { path: ch.path, from: ch.from, to: ch.to, note: '', source: 'drift_ack', nowMs: Date.now() }));
        } catch (e) { /* ledger only */ }
        try { C.Drift?.acknowledge?.(leagueId, { nowMs: Date.now() }); } catch (e) { /* keep pending */ }
        // Re-check just that league against the fresh baseline.
        setState(s => {
            if (s.status !== 'ready') return s;
            const drift = s.drift.map(d => {
                if (d.leagueId !== leagueId) return d;
                const league = s.mine.find(l => String(l.league_id || l.id) === leagueId);
                try { return { ...d, result: C.Drift.checkLeague(league, { nowMs: Date.now() }) }; } catch (e) { return d; }
            });
            return { ...s, drift };
        });
        setAckTick(t => t + 1);
    };
    const onCopy = (text) => { try { navigator.clipboard?.writeText?.(text); } catch (e) { /* clipboard unavailable */ } };

    // ── Preference + action mutations ────────────────────────────────
    // Every one of these writes to storage then bumps prefTick; the queue,
    // grid, badges and settings all re-derive from that single signal.
    const bumpPrefs = () => setPrefTick(t => t + 1);
    const onToggleLeague = (lid, on) => { try { P?.setManaged(lid, on); } catch (e) { /* unchanged */ } bumpPrefs(); };
    const onToggleDomain = (domain, on) => { try { P?.setDomainAlert(domain, on); } catch (e) { /* unchanged */ } bumpPrefs(); };
    const onSetFloor = (tier) => { try { P?.setFloor(tier); } catch (e) { /* unchanged */ } bumpPrefs(); };
    const bumpFollowups = () => setFollowTick(t => t + 1);
    const recordFollowup = (item, type, detail) => { try { F?.record?.(item, type, detail, { nowMs: Date.now() }); } catch (e) { /* unchanged */ } bumpFollowups(); };
    const itemForFollowup = (id) => ((rawQueue && rawQueue.items) || []).find(it => String(it.id) === String(id)) || actionItem || { id, headline: F?.get?.(id)?.headline || 'Commissioner follow-up' };
    const onSaveFollowup = (item, patch) => { try { F?.save?.(item, patch, { nowMs: Date.now() }); F?.record?.(item, 'SAVED', '', { nowMs: Date.now() }); } catch (e) { /* unchanged */ } bumpFollowups(); };
    const onCopyFollowup = (item, text) => { onCopy(text); recordFollowup(item, 'COPIED', 'Message copied for review'); };
    const onRemoveFollowup = (id) => { try { F?.remove?.(id); } catch (e) { /* unchanged */ } bumpFollowups(); };
    const onItemDone = (item) => { try { P?.markDone(item, { nowMs: Date.now() }); } catch (e) { /* unchanged */ } recordFollowup(item, 'DONE', 'Marked done'); setActionItem(null); bumpPrefs(); };
    const onItemSkip = (item) => { try { P?.skip(item, { nowMs: Date.now() }); } catch (e) { /* unchanged */ } recordFollowup(item, 'SKIPPED', 'Snoozed for ' + ((P && P.SKIP_DAYS) || 7) + ' days'); setActionItem(null); bumpPrefs(); };
    const onItemHide = (item) => { try { P?.hide(item, { nowMs: Date.now() }); } catch (e) { /* unchanged */ } recordFollowup(item, 'HIDDEN', 'Hidden from Command'); setActionItem(null); bumpPrefs(); };
    const onItemRestore = (id) => { const item = itemForFollowup(id); try { P?.restore(id); } catch (e) { /* unchanged */ } recordFollowup(item, 'RESTORED', 'Restored to Command'); setActionItem(null); bumpPrefs(); };
    // A queue row opens the drawer rather than navigating: the drawer is where
    // done/skip/hide live, and it still offers the deep-link as its primary.
    const onQueueItem = (item) => { recordFollowup(item, 'OPENED', 'Action drawer opened'); setActionItem(item); };
    const onActionOpen = (item) => { recordFollowup(item, 'NAVIGATED', item.action?.label || 'Opened desk'); setActionItem(null); openHub(item.hub, { leagueId: (item.leagueIds || [])[0] || null }); };
    const onExportAll = () => {
        if (!window.wrExport || state.status !== 'ready') return;
        (state.programmes || []).forEach(p => {
            if (p && !p.empty) {
                const el = document.getElementById('wr-programme-' + p.leagueId);
                if (el) window.wrExport.capture(el, 'programme-' + (p.leagueName || p.leagueId).replace(/\W+/g, '-').toLowerCase());
            }
        });
    };

    // ── Navigation ───────────────────────────────────────────────────
    // Seven desks in three named groups. The horizontal rail is gone: seven
    // items scrolled out of view in a strip, and a commissioner moving between
    // desks wants the whole map visible. The sidebar carries the same group
    // vocabulary as the Command view's desk cards, so the two teach each other.
    const HUB_GROUPS = [
        { name: 'OPEN THE SEASON', hubs: [['genesis', 'Season Setup'], ['ops', 'Operations'], ['rulelab', 'Rule Lab']] },
        { name: 'HOLD THE ROOM', hubs: [['people', 'People'], ['governance', 'Bylaws & Dues']] },
        { name: 'THE BROADCAST', hubs: [['network', 'The Coefficient'], ['programmes', 'Programmes']] },
    ];
    // Sidebar shape: the same three groups, with dormancy carried through so a
    // desk that can't have data yet says so instead of reading as broken.
    const scoredYet = state.status === 'ready' && (state.week || 0) > 0
        && Object.values(state.ledgers || {}).some(l => (l.weeks || []).length);
    const sidebarGroups = HUB_GROUPS.map(g => ({
        name: g.name,
        dormant: g.name === 'THE BROADCAST' && !scoredYet,
        hubs: g.hubs.map(([hub, name]) => ({ hub, name, dormant: g.name === 'THE BROADCAST' && !scoredYet })),
    }));
    const hubCounts = React.useMemo(() => {
        const out = {};
        ((queue && queue.items) || []).forEach(it => {
            if (it.tier === 'BACKLOG') return;
            out[it.hub] = (out[it.hub] || 0) + 1;
        });
        return out;
    }, [queue]);

    // The app paints a fixed 0.05-opacity logo watermark on body::before at
    // z-index 0 (index.html:479). Any surface that doesn't paint its own
    // background lets it bleed through — which is exactly what the office was
    // doing. Own the full viewport with an opaque page-bg and sit above it.
    // The app paints a fixed 0.05-opacity logo watermark on body::before at
    // z-index 0 (index.html:479). Any surface that doesn't paint its own
    // background lets it bleed through. Own the viewport, define the CO_*
    // ladder here so every descendant resolves real colors, and isolate so no
    // ancestor blend mode can reach in.
    const shell = (children) => (
        // The office mounts as a standalone full-page surface (app.js commishMode
        // branch returns it in place of the normal <header className="header">
        // shell that every other view gets for free), so it has to carve out its
        // own safe-area-inset-top — without it, the header row sits under the iOS
        // status bar/notch on phone and its buttons become untappable.
        <div style={{ ...CO_TOKENS, position: 'relative', zIndex: 1, background: 'var(--co-page)', isolation: 'isolate', minHeight: '100vh', paddingTop: 'var(--sat, env(safe-area-inset-top, 0px))' }}>
        {isPhone && navOpen && window.WrCommishSidebar ? (
            <window.WrCommishSidebar
                groups={sidebarGroups} active={tab} counts={hubCounts}
                onSelect={openHub} onOpenSettings={() => openHub('settings')}
                managedCount={managedLeagues.length} leagueCount={(state.mine || []).length}
                phone open onClose={() => setNavOpen(false)}
            />
        ) : null}
        {actionItem && window.WrCommishActionPanel ? (
            <window.WrCommishActionPanel
                item={actionItem} state={P ? P.stateOf(actionItem.id) : null} followup={actionFollowup}
                skipDays={(P && P.SKIP_DAYS) || 7}
                onOpen={() => onActionOpen(actionItem)}
                onDone={() => onItemDone(actionItem)}
                onSkip={() => onItemSkip(actionItem)}
                onHide={() => onItemHide(actionItem)}
                onRestore={() => onItemRestore(actionItem.id)}
                onSaveFollowup={(patch) => onSaveFollowup(actionItem, patch)}
                onCopyMessage={(text) => onCopyFollowup(actionItem, text)}
                onClose={() => setActionItem(null)}
            />
        ) : null}
        <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '20px 16px 60px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
                <button onClick={onBack} style={{ background: 'transparent', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', color: TEXT, cursor: 'pointer', padding: '6px 12px', fontFamily: MONO, fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.1em' }}>‹ HUB</button>
                {/* Blue wordmark, not gold: the cheapest signal that the Office
                    is a different room from Empire. Gold survives in exactly two
                    places office-wide — the LABS chip and the "this is you" row. */}
                <span style={{ fontFamily: 'var(--font-title)', fontWeight: 700, fontSize: isPhone ? '1.15rem' : '1.5rem', letterSpacing: '.06em', textTransform: 'uppercase', color: TEXT, display: 'inline-block', borderBottom: `3px solid ${ACCENT}`, paddingBottom: '3px' }}>Commissioner's Office</span>
                <span style={{ fontFamily: MONO, fontSize: '0.625rem', fontWeight: 700, letterSpacing: '.08em', color: '#121217', background: GOLD, borderRadius: 'var(--card-radius-xs, 5px)', padding: '2px 6px' }}>LABS</span>
                {state.status === 'ready' ? (
                    <span style={{ marginLeft: isPhone ? 0 : 'auto', flexBasis: isPhone ? '100%' : 'auto', fontFamily: MONO, fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.1em', color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
                        {state.mine.length} LEAGUES · {Object.keys(state.graph?.people || {}).length} HUMANS · {(state.graph?.overlap || []).length} CROSSOVER
                    </span>
                ) : null}
            </div>
            {state.status === 'ready' ? (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '20px' }}>
                    {!isPhone && window.WrCommishSidebar ? (
                        <div style={{ position: 'sticky', top: '16px', flex: 'none' }}>
                            <window.WrCommishSidebar
                                groups={sidebarGroups} active={tab} counts={hubCounts}
                                onSelect={openHub} onOpenSettings={() => openHub('settings')}
                                managedCount={managedLeagues.length} leagueCount={state.mine.length}
                                phone={false}
                            />
                        </div>
                    ) : null}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        {isPhone ? (
                            <button onClick={() => setNavOpen(true)}
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', minHeight: '44px', padding: '10px 14px', cursor: 'pointer', background: 'var(--co-surface-2)', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', color: TEXT, fontFamily: MONO, fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                                ☰ Desks
                            </button>
                        ) : null}
                        {scopeLeagueId ? (
                            <button onClick={() => setScopeLeagueId(null)}
                                style={{ marginBottom: '12px', padding: '6px 11px', cursor: 'pointer', background: 'var(--co-accent-fill)', border: `1px solid var(--co-accent-line)`, borderRadius: 'var(--card-radius-sm, 8px)', color: ACCENT, fontFamily: MONO, fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.08em' }}>
                                {(state.mine || []).find(l => String(l.league_id || l.id) === scopeLeagueId)?.name || 'SCOPED'} ✕
                            </button>
                        ) : null}
                        {children}
                    </div>
                </div>
            ) : children}
            {/* The command panel prints its own provenance footer; only add one
                here for the hub views, so the two never stack. */}
            {tab !== 'command' ? (
                <div style={{ marginTop: '24px', fontFamily: MONO, fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED }}>
                    The office reads; it never writes to a platform.
                </div>
            ) : null}
        </div>
        </div>
    );

    if (state.status === 'idle' || state.status === 'loading') {
        return shell(<div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '18px', color: TEXT, fontFamily: MONO, fontSize: '0.78rem' }}>{state.step || 'Opening the office…'}</div>);
    }
    if (state.status === 'none') {
        return shell(<div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '18px', color: TEXT, fontSize: '0.82rem', lineHeight: 1.6 }}>No commissioned leagues found on this account. Sleeper marks commissioners on each league — when one of your leagues carries your gavel, the office opens by itself.</div>);
    }
    if (state.status === 'error' || state.status === 'unavailable') {
        return shell(<div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '18px', color: TEXT, fontSize: '0.82rem' }}>The office couldn't load — league data was unavailable. Try again from the hub.</div>);
    }

    const Net = window.WrCommishCoefficientPanel, Prog = window.WrCommishProgrammePanel;
    const People = window.WrCommishPeoplePanel, Ops = window.WrCommishOpsPanel;
    const missing = (name) => <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '16px', color: TEXT, fontSize: '0.78rem', fontFamily: MONO }}>{name} module not loaded.</div>;

    return shell(
        <React.Fragment>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {tab === 'command' ? (window.WrCommishCommandPanel ? (
                    <window.WrCommishCommandPanel
                        queue={queue} kpis={commandKpis} grid={commandGrid} desks={commandDesks}
                        onOpenHub={openHub} onFilter={setQueueFilter} filter={queueFilter} phone={isPhone}
                        onSelectItem={onQueueItem} onEnterLeague={handleEnterLeague}
                    />
                ) : missing('Command')) : null}
                {tab === 'settings' ? (window.WrCommishSettingsPanel ? (
                    <window.WrCommishSettingsPanel
                        leagues={state.mine}
                        isManaged={(lid) => (P ? P.isManaged(lid) : true)}
                        onToggleLeague={onToggleLeague}
                        alerts={prefs.alerts}
                        onToggleDomain={onToggleDomain}
                        onSetFloor={onSetFloor}
                        domainLabels={DOMAIN_ALERT_LABELS}
                        suppressed={(queue && queue.hiddenByMe) || []}
                        onRestore={onItemRestore}
                        followups={followups}
                        onRemoveFollowup={onRemoveFollowup}
                    />
                ) : missing('Settings')) : null}
                {tab === 'network' ? (Net ? <Net coefficient={state.coefficient} graph={state.graph} /> : missing('Coefficient')) : null}
                {tab === 'people' ? (People ? <People radar={state.radar} seats={state.seats} benches={state.benches} prospectuses={state.prospectuses} folders={state.folders} onCopy={onCopy} /> : missing('People desk')) : null}
                {tab === 'people' && state.renewal && window.WrCommishRenewalPanel ? <window.WrCommishRenewalPanel forecast={state.renewal} /> : null}
                {tab === 'ops' ? (Ops ? <Ops drift={state.drift} calendar={opsCalendar} conflicts={state.conflicts}
                    leagues={(state.mine || []).map(l => ({ id: String(l.league_id || l.id), name: l.name }))}
                    onAcknowledge={onAcknowledge} onAddTask={onAddTask} onToggleTask={onToggleTask} onRemoveTask={onRemoveTask}
                    ackTick={ackTick} /> : missing('Ops desk')) : null}
                {tab === 'programmes' ? (Prog ? <Prog programmes={state.programmes} onExportAll={onExportAll} /> : missing('Programme rack')) : null}
                {tab === 'rulelab' ? (window.WrCommishRuleLabPanel ? (
                    <window.WrCommishRuleLabPanel
                        status={ruleLab.status === 'ready' ? 'ready' : ruleLab.status}
                        seasonUsed={ruleLab.season}
                        seasons={ruleLab.seasons || []}
                        onSeason={onRlSeason}
                        proposal={proposal}
                        onProposalChange={onProposalChange}
                        onProposalStage={onProposalStage}
                        rosterProposal={rosterProposal}
                        onRosterProposalChange={onRosterProposalChange}
                        onReset={onResetProposal}
                        onAnalyze={onAnalyzeProposal}
                        hasUnanalyzedChanges={hasUnanalyzedChanges}
                        results={ruleLabResults}
                        presets={(C?.RuleLab && C.RuleLab.PRESETS) || []}
                        baselineScoring={rlBaselineScoring}
                        editorKeys={rlEditorKeys}
                        leagues={(state.mine || []).map(l => ({ id: String(l.league_id || l.id), name: l.name }))}
                        selectedLeagueId={rlActiveId}
                        onSelectLeague={(id) => { setRlLeagueId(id); setSweepState(null); }}
                        currentSlotsByLeague={rlCurrentSlots}
                        sweepResult={sweepState}
                        onSweep={onSweep}
                        sweepBusy={sweepBusy}
                        saved={savedProposals}
                        onSaveProposal={onSaveProposal}
                        onLoadProposal={onLoadProposal}
                        onDeleteProposal={onDeleteProposal}
                        onRatify={onRatifyProposal}
                        onCopyBallot={onCopyBallot}
                        onExportBallot={onExportBallot}
                    />
                ) : missing('Rule Lab')) : null}
                {tab === 'genesis' ? (window.WrCommishGenesisPanel ? (
                    genesis ? <window.WrCommishGenesisPanel readiness={genesis} onToggle={onGenesisToggle} /> : missing('Season Setup')
                ) : missing('Season Setup')) : null}
                {tab === 'governance' ? (window.WrCommishGovernancePanel ? (
                    <window.WrCommishGovernancePanel
                        leagues={state.mine} graph={state.graph}
                        constitutions={state.constitutions || {}} amendments={bylawAmendments} treasuries={treasuries}
                        onMarkPaid={onMarkPaid} onSetLeagueSafe={onSetLeagueSafe} onSetSheet={onSetSheet}
                        onFetchSheet={onFetchSheet} onPasteCsv={onPasteCsv} onAsk={onAsk}
                    />
                ) : missing('Bylaws & Dues')) : null}
            </div>
        </React.Fragment>
    );
}

window.CommissionerOffice = CommissionerOffice;
