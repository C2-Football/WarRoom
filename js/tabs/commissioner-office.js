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
    const [tab, setTab] = React.useState('network'); // network | people | ops | programmes
    const [ackTick, setAckTick] = React.useState(0);
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
                let coefficient = null, radar = null, drift = [], calendar = { events: [] }, conflicts = [], programmes = [];
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
                    mine, graph, week,
                    coefficient, radar, drift, calendar, conflicts, programmes,
                    seats, benches, prospectuses: prospectuses.filter(Boolean).length ? prospectuses : prospectuses,
                    folders: folders.filter(Boolean),
                });
            } catch (e) {
                window.wrLog?.('commish.office', e);
                if (live()) setState({ status: 'error' });
            }
        })();
    }, [state.status, runKey]);

    const onAcknowledge = (leagueId) => {
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

    const shell = (children) => (
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
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {tab === 'network' ? (Net ? <Net coefficient={state.coefficient} graph={state.graph} /> : missing('Coefficient')) : null}
                {tab === 'people' ? (People ? <People radar={state.radar} seats={state.seats} benches={state.benches} prospectuses={state.prospectuses} folders={state.folders} onCopy={onCopy} /> : missing('People desk')) : null}
                {tab === 'ops' ? (Ops ? <Ops drift={state.drift} calendar={state.calendar} conflicts={state.conflicts} onAcknowledge={onAcknowledge} ackTick={ackTick} /> : missing('Ops desk')) : null}
                {tab === 'programmes' ? (Prog ? <Prog programmes={state.programmes} onExportAll={onExportAll} /> : missing('Programme rack')) : null}
            </div>
        </React.Fragment>
    );
}

window.CommissionerOffice = CommissionerOffice;
