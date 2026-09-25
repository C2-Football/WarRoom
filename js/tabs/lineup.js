// ══════════════════════════════════════════════════════════════════
// js/tabs/lineup.js — LineupTab: weekly Start/Sit Command Center.
// Interactive lineup builder: one unified table where each starting slot
// is a row (assigned player + projection + matchup + rolling form), and
// tapping a slot reveals every eligible roster player so you can set it.
// Working totals + optimal delta update live. League-scored via
// App.WeeklyProj / App.StartSit; auto-fill ranks the selected rolling PPG window.
// NOTE: builds/compares your lineup IN-APP. MFL leagues can push the working
// lineup straight to MyFantasyLeague ("Submit to MFL"); Sleeper has no public
// lineup-write API, so Sleeper lineups are still set on the platform.
// ══════════════════════════════════════════════════════════════════

// Text + color communicate risk without relying on color alone.
function LineupInjuryBadge({ status }) {
    const code = String(status || '').trim().toUpperCase();
    if (!code) return null;
    const label = ({ D: 'Doubtful', DOUBTFUL: 'Doubtful', Q: 'Questionable', QUESTIONABLE: 'Questionable', O: 'Out', OUT: 'Out' })[code] || status;
    const tone = ['D', 'DOUBTFUL', 'O', 'OUT', 'IR', 'PUP', 'SUS', 'DNP', 'COV'].includes(code) ? 'danger' : ['Q', 'QUESTIONABLE'].includes(code) ? 'caution' : 'muted';
    return <span className={'lineup-injury is-' + tone}>{label}</span>;
}

// Stable component identity keeps the player button available for sheet focus return.
const MobilePlayerRow = ({ pos, name, tag, slots, accent, injuryStatus, onClick }) => (
    <button type="button" className={'gd-plan-player' + (accent === 'risk' ? ' is-risk' : '')} onClick={onClick}>
        <span className="gd-player-initial" aria-hidden="true">{pos}</span>
        <span className="gd-player-main"><strong>{name}</strong><LineupInjuryBadge status={injuryStatus} /><span>{tag}</span></span>
        <span className="gd-plan-stats">{(slots || []).map(stat => <span key={stat.label}><strong>{stat.value}</strong><small>{stat.label === 'PROJ' ? 'Proj' : stat.label}</small></span>)}</span>
        <span className="gd-row-chevron" aria-hidden="true">›</span>
    </button>
);

// One always-visible matchup view for desktop and phone.
function MatchupBreakdown({ matchup, week, pro, pmeta, upgrade }) {
    if (!matchup) return null;
    const fmt = value => Number.isFinite(value) ? value.toFixed(1) : '—';
    const gap = (a, b) => Number.isFinite(a) && Number.isFinite(b) ? Math.round((a - b) * 10) / 10 : null;
    const tone = delta => delta == null || delta === 0 ? 'even' : delta > 0 ? 'ahead' : 'behind';
    const edge = delta => delta == null ? 'Unavailable' : delta === 0 ? 'Even' : (delta > 0 ? 'You +' : 'Them +') + fmt(Math.abs(delta));
    const rows = matchup.h2h.map(row => ({ ...row, delta: gap(row.myMed, row.theirMed) }));
    const positions = matchup.posStrength.map(row => ({ ...row, delta: gap(row.mine, row.theirs) }));
    const incomplete = positions.some(row => row.delta == null);
    const best = positions.filter(row => row.delta > 0).sort((a, b) => b.delta - a.delta)[0];
    const toughest = positions.filter(row => row.delta != null && row.delta < 0).sort((a, b) => a.delta - b.delta)[0];
    const close = rows.filter(row => row.delta != null && Math.abs(row.delta) <= 2);
    const leads = rows.filter(row => row.delta > 0).length;
    const largest = Math.max(0, ...rows.map(row => Math.abs(row.delta || 0)));
    const maxPosition = Math.max(1, ...positions.flatMap(row => [Math.abs(row.mine || 0), Math.abs(row.theirs || 0)]));
    const margin = matchup.fc.margin;
    return <section className="gd-matchup" aria-label="Weekly matchup breakdown">
        <div className="gd-matchup-heading">
            <div><div className="gd-matchup-eyebrow">Week {week} · Matchup outlook</div><h2>vs {matchup.oppName}</h2>
                <p>Projected points · your lineup plan vs their {pro ? 'optimal' : 'current'} lineup</p>
                <div className="gd-matchup-totals"><span><strong>{fmt(matchup.fc.projMe)}</strong><small>You</small></span><span className="gd-matchup-versus">vs</span><span><strong>{fmt(pro ? matchup.fc.projOpp : matchup.oppCurTotal > 0 ? matchup.oppCurTotal : null)}</strong><small>Them</small></span></div>
            </div>
            {pro ? <div className={'gd-matchup-odds is-' + tone(margin)}><strong>{matchup.fc.winPct == null ? '—' : matchup.fc.winPct + '%'}</strong><span>Win probability</span><small>{margin == null ? 'Forecast unavailable' : margin === 0 ? 'Even projection' : fmt(Math.abs(margin)) + ' pts ' + (margin > 0 ? 'ahead' : 'behind')}</small></div> : null}
        </div>
        {pro ? <React.Fragment>
            <p className="gd-matchup-context">Their current lineup: {matchup.oppCurTotal > 0 ? fmt(matchup.oppCurTotal) : '—'} · Optimal: {fmt(matchup.oppIdealTotal)}{matchup.oppCurTotal > 0 && matchup.oppIdealTotal - matchup.oppCurTotal > 0.5 ? <span> · {fmt(matchup.oppIdealTotal - matchup.oppCurTotal)} projected points on their bench</span> : null}</p>
            <div className="gd-matchup-focus" aria-label="Matchup key edges">
                <div className="is-ahead"><small>Your biggest edge</small><strong>{best ? best.pos + ' +' + fmt(best.delta) : incomplete ? 'Incomplete data' : 'No projected edge'}</strong><span>{best ? 'Your strongest position advantage' : 'Look for gains in the close slots'}</span></div>
                <div className="is-behind"><small>Biggest gap</small><strong>{toughest ? toughest.pos + ' −' + fmt(Math.abs(toughest.delta)) : incomplete ? 'Incomplete data' : 'No projected deficit'}</strong><span>{toughest ? 'Their strongest position advantage' : incomplete ? 'Some projections are unavailable' : 'No position group trails'}</span></div>
                <div className="is-close"><small>Close contests</small><strong>{close.length} {close.length === 1 ? 'slot' : 'slots'}</strong><span>Within 2 projected points</span></div>
            </div>
            <div className="gd-matchup-section-heading"><h3>Position strength</h3><span>Projected points</span></div>
            <div className="gd-position-legend"><span>You ◀</span><span>▶ Opponent</span></div>
            <div className="gd-position-list">{positions.map(row => <div key={row.pos} className={'gd-position-row is-' + tone(row.delta)}>
                <strong>{row.pos}</strong><span className="gd-position-value">{fmt(row.mine)}</span>
                <div className="gd-position-bars" role="img" aria-label={row.pos + ': you ' + fmt(row.mine) + ', opponent ' + fmt(row.theirs)}><span><i style={{ width: Math.min(100, Math.abs(row.mine || 0) / maxPosition * 100) + '%' }} /></span><span><i style={{ width: Math.min(100, Math.abs(row.theirs || 0) / maxPosition * 100) + '%' }} /></span></div>
                <span className="gd-position-value">{fmt(row.theirs)}</span><span className={'gd-matchup-edge is-' + tone(row.delta)}>{edge(row.delta)}</span>
            </div>)}</div>
            <div className="gd-matchup-section-heading"><h3>Slot by slot</h3><span>You lead {leads} of {rows.length}</span></div>
            <p className="gd-matchup-key">Green: your edge · Red: their edge · Gold outline: within 2 pts{rows.some(row => row.delta == null) ? ' · Some projections unavailable' : ''}</p>
            <div className="gd-matchup-slot-head" aria-hidden="true"><span>Slot</span><span>You</span><span>Edge</span><span>Opponent</span></div>
            <div className="gd-matchup-slots">{rows.map((row, index) => <div key={index} className={'gd-matchup-slot is-' + tone(row.delta) + (row.delta != null && Math.abs(row.delta) <= 2 ? ' is-close' : '') + (largest > 0 && Math.abs(row.delta) === largest ? ' is-key' : '')}>
                <strong className="gd-matchup-slot-label">{row.slot.replace('_', ' ')}</strong>
                <div className="gd-matchup-player gd-matchup-you"><small>You</small><span>{row.myPid ? pmeta(row.myPid).name : 'Empty slot'}</span><strong>{fmt(row.myMed)}</strong></div>
                <span className={'gd-matchup-edge is-' + tone(row.delta)}>{edge(row.delta)}</span>
                <div className="gd-matchup-player gd-matchup-them"><small>Opponent</small><span>{row.theirPid ? pmeta(row.theirPid).name : 'Empty slot'}</span><strong>{fmt(row.theirMed)}</strong></div>
            </div>)}</div>
        </React.Fragment> : upgrade}
    </section>;
}

function LineupTab({
    myRoster, currentLeague, leagueSkin, playersData, statsData, stats2025Data,
    sleeperUserId, gmStrategy, setActiveTab, timeRecomputeTs, rosterView = false,
}) {
    const WP = window.App && window.App.WeeklyProj;
    const SS = window.App && window.App.StartSit;
    const normPos = (window.App && window.App.normPos) || (p => p);
    // Partial free/Pro gate (owner ruling 2026-07-05): FREE keeps the manual
    // builder, raw per-player projections, bye listing and the MFL push
    // (incl. pre-season building). PRO = the optimizer layer: optimal
    // hero/delta, floor–ceiling bands, matchup grades, win %, opponent
    // strength, bye recs, the Alex note. Supersedes the old whole-tab
    // STARTSIT_DEPTH gate.
    const pro = typeof window.wrIsPro !== 'function' || window.wrIsPro();
    const GatedRow = window.WrGatedMoreRow;
    const STARTSIT_FEAT = (window.FEATURES && window.FEATURES.STARTSIT_DEPTH) || 'startsit_depth';
    const [ctxTick, setCtxTick] = React.useState(0); // bumps when NFL matchup context (opponent/weather/odds) loads

    React.useEffect(() => {
        const refreshForm = event => {
            const id = currentLeague?.id || currentLeague?.league_id;
            if (event.detail?.leagueId != null && String(event.detail.leagueId) !== String(id)) return;
            setCtxTick(tick => tick + 1);
        };
        window.addEventListener('wr:weekly-points-loaded', refreshForm);
        return () => window.removeEventListener('wr:weekly-points-loaded', refreshForm);
    }, [currentLeague?.id, currentLeague?.league_id]);

    const result = React.useMemo(() => {
        if (!WP || !myRoster || !currentLeague) return null;
        try {
            return WP.optimalForRoster(myRoster, currentLeague, {
                playersData, statsData, priorData: stats2025Data,
            });
        } catch (e) { if (window.wrLog) window.wrLog('lineup.compute', e); return null; }
    }, [myRoster, currentLeague, playersData, statsData, timeRecomputeTs, ctxTick]);

    const Live = window.App && window.App.LeagueLiveScores;
    const liveWeek = Live ? Live.currentWeek(currentLeague) : (result && result.week) || 1;
    const liveScores = Live ? Live.useScores({ league: currentLeague, week: liveWeek }) : { rows: [], status: 'unavailable', supported: false };
    const liveRow = (liveScores.rows || []).find(r => String(r.roster_id) === String(myRoster && myRoster.roster_id));
    const platformStarters = liveRow && Array.isArray(liveRow.starters) ? liveRow.starters : ((myRoster && myRoster.starters) || []);
    const [nflGames, setNflGames] = React.useState({ key: '', games: [], updatedAt: 0 });
    const liveKey = String(currentLeague && (currentLeague.league_id || currentLeague.id) || '') + '|' + String(currentLeague && currentLeague.season) + '|' + liveWeek;
    React.useEffect(() => {
        let alive = true, busy = false;
        const NC = window.App && window.App.NflContext;
        const refresh = async () => {
            if (busy || !NC || !NC.loadScores || document.hidden) return;
            busy = true;
            try {
                const games = await NC.loadScores(liveWeek, currentLeague && currentLeague.season, 2);
                if (alive && games && games.length) setNflGames({ key: liveKey, games, updatedAt: Date.now() });
            } finally { busy = false; }
        };
        refresh();
        const timer = setInterval(refresh, 30000);
        document.addEventListener('visibilitychange', refresh);
        return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
    }, [liveKey]);
    const games = nflGames.key === liveKey ? nflGames.games : [];
    const statusOfGame = game => window.App?.NflContext?.gameStatus?.(game) || 'unknown';
    const gameFor = pid => {
        const aliases = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR' };
        const raw = String(playersData?.[pid]?.team || '').toUpperCase();
        const team = aliases[raw] || raw;
        return games.find(g => g.home === team || g.away === team);
    };
    const gameState = pid => statusOfGame(gameFor(pid));
    const gamesFresh = nflGames.key === liveKey && Date.now() - nflGames.updatedAt < 90000;
    const weekStarted = games.some(g => ['live', 'final', 'locked'].includes(statusOfGame(g)));
    const optimizerAvailable = gamesFresh && games.length > 0 && !weekStarted
        && games.every(g => statusOfGame(g) === 'upcoming')
        && ((myRoster && myRoster.players) || []).filter(pid => result?.projections?.[pid]?.available !== false).every(pid => gameState(pid) === 'upcoming');
    const canChangePlayer = pid => !pid || (gamesFresh && gameState(pid) === 'upcoming');

    const [formWindow, setFormWindow] = React.useState(5); // rolling-PPG window: 3 | 5 | 8 | 'season'
    const [openSlot, setOpenSlot] = React.useState(null);  // slot idx whose picker is expanded
    const [draftAssign, setWorkingAssign] = React.useState({}); // slotIdx -> pid (the user's working lineup)
    const [applyOpen, setApplyOpen] = React.useState(false);      // phone-only: WR.ActionBar apply/push sheet (inert off-phone)
    const [phoneView, setPhoneView] = React.useState('week');     // phone Game Day: 'week' (matchup + lineup) | 'season' (outlook + schedule)
    const [appliedMoves, setAppliedMoves] = React.useState(null); // phone: swap list shown after Apply Optimal ({sl,cur,opt,gain}[])
    const [explainPid, setExplainPid] = React.useState(null);     // "why this number" ledger target (Pro; tap a projection)
    // Game Day view (owner ruling 2026-07-30: Season Odds belongs here, not in
    // Analytics). Phone: This Week | Season | Odds. Desktop already shows the
    // season rail alongside the lineup, so it only needs This Week | Odds.
    const [gdView, setGdView] = React.useState('week');           // 'week' | 'odds' (desktop) — phone adds 'season' via phoneView
    // Projected record from the Season Odds simulation, when it has run. The
    // rail prefers this over schedule-engine's per-week sum so Game Day never
    // prints two different projected records on one screen.
    const [simSummary, setSimSummary] = React.useState(null);
    const onSimSummary = React.useCallback(s => setSimSummary(s), []);

    const GOLD = 'var(--gold, #d4af37)', SILVER = 'var(--silver, #9aa0a6)', TEXT = 'var(--text, #e8e8ea)';
    const GREEN = 'var(--k-2ecc71, #2ecc71)', RED = 'var(--k-e74c3c, #e74c3c)', AMBER = 'var(--k-f0a500, #f0a500)';
    const PANEL = 'var(--panel, #15151b)', LINE = 'var(--ov-4, rgba(255,255,255,0.08))';
    // Shared viewport seam (js/shared/viewport.js). isNarrow (≤900, threshold
    // unchanged) collapses the right rail below the main column; isPhone (<768)
    // drives the phone column-set + touch sizing — the tablet (768–1023) and
    // desktop (≥1024) tiers render exactly as before.
    const _vp = window.WR.useViewport();
    const isNarrow = _vp.width <= 900;
    const isPhone = !!_vp.isPhone;
    // Phone micro-type floor (plan D7): sub-0.65rem labels read at ~9px — lift
    // them to 0.7rem at the phone tier only; other tiers get the exact literal.
    const fz = s => (isPhone && parseFloat(s) < 0.65 ? '0.7rem' : s);
    // Free drops the Mtch column (A–F matchup grade is a Pro interpretation).
    // Phone drops the Form/Hi/Lo columns so rows fit 375px with no horizontal
    // scroll — form stats resurface inside the row-tap expand instead.
    const GRID = isPhone
        ? (pro ? '50px minmax(0,1fr) 54px 34px' : '50px minmax(0,1fr) 54px')
        : (pro ? '50px minmax(0,1fr) 58px 50px 48px 38px 38px' : '50px minmax(0,1fr) 58px 48px 38px 38px');
    const SLOT_DISPLAY_ORDER = { QB: 1, RB: 2, WR: 3, TE: 4, REC_FLEX: 5, FLEX: 6, WRTQ: 7, SUPER_FLEX: 8, K: 20, DEF: 21, IDP_FLEX: 30, DL: 31, LB: 32, DB: 33, WILDCARD: 40 };
    const BENCH = new Set(['BN', 'BE', 'BENCH', 'IR', 'TAXI', 'RES']);

    function pmeta(pid) {
        const p = (playersData && playersData[pid]) || {};
        const name = p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || String(pid);
        return { name, pos: normPos(p.position) || p.position || '', team: p.team || '' };
    }
    const gradeColor = g => (g === 'A' ? GREEN : g === 'B' ? GOLD : g === 'C' ? SILVER : g === 'D' ? AMBER : RED);

    // ── Starting slots (aligned with roster.starters order) + display order ──
    const startingSlots = React.useMemo(() => {
        if (!SS) return [];
        const out = [];
        let k = 0;
        (currentLeague && currentLeague.roster_positions || []).forEach(raw => {
            const s = SS.normSlot(raw);
            if (BENCH.has(s)) return;
            const elig = SS.FLEX_ALLOWED[s] || (SS.BASE_POSITIONS.has(s) ? [s] : null);
            if (!elig) { k++; return; } // unknown starting slot — keep starters[] alignment
            out.push({ idx: k, slotName: s, elig });
            k++;
        });
        return out;
    }, [currentLeague]);

    // Current lineup from the platform (roster.starters aligns with non-bench slots).
    const currentAssign = React.useMemo(() => {
        const arr = platformStarters;
        const cur = {};
        startingSlots.forEach(sl => { const pid = arr[sl.idx]; if (pid && String(pid) !== '0') cur[sl.idx] = String(pid); });
        return cur;
    }, [platformStarters.join(','), startingSlots]);

    // Submitted slots win at kickoff, even if a local draft benched or moved
    // that player earlier. Never treat an unsubmitted draft as live scoring.
    const workingAssign = { ...draftAssign };
    const lockedSubmitted = new Set(Object.values(currentAssign).filter(pid => !canChangePlayer(pid)));
    startingSlots.forEach(sl => {
        const submitted = currentAssign[sl.idx];
        const planned = workingAssign[sl.idx];
        if (submitted && lockedSubmitted.has(submitted)) workingAssign[sl.idx] = submitted;
        else if (planned && (!canChangePlayer(planned) || lockedSubmitted.has(planned))) {
            if (submitted) workingAssign[sl.idx] = submitted;
            else delete workingAssign[sl.idx];
        }
    });

    const formWinLabel = formWindow === 'season' ? 'SZN' : 'L' + formWindow;
    const formOf = pid => WP?.formStats?.(pid, formWindow);
    const formPts = pid => {
        const value = formOf(pid)?.rollingPPG;
        return Number.isFinite(value) ? value : null;
    };
    const injuryOf = pid => result?.projections?.[pid]?.injuryStatus || playersData?.[pid]?.injury_status || '';
    const byForm = (a, b) => (formPts(b) ?? -Infinity) - (formPts(a) ?? -Infinity);
    // Use actual league-scored history directly. Projection injury discounts,
    // matchup multipliers, and GM strategy must not reorder rolling averages.
    const formOptimal = React.useMemo(() => {
        if (!SS?.optimalLineupWeekly) return { starters: [], total: 0 };
        const reserves = new Set([...(myRoster?.reserve || []), ...(myRoster?.taxi || [])].map(String));
        const pool = (myRoster?.players || []).map(String).filter(pid => !reserves.has(pid)).map(pid => ({
            pid, pos: pmeta(pid).pos, pts: formPts(pid),
            available: result?.projections?.[pid]?.available !== false && SS.availability(injuryOf(pid)).available && gameState(pid) === 'upcoming',
        }));
        return SS.optimalLineupWeekly(pool, currentLeague?.roster_positions || []);
    }, [myRoster, currentLeague, playersData, result, formWindow, ctxTick, nflGames]);
    const formComplete = startingSlots.length > 0 && formOptimal.starters.length === startingSlots.length;
    const canOptimize = optimizerAvailable && formComplete;
    const missingPlanForm = startingSlots.some(sl => formPts(workingAssign[sl.idx]) == null);
    const objPts = pid => formPts(pid) ?? 0;
    const workingTotal = Object.values(workingAssign).filter(Boolean).reduce((sum, pid) => sum + objPts(pid), 0);
    const optimalTotal = formOptimal.total;
    const benchPts = Math.round((optimalTotal - workingTotal) * 10) / 10;
    const planUnavailable = Object.values(workingAssign).some(pid => result?.projections?.[pid]?.available === false || SS?.availability?.(injuryOf(pid))?.available === false);
    const isOptimal = formComplete && !missingPlanForm && benchPts <= 0.05
        && !planUnavailable;
    const formHelp = !optimizerAvailable ? 'Auto-fill is paused while games are underway or kickoff status is unverified.'
        : !formComplete ? 'More eligible players with game history are needed to auto-fill every slot. You can still set slots manually.'
        : 'Auto-fill and replacements use ' + formWinLabel + ' PPG. Doubtful and questionable players stay ranked by average; review their injury flags.';
    function applyOptimal() {
        if (!pro || !canOptimize) return;
        const byName = {};
        formOptimal.starters.forEach(s => { (byName[s.slot] = byName[s.slot] || []).push(s.pid); });
        const next = {};
        startingSlots.forEach(sl => { const arr = byName[sl.slotName]; if (arr && arr.length) next[sl.idx] = String(arr.shift()); });
        setWorkingAssign(next); setOpenSlot(null);
    }

    // Reset the working lineup to the platform lineup ONLY when the league or
    // the platform starters actually change — keyed on a stable string so an
    // incidental re-render never wipes the user's in-progress edits / open slot.
    const lineupKey = liveKey + '|' + platformStarters.join(',');
    React.useEffect(() => { setWorkingAssign(currentAssign); setOpenSlot(null); }, [lineupKey]);

    // Load real NFL matchup context (opponent + Vegas implied total/spread +
    // weather) for the current week, then recompute projections once it lands.
    React.useEffect(() => {
        const NC = window.App && window.App.NflContext;
        if (!NC || !NC.loadCurrent) return;
        let alive = true;
        NC.loadCurrent(currentLeague && currentLeague.season).then(map => {
            if (alive && map && Object.keys(map).length) setCtxTick(t => t + 1);
        }).catch(() => {});
        return () => { alive = false; };
    }, [lineupKey]);

    // ── Weekly opponent (head-to-head): resolve, project, forecast ──
    const [oppRosterId, setOppRosterId] = React.useState(null);
    React.useEffect(() => {
        const M = window.App && window.App.Matchup;
        if (!M || !myRoster || !currentLeague) return;
        let alive = true; setOppRosterId(null);
        const wk = WP && WP.currentWeek ? WP.currentWeek() : 1;
        M.resolveOpponentRosterId({ league: currentLeague, myRosterId: myRoster.roster_id, week: wk })
            .then(id => { if (alive) setOppRosterId(id != null ? String(id) : null); })
            .catch(() => {});
        return () => { alive = false; };
    }, [lineupKey]);
    const oppResult = React.useMemo(() => {
        if (!WP || !oppRosterId || !currentLeague) return null;
        const oppRoster = (currentLeague.rosters || []).find(r => String(r.roster_id) === String(oppRosterId));
        if (!oppRoster) return null;
        try { return { roster: oppRoster, res: WP.optimalForRoster(oppRoster, currentLeague, { playersData, statsData, priorData: stats2025Data, objective: 'median' }) }; }
        catch (e) { if (window.wrLog) window.wrLog('lineup.oppProject', e); return null; }
    }, [oppRosterId, currentLeague, playersData, statsData, timeRecomputeTs, ctxTick]);

    // ── Game Day Central: DvP, season schedule rail, Alex note, MFL push ──
    const [seasonData, setSeasonData] = React.useState(null);
    const [note, setNote] = React.useState('');
    // Game-plan expansion — one-shot follow-up on the ambient note (replaced
    // the old "ASK" chat handoff). Reuses the same AlexVoice.enhance()
    // template-first pattern the note itself already uses.
    const [gameplanTake, setGameplanTake] = React.useState(null); // null | {loading} | {text}
    async function askGameplanTake() {
        if (!optimizerAvailable || typeof window.AlexVoice?.enhance !== 'function') return;
        setGameplanTake({ loading: true });
        const facts = buildNoteFacts();
        if (!facts) { setGameplanTake(null); return; }
        const text = await window.AlexVoice.enhance({
            type: 'start-sit',
            message: 'Give me a fuller game-plan for this week in 3-4 sentences — the start/sit calls worth a second look, where I can attack this matchup, and what would change your read before kickoff. Natural prose, no lists, no sign-off.',
            context: JSON.stringify(facts.ctx),
            fallback: null,
            cacheKey: 'gd-plan-v1-' + lineupKey + '-w' + facts.week,
        });
        setGameplanTake(text ? { text } : null);
    }
    const [submit, setSubmit] = React.useState({ status: 'idle', msg: '' });
    // Real DvP: spin up the SOS engine (18-week defense-vs-position rankings),
    // then bump ctxTick so projections recompute with matchup context applied.
    React.useEffect(() => {
        const SOS = window.App && window.App.SOS;
        if (!SOS || !SOS.initialize) return;
        let alive = true;
        SOS.initialize(currentLeague && currentLeague.season, playersData, () => { if (alive) setCtxTick(t => t + 1); });
        return () => { alive = false; };
    }, [lineupKey]);

    // Full-season schedule + win projection for the right rail. Wait until the
    // main projection is ready (non-zero) before building/caching — otherwise an
    // early run (stats prop not yet populated) would cache an all-zero season.
    const _projReady = !!(result && result.optimal && result.optimal.total > 0);
    React.useEffect(() => {
        const Sch = window.App && window.App.Schedule;
        if (!Sch || !Sch.buildSeason || !myRoster || !currentLeague || !_projReady) return;
        let alive = true;
        Sch.buildSeason({ league: currentLeague, myRoster, playersData, statsData, stats2025Data })
            .then(d => { if (alive && d) setSeasonData(d); })
            .catch(() => {});
        return () => { alive = false; };
    }, [lineupKey, ctxTick, _projReady]);

    // Alex's game-day note: a stable weekly briefing off the CURRENT lineup +
    // matchup (not the working edits). Seeded template renders instantly; AI
    // upgrades it in the background when reachable (falls back to the template).
    function buildNoteFacts() {
        if (!result || !result.optimal) return null;
        const proj = result.projections;
        const curIds = Object.values(currentAssign).filter(Boolean);
        // MFL never exposes platform starters (starters:[]) — fall back to the
        // optimal lineup so the note forecasts the same lineup as the hero.
        // With the fallback there IS no visible bench gap: benchPts reads 0 and
        // no upgrade is pitched (a delta vs an empty platform lineup would
        // claim the whole optimal total is "stranded on the bench").
        const noPlatformLineup = !curIds.length;
        const noteIds = noPlatformLineup ? formOptimal.starters.map(s => String(s.pid)) : curIds;
        const curTotal = noteIds.reduce((s, pid) => s + objPts(pid), 0);
        const benchPts = noPlatformLineup || !formComplete || noteIds.some(pid => formPts(pid) == null) ? 0 : Math.round((formOptimal.total - curTotal) * 10) / 10;
        let topStart = null;
        if (!noPlatformLineup) formOptimal.starters.filter(s => !curIds.includes(String(s.pid))).forEach(s => { if (!topStart || s.pts > topStart.pts) topStart = s; });
        let winPct = null, oppName = null, margin = null;
        const M = window.App && window.App.Matchup;
        if (M && oppResult && oppResult.res) {
            const oppOpt = oppResult.res.optimal.starters.map(s => s.pid);
            const fc = M.forecast(M.dist(noteIds, proj, 'median'), M.dist(oppOpt, oppResult.res.projections, 'median'));
            winPct = fc.winPct; margin = fc.margin;
            const users = (currentLeague && currentLeague.users) || [];
            const u = users.find(x => String(x.user_id) === String(oppResult.roster.owner_id));
            oppName = (oppResult.roster.metadata && oppResult.roster.metadata.team_name) || (u && u.display_name) || ('Team ' + oppResult.roster.roster_id);
        }
        const injuries = noteIds.map(pid => { const p = proj[pid]; const st = p && p.injuryStatus; return st ? { name: pmeta(pid).name, status: st } : null; }).filter(Boolean);
        const topName = topStart ? pmeta(topStart.pid).name : null;
        const byeWatch = (seasonData && seasonData.byeWatch) || [];
        const topBye = byeWatch.length ? byeWatch[0] : null;   // worst upcoming bye week
        return {
            week: result.week, benchPts, topStart, topName, winPct, oppName, margin, injuries, mode: result.mode, topBye,
            ctx: { week: result.week, winPct, margin, opponent: oppName, pointsLeftOnBench: benchPts, topUpgrade: topName, topUpgradeSlot: topStart ? topStart.slot : null, injuries: injuries.map(i => i.name + ' (' + i.status + ')'), byeWatch: byeWatch.slice(0, 3).map(b => ({ week: b.week, count: b.count, unfilled: b.unfilled, reason: b.reason, positions: b.positions })), objective: formWinLabel + ' rolling PPG (not weekly projections)', mode: result.mode },
        };
    }
    function seededNote(f) {
        const AV = window.AlexVoice;
        if (!AV) return '';
        const seed = (currentLeague && (currentLeague.league_id || currentLeague.id) || '') + '|w' + f.week;
        let lead;
        if (f.winPct != null && f.oppName) {
            // Thresholds match the hero's win% coloring: ≥55 favored, ≤45 uphill.
            if (f.winPct >= 55) lead = AV.pick(seed + 'a', ['You’re favored this week', 'The numbers like your side', 'You’ve got the edge this week']) + ' — about ' + f.winPct + '% to beat ' + f.oppName + '.';
            else if (f.winPct > 45) lead = AV.pick(seed + 'a', ['Coin-flip week', 'This one’s tight', 'Dead heat']) + ' against ' + f.oppName + ' (~' + f.winPct + '%).';
            else lead = AV.pick(seed + 'a', ['Uphill week', 'You’re the underdog', 'Tough draw']) + ' vs ' + f.oppName + ' (~' + f.winPct + '%) — chase ceiling.';
        } else {
            lead = AV.pick(seed + 'a', ['Let’s set the week', 'Here’s your week', 'Locking in the lineup']) + '.';
        }
        let mid;
        if (f.benchPts >= 1 && f.topName) mid = ' ' + AV.pick(seed + 'b', ['You’re leaving ' + f.benchPts + ' ' + formWinLabel + ' PPG on the bench', 'There’s ' + f.benchPts + ' ' + formWinLabel + ' PPG sitting on your bench', f.benchPts + ' ' + formWinLabel + ' PPG are on the bench']) + ' — ' + f.topName + (f.topStart && f.topStart.slot ? ' into your ' + String(f.topStart.slot).replace('_', ' ') : '') + ' is the move.';
        else mid = ' ' + AV.pick(seed + 'b', ['Lineup’s optimal', 'Nothing left on the table', 'Your best is already in']) + ' — no changes needed.';
        let tail = '';
        if (f.injuries && f.injuries.length) tail = ' ' + AV.pick(seed + 'c', ['Keep an eye on', 'Watch', 'Monitor']) + ' ' + AV.joinNatural(f.injuries.map(i => i.name)) + '.';
        let byeTail = '';
        if (f.topBye && (f.topBye.unfilled || f.topBye.count >= 2)) {
            const b = f.topBye;
            // Only blame byes when bye starters actually drive the hole —
            // count===0 means a roster gap (position unrostered / players OUT).
            const byeDriven = b.reason ? b.reason === 'bye' : b.count > 0;
            if (byeDriven) {
                const c = {}; (b.positions || []).forEach(p => { c[p] = (c[p] || 0) + 1; });
                const posLabel = Object.keys(c).map(p => c[p] > 1 ? c[p] + ' ' + p + 's' : p).join(' + ');
                byeTail = ' ' + AV.pick(seed + 'd', ['Bye watch —', 'Plan ahead —', 'Down the road —']) + ' Week ' + b.week + (b.unfilled ? ' leaves a hole' : ' you’re thin') + (posLabel ? ' at ' + posLabel : '') + ', so line up cover.';
            } else if (b.unfilled) {
                byeTail = ' ' + AV.pick(seed + 'd', ['Plan ahead —', 'Heads up —', 'Down the road —']) + ' Week ' + b.week + ' you can’t field a full lineup as rostered, so line up cover.';
            }
        }
        return (lead + mid + tail + byeTail).trim();
    }
    React.useEffect(() => {
        // Composed note guard: the seeded copy is itself a rec ("X is the
        // move"), so the whole note is Pro-only — free renders no note (and
        // never builds facts, so no optimizer output is computed for free).
        // Future format carve-outs (cross-track C5) compose in here, e.g.
        // `pro && isDynastyFormat`. The AV.enhance AI upgrade below is
        // additionally behind hasAmbientAI() (ambient-AI policy seam) — a Pro
        // user without AI still keeps the seeded template.
        const noteAllowed = pro && optimizerAvailable && !rosterView;
        if (!noteAllowed) { setNote(''); return; }
        if (!_projReady) return;                 // wait for real projections (avoid a stale AI-note cache)
        const facts = buildNoteFacts();
        if (!facts) { setNote(''); return; }
        const seeded = seededNote(facts);
        setNote(seeded);
        let alive = true;
        const AV = window.AlexVoice;
        if (AV && AV.enhance && (typeof AV.hasAmbientAI !== 'function' || AV.hasAmbientAI())) {
            // Bucket win% into the cache key so a materially different matchup
            // outlook re-generates rather than reusing an early note. v2: the
            // facts source changed to rolling PPG — don't let notes
            // cached off the old empty-lineup facts survive the fix.
            const wpBucket = facts.winPct == null ? 'na' : Math.round(facts.winPct / 10);
            AV.enhance({
                type: 'start-sit',
                message: 'Give me a punchy 1-2 sentence game-day coaching note for my fantasy team this week. Are we favored? Any must-start upgrade sitting on the bench? Any injuries to watch, or an upcoming bye-week hole to plan for? Natural prose, no lists, no sign-off.',
                context: JSON.stringify(facts.ctx),
                fallback: seeded,
                cacheKey: 'gd-note-form-' + formWinLabel + '-' + ctxTick + '-' + lineupKey + '-w' + facts.week + '-' + wpBucket + (facts.topBye ? '-b' + facts.topBye.week + (facts.topBye.unfilled ? 'x' : '') : ''),
            }).then(txt => { if (alive && txt && typeof txt === 'string') setNote(txt); }).catch(() => {});
        }
        return () => { alive = false; };
    }, [lineupKey, ctxTick, oppRosterId, _projReady, seasonData, optimizerAvailable, formWindow, formComplete]);

    // Invalidate the game-plan expansion on the same signals the note above
    // regenerates on — otherwise a stale plan for last week or a different
    // league keeps showing, with the trigger button permanently hidden and
    // no way to refresh it.
    React.useEffect(() => { setGameplanTake(null); }, [lineupKey, ctxTick, oppRosterId, _projReady, seasonData, optimizerAvailable, formWindow, formComplete]);

    // MFL is the only platform with a public lineup-write API (Sleeper has none).
    const _plat = (window.App && window.App.Matchup && window.App.Matchup._platform) ? window.App.Matchup._platform(currentLeague) : 'sleeper';
    const isMfl = _plat === 'mfl';
    const mflApiKey = (window.S && window.S._mflApiKey) || (function () { try { return sessionStorage.getItem('mfl_api_key') || localStorage.getItem('mfl_api_key'); } catch (e) { return null; } })();

    // MFL requires a login COOKIE (not the API key) to set a lineup. Keep only the
    // session token (sessionStorage, cleared on tab close); the password is used
    // once to obtain it and never stored.
    const [mflCookie, setMflCookie] = React.useState(() => { try { return sessionStorage.getItem('mfl_write_cookie') || ''; } catch (e) { return ''; } });
    const [mflHost, setMflHost] = React.useState(() => { try { return sessionStorage.getItem('mfl_write_host') || ''; } catch (e) { return ''; } });
    const [mflUser, setMflUser] = React.useState('');
    const [mflPass, setMflPass] = React.useState('');
    const [mflAuthBusy, setMflAuthBusy] = React.useState(false);
    const [mflAuthErr, setMflAuthErr] = React.useState('');
    async function doMflLogin() {
        if (!window.MFL || !window.MFL.mflLogin) { setMflAuthErr('MFL connector unavailable.'); return; }
        if (!mflUser || !mflPass) { setMflAuthErr('Enter your MFL username and password.'); return; }
        setMflAuthBusy(true); setMflAuthErr('');
        try {
            const yr = currentLeague.season || (window.S && window.S.mflYear);
            const out = await window.MFL.mflLogin({ username: mflUser, password: mflPass, year: yr });
            try { sessionStorage.setItem('mfl_write_cookie', out.cookie); if (out.host) sessionStorage.setItem('mfl_write_host', out.host); } catch (e) {}
            setMflCookie(out.cookie); setMflHost(out.host || ''); setMflPass('');
        } catch (e) { setMflAuthErr((e && e.message) || 'MFL login failed.'); }
        finally { setMflAuthBusy(false); }
    }
    function mflDisconnect() {
        try { sessionStorage.removeItem('mfl_write_cookie'); sessionStorage.removeItem('mfl_write_host'); } catch (e) {}
        setMflCookie(''); setMflHost(''); setSubmit({ status: 'idle', msg: '' });
    }
    async function pushToMfl() {
        if (!optimizerAvailable) { setSubmit({ status: 'error', msg: 'Set game-day changes on MFL directly so its lineup locks are enforced.' }); return; }
        const MFL = window.MFL;
        if (!MFL || !MFL.submitLineup) { setSubmit({ status: 'error', msg: 'MFL connector unavailable.' }); return; }
        // Fail closed: if any starting slot TYPE wasn't recognized (so it was
        // dropped from startingSlots), we'd under-submit and MFL's replace-all
        // would bench it. Block rather than silently overwrite.
        const trueStartCount = (currentLeague.roster_positions || []).filter(p => { const s = SS.normSlot(p); return s && !BENCH.has(s); }).length;
        if (startingSlots.length < trueStartCount) {
            setSubmit({ status: 'error', msg: 'Your lineup has a slot type we don’t fully support yet — set this lineup on MFL directly to be safe.' });
            return;
        }
        // MFL's lineup import is REPLACE-ALL: any starting slot we omit gets
        // benched. Refuse to push unless every starting slot is filled.
        const emptySlots = startingSlots.filter(sl => !workingAssign[sl.idx]);
        if (emptySlots.length) {
            // Free has no "Apply Optimal" button — don't reference it.
            setSubmit({ status: 'error', msg: 'Fill all ' + startingSlots.length + ' starting slots first — ' + emptySlots.map(s => s.slotName.replace('_', ' ')).join(', ') + ' empty. ' + (pro ? 'Tap “Apply Optimal” to fill them. ' : '') + 'MFL benches anyone left out.' });
            return;
        }
        const starterIds = startingSlots.map(sl => workingAssign[sl.idx]).filter(Boolean);
        setSubmit({ status: 'submitting', msg: '' });
        try {
            await MFL.submitLineup({
                // Prefer the league being VIEWED (session globals reflect only the
                // last-connected MFL league — matches league-detail/draft-room).
                leagueId: currentLeague._mflLeagueId || String(currentLeague.id || '').replace(/^mfl_/, '').replace(/_\d+$/, '') || (window.S && window.S.mflLeagueId),
                year: currentLeague.season || (window.S && window.S.mflYear),
                week: result.week,
                franchiseId: myRoster.roster_id,
                starterIds,
                mflByPid: myRoster._mflPlayerIds || null,
                cookie: mflCookie || undefined,
                host: mflHost || undefined,
                apiKey: mflApiKey,
            });
            setSubmit({ status: 'done', msg: 'Lineup submitted to MFL for Week ' + result.week + '.' });
        } catch (e) {
            const msg = (e && e.message) || 'MFL rejected the lineup — set it on MFL directly.';
            // If the session expired, drop the cookie so the UI prompts a reconnect.
            if (/authoriz|expired|not\s*log|logg?ed?[\s-]?in|session/i.test(msg)) mflDisconnect();
            setSubmit({ status: 'error', msg });
        }
    }

    // MFL rosters don't expose current starters (starters:[]), so the builder
    // would start all-empty. Seed the working lineup from the optimal build once
    // rolling history and kickoff status are ready, so the table starts full and the completeness guard
    // is satisfiable. (We can't show MFL's actual current starters — the rosters
    // export doesn't include them.)
    const _optReady = canOptimize;
    React.useEffect(() => {
        // Pro only: the seed IS the optimizer's optimal lineup. Free MFL
        // users start from an empty table and set slots manually (the free
        // builder experience); the push guard message tells them to fill all.
        if (!pro) return;
        if (!isMfl || !_optReady) return;
        if (Object.keys(currentAssign).length || Object.keys(workingAssign).length) return; // platform starters, or user already editing
        const byName = {};
        formOptimal.starters.forEach(s => { (byName[s.slot] = byName[s.slot] || []).push(s.pid); });
        const next = {};
        startingSlots.forEach(sl => { const arr = byName[sl.slotName]; if (arr && arr.length) next[sl.idx] = String(arr.shift()); });
        if (Object.keys(next).length) setWorkingAssign(next);
    }, [lineupKey, isMfl, _optReady]);

    const projectedPoints = pid => {
        // The existing engine recomputes as data arrives; never call this an archived pregame forecast.
        const projectionSeason = window.S?.nflState?.season || new Date().getFullYear();
        if (!result || Number(result.week) !== Number(liveWeek) || Number(currentLeague?.season) !== Number(projectionSeason) || result.projections?.[pid]?.available === false) return null;
        const value = result.projections?.[pid]?.points?.median;
        return Number.isFinite(value) ? value : null;
    };
    const Forecasts = window.App && window.App.LineupForecastSnapshots;
    const [forecastState, setForecastState] = React.useState(() => ({ key: liveKey, data: Forecasts ? Forecasts.read(currentLeague, liveWeek) : { players: {}, persistent: false } }));
    React.useEffect(() => {
        if (!Forecasts) return;
        const projections = {}, statuses = {};
        if (gamesFresh) platformStarters.forEach(pid => { projections[pid] = projectedPoints(pid); statuses[pid] = gameState(pid); });
        const data = Forecasts.capture({ league: currentLeague, week: liveWeek, projections, statuses });
        setForecastState(previous => previous.key === liveKey && previous.data === data ? previous : { key: liveKey, data });
    }, [liveKey, result, nflGames, platformStarters.join(',')]);
    const savedForecasts = forecastState.key === liveKey ? forecastState.data : { players: {}, persistent: true };
    const liveTotal = Live && liveRow ? Live.rosterPoints(liveRow) : null;
    // Phone scores come from the submitted matchup feed, including zero and
    // negative totals. A matchup ID is required: unrelated bye rows must never
    // become an invented opponent.
    const liveOpponent = liveRow?.matchup_id == null ? null : (liveScores.rows || []).find(row =>
        String(row.roster_id) !== String(liveRow.roster_id) && String(row.matchup_id) === String(liveRow.matchup_id));
    const liveOpponentTotal = Live && liveOpponent ? Live.rosterPoints(liveOpponent) : null;
    const opponentRoster = liveOpponent && (currentLeague?.rosters || []).find(row => String(row.roster_id) === String(liveOpponent.roster_id));
    const opponentUser = opponentRoster && (currentLeague?.users || []).find(user => String(user.user_id) === String(opponentRoster.owner_id));
    const liveOpponentName = opponentRoster?.metadata?.team_name || opponentUser?.metadata?.team_name || opponentUser?.display_name || (liveOpponent ? 'Team ' + liveOpponent.roster_id : 'Opponent');
    const mobileScoreStatus = liveScores.error ? 'Last available scores'
        : liveScores.status === 'loading' ? 'Loading scores'
        : !liveScores.supported ? 'Scoring unavailable'
        : weekStarted ? 'Actual points' : 'Submitted lineup · actual points';
    const trackingLineup = weekStarted || (liveTotal != null && liveTotal !== 0);
    // The existing Game Day lineup is the single home for planning and scores.
    function LineupLiveStatus({ pid }) {
        if (!trackingLineup || !pid) return null;
        const state = gameState(pid);
        if (state === 'upcoming') return <span style={{ display: 'block', color: SILVER, fontSize: '0.75rem', marginTop: '4px' }}>Upcoming</span>;
        const started = ['live', 'final', 'locked'].includes(state);
        const submitted = platformStarters.map(String).includes(String(pid));
        const actual = submitted && Live && liveRow ? Live.playerPoints(liveRow, pid) : null;
        const label = state === 'final' ? 'Final' : state === 'live' ? 'Live' : state === 'locked' ? 'Kickoff' : 'Status unverified';
        return <span style={{ display: 'block', color: state === 'live' ? GREEN : SILVER, fontSize: '0.75rem', marginTop: '4px' }}>
            {label}{started && submitted ? ' · ' + (Number.isFinite(actual) ? actual.toFixed(2) : '—') + ' pts' : ''}{started ? ' · Locked' : ''}
        </span>;
    }
    const mobileScoreboard = (
        <section className="gd-scoreboard" aria-label="Week matchup score">
            <div className="gd-eyebrow">Week {liveWeek} · {mobileScoreStatus}</div>
            <div className="gd-scoreboard-sides">
                <div><span className="gd-team-name">Your team</span><strong>{liveTotal == null ? '—' : liveTotal.toFixed(2)}</strong></div>
                {liveOpponent ? <React.Fragment><span className="gd-versus" aria-hidden="true">vs</span><div><span className="gd-team-name">{liveOpponentName}</span><strong>{liveOpponentTotal == null ? '—' : liveOpponentTotal.toFixed(2)}</strong></div></React.Fragment> : null}
            </div>
            <div className="gd-score-update">
                <span>{liveScores.error ? 'Refresh failed · check your platform.' : liveScores.updatedAt ? 'Updated ' + new Date(liveScores.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : liveScores.supported ? 'Waiting for this week’s scoring.' : 'Follow scoring on your league platform.'}</span>
                {liveScores.supported && liveScores.refresh ? <button type="button" onClick={() => liveScores.refresh()} aria-label="Refresh scores">Refresh</button> : null}
            </div>
        </section>
    );
    const mobileScoreHelp = (
        <details className="gd-disclosure">
            <summary>Scoring &amp; lineup rules</summary>
            <div className="gd-disclosure-body">
                <p>Actual points follow your submitted lineup. Weekly projections remain estimates. A dash means unavailable.</p>
                <p>Scores refresh every 30 seconds while open; provider updates can lag. Injury tags are periodic updates, not instant alerts.</p>
                <p>A player whose game has started cannot normally be replaced. Check unstarted bench options and confirm eligibility on your league platform.</p>
                {!savedForecasts.persistent && Object.keys(savedForecasts.players).length ? <p>Browser storage is unavailable; projections are saved for this visit only.</p> : null}
            </div>
        </details>
    );
    if (rosterView) {
        const tracking = weekStarted || (liveTotal != null && liveTotal !== 0);
        const formLabel = (formWindow === 'season' ? 'SZN' : 'L' + formWindow) + ' PPG';
        const slots = startingSlots.length ? startingSlots : platformStarters.map((pid, idx) => ({ idx, slotName: 'START', elig: [] }));
        const assigned = startingSlots.length ? workingAssign : Object.fromEntries(platformStarters.map((pid, idx) => [idx, pid]));
        const used = new Set(Object.values(assigned).map(String));
        const reserves = new Set([...(myRoster?.reserve || []), ...(myRoster?.taxi || [])].map(String));
        const fmt = (value, places = 1) => Number.isFinite(value) ? value.toFixed(places) : '—';
        const statusLabel = pid => {
            const game = gameFor(pid), state = gameState(pid);
            if (state === 'final') return 'Final · Locked';
            if (state === 'live') return (game.shortDetail || 'Live') + ' · Locked';
            if (state === 'locked') return 'Kickoff · Locked';
            if (state === 'upcoming') return new Date(game.kickoff).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
            return 'Game status unverified';
        };
        const selectPlayer = (slot, pid) => {
            if (!canChangePlayer(assigned[slot.idx]) || !canChangePlayer(pid)) return;
            setWorkingAssign(previous => ({ ...previous, [slot.idx]: pid }));
            setOpenSlot(null);
        };
        const metrics = (pid, submitted) => {
            const started = ['live', 'final', 'locked'].includes(gameState(pid));
            const forecast = savedForecasts.players[pid];
            const form = WP?.formStats?.(pid, formWindow);
            return <span className="roster-lineup-metrics">
                {tracking ? <span className={gameState(pid) === 'live' ? 'is-live' : ''}><strong>{fmt(submitted && gameState(pid) !== 'upcoming' && Live && liveRow ? Live.playerPoints(liveRow, pid) : null, 2)}</strong><small>Actual</small></span> : null}
                <span title={started ? forecast ? (forecast.kind === 'pregame' ? 'Pregame projection' : 'First-view projection') + ' · ' + new Date(forecast.capturedAt).toLocaleString() : 'No saved projection' : 'Weekly projection'}><strong>{fmt(started ? forecast?.points : projectedPoints(pid))}</strong><small>{started ? 'Saved proj' : 'Proj'}</small></span>
                <span><strong>{fmt(form?.rollingPPG)}</strong><small>{formLabel}</small></span>
                {!isPhone ? <React.Fragment><span><strong>{fmt(form?.high)}</strong><small>Hi</small></span><span><strong>{fmt(form?.low)}</strong><small>Lo</small></span></React.Fragment> : null}
            </span>;
        };
        return <section className="roster-lineup" aria-label="Roster starting lineup">
            <div className="roster-lineup-heading"><div><div className="gd-eyebrow">Week {liveWeek}</div><h2>Starting lineup</h2></div>
                <div className="roster-lineup-form" aria-label="Player form window">{[['L3', 3], ['L5', 5], ['L8', 8], ['SZN', 'season']].map(([label, value]) => <button type="button" key={label} aria-pressed={formWindow === value} onClick={() => setFormWindow(value)}>{label}</button>)}</div>
            </div>
            <p className="roster-lineup-hint">{tracking ? 'Started players are locked. You can still plan changes for later games.' : 'Plan your starters here. Live scores appear when games begin.'} {isMfl ? 'Set your final lineup on MFL.' : 'Set your final lineup on your league platform.'}</p>
            <div className="roster-lineup-actions">
                {pro ? <button type="button" className="gd-primary" disabled={!canOptimize} onClick={applyOptimal}>Apply Optimal</button> : null}
                <span>{formWinLabel} PPG · {workingTotal.toFixed(1)} lineup total{missingPlanForm ? ' · partial' : ''}</span>
            </div>
            <p className="roster-lineup-hint">{formHelp}</p>
            {tracking ? mobileScoreboard : null}
            <div className="roster-lineup-players">{[...slots].sort((a, b) => (SLOT_DISPLAY_ORDER[a.slotName] ?? 50) - (SLOT_DISPLAY_ORDER[b.slotName] ?? 50)).map(sl => {
                const pid = assigned[sl.idx] || null;
                const meta = pid ? pmeta(pid) : { name: 'Empty slot', pos: '', team: '' };
                const editable = canChangePlayer(pid) && sl.elig.length > 0;
                const submitted = String(platformStarters[sl.idx] || '') === String(pid || '');
                const open = openSlot === sl.idx && editable;
                const options = open ? (myRoster?.players || []).map(String).filter(id => !reserves.has(id) && (!used.has(id) || id === pid) && sl.elig.includes(pmeta(id).pos) && canChangePlayer(id)).sort(byForm) : [];
                return <div className="roster-lineup-slot" key={sl.idx}>
                    <button type="button" className="roster-lineup-row" disabled={!editable} aria-expanded={open} onClick={() => setOpenSlot(open ? null : sl.idx)}>
                        <span className="roster-lineup-position">{sl.slotName.replace('_', ' ')}</span>
                        <span className="roster-lineup-player"><strong>{meta.name}</strong><LineupInjuryBadge status={injuryOf(pid)} /><small>{[meta.pos, meta.team, pid ? statusLabel(pid) : 'Choose a starter', !submitted ? 'Local plan' : null].filter(Boolean).join(' · ')}</small></span>
                        {metrics(pid, submitted)}
                        <span className="roster-lineup-edit">{editable ? '⌄' : ['live', 'final', 'locked'].includes(gameState(pid)) ? 'Locked' : 'Check'}</span>
                    </button>
                    {open ? <div className="roster-lineup-picker"><p>Eligible for {sl.slotName.replace('_', ' ')} · highest {formWinLabel} PPG first</p>{options.map(id => <button type="button" key={id} className="roster-lineup-row" onClick={() => selectPlayer(sl, id)}><span className="roster-lineup-player"><strong>{pmeta(id).name}</strong><LineupInjuryBadge status={injuryOf(id)} /><small>{pmeta(id).team} · {statusLabel(id)}</small></span>{metrics(id, false)}</button>)}
                        {pid ? <button type="button" className="roster-lineup-clear" onClick={() => selectPlayer(sl, null)}>Empty this slot</button> : null}
                        {!options.length ? <p>No eligible players with an upcoming game.</p> : null}
                    </div> : null}
                </div>;
            })}</div>
            {!slots.length ? <p className="roster-lineup-hint">Your starters will appear when your roster syncs.</p> : null}
            {tracking ? mobileScoreHelp : null}
        </section>;
    }

    // No whole-tab gate: the partial free/Pro split above (`pro`) supersedes
    // the old STARTSIT_DEPTH block — free users enter and use the manual
    // builder; only the optimizer layer is locked inline.

    if (!WP || !SS) {
        return <div style={{ padding: '24px', color: SILVER }}>Start/Sit engine not loaded.</div>;
    }
    if (!result || !result.optimal || !result.optimal.starters.length) {
        return (
            <div style={{ padding: isPhone ? '14px 12px' : '20px 16px', color: SILVER, maxWidth: '1240px', margin: '0 auto' }}>

                {trackingLineup ? mobileScoreboard : null}
                <div style={{ padding: '32px 12px', textAlign: 'center', maxWidth: '520px', margin: '0 auto' }}>
                <div style={{ fontSize: '1.1rem', color: GOLD, fontWeight: 600, marginBottom: '10px', letterSpacing: '0.04em' }}>{isPhone ? 'Projections unavailable' : 'LINEUP COMMAND CENTER'}</div>
                <div>{isPhone ? 'Lineup planning will appear when weekly projections load.' : "No weekly projections yet. This lights up in-season once roster and stat data are synced — start/sit guidance is built from each player's role, recent form, and matchup, scored through your league's exact settings."}</div>
                </div>
            </div>
        );
    }

    const objective = result.objective;
    const projOf = pid => (pid && result.projections[pid]) || null;

    // Roster pools.
    const resSet = new Set((myRoster && myRoster.reserve) || []);
    const taxiSet = new Set((myRoster && myRoster.taxi) || []);
    const activeIds = ((myRoster && myRoster.players) || []).filter(id => id && !resSet.has(id) && !taxiSet.has(id)).map(String);
    const usedPids = new Set(Object.values(workingAssign).filter(Boolean).map(String));

    function eligibleFor(slot) {
        return activeIds
            .filter(pid => slot.elig.includes(normPos((playersData[pid] || {}).position) || (playersData[pid] || {}).position))
            .filter(pid => !usedPids.has(pid) || String(workingAssign[slot.idx]) === pid)
            .filter(pid => String(workingAssign[slot.idx]) === pid || (canChangePlayer(workingAssign[slot.idx]) && canChangePlayer(pid)))
            .sort(byForm);
    }

    // Phone: hit-padding, not bigger glyphs (plan D7) — action buttons hit 44px.
    const winBtn = active => ({ padding: isPhone ? '9px 12px' : '3px 8px', fontSize: fz('0.64rem'), fontWeight: 700, letterSpacing: '0.03em', cursor: 'pointer', borderRadius: 'var(--card-radius-xs, 5px)', border: `1px solid ${active ? GOLD : LINE}`, background: active ? 'rgba(212,175,55,0.14)' : 'transparent', color: active ? GOLD : SILVER });
    const actBtn = { padding: isPhone ? '11px 16px' : '5px 12px', minHeight: isPhone ? '44px' : undefined, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer', borderRadius: 'var(--card-radius-xs, 5px)', border: `1px solid ${LINE}`, background: 'transparent', color: SILVER };

    function wxTag(weather) {
        if (!weather) return null;
        if (weather.indoor) return <span style={{ color: SILVER, opacity: 0.5, fontSize: fz('0.6rem'), marginLeft: '6px' }}>dome</span>;
        const d = String(weather.display || '').toLowerCase();
        let tag = null;
        if (/wind/.test(d)) tag = 'WIND';
        else if (/snow|sleet|flurr/.test(d)) tag = 'SNOW';
        else if (/rain|shower|storm/.test(d)) tag = 'RAIN';
        else if (Number.isFinite(Number(weather.temp)) && Number(weather.temp) <= 20) tag = 'COLD';
        if (!tag) return null;
        const tip = (weather.display || '') + (weather.temp != null ? ' · ' + Math.round(weather.temp) + '°' : '');
        return <span title={tip} style={{ color: AMBER, fontSize: fz('0.56rem'), fontWeight: 700, marginLeft: '6px', letterSpacing: '0.03em' }}>{tag}</span>;
    }

    // ── Player field cells (shared by slot rows, picker rows, bench rows) ──
    function PlayerCells({ pid }) {
        if (!pid) {
            return (<React.Fragment>
                <span style={{ color: SILVER, opacity: 0.6, fontStyle: 'italic' }}>Empty — tap to set</span>
                <span />{pro ? <span /> : null}{!isPhone ? <React.Fragment><span /><span /><span /></React.Fragment> : null}
            </React.Fragment>);
        }
        const meta = pmeta(pid);
        const proj = projOf(pid);
        const pts = proj && proj.points;
        const grade = (proj && proj.matchupGrade) || '—';
        const opp = proj && proj.opponent;
        const status = injuryOf(pid);
        const unavail = proj && proj.available === false;
        const fs = isPhone ? null : formOf(pid); // phone drops the form cells (shown on row-tap expand)
        const weather = proj && proj.weather;
        const num = (v, c) => <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: c || SILVER }}>{v}</span>;
        return (<React.Fragment>
            <span style={{ minWidth: 0, overflow: 'hidden' }}>
                <span style={{ color: unavail ? SILVER : TEXT, fontWeight: 500, textDecoration: unavail ? 'line-through' : 'none' }}>{meta.name}</span>
                <span style={{ color: SILVER, fontSize: '0.7rem', marginLeft: '6px' }}>{meta.pos}{meta.team ? ' · ' + meta.team : ''} · {window.App?.NFLByes?.label(playersData?.[pid], window.App.NFLByes.seasonFor(currentLeague)) || 'Bye —'}</span>
                {opp && opp.abbr ? <span style={{ color: SILVER, fontSize: '0.66rem', marginLeft: '6px', opacity: 0.85 }}>{opp.home ? 'vs ' : '@ '}{opp.abbr}</span> : null}
                {wxTag(weather)}
                <LineupInjuryBadge status={status} />
                <LineupLiveStatus pid={pid} />
            </span>
            <span style={{ textAlign: 'right', ...(pro && pts ? { cursor: 'pointer' } : {}) }}
                title={pro && pts ? 'Why this number — tap for the projection ledger' : undefined}
                onClick={pro && pts ? (e => { e.stopPropagation(); setExplainPid(pid); }) : undefined}>
                <span style={{ color: TEXT, fontWeight: 700, fontVariantNumeric: 'tabular-nums', ...(pro && pts ? { borderBottom: '1px dotted rgba(212,175,55,0.5)' } : {}) }}>{pts ? (pts[objective] || 0).toFixed(1) : '—'}</span>
                {pro && pts ? <span style={{ display: 'block', color: SILVER, opacity: 0.6, fontSize: fz('0.56rem'), fontVariantNumeric: 'tabular-nums' }}>{pts.floor.toFixed(0)}–{pts.ceiling.toFixed(0)}</span> : null}
            </span>
            {pro ? <span style={{ textAlign: 'center' }}><span title={opp && opp.abbr ? ('vs ' + opp.abbr) : ('Matchup ' + grade)} style={{ fontWeight: 700, color: gradeColor(grade), fontSize: '0.78rem' }}>{grade}</span></span> : null}
            {!isPhone ? (<React.Fragment>
                {num(Number.isFinite(fs?.rollingPPG) ? fs.rollingPPG.toFixed(1) : '—', TEXT)}
                {num(Number.isFinite(fs?.high) ? fs.high.toFixed(1) : '—', GREEN)}
                {num(Number.isFinite(fs?.low) ? fs.low.toFixed(1) : '—', SILVER)}
            </React.Fragment>) : null}
        </React.Fragment>);
    }

    // ── "Why this number" — projection ledger (Pro; tap any Proj cell) ──
    // Re-derives the projection stage by stage via WeeklyProj.explainPlayer:
    // baseline → DvP → Vegas → weather → availability — then scores the same
    // stat line under a neutral 0.5-PPR baseline. The closing line is the
    // league-scoring edge: identical stat line, your rules vs generic.
    const ledgerNode = (() => {
        if (!explainPid || !pro) return null;
        const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
        const close = () => setExplainPid(null);
        const ex = WP.explainPlayer
            ? WP.explainPlayer(explainPid, { playersData, statsData, priorData: stats2025Data, scoring: result.scoring, week: result.week })
            : null;
        const meta = pmeta(explainPid);
        const proj = projOf(explainPid);
        const pts = proj && proj.points;
        const num = v => (v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1));
        const deltaCol = d => d > 0.05 ? GREEN : d < -0.05 ? RED : SILVER;
        const band = pts && pts.ceiling > pts.floor ? Math.max(0, Math.min(1, (pts.median - pts.floor) / (pts.ceiling - pts.floor))) : 0.5;
        const content = (
            <div style={{ fontFamily: 'var(--font-body)', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, color: TEXT, fontSize: fz('0.95rem') }}>{meta.name}</span>
                    <span style={{ color: SILVER, fontSize: fz('0.7rem') }}>{meta.pos}{meta.team ? ' · ' + meta.team : ''}{ex && ex.opponent ? ' · vs ' + ex.opponent : ''} · Wk {result.week}</span>
                </div>
                {!ex ? (
                    <div style={{ color: SILVER, fontSize: fz('0.78rem') }}>No ledger for this player yet — it needs a stat baseline or a published analyst line.</div>
                ) : (
                    <React.Fragment>
                        {ex.stages.map((s, i) => (
                            <div key={s.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 52px 52px', gap: '8px', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${LINE}` }}>
                                <span style={{ minWidth: 0 }}>
                                    <span style={{ display: 'block', color: TEXT, fontWeight: 600, fontSize: fz('0.76rem') }}>{s.label}</span>
                                    <span style={{ display: 'block', color: SILVER, opacity: 0.75, fontSize: fz('0.62rem'), fontFamily: MONO }}>{s.detail}</span>
                                </span>
                                <span style={{ textAlign: 'right', fontFamily: MONO, fontVariantNumeric: 'tabular-nums', color: deltaCol(s.delta || 0), fontSize: fz('0.72rem') }}>
                                    {i === 0 ? '' : (s.delta > 0 ? '+' : '') + num(s.delta)}
                                </span>
                                <span style={{ textAlign: 'right', fontFamily: MONO, fontVariantNumeric: 'tabular-nums', color: TEXT, fontWeight: i === ex.stages.length - 1 ? 700 : 400, fontSize: fz('0.74rem') }}>{num(s.pts)}</span>
                            </div>
                        ))}
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 104px', gap: '8px', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${LINE}` }}>
                            <span>
                                <span style={{ display: 'block', color: GOLD, fontWeight: 700, fontSize: fz('0.76rem') }}>Your league's scoring</span>
                                <span style={{ display: 'block', color: SILVER, opacity: 0.75, fontSize: fz('0.62rem'), fontFamily: MONO }}>same stat line · 0.5-PPR baseline scores it {num(ex.standardPts)}</span>
                            </span>
                            <span style={{ textAlign: 'right', fontFamily: MONO, fontVariantNumeric: 'tabular-nums', color: GOLD, fontWeight: 700, fontSize: fz('0.85rem') }}>
                                {num(ex.leaguePts)} <span style={{ fontSize: fz('0.66rem'), color: ex.scoringEdge >= 0 ? GREEN : RED }}>({ex.scoringEdge > 0 ? '+' : ''}{num(ex.scoringEdge)})</span>
                            </span>
                        </div>
                        {pts ? (
                            <div style={{ marginTop: '10px' }}>
                                <div style={{ position: 'relative', height: '8px', background: '#0C0E13', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '3px' }}>
                                    <i style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, background: 'rgba(93,173,226,0.16)', borderRadius: '3px' }} />
                                    <b style={{ position: 'absolute', top: '-3px', bottom: '-3px', width: '2px', left: 'calc(' + Math.round(band * 100) + '% - 1px)', background: GOLD }} />
                                </div>
                                <div style={{ fontFamily: MONO, fontSize: fz('0.62rem'), color: SILVER, marginTop: '5px', fontVariantNumeric: 'tabular-nums' }}>
                                    {pts.floor.toFixed(1)} floor — <span style={{ color: GOLD }}>{pts.median.toFixed(1)} proj</span> — {pts.ceiling.toFixed(1)} ceiling
                                </div>
                            </div>
                        ) : null}
                        {ex.provider ? (
                            <div style={{ color: SILVER, opacity: 0.7, fontSize: fz('0.62rem'), fontFamily: MONO, marginTop: '8px' }}>
                                Anchored to the published analyst line, which already prices the matchup — DvP is not double-counted.
                            </div>
                        ) : null}
                        {/* Usage context — not part of the point ledger above, just the
                            opportunity signal (targets, red zone looks, snap share) behind
                            it, from window.App.StatCatalog off this season's raw stat line. */}
                        {(() => {
                            const SC = window.App?.StatCatalog;
                            const st = statsData[explainPid] || {};
                            if (!SC || !(st.gp > 0)) return null;
                            const pos = meta.pos;
                            const items = [];
                            const push = (key, opts) => { const v = SC.computeStat(key, st, opts); if (v != null) items.push({ stat: SC.statByKey(key), v }); };
                            if (['RB', 'WR', 'TE'].includes(pos)) { push('targets', { perGame: true }); push('rzTouches', { perGame: true }); push('snapPct'); }
                            else if (pos === 'QB') { push('rushAtt', { perGame: true }); push('cmpPct'); push('rzPassAtt', { perGame: true }); }
                            else if (['DL', 'LB', 'DB'].includes(pos)) { push('tackles', { perGame: true }); push('defSnapPct'); }
                            if (!items.length) return null;
                            return (
                                <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${LINE}` }}>
                                    <div style={{ fontFamily: MONO, fontSize: fz('0.62rem'), letterSpacing: '0.06em', textTransform: 'uppercase', color: SILVER, marginBottom: '6px' }}>Usage this season</div>
                                    <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                                        {items.map(({ stat, v }) => (
                                            <div key={stat.key} style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span style={{ fontFamily: MONO, fontSize: fz('0.9rem'), fontWeight: 700, color: GOLD }}>{SC.formatStat(v, stat.format)}</span>
                                                <span style={{ fontSize: fz('0.6rem'), color: SILVER, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{stat.short}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })()}
                    </React.Fragment>
                )}
            </div>
        );
        const overlay = (
            <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                <div onClick={e => e.stopPropagation()} style={{ background: PANEL, border: `1px solid ${LINE}`, borderLeft: `3px solid ${GOLD}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '16px 18px', maxWidth: '480px', width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontFamily: MONO, fontSize: fz('0.66rem'), fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: GOLD }}>Why this number</span>
                        <button onClick={close} style={{ marginLeft: 'auto', background: 'none', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-xs, 5px)', color: SILVER, cursor: 'pointer', padding: '3px 9px', fontSize: fz('0.7rem') }}>✕</button>
                    </div>
                    {content}
                </div>
            </div>
        );
        const Sheet = window.WR && window.WR.Sheet;
        return Sheet
            ? <Sheet open onClose={close} title="Why this number" desktop={overlay}>{content}</Sheet>
            : overlay;
    })();

    const projTip = 'Weekly projection using your ' + (objective === 'ceiling' ? 'ceiling (upside)' : objective === 'floor' ? 'floor (safe)' : 'median (balanced)') + ' strategy';
    const headerRow = (
        <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: '8px', padding: '7px 14px', borderBottom: `1px solid ${LINE}`, fontSize: fz('0.58rem'), letterSpacing: '0.05em', color: SILVER, textTransform: 'uppercase' }}>
            <span title="Roster slot">Slot</span>
            <span title="Player · position · NFL team · this week's opponent">Player</span>
            <span title={projTip} style={{ textAlign: 'right' }}>Proj</span>
            {pro ? <span title="Matchup grade A (great) → F (tough), from the opponent's Vegas implied total" style={{ textAlign: 'center' }}>Mtch</span> : null}
            {!isPhone ? (<React.Fragment>
                <span title={'Rolling average over the last ' + (formWindow === 'season' ? 'full season' : formWindow + ' weeks') + ' (actual points)'} style={{ textAlign: 'right' }}>{formWinLabel}</span>
                <span title="Season high — most fantasy points in a week" style={{ textAlign: 'right' }}>Hi</span>
                <span title="Season low — fewest points in a played week" style={{ textAlign: 'right' }}>Lo</span>
            </React.Fragment>) : null}
        </div>
    );

    // ── Matchup forecast: your WORKING lineup vs the opponent's ideal ──
    let matchup = null;
    {
        const M = window.App && window.App.Matchup;
        // No matchup card without at least one working starter — forecasting an
        // empty lineup would read as a confident 1% off a zero-point side.
        const myStarters = Object.values(workingAssign).filter(Boolean);
        if (M && oppResult && oppResult.res && myStarters.length) {
            const oppProj = oppResult.res.projections;
            const oppOpt = oppResult.res.optimal.starters;
            const myDist = M.dist(myStarters, result.projections, 'median');
            const oppDist = M.dist(oppOpt.map(s => s.pid), oppProj, 'median');
            const fc = M.forecast(myDist, oppDist);
            const oppCurTotal = M.dist((oppResult.roster.starters || []).filter(Boolean), oppProj, 'median').mean;
            const users = (currentLeague && currentLeague.users) || [];
            const u = users.find(x => String(x.user_id) === String(oppResult.roster.owner_id));
            const oppName = (oppResult.roster.metadata && oppResult.roster.metadata.team_name) || (u && u.metadata && u.metadata.team_name) || (u && u.display_name) || ('Team ' + oppResult.roster.roster_id);
            const medOf = (pid, proj) => !pid ? 0 : proj[pid]?.available !== false && Number.isFinite(proj[pid]?.points?.median) ? proj[pid].points.median : null;

            // Slot-by-slot head-to-head: my WORKING player vs their IDEAL player,
            // aligned by slot-name occurrence (rosters share roster_positions).
            const theirByName = {}; oppOpt.forEach(s => { (theirByName[s.slot] = theirByName[s.slot] || []).push(s.pid); });
            const cursor = {};
            const dispSlots = [...startingSlots].sort((a, b) => (SLOT_DISPLAY_ORDER[a.slotName] ?? 50) - (SLOT_DISPLAY_ORDER[b.slotName] ?? 50));
            let myEdges = 0;
            const h2h = dispSlots.map(sl => {
                const myPid = workingAssign[sl.idx] || null;
                cursor[sl.slotName] = cursor[sl.slotName] || 0;
                const theirPid = (theirByName[sl.slotName] || [])[cursor[sl.slotName]++] || null;
                const myMed = medOf(myPid, result.projections), theirMed = medOf(theirPid, oppProj);
                if (myMed != null && theirMed != null && myMed > theirMed) myEdges++;
                return { slot: sl.slotName, myPid, myMed, theirPid, theirMed };
            });
            // Position-group strength (each starter's projected pts summed by position).
            const myByPos = {}, theirByPos = {};
            myStarters.forEach(pid => { const p = normPos((playersData[pid] || {}).position) || '?'; const value = medOf(pid, result.projections); myByPos[p] = value == null || myByPos[p] === null ? null : (myByPos[p] || 0) + value; });
            oppOpt.forEach(s => { const p = normPos((playersData[s.pid] || {}).position) || '?'; const value = medOf(s.pid, oppProj); theirByPos[p] = value == null || theirByPos[p] === null ? null : (theirByPos[p] || 0) + value; });
            const posStrength = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].filter(p => p in myByPos || p in theirByPos).map(p => ({ pos: p, mine: p in myByPos ? myByPos[p] : 0, theirs: p in theirByPos ? theirByPos[p] : 0 }));

            matchup = { fc, oppName, oppCurTotal, oppIdealTotal: oppResult.res.optimal.total, oppProj, h2h, posStrength, myEdges, slotCount: h2h.length };
        }
    }

    const matchupPanel = <MatchupBreakdown matchup={matchup} week={result.week} pro={pro} pmeta={pmeta}
        upgrade={GatedRow ? <GatedRow title="Win probability + matchup breakdown" sub="Projected margin, slot-by-slot edges and position-strength bars" feature={STARTSIT_FEAT} /> : null} />;

    // ── MFL lineup push card (write to MyFantasyLeague) ──
    function renderMflPush() {
        if (!isMfl) return null;
        const s = submit.status;
        // Phone: 16px input font (iOS Safari zooms on focus below 16px) + 44px height.
        const inputStyle = { flex: '1 1 130px', minWidth: 0, padding: isPhone ? '10px 12px' : '7px 10px', minHeight: isPhone ? '44px' : undefined, background: 'var(--charcoal, #0e0e12)', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-xs, 5px)', color: TEXT, fontSize: isPhone ? '16px' : '0.8rem' };
        return (
            <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '12px 16px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '0.66rem', letterSpacing: '0.07em', color: GOLD, fontWeight: 700 }}>PUSH LINEUP TO MFL</div>
                    {mflCookie ? <span onClick={mflDisconnect} style={{ fontSize: fz('0.62rem'), color: SILVER, cursor: 'pointer', padding: isPhone ? '12px 0 12px 12px' : 0 }}>● connected · disconnect</span> : null}
                </div>
                {!mflCookie ? (
                    <div style={{ marginTop: '8px' }}>
                        <div style={{ fontSize: '0.72rem', color: SILVER, marginBottom: '8px', lineHeight: 1.5 }}>MFL requires your login to set a lineup (the API key can’t). Your password is used once to get a session token — only the token is kept (this tab), never the password.</div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <input value={mflUser} onChange={e => setMflUser(e.target.value)} placeholder="MFL username" autoComplete="off" style={inputStyle} />
                            <input value={mflPass} onChange={e => setMflPass(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doMflLogin(); }} placeholder="MFL password" type="password" autoComplete="off" style={inputStyle} />
                            <button onClick={doMflLogin} disabled={mflAuthBusy} style={{ ...actBtn, color: GOLD, borderColor: 'var(--acc-line2, rgba(212,175,55,0.4))', background: 'rgba(212,175,55,0.10)', opacity: mflAuthBusy ? 0.6 : 1 }}>{mflAuthBusy ? 'Connecting…' : 'Connect'}</button>
                        </div>
                        {mflAuthErr ? <div style={{ fontSize: '0.7rem', color: RED, marginTop: '6px' }}>{mflAuthErr}</div> : null}
                    </div>
                ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginTop: '8px' }}>
                        <div style={{ fontSize: '0.72rem', color: SILVER, minWidth: 0 }}>
                            {s === 'done' ? <span style={{ color: GREEN }}>{submit.msg}</span>
                                : s === 'error' ? <span style={{ color: RED }}>{submit.msg}</span>
                                    : 'Sets your working lineup as this week’s starters on MyFantasyLeague.'}
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            {s === 'confirm' ? (
                                <React.Fragment>
                                    <span style={{ fontSize: '0.7rem', color: AMBER }}>Overwrite Week {result.week} starters?</span>
                                    <button onClick={pushToMfl} style={{ ...actBtn, color: GOLD, borderColor: 'var(--acc-line2, rgba(212,175,55,0.4))', background: 'rgba(212,175,55,0.12)' }}>Confirm</button>
                                    <button onClick={() => setSubmit({ status: 'idle', msg: '' })} style={actBtn}>Cancel</button>
                                </React.Fragment>
                            ) : (
                                <button disabled={s === 'submitting'} onClick={() => setSubmit({ status: 'confirm', msg: '' })}
                                    style={{ ...actBtn, opacity: s === 'submitting' ? 0.5 : 1, cursor: s === 'submitting' ? 'not-allowed' : 'pointer', color: GOLD, borderColor: 'var(--acc-line2, rgba(212,175,55,0.4))', background: 'rgba(212,175,55,0.10)' }}>
                                    {s === 'submitting' ? 'Submitting…' : s === 'done' ? 'Re-submit' : 'Submit to MFL'}
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ── Season schedule rail: outlook + week-by-week ──
    function renderRail() {
        const d = seasonData;
        const scheduleUnset = !!(d && d.scheduleUnset);
        const byeWatch = _vp.isPhone ? [...((d && d.byeWatch) || [])].sort((a, b) => a.week - b.week) : (d && d.byeWatch) || [];
        const byeLabel = (bw) => {
            const c = {}; (bw.positions || []).forEach(p => { c[p] = (c[p] || 0) + 1; });
            // count===0 = a roster-gap hole, not a bye week — never say "0 on bye".
            return Object.keys(c).map(p => c[p] > 1 ? c[p] + ' ' + p + 's' : p).join(', ') || (bw.count > 0 ? bw.count + ' on bye' : 'lineup hole');
        };
        return (
            <div className="gd-season-rail" style={{ display: 'flex', flexDirection: 'column', gap: '14px', position: isNarrow ? 'static' : 'sticky', top: '16px' }}>
                {/* Season outlook (or a pre-season placeholder when no schedule yet) */}
                <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '14px 16px' }}>
                    <div style={{ fontSize: fz('0.64rem'), letterSpacing: '0.07em', color: SILVER, fontWeight: 600 }}>SEASON OUTLOOK</div>
                    {!pro ? (
                        // Free: raw current record only — proj record / PF / win% are
                        // season-sim (optimizer) outputs.
                        <React.Fragment>
                            {d && d.summary && d.summary.record ? (
                                <div style={{ display: 'flex', gap: '16px', margin: '8px 0 10px' }}>
                                    <div><div style={{ fontSize: fz('0.6rem'), color: SILVER, letterSpacing: '0.04em' }}>NOW</div><div style={{ fontWeight: 700, color: TEXT }}>{d.summary.record}</div></div>
                                </div>
                            ) : <div style={{ height: '8px' }} />}
                            {GatedRow ? <GatedRow title="Season projection" sub="Projected record, points-for and weekly win odds" feature={STARTSIT_FEAT} /> : null}
                        </React.Fragment>
                    ) : scheduleUnset ? (
                        <div style={{ color: SILVER, fontSize: '0.74rem', marginTop: '8px', lineHeight: 1.5 }}>Schedule posts closer to Week 1. Building your <span style={{ color: TEXT, fontWeight: 600 }}>Week 1</span> lineup now — record + win% light up once matchups are set.</div>
                    ) : d && d.summary ? (
                        <React.Fragment>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '8px' }}>
                                {/* Prefer the Season Odds simulation's projected record when it
                                    has run: schedule-engine sums per-week win probabilities while
                                    the sim models real scoring distributions and seeding, and two
                                    different projected records on one screen reads as a bug. */}
                                <span style={{ fontSize: '1.5rem', fontWeight: 800, color: GOLD, fontVariantNumeric: 'tabular-nums' }}>
                                    {simSummary ? simSummary.projWins + '-' + simSummary.projLosses : d.summary.projRecord}
                                </span>
                                <span style={{ fontSize: fz('0.64rem'), color: SILVER }}>proj record</span>
                                {simSummary ? <span style={{ fontSize: fz('0.64rem'), color: GOLD, fontWeight: 700 }}>· {simSummary.playoffPct}% playoffs</span> : null}
                            </div>
                            <div style={{ display: 'flex', gap: '16px', marginTop: '9px' }}>
                                <div><div style={{ fontSize: fz('0.6rem'), color: SILVER, letterSpacing: '0.04em' }}>NOW</div><div style={{ fontWeight: 700, color: TEXT }}>{d.summary.record}</div></div>
                                <div><div style={{ fontSize: fz('0.6rem'), color: SILVER, letterSpacing: '0.04em' }}>PROJ PF</div><div style={{ fontWeight: 700, color: TEXT, fontVariantNumeric: 'tabular-nums' }}>{d.summary.projPF}</div></div>
                                {d.summary.winPct != null ? <div><div style={{ fontSize: fz('0.6rem'), color: SILVER, letterSpacing: '0.04em' }}>WIN%</div><div style={{ fontWeight: 700, color: TEXT }}>{d.summary.winPct}%</div></div> : null}
                            </div>
                        </React.Fragment>
                    ) : <div style={{ color: SILVER, fontSize: '0.74rem', marginTop: '8px', opacity: 0.7 }}>Projecting your season…</div>}
                </div>

                {/* Bye watch — the weeks you're thinnest (works with or without a schedule) */}
                {byeWatch.length ? (
                    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '12px 16px' }}>
                        <div style={{ fontSize: fz('0.64rem'), letterSpacing: '0.07em', color: SILVER, fontWeight: 600, marginBottom: '6px' }}>BYE WATCH</div>
                        {(_vp.isPhone ? byeWatch.slice(0, 1) : byeWatch).map(bw => (
                            <div key={bw.week} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '6px', padding: '6px 0', fontSize: '0.74rem' }}>
                                <span style={{ minWidth: 0 }}>
                                    <span style={{ color: bw.unfilled ? RED : AMBER, fontWeight: 700 }}>Wk {bw.week}</span>
                                    <span style={{ color: SILVER, marginLeft: '6px' }}>{byeLabel(bw)}{bw.unfilled && bw.count > 0 ? ' · no cover' : ''}</span>
                                </span>
                                <span style={{ color: bw.unfilled ? RED : AMBER, fontWeight: 800 }}>{bw.unfilled ? '⚠' : bw.count}</span>
                                <div style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                    {(bw.positions?.length ? [...new Set(bw.positions)] : [null]).map(position => <button key={position || 'cover'} type="button" onClick={() => {
                                        const dropPid = (myRoster?.players || []).find(pid => window._playerTags?.[pid] === 'cut');
                                        const context = {
                                            position: position || undefined,
                                            week: bw.week,
                                            dropPid: dropPid || undefined,
                                            reason: 'Week ' + bw.week + (position ? ' ' + position : '') + (bw.reason === 'gap' ? ' lineup coverage' : ' bye coverage') + (bw.unfilled ? ' · No cover on your roster.' : ' · Add depth before this week.'),
                                            source: 'game-day-bye-watch',
                                            leagueId: currentLeague?.league_id || currentLeague?.id,
                                        };
                                        if (typeof window.WR?.openAcquisition === 'function') window.WR.openAcquisition(context);
                                        else setActiveTab?.('fa');
                                    }} style={{ background: 'transparent', border: '1px solid ' + LINE, borderRadius: 'var(--card-radius-sm, 8px)', padding: '5px 8px', minHeight: '36px', color: GOLD, fontSize: '.7rem', cursor: 'pointer' }}>Find {position ? position + ' ' : ''}cover →</button>)}
                                </div>
                            </div>
                        ))}
                        {_vp.isPhone && byeWatch.length > 1 && <window.WR.MobileSection phone={true} title="Later coverage weeks" summary={(byeWatch.length - 1) + ' weeks to review'}>{byeWatch.slice(1).map(bw => (
                            <div key={bw.week} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '6px', padding: '6px 0', fontSize: '0.74rem' }}>
                                <span style={{ minWidth: 0 }}>
                                    <span style={{ color: bw.unfilled ? RED : AMBER, fontWeight: 700 }}>Wk {bw.week}</span>
                                    <span style={{ color: SILVER, marginLeft: '6px' }}>{byeLabel(bw)}{bw.unfilled && bw.count > 0 ? ' · no cover' : ''}</span>
                                </span>
                                <span style={{ color: bw.unfilled ? RED : AMBER, fontWeight: 800 }}>{bw.unfilled ? '⚠' : bw.count}</span>
                                <div style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                    {(bw.positions?.length ? [...new Set(bw.positions)] : [null]).map(position => <button key={position || 'cover'} type="button" onClick={() => {
                                        const dropPid = (myRoster?.players || []).find(pid => window._playerTags?.[pid] === 'cut');
                                        const context = {
                                            position: position || undefined,
                                            week: bw.week,
                                            dropPid: dropPid || undefined,
                                            reason: 'Week ' + bw.week + (position ? ' ' + position : '') + (bw.reason === 'gap' ? ' lineup coverage' : ' bye coverage') + (bw.unfilled ? ' · No cover on your roster.' : ' · Add depth before this week.'),
                                            source: 'game-day-bye-watch',
                                            leagueId: currentLeague?.league_id || currentLeague?.id,
                                        };
                                        if (typeof window.WR?.openAcquisition === 'function') window.WR.openAcquisition(context);
                                        else setActiveTab?.('fa');
                                    }} style={{ background: 'transparent', border: '1px solid ' + LINE, borderRadius: 'var(--card-radius-sm, 8px)', padding: '5px 8px', minHeight: '36px', color: GOLD, fontSize: '.7rem', cursor: 'pointer' }}>Find {position ? position + ' ' : ''}cover →</button>)}
                                </div>
                            </div>
                        ))}</window.WR.MobileSection>}
                        {/* The raw bye listing is free; the "do X" line is a rec. */}
                        <div style={{ fontSize: fz('0.62rem'), color: SILVER, opacity: 0.7, marginTop: '6px' }}>Carry the week and position into your waiver plan.</div>
                    </div>
                ) : null}

                {/* Week-by-week schedule */}
                <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', overflow: 'hidden' }}>
                    <div style={{ padding: '9px 14px', borderBottom: `1px solid ${LINE}`, fontSize: fz('0.64rem'), letterSpacing: '0.07em', color: SILVER, fontWeight: 600 }}>SCHEDULE</div>
                    {scheduleUnset ? (
                        <div style={{ padding: '10px 14px', color: SILVER, fontSize: '0.74rem', opacity: 0.8, lineHeight: 1.5 }}>{pro ? 'Opponents + weekly win% appear here once your league posts the schedule.' : 'Opponents appear here once your league posts the schedule.'}</div>
                    ) : d && d.weeks ? d.weeks.map(w => {
                        const wp = pro ? w.winPct : null; // weekly win% is a Pro likelihood read
                        const color = w.result ? (w.result === 'W' ? GREEN : w.result === 'L' ? RED : SILVER) : (wp == null ? SILVER : wp >= 55 ? GREEN : wp <= 45 ? RED : GOLD);
                        const bye = w.byes || {};
                        return (
                            <div key={w.week} style={{ display: 'grid', gridTemplateColumns: '26px 1fr 52px', gap: '8px', alignItems: 'center', padding: '6px 14px', borderBottom: `1px solid ${LINE}`, background: w.isCurrent ? 'var(--acc-fill2, rgba(212,175,55,0.08))' : 'transparent' }}>
                                <span style={{ fontSize: fz('0.62rem'), color: w.isCurrent ? GOLD : SILVER, fontWeight: 700 }}>W{w.week}</span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
                                    <span style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: '0.74rem', color: (w.isPast && !w.result) ? SILVER : TEXT }}>{w.bye ? <span style={{ color: SILVER, opacity: 0.6 }}>bye</span> : w.oppName}</span>
                                    {bye.count ? <span title={bye.unfilled ? "You can't field a full lineup this week" : bye.count + ' of your starters on bye'} style={{ flex: '0 0 auto', fontSize: fz('0.56rem'), fontWeight: 700, color: bye.thin ? (bye.unfilled ? RED : AMBER) : SILVER }}>{bye.unfilled ? '⚠' : bye.count + '·b'}</span> : null}
                                </span>
                                <span style={{ textAlign: 'right', fontSize: '0.68rem', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
                                    {w.result ? (w.result + (w.myProj != null ? ' ' + Math.round(w.myProj) : '')) : (wp != null ? wp + '%' : w.bye ? '—' : '·')}
                                </span>
                            </div>
                        );
                    }) : <div style={{ padding: '10px 14px', color: SILVER, fontSize: '0.74rem', opacity: 0.7 }}>Loading schedule…</div>}
                </div>
            </div>
        );
    }

    // ══ PHONE (<768) — Game Day Central phone branch (iPhone program Phase 1).
    // EARLY RETURN: everything below the closing brace renders only off-phone,
    // so the desktop/tablet return underneath stays byte-identical. Kit
    // presence (wr-primitives.js loads earlier in the babel chain) is fixed
    // for the page's lifetime, so gating the return on it has no hook hazard.
    // Free/Pro: every phone surface re-pours gated content at the EXACT
    // existing `pro` boundaries — optimal hero/delta, matchup grades, win%,
    // breakdown and the Alex note stay Pro; the manual builder, raw
    // projections, bye listing and the MFL push stay free.
    const _kitReady = !!(window.WR && window.WR.HeroCard && window.WR.AssetRow && window.WR.CardList && window.WR.Sheet && window.WR.ActionBar);
    if (isPhone && _kitReady) {
        const Sheet = window.WR.Sheet, ActionBar = window.WR.ActionBar;
        const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
        const MICRO = '0.875rem';
        const SLOT_SHORT = { SUPER_FLEX: 'SF', REC_FLEX: 'RF', FLEX: 'FLX', WRTQ: 'WRT', IDP_FLEX: 'IDP', WILDCARD: 'WC' };
        const dispSlots = [...startingSlots].sort((a, b) => (SLOT_DISPLAY_ORDER[a.slotName] ?? 50) - (SLOT_DISPLAY_ORDER[b.slotName] ?? 50));

        // Working-vs-platform dirtiness drives the ActionBar (P6). MFL rosters
        // never expose platform starters (currentAssign = {}), so any set slot
        // reads as "unpushed" — exactly when the push path matters.
        const dirty = startingSlots.some(sl => String(workingAssign[sl.idx] || '') !== String(currentAssign[sl.idx] || ''));

        // Optimal swap summary for the hero facts — the same per-slot
        // assignment walk as applyOptimal(), diffed against the working
        // lineup. Pro only (the optimizer layer).
        let swaps = [], topSwap = null;
        if (pro && canOptimize) {
            const byName = {};
            formOptimal.starters.forEach(s => { (byName[s.slot] = byName[s.slot] || []).push(s.pid); });
            const optAssign = {};
            startingSlots.forEach(sl => { const arr = byName[sl.slotName]; if (arr && arr.length) optAssign[sl.idx] = String(arr.shift()); });
            startingSlots.forEach(sl => {
                const cur = String(workingAssign[sl.idx] || ''), opt = String(optAssign[sl.idx] || '');
                if (cur === opt) return;
                const sw = { sl, cur, opt, gain: formPts(opt) != null && (!cur || formPts(cur) != null) ? objPts(opt) - objPts(cur) : null };
                swaps.push(sw);
                if (!topSwap || sw.gain > topSwap.gain) topSwap = sw;
            });
        }
        const swapFacts = topSwap
            ? swaps.length + ' swap' + (swaps.length === 1 ? '' : 's') + ': ' + (topSwap.cur ? pmeta(topSwap.cur).name : 'Empty') + ' → ' + (topSwap.opt ? pmeta(topSwap.opt).name : 'Empty') + ' · ' + topSwap.sl.slotName.replace('_', ' ') + ' slot'
            : 'No swaps — your best lineup is in';

        // Apply Optimal, then show the moves it made as a list (owner ask).
        // Capture the swaps BEFORE applying (post-apply they recompute to []).
        const applyOptimalWithSummary = () => {
            const moves = swaps.slice();
            applyOptimal();
            if (moves.length) setAppliedMoves(moves);
        };



        // Phone rows keep the projection and selected-window PPG visible together.
        // A tap opens eligible replacements and deeper matchup/form context.
        const slotRow = (sl) => {
            const pid = workingAssign[sl.idx] || null;
            const slotLabel = sl.slotName.replace('_', ' ');
            const open = openSlot === sl.idx;
            if (!pid) {
                return <MobilePlayerRow key={sl.idx} pos={SLOT_SHORT[sl.slotName] || sl.slotName} name="Empty — tap to set" tag={slotLabel}
                    slots={[{ label: 'PROJ', value: '—', tone: 'mute' }, { label: formWinLabel + ' PPG', value: '—' }]} accent={open ? 'gold' : undefined}
                    onClick={() => setOpenSlot(open ? null : sl.idx)} />;
            }
            const meta = pmeta(pid), proj = projOf(pid), pts = proj && proj.points;
            const status = injuryOf(pid);
            const opp = proj && proj.opponent;
            const tag = [slotLabel, meta.team || 'FA', opp && opp.abbr ? (opp.home ? 'vs ' : '@ ') + opp.abbr : null].filter(Boolean).join(' · ');
            const fs = formOf(pid);
            const atRisk = !!status || (proj && proj.available === false);
            return <MobilePlayerRow key={sl.idx} pos={meta.pos || '?'} name={meta.name} injuryStatus={status} tag={<>{tag}<LineupLiveStatus pid={pid} /></>}
                slots={[{ label: 'PROJ', value: proj?.available !== false && Number.isFinite(pts?.[objective]) ? pts[objective].toFixed(1) : '—' }, { label: formWinLabel + ' PPG', value: Number.isFinite(fs?.rollingPPG) ? fs.rollingPPG.toFixed(1) : '—' }]}
                accent={open ? 'gold' : atRisk ? 'risk' : undefined}
                onClick={() => setOpenSlot(open ? null : sl.idx)} />;
        };

        // Eligible-player picker (openSlot) — a WR.Sheet instead of the
        // desktop inline expansion; rows drive the EXACT same assign/empty
        // setters. Form stats + the L3/L5/L8/SZN window ride here (the
        // Hi/Lo columns stay in the picker).
        const openSl = openSlot != null ? startingSlots.find(sl => sl.idx === openSlot) : null;
        const openPid = openSl ? (workingAssign[openSl.idx] || null) : null;
        const openElig = openSl ? eligibleFor(openSl) : [];
        const openFs = openPid ? formOf(openPid) : null;
        const pickRow = (epid) => {
            const isCur = String(openPid) === String(epid);
            const meta = pmeta(epid), proj = projOf(epid), pts = proj && proj.points;
            const status = injuryOf(epid);
            const opp = proj && proj.opponent;
            const fs = formOf(epid);
            return <MobilePlayerRow key={epid} pos={meta.pos || '?'} name={meta.name} injuryStatus={status}
                tag={[isCur ? 'IN' : null, meta.team || 'FA', opp && opp.abbr ? (opp.home ? 'vs ' : '@ ') + opp.abbr : null, pro ? 'Matchup ' + (proj?.matchupGrade || '—') : null].filter(Boolean).join(' · ')}
                slots={[{ label: 'PROJ', value: proj?.available !== false && Number.isFinite(pts?.[objective]) ? pts[objective].toFixed(1) : '—' }, { label: formWinLabel + ' PPG', value: Number.isFinite(fs?.rollingPPG) ? fs.rollingPPG.toFixed(1) : '—', tone: 'mute' }]}
                accent={isCur ? 'gold' : undefined}
                onClick={() => { canChangePlayer(openPid) && canChangePlayer(epid) && setWorkingAssign(w => ({ ...w, [openSl.idx]: epid })); setOpenSlot(null); }} />;
        };

        // Pregame has one next action. Every change here is explicitly a local
        // plan; the existing optimizer and provider submission guards stay intact.
        const heroEl = (
            <section className="gd-planning-focus" aria-label="Lineup planning guidance">
                <div className="gd-eyebrow">Week {liveWeek} · Local lineup plan</div>
                <h2>{!optimizerAvailable ? 'Review your lineup' : !formComplete ? 'More game history needed' : missingPlanForm ? 'Some averages are missing' : planUnavailable ? 'Replace unavailable starters' : pro ? isOptimal ? 'Your strongest ' + formWinLabel + ' lineup' : '+' + benchPts.toFixed(1) + ' ' + formWinLabel + ' PPG available' : 'Check your starters'}</h2>
                <p>{!optimizerAvailable ? 'Whole-lineup optimization is paused while games are underway or kickoff status is unverified.' : !formComplete || missingPlanForm ? formHelp : planUnavailable ? 'Auto-fill replaces unavailable starters using the selected rolling average.' : pro ? isOptimal ? 'No improvement in ' + formWinLabel + ' PPG from a swap.' : swapFacts : 'Tap a player in your plan to compare eligible options.'}</p>
                {pro && canOptimize && !isOptimal ? <button type="button" className="gd-primary" onClick={() => { applyOptimalWithSummary(); }}>Use optimal in my plan</button> : <a className="gd-primary" href="#gameday-starting-lineup" onClick={event => { event.preventDefault(); document.getElementById('gameday-starting-lineup')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>View starting lineup</a>}
            </section>
        );

        return (
            <div className="gd-mobile">
                {ledgerNode}
                {/* This Week ⇄ Season toggle (owner ask) — week = matchup +
                    lineup; season = outlook + schedule. */}
                <div className="wr-seg gd-view-nav" aria-label="Game Day views">
                    <button aria-pressed={phoneView === 'week'} className={phoneView === 'week' ? 'is-on' : ''} onClick={() => setPhoneView('week')}>This Week</button>
                    <button aria-pressed={phoneView === 'season'} className={phoneView === 'season' ? 'is-on' : ''} onClick={() => setPhoneView('season')}>Season</button>
                    <button aria-pressed={phoneView === 'odds'} className={phoneView === 'odds' ? 'is-on' : ''} onClick={() => setPhoneView('odds')}>Odds</button>
                </div>

                {phoneView === 'odds' ? (
                    // No bracket in a chopped league — survival IS the odds view.
                    leagueSkin?.features?.showPlayoffOdds === false
                        ? (window.WrChopBlock ? <window.WrChopBlock active currentLeague={currentLeague} myRoster={myRoster} /> : null)
                    : window.WrSeasonOdds
                        ? <window.WrSeasonOdds active currentLeague={currentLeague} myRoster={myRoster}
                            playersData={playersData} statsData={statsData} stats2025Data={stats2025Data}
                            leagueSkin={leagueSkin} pro={pro} onSummary={onSimSummary} />
                        : null
                ) : phoneView === 'week' ? (<React.Fragment>
                {heroEl}
                <div className="roster-lineup-form" aria-label="Optimizer form window">{[['L3', 3], ['L5', 5], ['L8', 8], ['SZN', 'season']].map(([label, value]) => <button type="button" key={label} aria-pressed={formWindow === value} onClick={() => setFormWindow(value)}>{label}</button>)}</div>
                <p className="gd-muted">{formHelp}</p>
                {matchupPanel}
                <section id="gameday-starting-lineup" className="gd-working-lineup" aria-label="Local lineup plan">
                    <div className="gd-list-heading"><h2>Starting lineup</h2><span>{workingTotal.toFixed(1)} {formWinLabel} PPG{missingPlanForm ? ' · partial' : ''}</span></div>
                    <p className="gd-muted">{isMfl ? 'Review changes here, then submit to MFL.' : 'Plan here. Set your final starters on your league platform.'}</p>
                    {!optimizerAvailable ? <p className="gd-muted">Only players with verified upcoming games can be moved.</p> : null}
                    {trackingLineup ? mobileScoreboard : null}
                    <div className="gd-player-list">{dispSlots.map(slotRow)}</div>
                    {trackingLineup ? mobileScoreHelp : null}
                    {dirty || isMfl ? <button type="button" className="gd-secondary" onClick={() => setApplyOpen(true)}>Review planned changes</button> : null}
                </section>
                </React.Fragment>) : (<React.Fragment>
                {/* Season view — outlook + week-by-week schedule (renderRail
                    carries every existing free/Pro gate). */}
                {renderRail()}
                </React.Fragment>)}

                {/* P3-style picker sheet — bench players for the open slot */}
                <Sheet open={!!openSl} onClose={() => setOpenSlot(null)} title={openSl ? 'Set ' + openSl.slotName.replace('_', ' ') : ''} desktop={null}>
                    {openSl ? (
                        <div className="gd-mobile-sheet" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 14px 4px' }}>
                            <div className="wr-seg">
                                {[['L3', 3], ['L5', 5], ['L8', 8], ['SZN', 'season']].map(opt => (
                                    <button key={opt[0]} className={formWindow === opt[1] ? 'is-on' : ''} onClick={() => setFormWindow(opt[1])}>{opt[0]}</button>
                                ))}
                            </div>
                            {openPid && pro ? <p className="gd-muted">Matchup grade: {projOf(openPid)?.matchupGrade || '—'} · {canChangePlayer(openPid) ? 'Upcoming game' : 'Changes locked or game status unverified'}</p> : null}
                            {openPid && openFs ? (
                                <div style={{ fontSize: '0.74rem', color: SILVER, fontVariantNumeric: 'tabular-nums' }}>
                                    {pmeta(openPid).name} · {formWinLabel} <span style={{ color: TEXT, fontWeight: 700 }}>{openFs.rollingPPG.toFixed(1)}</span>
                                    {' · Hi '}<span style={{ color: GREEN, fontWeight: 700 }}>{openFs.high.toFixed(1)}</span>
                                    {' · Lo '}<span style={{ color: SILVER, fontWeight: 700 }}>{openFs.low.toFixed(1)}</span>
                                </div>
                            ) : null}
                            <div style={{ fontFamily: MONO, fontSize: MICRO, letterSpacing: '0.05em', color: SILVER, textTransform: 'uppercase' }}>Eligible for {openSl.slotName.replace('_', ' ')} — tap to start</div>
                            {openElig.map(pickRow)}
                            {!openElig.length ? <div style={{ color: SILVER, fontSize: '0.74rem', opacity: 0.7 }}>No eligible bench players.</div> : null}
                            {openPid ? (
                                <button type="button" disabled={!canChangePlayer(openPid)} onClick={() => { canChangePlayer(openPid) && setWorkingAssign(w => { const n = { ...w }; delete n[openSl.idx]; return n; }); setOpenSlot(null); }}
                                    style={{ padding: '13px 0', cursor: 'pointer', color: RED, fontSize: '0.74rem', fontWeight: 600 }}>Empty this slot</button>
                            ) : null}
                        </div>
                    ) : null}
                </Sheet>

                {/* P6 apply/push sheet — the MFL push card re-homes here on
                    phone (never inline); same handlers, same submit machine. */}
                <Sheet open={applyOpen} onClose={() => setApplyOpen(false)} title="Working lineup" desktop={null}>
                    <div className="gd-mobile-sheet" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '10px 14px 4px' }}>
                        <div style={{ fontSize: '0.82rem', color: TEXT }}>
                            {!optimizerAvailable ? <span style={{ fontWeight: 700 }}>Lineup planning · {formWinLabel} PPG</span> : pro ? (!formComplete || missingPlanForm || planUnavailable ? <span>Review your lineup · {formWinLabel} PPG</span> : isOptimal ? <span style={{ color: GREEN, fontWeight: 700 }}>Lineup is optimal for {formWinLabel} PPG</span> : <span style={{ color: GOLD, fontWeight: 700 }}>{benchPts.toFixed(1)} {formWinLabel} PPG below optimal</span>) : <span style={{ fontWeight: 700 }}>Your lineup {workingTotal.toFixed(1)} {formWinLabel} PPG</span>}
                            {pro ? <span style={{ color: SILVER, fontSize: '0.76rem' }}> · yours {workingTotal.toFixed(1)}{missingPlanForm ? ' (partial)' : ''} · optimal {formComplete ? optimalTotal.toFixed(1) : '—'}</span> : null}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {pro ? <button className="lineup-apply" disabled={!canOptimize} onClick={applyOptimal} style={{ ...actBtn, color: GOLD, borderColor: 'var(--acc-line2, rgba(212,175,55,0.4))', background: 'rgba(212,175,55,0.12)' }}>Apply Optimal</button> : null}
                            <button onClick={() => { setWorkingAssign(currentAssign); setOpenSlot(null); }} style={actBtn}>Reset</button>
                        </div>
                        {renderMflPush()}
                        {!isMfl ? <div style={{ fontSize: '0.72rem', color: SILVER, lineHeight: 1.5 }}>Your platform has no public lineup-write API — build and compare here, then set the final lineup on your platform.</div> : null}
                    </div>
                </Sheet>

                {/* Apply-Optimal results — the moves it just made (owner ask). */}
                <Sheet open={!!appliedMoves} onClose={() => setAppliedMoves(null)} title={(appliedMoves ? appliedMoves.length : 0) + ' move' + ((appliedMoves && appliedMoves.length === 1) ? '' : 's') + ' planned'} desktop={null}>
                    {appliedMoves ? (() => {
                        const totalGain = appliedMoves.every(m => m.gain != null) ? appliedMoves.reduce((s, m) => s + m.gain, 0) : null;
                        return (
                        <div className="gd-mobile-sheet" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '6px 14px 4px' }}>
                            <div style={{ fontSize: '0.8rem', color: SILVER, lineHeight: 1.45 }}>Local plan updated{totalGain != null ? <> · <span style={{ color: totalGain >= 0 ? GREEN : SILVER, fontWeight: 700 }}>{totalGain > 0 ? '+' : ''}{totalGain.toFixed(1)}</span> {formWinLabel} PPG</> : null}. Here's what changed:</div>
                            {appliedMoves.map((m, i) => {
                                const outN = m.cur ? pmeta(m.cur).name : 'Empty';
                                const inN = m.opt ? pmeta(m.opt).name : 'Empty';
                                return (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 10px', background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)' }}>
                                        <span style={{ fontFamily: MONO, fontSize: MICRO, fontWeight: 700, color: GOLD, minWidth: '44px', whiteSpace: 'nowrap' }}>{m.sl.slotName.replace('_', ' ')}</span>
                                        <span style={{ flex: 1, minWidth: 0, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                                            <span style={{ color: m.cur ? SILVER : 'var(--text-muted, #8B8B96)', textDecoration: m.cur ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{outN}</span>
                                            <span style={{ color: SILVER, flexShrink: 0 }}>→</span>
                                            <span style={{ color: TEXT, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{inN}</span>
                                        </span>
                                        <span style={{ fontFamily: MONO, fontSize: MICRO, fontWeight: 700, color: m.gain >= 0 ? GREEN : SILVER, whiteSpace: 'nowrap' }}>{m.gain == null ? '—' : (m.gain > 0 ? '+' : '') + m.gain.toFixed(1)}</span>
                                    </div>
                                );
                            })}
                            <button onClick={() => setAppliedMoves(null)} style={{ ...actBtn, marginTop: '4px', minHeight: '44px' }}>Done</button>
                        </div>
                        );
                    })() : null}
                </Sheet>

                {/* P6 action bar — live while the working lineup differs from
                    the platform lineup. APPLY = the same applyOptimal path
                    (Pro); bar tap opens the apply/push sheet. */}
                <ActionBar visible={dirty && phoneView === 'week'} label="LOCAL LINEUP PLAN"
                    value={workingTotal.toFixed(1) + ' ' + formWinLabel + ' PPG' + (missingPlanForm ? ' · partial' : '')}
                    tone="good" actionLabel="REVIEW"
                    onAction={() => setApplyOpen(true)}
                    onOpen={() => setApplyOpen(true)} />
            </div>
        );
    }

    // Desktop This Week ⇄ Odds toggle. Desktop already shows the season rail
    // beside the lineup, so it needs no separate "Season" view — only a way
    // to reach the odds. Rendered in both desktop branches below.
    const gdSeg = (
        <div style={{ display: 'inline-flex', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', overflow: 'hidden', marginBottom: '14px' }}>
            {[['week', 'This Week'], ['odds', 'Season Odds']].map(([k, label]) => (
                <button key={k} onClick={() => setGdView(k)}
                    style={{ padding: '7px 15px', cursor: 'pointer', border: 'none', background: gdView === k ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'transparent', color: gdView === k ? GOLD : SILVER, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: 'var(--font-mono, monospace)' }}>
                    {label}
                </button>
            ))}
        </div>
    );

    if (gdView === 'odds') {
        return (
            <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '20px 16px 60px' }}>
                {gdSeg}
                {leagueSkin?.features?.showPlayoffOdds === false
                    ? (window.WrChopBlock
                        ? <window.WrChopBlock active currentLeague={currentLeague} myRoster={myRoster} />
                        : <div style={{ color: SILVER, fontSize: '0.8rem' }}>Chopping Block module not loaded.</div>)
                    : window.WrSeasonOdds
                    ? <window.WrSeasonOdds active currentLeague={currentLeague} myRoster={myRoster}
                        playersData={playersData} statsData={statsData} stats2025Data={stats2025Data}
                        leagueSkin={leagueSkin} pro={pro} onSummary={onSimSummary} />
                    : <div style={{ color: SILVER, fontSize: '0.8rem' }}>Season odds module not loaded.</div>}
            </div>
        );
    }

    return (
        <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '20px 16px 60px' }}>
            {ledgerNode}
            {gdSeg}

            {/* Alex's game-day note */}
            {note && optimizerAvailable ? (
                <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderLeft: `3px solid ${GOLD}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '12px 16px', marginBottom: '14px' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                        <span style={{ fontSize: fz('0.6rem'), fontWeight: 800, letterSpacing: '0.08em', color: GOLD, marginTop: '3px', whiteSpace: 'nowrap' }}>ALEX ·</span>
                        <span style={{ fontSize: '0.86rem', color: TEXT, lineHeight: 1.5 }}>{note}</span>
                        {/* Game-plan expansion — one-shot, ask once (chat retired). */}
                        {!gameplanTake?.text && (
                            <button onClick={askGameplanTake} disabled={gameplanTake?.loading}
                                style={{ flexShrink: 0, alignSelf: 'flex-start', background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.35)', borderRadius: 'var(--card-radius-xs, 5px)', color: GOLD, fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.05em', padding: '4px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                {gameplanTake?.loading ? '…' : '✨ MORE FROM ALEX'}
                            </button>
                        )}
                    </div>
                    {gameplanTake?.text && (
                        <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: `1px solid ${LINE}`, fontSize: '0.86rem', color: TEXT, opacity: 0.9, lineHeight: 1.5 }}>{gameplanTake.text}</div>
                    )}
                </div>
            ) : null}

            <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : '1fr 300px', gap: '16px', alignItems: 'start' }}>
                <div style={{ minWidth: 0 }}>
                    {renderMflPush()}
                    {/* Hero — Pro: Your lineup vs Optimal. Free: raw working total
                        (sum of the slots the user set) + optimizer teaser; the
                        optimal total / bench delta are optimizer outputs. */}
                    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '18px 20px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                        <div style={{ fontSize: '0.72rem', letterSpacing: '0.08em', color: SILVER, fontWeight: 600 }}>WEEK {result.week} · GAME DAY CENTRAL</div>
                        {pro ? (
                            <React.Fragment>
                                <div style={{ fontSize: '1.45rem', fontWeight: 700, color: isOptimal ? GREEN : GOLD, marginTop: '6px' }}>
                                    {!optimizerAvailable ? 'Lineup planning · ' + formWinLabel + ' PPG' : !formComplete ? 'More game history needed' : missingPlanForm ? 'Some averages are missing' : planUnavailable ? 'Replace unavailable starters' : isOptimal ? 'Lineup is optimal' : `${benchPts.toFixed(1)} ${formWinLabel} PPG below optimal`}
                                </div>
                                <div style={{ color: SILVER, fontSize: '0.82rem', marginTop: '4px' }}>
                                    Your lineup {workingTotal.toFixed(1)}{missingPlanForm ? ' (partial)' : ''} · Optimal {formComplete ? optimalTotal.toFixed(1) : '—'} {formWinLabel} PPG
                                </div>
                            </React.Fragment>
                        ) : (
                            <React.Fragment>
                                <div style={{ fontSize: '1.45rem', fontWeight: 700, color: GOLD, marginTop: '6px' }}>
                                    Your lineup {workingTotal.toFixed(1)} {formWinLabel} PPG
                                </div>
                                <div style={{ color: SILVER, fontSize: '0.82rem', marginTop: '4px' }}>
                                    Tap a slot below to set your starters — the total updates live.
                                </div>
                            </React.Fragment>
                        )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        {pro ? (
                            <React.Fragment>
                                <div style={{ fontSize: '0.66rem', color: SILVER, letterSpacing: '0.06em' }}>OPTIMIZING FOR</div>
                                <div style={{ fontSize: '0.82rem', color: GOLD, fontWeight: 600, marginTop: '3px' }}>{formWinLabel} · Rolling average</div>
                            </React.Fragment>
                        ) : null}
                        <div style={{ display: 'flex', gap: '6px', marginTop: '10px', justifyContent: 'flex-end' }}>
                            {pro ? <button className="lineup-apply" disabled={!canOptimize} onClick={applyOptimal} style={{ ...actBtn, color: GOLD, borderColor: 'var(--acc-line2, rgba(212,175,55,0.4))', background: 'rgba(212,175,55,0.12)' }}>Apply Optimal</button> : null}
                            <button onClick={() => { setWorkingAssign(currentAssign); setOpenSlot(null); }} style={actBtn}>Reset</button>
                        </div>
                    </div>
                </div>
                <p className="roster-lineup-hint">{formHelp}</p>
                {!pro && GatedRow ? (
                    <div style={{ marginTop: '12px' }}>
                        <GatedRow title="Lineup optimizer" sub="Optimal lineup + points left on bench, floor–ceiling bands, matchup grades and win odds" feature={STARTSIT_FEAT} />
                    </div>
                ) : null}
            </div>

            {matchupPanel}

            {/* Unified interactive lineup table */}
            <div id="gameday-starting-lineup" style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', borderBottom: `1px solid ${LINE}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.7rem', letterSpacing: '0.08em', color: SILVER, fontWeight: 600 }}>STARTING LINEUP · tap a slot to set it</span>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <span style={{ fontSize: fz('0.58rem'), color: SILVER, letterSpacing: '0.05em', marginRight: '2px' }}>FORM</span>
                        {[['L3', 3], ['L5', 5], ['L8', 8], ['SZN', 'season']].map(opt => (
                            <button key={opt[0]} onClick={() => setFormWindow(opt[1])} style={winBtn(formWindow === opt[1])}>{opt[0]}</button>
                        ))}
                    </div>
                </div>
                {trackingLineup ? mobileScoreboard : null}
                {headerRow}
                {[...startingSlots].sort((a, b) => (SLOT_DISPLAY_ORDER[a.slotName] ?? 50) - (SLOT_DISPLAY_ORDER[b.slotName] ?? 50)).map(sl => {
                    const pid = workingAssign[sl.idx] || null;
                    const open = openSlot === sl.idx;
                    const elig = open ? eligibleFor(sl) : [];
                    return (
                        <div key={sl.idx} style={{ borderBottom: `1px solid ${LINE}` }}>
                            <div onClick={() => setOpenSlot(open ? null : sl.idx)}
                                style={{ display: 'grid', gridTemplateColumns: GRID, gap: '8px', padding: isPhone ? '11px 14px' : '9px 14px', minHeight: isPhone ? '44px' : undefined, alignItems: 'center', cursor: 'pointer', background: open ? 'var(--acc-fill2, rgba(212,175,55,0.08))' : 'transparent' }}>
                                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: GOLD, letterSpacing: '0.04em' }}>{sl.slotName.replace('_', ' ')}<span style={{ color: SILVER, marginLeft: '4px', fontSize: fz('0.6rem') }}>{open ? '▾' : '▸'}</span></span>
                                <PlayerCells pid={pid} />
                            </div>
                            {open ? (
                                <div style={{ background: 'var(--ov-2, rgba(255,255,255,0.03))', borderTop: `1px solid ${LINE}`, padding: '4px 0' }}>
                                    {/* Phone: the Form/Hi/Lo columns are dropped from the grid —
                                        surface the assigned starter's form here on expand. */}
                                    {isPhone && pid ? (() => {
                                        const fs = formOf(pid);
                                        return fs ? (
                                            <div style={{ padding: '6px 14px 2px', fontSize: '0.7rem', color: SILVER, fontVariantNumeric: 'tabular-nums' }}>
                                                {formWinLabel} <span style={{ color: TEXT, fontWeight: 700 }}>{fs.rollingPPG.toFixed(1)}</span>
                                                {' · Hi '}<span style={{ color: GREEN, fontWeight: 700 }}>{fs.high.toFixed(1)}</span>
                                                {' · Lo '}<span style={{ color: SILVER, fontWeight: 700 }}>{fs.low.toFixed(1)}</span>
                                            </div>
                                        ) : null;
                                    })() : null}
                                    <div style={{ padding: '5px 14px', fontSize: fz('0.58rem'), letterSpacing: '0.05em', color: SILVER, textTransform: 'uppercase' }}>Eligible for {sl.slotName.replace('_', ' ')} — tap to start</div>
                                    {elig.map(epid => {
                                        const isCur = String(pid) === String(epid);
                                        return (
                                            <div key={epid} onClick={() => { canChangePlayer(pid) && canChangePlayer(epid) && setWorkingAssign(w => ({ ...w, [sl.idx]: epid })); setOpenSlot(null); }}
                                                style={{ display: 'grid', gridTemplateColumns: GRID, gap: '8px', padding: isPhone ? '10px 14px' : '7px 14px', minHeight: isPhone ? '44px' : undefined, alignItems: 'center', cursor: 'pointer', background: isCur ? 'rgba(212,175,55,0.10)' : 'transparent', borderLeft: isCur ? `3px solid ${GOLD}` : '3px solid transparent' }}>
                                                <span style={{ fontSize: fz('0.6rem'), color: isCur ? GOLD : SILVER, fontWeight: 700 }}>{isCur ? 'IN' : ''}</span>
                                                <PlayerCells pid={epid} />
                                            </div>
                                        );
                                    })}
                                    {pid ? (
                                        <div onClick={() => { canChangePlayer(pid) && setWorkingAssign(w => { const n = { ...w }; delete n[sl.idx]; return n; }); setOpenSlot(null); }}
                                            style={{ padding: isPhone ? '13px 14px' : '7px 14px', cursor: 'pointer', color: RED, fontSize: '0.7rem', fontWeight: 600 }}>✕ Empty this slot</div>
                                    ) : null}
                                    {!elig.length ? <div style={{ padding: '7px 14px', color: SILVER, fontSize: '0.74rem', opacity: 0.7 }}>No eligible bench players.</div> : null}
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>

            <div style={{ color: SILVER, fontSize: '0.66rem', marginTop: '10px', lineHeight: 1.6, opacity: 0.9 }}>
                <strong style={{ color: TEXT }}>Proj</strong> projected pts (your {objective} strategy){pro ? <React.Fragment> · <strong style={{ color: TEXT }}>Mtch</strong> matchup grade A–F (opponent's implied total)</React.Fragment> : null} · <strong style={{ color: TEXT }}>{formWinLabel}</strong> rolling avg of actual pts · <strong style={{ color: TEXT }}>Hi/Lo</strong> season best/worst week
            </div>
            <div style={{ color: SILVER, fontSize: '0.72rem', marginTop: '8px', lineHeight: 1.5 }}>
                Projections are league-scored from role, recent form{objective !== 'median' ? `, your ${result.mode.replace('_', '-')} strategy` : ''}, matchup and defense-vs-position; form columns are actual weekly points over the chosen window. Build and compare here{isMfl ? ' — then push straight to MFL above' : ' — set the final lineup on your platform'}.
            </div>
                </div>
                <div style={{ order: isNarrow ? 3 : 0 }}>{renderRail()}</div>
            </div>
        </div>
    );
}

window.LineupTab = LineupTab;
