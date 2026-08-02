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
    const GOLD = 'var(--gold, #d4af37)', SILVER = 'var(--silver, #9aa0a6)', TEXT = 'var(--text, #e8e8ea)';
    const PANEL = 'var(--panel, #15151b)', LINE = 'var(--ov-4, rgba(255,255,255,0.08))';
    const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';

    const C = window.App && window.App.Commish;
    const [state, setState] = React.useState({ status: 'idle' });
    const [tab, setTab] = React.useState('network'); // network | people | ops | programmes | rulelab | genesis
    const [ackTick, setAckTick] = React.useState(0);
    const [genTick, setGenTick] = React.useState(0);
    // Rule Lab data loads lazily on first open — 18 weeks of league-independent
    // stat lines plus per-league as-played lineups is too heavy for office boot.
    const [ruleLab, setRuleLab] = React.useState({ status: 'idle' });
    const [proposal, setProposal] = React.useState({});
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
    // Season choice: replay THIS season once it has ≥4 counted weeks; else
    // last season — whose lineups live on previous_league_id (Sleeper renews
    // league ids yearly) with last season's users/rosters for naming, scored
    // under THIS season's rules as the baseline being amended.
    const rlRun = React.useRef({ key: null });
    React.useEffect(() => {
        if (tab !== 'rulelab' || ruleLab.status !== 'idle' || state.status !== 'ready') return;
        if (rlRun.current.key === runKey) return;
        const RL = C && C.RuleLab;
        if (!RL) { setRuleLab({ status: 'error' }); return; }
        rlRun.current.key = runKey;
        const live = () => rlRun.current.key === runKey;
        setRuleLab({ status: 'loading' });
        (async () => {
            try {
                const nfl = (window.S && window.S.nflState) || {};
                const curSeason = Number(nfl.season || state.mine[0]?.season || 0);
                const anyCounted = Object.values(state.ledgers || {}).some(ld => (ld.weeks || []).length >= 4);
                const season = anyCounted ? curSeason : curSeason - 1;
                const seasonStats = await RL.loadSeasonStats(season);
                const perLeague = {};
                await Promise.all(state.mine.map(async l => {
                    const lid = String(l.league_id || l.id);
                    let lineupLid = lid, nameLeague = l;
                    if (!anyCounted) {
                        // Hub league objects usually lack previous_league_id (the
                        // hydrator only fetches league info when settings are
                        // missing) — resolve it explicitly before declaring a
                        // league first-season.
                        let prevId = l.previous_league_id;
                        if (!prevId && typeof window.fetchLeagueInfo === 'function') {
                            try { prevId = (await window.fetchLeagueInfo(lid))?.previous_league_id; } catch (e) { /* stays null */ }
                        }
                        if (!prevId) { perLeague[lid] = null; return; }   // genuinely first-year — nothing to replay
                        lineupLid = String(prevId);
                        try {
                            const [users, rosters] = await Promise.all([window.fetchLeagueUsers(lineupLid), window.fetchRosters(lineupLid)]);
                            nameLeague = { ...l, users: users || l.users, rosters: rosters || l.rosters };
                        } catch (e) { /* fall back to current names */ }
                    }
                    const weeks = []; for (let w = 1; w <= 18; w++) weeks.push(w);
                    const lineups = await RL.loadSeasonLineups(lineupLid, weeks);
                    perLeague[lid] = { lineups, nameLeague };
                }));
                if (live()) setRuleLab({ status: 'ready', season, seasonStats, perLeague });
            } catch (e) { window.wrLog?.('commish.rulelab', e); if (live()) setRuleLab({ status: 'error' }); }
        })();
    }, [tab, ruleLab.status, state.status]);

    // Proposal recompute is pure and fast (as-played sums over ~18 weeks);
    // every knob change re-runs the whole omnibus synchronously.
    const ruleLabResults = React.useMemo(() => {
        if (ruleLab.status !== 'ready' || state.status !== 'ready' || !C?.RuleLab?.runProposal) return null;
        return state.mine.map(l => {
            const lid = String(l.league_id || l.id);
            const pack = ruleLab.perLeague[lid];
            if (!pack) return { leagueName: l.name, result: { empty: true, reason: 'first_season' } };
            const mine = (pack.nameLeague.rosters || []).find(r => String(r.owner_id) === String(myUserId));
            try {
                return {
                    leagueName: l.name,
                    result: C.RuleLab.runProposal({
                        league: { ...pack.nameLeague, scoring_settings: l.scoring_settings, settings: l.settings },
                        seasonStats: ruleLab.seasonStats, lineups: pack.lineups, proposal,
                        playersData: state.playersData, myRosterId: mine ? mine.roster_id : null,
                        season: ruleLab.season,
                    }),
                };
            } catch (e) { window.wrLog?.('commish.rulelab.run', e); return { leagueName: l.name, result: { empty: true, reason: 'error' } }; }
        });
    }, [ruleLab.status, state.status, proposal]);

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
    const onGenesisToggle = (leagueId, itemId) => {
        try { C?.Genesis?.toggleManual?.(leagueId, itemId, { nowMs: Date.now() }); } catch (e) { /* unchanged */ }
        setGenTick(t => t + 1);
    };

    // Governance state: treasuries re-read on any bookkeeping change.
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
    const onExportAll = () => {
        if (!window.wrExport || state.status !== 'ready') return;
        (state.programmes || []).forEach(p => {
            if (p && !p.empty) {
                const el = document.getElementById('wr-programme-' + p.leagueId);
                if (el) window.wrExport.capture(el, 'programme-' + (p.leagueName || p.leagueId).replace(/\W+/g, '-').toLowerCase());
            }
        });
    };

    const seg = (k, label) => (
        <button key={k} onClick={() => setTab(k)}
            style={{ padding: '7px 15px', cursor: 'pointer', border: 'none', background: tab === k ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'transparent', color: tab === k ? GOLD : SILVER, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: MONO }}>
            {label}
        </button>
    );

    // The app paints a fixed 0.05-opacity logo watermark on body::before at
    // z-index 0 (index.html:479). Any surface that doesn't paint its own
    // background lets it bleed through — which is exactly what the office was
    // doing. Own the full viewport with an opaque page-bg and sit above it.
    const shell = (children) => (
        <div style={{ position: 'relative', zIndex: 1, background: 'var(--page-bg, #08080B)', minHeight: '100vh' }}>
        <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '20px 16px 60px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '4px' }}>
                <button onClick={onBack} style={{ background: 'transparent', border: `1px solid ${LINE}`, borderRadius: '6px', color: SILVER, cursor: 'pointer', padding: '5px 12px', fontFamily: MONO, fontSize: '0.7rem', letterSpacing: '0.05em' }}>‹ HUB</button>
                <span style={{ fontFamily: 'var(--font-title)', fontWeight: 700, fontSize: '1.25rem', letterSpacing: '.06em', color: GOLD }}>COMMISSIONER'S OFFICE</span>
                <span style={{ fontFamily: MONO, fontSize: '0.66rem', fontWeight: 700, letterSpacing: '.06em', color: 'var(--black)', background: GOLD, borderRadius: '5px', padding: '1px 6px' }}>LABS</span>
                {state.status === 'ready' ? <span style={{ fontFamily: MONO, fontSize: '0.7rem', color: SILVER }}>{state.mine.length} league{state.mine.length !== 1 ? 's' : ''} under your gavel</span> : null}
            </div>
            <div style={{ color: SILVER, fontSize: '0.78rem', marginBottom: '14px' }}>Every league you commission, one desk. Discovered from your Sleeper commissioner flag — nothing to configure.</div>
            {children}
        </div>
        </div>
    );

    if (state.status === 'idle' || state.status === 'loading') {
        return shell(<div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', padding: '18px', color: SILVER, fontFamily: MONO, fontSize: '0.78rem' }}>{state.step || 'Opening the office…'}</div>);
    }
    if (state.status === 'none') {
        return shell(<div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', padding: '18px', color: SILVER, fontSize: '0.82rem', lineHeight: 1.6 }}>No commissioned leagues found on this account. Sleeper marks commissioners on each league — when one of your leagues carries your gavel, the office opens by itself.</div>);
    }
    if (state.status === 'error' || state.status === 'unavailable') {
        return shell(<div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', padding: '18px', color: SILVER, fontSize: '0.82rem' }}>The office couldn't load — league data was unavailable. Try again from the hub.</div>);
    }

    const Net = window.WrCommishCoefficientPanel, Prog = window.WrCommishProgrammePanel;
    const People = window.WrCommishPeoplePanel, Ops = window.WrCommishOpsPanel;
    const missing = (name) => <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', padding: '16px', color: SILVER, fontSize: '0.78rem', fontFamily: MONO }}>{name} module not loaded.</div>;

    // Radar people carry `status` (DARK_ALL/DARK_ONE/FADING/ACTIVE), worst-first.
    const darkCount = state.radar ? state.radar.people.filter(p => p.status === 'DARK_ALL' || p.status === 'DARK_ONE').length : 0;
    const driftCount = state.drift.reduce((s, d) => s + ((d.result && d.result.changes) || []).length, 0);

    return shell(
        <React.Fragment>
            <div style={{ display: 'inline-flex', border: `1px solid ${LINE}`, borderRadius: '6px', overflow: 'hidden', marginBottom: '14px', flexWrap: 'wrap' }}>
                {seg('network', 'The Coefficient')}
                {seg('people', 'People' + (darkCount || state.seats.length ? ' · ' + (darkCount + state.seats.length) : ''))}
                {seg('ops', 'Operations' + (driftCount || state.conflicts.length ? ' · ' + (driftCount + state.conflicts.length) : ''))}
                {seg('programmes', 'Programmes')}
                {seg('rulelab', 'Rule Lab')}
                {seg('genesis', 'Genesis')}
                {seg('governance', 'Bylaws & Dues')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {tab === 'network' ? (Net ? <Net coefficient={state.coefficient} graph={state.graph} /> : missing('Coefficient')) : null}
                {tab === 'people' ? (People ? <People radar={state.radar} seats={state.seats} benches={state.benches} prospectuses={state.prospectuses} folders={state.folders} onCopy={onCopy} /> : missing('People desk')) : null}
                {tab === 'people' && state.renewal && window.WrCommishRenewalPanel ? <window.WrCommishRenewalPanel forecast={state.renewal} /> : null}
                {tab === 'ops' ? (Ops ? <Ops drift={state.drift} calendar={state.calendar} conflicts={state.conflicts} onAcknowledge={onAcknowledge} ackTick={ackTick} /> : missing('Ops desk')) : null}
                {tab === 'programmes' ? (Prog ? <Prog programmes={state.programmes} onExportAll={onExportAll} /> : missing('Programme rack')) : null}
                {tab === 'rulelab' ? (window.WrCommishRuleLabPanel ? (
                    <window.WrCommishRuleLabPanel
                        status={ruleLab.status === 'ready' ? 'ready' : ruleLab.status}
                        seasonUsed={ruleLab.season}
                        proposal={proposal}
                        onProposalChange={setProposal}
                        results={ruleLabResults}
                        presets={(C?.RuleLab && C.RuleLab.PRESETS) || []}
                    />
                ) : missing('Rule Lab')) : null}
                {tab === 'genesis' ? (window.WrCommishGenesisPanel ? (
                    genesis ? <window.WrCommishGenesisPanel readiness={genesis} onToggle={onGenesisToggle} /> : missing('Season Genesis')
                ) : missing('Season Genesis')) : null}
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
