// ══════════════════════════════════════════════════════════════════
// js/tabs/league-central.js — LeagueCentralTab
// Single-page league hub: standings + playoff picture (division or overall),
// this week's scoreboard, stat leaders, recent transactions.
//
// Reuses existing engines rather than building new ones:
//   App.Luck + App.PlayoffOdds   — same wiring recipe as season-odds-panel.js
//   App.SOS.getWeekStats + calcFantasyPts — same recipe as gamelog-engine.js
//   window.fetchMatchups         — same grouping recipe as playoff-odds.js
//   `transactions` prop          — already computed + capped by league-detail.js
//
// Deliberately shows playoff odds as a percentage + bar, never a discrete
// "Clinched"/"Eliminated" tag — the sim is probabilistic, not a math-clinch
// solver, and this app's own ethos (see season-odds-panel.js's noPlayoffs
// messaging) is to not fabricate certainty a compute pass can't back up.
//
// Exposes: window.LeagueCentralTab
// ══════════════════════════════════════════════════════════════════
function LeagueCentralTab({
    currentLeague,
    leagueSkin,
    myRoster,
    playersData,
    standings,
    transactions,
    sleeperUserId,
    getOwnerName,
    getPlayerName,
    timeAgo,
    setActiveTab,
    // Merged-home mode (redraft / chopped): this tab IS the landing page, so
    // it also carries the intelligence briefing and the Home widget grid.
    // Both arrive as ready-built elements from league-detail.js rather than as
    // prop bundles — this component owns the layout, not the wiring.
    homeMerged,
    briefSlot,
    kpiSlot,
}) {
    const GOLD = 'var(--gold, #d4af37)';
    const SILVER = 'var(--silver, #bdb8ad)';
    const WHITE = 'var(--white, #f5f2ea)';
    const MUTED = 'var(--text-muted, #8d887e)';
    const FAINT = 'var(--text-faint, rgba(189,184,173,0.62))';
    const GOOD = 'var(--good, #2ecc71)';
    const BAD = 'var(--bad, #e74c3c)';
    const WARN = 'var(--warn, #f0a500)';
    const INFO = 'var(--info, #5dade2)';
    const PANEL = 'var(--off-black, #1b1b22)';
    const WELL = 'var(--black, #121217)';
    const LINE = 'rgba(212,175,55,0.16)';
    const RAJ = 'var(--font-title, "Rajdhani", sans-serif)';
    const DM = 'var(--font-body, "DM Sans", sans-serif)';
    const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
    const mono = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' };
    const microHdr = { fontFamily: MONO, fontSize: '0.6875rem', fontWeight: 600, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase' };
    const sameId = (a, b) => String(a) === String(b);

    const resolvedLeagueSkin = leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;
    const vp = window.WR?.useViewport?.() || {};
    const isPhone = !!vp.isPhone;

    const leagueId = currentLeague?.league_id || currentLeague?.id || '';
    const season = currentLeague?.season || '';
    const playoffTeams = Math.max(2, Number(currentLeague?.settings?.playoff_teams) || 6);
    const noPlayoffs = resolvedLeagueSkin?.features?.showPlayoffOdds === false;

    const _getPlayerName = getPlayerName || (pid => playersData?.[pid]?.full_name || ('Player ' + pid));
    const _getOwnerName = getOwnerName || (rosterId => {
        const r = currentLeague?.rosters?.find(x => x.roster_id === rosterId);
        const u = currentLeague?.users?.find(x => x.user_id === r?.owner_id);
        return u?.display_name || u?.username || 'Unknown';
    });
    const _timeAgo = timeAgo || (() => '');

    // ── Playoff odds + weekly-score ledger (season-odds-panel.js's exact recipe) ──
    const [odds, setOdds] = React.useState({ status: 'idle' });
    const runRef = React.useRef({ key: null });
    React.useEffect(() => {
        if (noPlayoffs) return;
        if (odds.status !== 'idle') return;
        if (runRef.current.key === leagueId) return;
        const Luck = window.App?.Luck, PO = window.App?.PlayoffOdds, WP = window.App?.WeeklyProj;
        if (!Luck || !PO || !WP || !currentLeague) { setOdds({ status: 'unavailable' }); return; }
        const runKey = leagueId;
        runRef.current.key = runKey;
        const live = () => runRef.current.key === runKey;
        setOdds({ status: 'loading' });
        (async () => {
            try {
                const curWk = WP.currentWeek();
                const pws = Number(currentLeague.settings?.playoff_week_start) || 15;
                const lastReg = Math.max(1, Math.min(18, pws - 1));
                const seasonOver = resolvedLeagueSkin?.phase === 'complete' || resolvedLeagueSkin?.phase === 'offseason';
                const ledger = await Luck.build({ league: currentLeague, throughWeek: seasonOver ? lastReg : undefined });
                const playedWeeks = ledger.weeks.length;
                let sim = null;
                if (!seasonOver && playedWeeks >= 2 && curWk <= lastReg) {
                    const futurePairs = await PO.fetchFuturePairs({ league: currentLeague, fromWeek: curWk, toWeek: lastReg });
                    sim = PO.simulate({ league: currentLeague, ledger, futurePairs, myRosterId: myRoster?.roster_id, sims: 10000 });
                }
                if (live()) setOdds({ status: 'ready', ledger, sim, curWk, lastReg });
            } catch (e) {
                window.wrLog?.('leagueCentral.odds', e);
                if (live()) setOdds({ status: 'error' });
            }
        })();
    }, [odds.status, leagueId, noPlayoffs]);

    // ── This week's scoreboard ──
    const [board, setBoard] = React.useState({ status: 'idle', week: null, rows: [] });
    React.useEffect(() => {
        const WP = window.App?.WeeklyProj;
        if (!WP || !currentLeague || typeof window.fetchMatchups !== 'function' || !leagueId) return;
        const wk = Math.max(1, Math.min(18, WP.currentWeek()));
        let alive = true;
        setBoard({ status: 'loading', week: wk, rows: [] });
        window.fetchMatchups(leagueId, wk)
            .then(rows => { if (alive) setBoard({ status: 'ready', week: wk, rows: rows || [] }); })
            .catch(e => { window.wrLog?.('leagueCentral.matchups', e); if (alive) setBoard({ status: 'error', week: wk, rows: [] }); });
        return () => { alive = false; };
    }, [leagueId]);

    const weekHasScores = board.rows.filter(r => Number(r.points) > 0).length >= 2;
    const statWeek = board.week ? Math.max(1, weekHasScores ? board.week : board.week - 1) : null;

    // ── Stat leaders — week AND season, keeping the RAW stat line ──
    // The raw line is what lets the Stats panel render real position columns
    // (CMP%/YPA for a QB, TGT/REC for a WR, TKL/SACK for IDP) through
    // App.StatCatalog rather than points-only. Same field vocabulary either
    // way: SOS.getWeekStats for a week, fetchSeasonStats for the season
    // aggregate (see js/shared/stat-catalog.js's header note).
    const [statScope, setStatScope] = React.useState('week'); // 'week' | 'season'
    const [leaders, setLeaders] = React.useState({ status: 'idle', week: null, rows: [] });
    const [seasonLeaders, setSeasonLeaders] = React.useState({ status: 'idle', rows: [] });

    // Shared: raw {pid: statLine} -> scored, sorted rows for every rostered player.
    const buildLeaderRows = React.useCallback((statsByPid) => {
        const scoring = currentLeague?.scoring_settings || {};
        const seen = new Set();
        const rows = [];
        (currentLeague?.rosters || []).forEach(r => {
            (r.players || []).forEach(pid => {
                if (seen.has(pid)) return;
                seen.add(pid);
                const raw = statsByPid[pid];
                if (!raw) return;
                const pts = window.calcFantasyPts(raw, scoring);
                if (!(pts > 0)) return;
                const player = playersData?.[pid] || {};
                rows.push({
                    pid, raw, pts: Math.round(pts * 10) / 10,
                    pos: window.App?.normPos?.(player.position) || player.position || '??',
                    name: _getPlayerName(pid), team: player.team || '', rosterId: r.roster_id,
                });
            });
        });
        rows.sort((a, b) => b.pts - a.pts);
        return rows;
    }, [currentLeague, playersData]);

    React.useEffect(() => {
        const SOS = window.App?.SOS;
        if (!SOS?.getWeekStats || typeof window.calcFantasyPts !== 'function' || !currentLeague || !statWeek) return undefined;
        let alive = true;
        setLeaders(s => ({ ...s, status: 'loading', week: statWeek }));
        Promise.resolve(SOS.getWeekStats(season, statWeek)).then(weekStats => {
            if (!alive) return;
            setLeaders({ status: 'ready', week: statWeek, rows: buildLeaderRows(weekStats || {}) });
        }).catch(e => { window.wrLog?.('leagueCentral.leaders', e); if (alive) setLeaders({ status: 'error', week: statWeek, rows: [] }); });
        return () => { alive = false; };
    }, [leagueId, statWeek, season, buildLeaderRows]);

    // Season aggregate — lazy, only once the user actually asks for it.
    React.useEffect(() => {
        if (statScope !== 'season' || seasonLeaders.status !== 'idle') return;
        if (typeof window.fetchSeasonStats !== 'function' || typeof window.calcFantasyPts !== 'function' || !currentLeague) {
            setSeasonLeaders({ status: 'unavailable', rows: [] });
            return;
        }
        let alive = true;
        setSeasonLeaders({ status: 'loading', rows: [] });
        Promise.resolve(window.fetchSeasonStats(Number(season) || new Date().getFullYear()))
            .then(data => { if (alive) setSeasonLeaders({ status: 'ready', rows: buildLeaderRows(data || {}) }); })
            .catch(e => { window.wrLog?.('leagueCentral.seasonLeaders', e); if (alive) setSeasonLeaders({ status: 'error', rows: [] }); });
        return () => { alive = false; };
    }, [statScope, seasonLeaders.status, season, currentLeague, buildLeaderRows]);

    // Reset the season cache when the league changes.
    React.useEffect(() => { setSeasonLeaders({ status: 'idle', rows: [] }); }, [leagueId]);

    // ── Divisions ──
    const metadata = currentLeague?.metadata || {};
    const getDivisionKey = (rosterId) => {
        const r = currentLeague?.rosters?.find(x => sameId(x.roster_id, rosterId));
        return String(r?.settings?.division ?? 0);
    };
    const getDivisionName = (key) => metadata['division_' + key + '_name'] || metadata['division_' + key] || ('Division ' + key);
    const hasDivisions = (Number(currentLeague?.settings?.divisions) || 0) >= 2
        && (currentLeague?.rosters || []).length > 0
        && (currentLeague?.rosters || []).every(r => r.settings?.division);
    const [standingsView, setStandingsView] = React.useState(hasDivisions ? 'division' : 'overall');

    // ── Merge standings + playoff sim + PA + streak ──
    const enrichedStandings = React.useMemo(() => {
        return (standings || []).map(team => {
            const roster = currentLeague?.rosters?.find(r => sameId(r.roster_id, team.rosterId));
            const pf = (roster?.settings?.fpts || 0) + ((roster?.settings?.fpts_decimal || 0) / 100);
            const pa = (roster?.settings?.fpts_against || 0) + ((roster?.settings?.fpts_against_decimal || 0) / 100);
            const simRow = odds.sim?.rows?.find(r => sameId(r.rosterId, team.rosterId));
            const luckRow = odds.ledger?.rows?.find(r => sameId(r.rosterId, team.rosterId));
            let streak = null;
            // Soccer-style form guide: the last 5 results oldest -> newest.
            // Same weekly ledger the streak is derived from, so the two can
            // never disagree.
            let form = [];
            if (luckRow?.weekly?.length) {
                const played = [...luckRow.weekly].filter(g => g.result).sort((a, b) => b.week - a.week);
                if (played.length) {
                    const r = played[0].result;
                    let n = 0;
                    for (const g of played) { if (g.result === r) n++; else break; }
                    streak = r + n;
                    form = played.slice(0, 5).reverse().map(g => ({ week: g.week, result: g.result, pts: g.pts }));
                }
            }
            return {
                ...team,
                pointsFor: pf || team.pointsFor || 0,
                pointsAgainst: pa,
                division: getDivisionKey(team.rosterId),
                streak,
                form,
                playoffPct: simRow ? simRow.playoffPct : null,
                byePct: simRow ? simRow.byePct : null,
                titlePct: simRow ? simRow.titlePct : null,
                projWins: simRow ? simRow.projWins : null,
                projLosses: simRow ? simRow.projLosses : null,
            };
        });
    }, [standings, currentLeague, odds.sim, odds.ledger]);

    const divisionGroups = React.useMemo(() => {
        if (!hasDivisions) return [];
        const byKey = {};
        enrichedStandings.forEach(t => { (byKey[t.division] = byKey[t.division] || []).push(t); });
        return Object.keys(byKey).sort((a, b) => Number(a) - Number(b)).map(key => ({
            key, name: getDivisionName(key), teams: byKey[key],
        }));
    }, [enrichedStandings, hasDivisions]);

    // ── Shells ──
    const Panel = ({ title, meta, right, children }) => (
        <div style={{ background: PANEL, border: '1px solid ' + LINE, borderRadius: 'var(--card-radius, 10px)', padding: '14px 16px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <span style={{ fontFamily: RAJ, fontWeight: 700, fontSize: '1.05rem', letterSpacing: '0.03em', color: WHITE }}>{title}</span>
                {meta ? <span style={{ ...microHdr, textTransform: 'none', letterSpacing: 0 }}>{meta}</span> : null}
                {right ? <div style={{ marginLeft: 'auto' }}>{right}</div> : null}
            </div>
            {children}
        </div>
    );
    const Kpi = ({ label, value, sub }) => (
        <div style={{ background: WELL, border: '1px solid ' + LINE, borderRadius: 'var(--card-radius-sm, 8px)', padding: '10px 12px', flex: '1 1 150px', minWidth: '140px' }}>
            <div style={microHdr}>{label}</div>
            <div style={{ ...mono, fontSize: '1.4rem', fontWeight: 700, color: WHITE, marginTop: '3px' }}>{value}</div>
            {sub ? <div style={{ fontFamily: DM, fontSize: '0.75rem', color: MUTED, marginTop: '2px' }}>{sub}</div> : null}
        </div>
    );
    const OddsBar = ({ pct }) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '110px' }}>
            <div style={{ flex: 1, height: '6px', background: WELL, border: '1px solid ' + LINE, borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: Math.max(0, Math.min(100, pct)) + '%', height: '100%', background: pct >= 60 ? GOOD : pct >= 25 ? INFO : BAD }} />
            </div>
            <span style={{ ...mono, fontSize: '0.75rem', color: WHITE, width: '34px', textAlign: 'right' }}>{Math.round(pct)}%</span>
        </div>
    );
    const Avatar = ({ label }) => (
        <div style={{ width: '26px', height: '26px', borderRadius: 'var(--card-radius-sm, 8px)', background: 'rgba(212,175,55,0.14)', color: GOLD, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: RAJ, fontWeight: 700, fontSize: '0.68rem', flexShrink: 0 }}>
            {label}
        </div>
    );

    // ── Standings table (shared between division + overall renders) ──
    function StandingsRow({ team, rank, showDiv }) {
        const isMe = sameId(team.userId, sleeperUserId);
        const initials = (team.teamName || team.displayName || '??').replace(/[^A-Za-z0-9 ]/g, '').split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase() || '??';
        return (
            <div style={{
                display: 'grid',
                gridTemplateColumns: isPhone ? '20px 1fr 52px' : (showDiv ? '20px 1fr 44px 52px 62px 62px 52px 110px' : '20px 1fr 52px 62px 62px 52px 110px'),
                gap: '8px', alignItems: 'center', padding: '7px 6px',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                background: isMe ? 'rgba(212,175,55,0.06)' : 'transparent',
            }}>
                <span style={{ ...mono, fontSize: '0.75rem', color: MUTED }}>{rank}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <Avatar label={initials} />
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: DM, fontWeight: 600, fontSize: '0.85rem', color: WHITE, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {team.teamName || team.displayName}{isMe ? ' (You)' : ''}
                        </div>
                        <div style={{ fontFamily: DM, fontSize: '0.7rem', color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{team.displayName}</div>
                    </div>
                </div>
                {showDiv && !isPhone && <span style={{ fontFamily: MONO, fontSize: '0.65rem', color: MUTED, border: '1px solid ' + LINE, borderRadius: '3px', padding: '1px 5px', textAlign: 'center' }}>{getDivisionName(team.division).replace(/ ?Division ?/i, '').slice(0, 3).toUpperCase() || team.division}</span>}
                <span style={{ ...mono, fontSize: '0.8rem', color: WHITE, textAlign: 'right' }}>{team.wins}-{team.losses}{team.ties ? '-' + team.ties : ''}</span>
                {!isPhone && <span style={{ ...mono, fontSize: '0.8rem', color: SILVER, textAlign: 'right' }}>{team.pointsFor.toFixed(1)}</span>}
                {!isPhone && <span style={{ fontFamily: MONO, fontSize: '0.72rem', color: team.streak?.[0] === 'W' ? GOOD : team.streak?.[0] === 'L' ? BAD : MUTED, textAlign: 'right' }}>{team.streak || '—'}</span>}
                {noPlayoffs ? <span /> : (team.playoffPct != null ? <OddsBar pct={team.playoffPct} /> : <span style={{ ...mono, fontSize: '0.72rem', color: FAINT }}>—</span>)}
            </div>
        );
    }
    function StandingsHeader({ showDiv }) {
        return (
            <div style={{
                display: 'grid',
                gridTemplateColumns: isPhone ? '20px 1fr 52px' : (showDiv ? '20px 1fr 44px 52px 62px 62px 52px 110px' : '20px 1fr 52px 62px 62px 52px 110px'),
                gap: '8px', padding: '0 6px 6px', borderBottom: '1px solid ' + LINE,
            }}>
                <span style={microHdr}>#</span>
                <span style={microHdr}>Team</span>
                {showDiv && !isPhone && <span style={microHdr}>Div</span>}
                <span style={{ ...microHdr, textAlign: 'right' }}>W-L</span>
                {!isPhone && <span style={{ ...microHdr, textAlign: 'right' }}>PF</span>}
                {!isPhone && <span style={{ ...microHdr, textAlign: 'right' }}>Strk</span>}
                {!noPlayoffs && <span style={microHdr}>Playoff %</span>}
            </div>
        );
    }

    // ── Render ──
    const teamCount = currentLeague?.rosters?.length || 0;
    const leaguePositions = (window.getLeaguePositions ? window.getLeaguePositions({ league: currentLeague }) : ['QB', 'RB', 'WR', 'TE']) || ['QB', 'RB', 'WR', 'TE'];
    const [leaderPos, setLeaderPos] = React.useState('Overall');
    const [stMode, setStMode] = React.useState('table'); // 'table' | 'odds'
    // Merged-home inner tabs + briefing collapse. The collapse sticks, because
    // the briefing is a once-a-visit read, not something to re-dismiss on every
    // page load.
    const [innerTab, setInnerTab] = React.useState('league'); // 'league' | 'kpis'
    const BRIEF_KEY = 'wr_cc_brief_collapsed';
    const [briefCollapsed, setBriefCollapsed] = React.useState(
        () => window.App?.WrStorage?.get?.(BRIEF_KEY, false) === true
    );
    const toggleBrief = () => setBriefCollapsed(v => {
        const next = !v;
        try { window.App?.WrStorage?.set?.(BRIEF_KEY, next); } catch (e) { /* private mode */ }
        return next;
    });

    const activeLeaders = statScope === 'season' ? seasonLeaders : leaders;
    const leaderRows = (leaderPos === 'Overall'
        ? activeLeaders.rows
        : activeLeaders.rows.filter(r => r.pos === leaderPos)).slice(0, 10);

    // Per-position stat columns, defined as App.StatCatalog keys so the
    // catalog stays the single source of truth for how each stat is derived
    // and formatted (see js/shared/stat-catalog.js). 'Overall' is the
    // cross-position points board and has no stat columns.
    const STAT_COLS = {
        QB: ['cmpPct', 'passYd', 'passTd', 'ints'],
        RB: ['rushAtt', 'rushYd', 'rushTd', 'receptions'],
        WR: ['targets', 'receptions', 'recYd', 'recTd'],
        TE: ['targets', 'receptions', 'recYd', 'recTd'],
        K: ['fgPct', 'fg50', 'xpm'],
        DL: ['tackles', 'sacks', 'qbHits'],
        LB: ['tackles', 'tfl', 'sacks'],
        DB: ['tackles', 'passDef', 'idpInts'],
    };
    const SC = window.App?.StatCatalog;
    const statCols = (leaderPos !== 'Overall' && SC ? (STAT_COLS[leaderPos] || []) : [])
        .map(k => SC.statByKey ? SC.statByKey(k) : null).filter(Boolean);


    // Standings row shells — the table view (form guide) and the odds view
    // (playoff picture) are two reads of the same enriched rows, so a team
    // can never rank differently between them.
    const FormGuide = ({ form }) => {
        if (!form || !form.length) return <span style={{ color: FAINT, fontFamily: MONO, fontSize: '0.65rem' }}>—</span>;
        return (
            <span style={{ display: 'inline-flex', gap: '3px' }}>
                {form.map((g, i) => (
                    <i key={i} title={'Week ' + g.week + (g.pts != null ? ' · ' + Number(g.pts).toFixed(1) : '')}
                        style={{
                            width: '16px', height: '16px', borderRadius: 'var(--card-radius-xs, 5px)',
                            display: 'grid', placeItems: 'center', fontFamily: MONO, fontSize: '0.5rem',
                            fontWeight: 800, fontStyle: 'normal',
                            background: g.result === 'W' ? 'rgba(46,204,113,0.16)' : 'rgba(231,76,60,0.14)',
                            color: g.result === 'W' ? GOOD : BAD,
                            border: '1px solid ' + (g.result === 'W' ? 'rgba(46,204,113,0.34)' : 'rgba(231,76,60,0.3)'),
                        }}>{g.result}</i>
                ))}
            </span>
        );
    };

    const th = { fontFamily: MONO, fontSize: '0.6rem', color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', padding: '6px 7px', borderBottom: '1px solid ' + LINE, whiteSpace: 'nowrap' };
    const thNum = { ...th, textAlign: 'right' };
    const td = { padding: '7px', borderBottom: '1px solid rgba(255,255,255,0.04)', whiteSpace: 'nowrap', fontFamily: DM, fontSize: '0.78rem' };
    const tdNum = { ...td, textAlign: 'right', ...mono };

    const teamCell = (team, rank) => {
        const isMe = sameId(team.rosterId, myRoster?.roster_id);
        return (
            <React.Fragment>
                <td style={{ ...td, ...mono, color: MUTED, width: '22px', boxShadow: isMe ? 'inset 3px 0 0 ' + GOLD : 'none' }}>{rank}</td>
                <td style={{ ...td, fontWeight: isMe ? 700 : 600, color: isMe ? GOLD : WHITE, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {team.teamName || team.displayName || _getOwnerName(team.rosterId)}
                </td>
            </React.Fragment>
        );
    };

    const StandingsTable = ({ teams, showCutline }) => (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
                <tr>
                    <th style={th}></th><th style={th}>Team</th>
                    <th style={thNum}>W-L</th>
                    {!isPhone && <th style={thNum}>PF</th>}
                    {!isPhone && <th style={thNum}>PA</th>}
                    <th style={thNum}>Strk</th>
                    {!isPhone && <th style={th}>Last 5</th>}
                </tr>
            </thead>
            <tbody>
                {teams.map((team, idx) => (
                    <tr key={team.rosterId} style={showCutline && idx === playoffTeams - 1 && idx < teams.length - 1
                        ? { boxShadow: 'inset 0 -1px 0 rgba(212,175,55,0.45)' } : null}>
                        {teamCell(team, idx + 1)}
                        <td style={tdNum}>{team.wins}-{team.losses}</td>
                        {!isPhone && <td style={tdNum}>{(team.pointsFor || 0).toFixed(1)}</td>}
                        {!isPhone && <td style={{ ...tdNum, color: MUTED }}>{(team.pointsAgainst || 0).toFixed(1)}</td>}
                        <td style={{ ...tdNum, fontWeight: 700, color: team.streak ? (team.streak[0] === 'W' ? GOOD : BAD) : MUTED }}>{team.streak || '—'}</td>
                        {!isPhone && <td style={td}><FormGuide form={team.form} /></td>}
                    </tr>
                ))}
            </tbody>
        </table>
    );

    const OddsTable = ({ teams }) => (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
                <tr>
                    <th style={th}></th><th style={th}>Team</th>
                    <th style={thNum}>W-L</th>
                    <th style={thNum}>Playoff</th>
                    {!isPhone && <th style={thNum}>Bye</th>}
                    <th style={thNum}>Title</th>
                </tr>
            </thead>
            <tbody>
                {teams.map((team, idx) => (
                    <tr key={team.rosterId} style={idx === playoffTeams - 1 && idx < teams.length - 1
                        ? { boxShadow: 'inset 0 -1px 0 rgba(212,175,55,0.45)' } : null}>
                        {teamCell(team, idx + 1)}
                        <td style={tdNum}>{team.wins}-{team.losses}</td>
                        <td style={tdNum}>
                            {team.playoffPct == null ? <span style={{ color: MUTED }}>—</span> : (
                                <React.Fragment>
                                    <span style={{ width: '42px', height: '5px', background: 'rgba(255,255,255,0.06)', borderRadius: 'var(--card-radius-xs, 5px)', display: 'inline-block', overflow: 'hidden', verticalAlign: 'middle', marginRight: '7px' }}>
                                        <i style={{ display: 'block', height: '100%', width: Math.max(0, Math.min(100, team.playoffPct)) + '%', background: GOOD, borderRadius: 'var(--card-radius-xs, 5px)' }} />
                                    </span>{team.playoffPct}%
                                </React.Fragment>
                            )}
                        </td>
                        {!isPhone && <td style={{ ...tdNum, color: SILVER }}>{team.byePct == null ? '—' : team.byePct + '%'}</td>}
                        <td style={{ ...tdNum, color: GOLD }}>{team.titlePct == null ? '—' : team.titlePct + '%'}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );

    const segBtn = (on) => ({
        fontFamily: MONO, fontSize: '0.6rem', letterSpacing: '0.05em', textTransform: 'uppercase',
        padding: '5px 9px', borderRadius: 'var(--card-radius-xs, 5px)', border: 'none', cursor: 'pointer',
        whiteSpace: 'nowrap',
        background: on ? 'rgba(212,175,55,0.16)' : 'transparent', color: on ? GOLD : MUTED,
    });
    const segWrap = { display: 'flex', gap: '2px', background: WELL, borderRadius: 'var(--card-radius-sm, 8px)', padding: '2px', border: '1px solid ' + LINE };

    const me = enrichedStandings.find(t => sameId(t.rosterId, myRoster?.roster_id));
    const oddsReady = odds.status === 'ready' && odds.sim;

    return (
        <div style={{ padding: isPhone ? '14px' : '20px 24px', maxWidth: '1500px', margin: '0 auto', paddingBottom: '54px' }}>
            <div style={{ marginBottom: '14px' }}>
                <div style={{ fontFamily: RAJ, fontWeight: 700, fontSize: isPhone ? '1.3rem' : '1.6rem', color: WHITE, letterSpacing: '0.02em' }}>
                    {homeMerged ? 'Command Center' : 'League Central'}
                </div>
                <div style={{ fontFamily: DM, fontSize: '0.8rem', color: MUTED, marginTop: '2px' }}>
                    {currentLeague?.name || 'League'} · {season} · {teamCount} Teams
                    {board.week ? <> · Week {board.week}</> : null}
                </div>
            </div>

            {/* Briefing — always the first thing you see on entry, collapsible
                to a one-line bar once you've read it. */}
            {homeMerged && briefSlot && (
                <div style={{ border: '1px solid rgba(155,138,251,0.28)', borderRadius: 'var(--card-radius-lg, 14px)', background: 'linear-gradient(135deg, rgba(155,138,251,0.09), rgba(212,175,55,0.03))', marginBottom: '14px', overflow: 'hidden' }}>
                    <button
                        type="button"
                        onClick={toggleBrief}
                        aria-expanded={!briefCollapsed}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: briefCollapsed ? '11px 14px' : '11px 14px 4px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'inherit' }}
                    >
                        <span style={{ ...microHdr, color: 'var(--purple, #9b8afb)' }}>Intelligence Briefing</span>
                        {briefCollapsed && (
                            <span style={{ fontFamily: DM, fontSize: '0.78rem', color: SILVER, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                                tap to expand
                            </span>
                        )}
                        <span style={{ marginLeft: 'auto', color: MUTED, fontSize: '0.7rem', transform: briefCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
                    </button>
                    {!briefCollapsed && <div style={{ padding: '0 4px 4px' }}>{briefSlot}</div>}
                </div>
            )}

            {/* League / KPIs */}
            {homeMerged && (
                <div style={{ display: 'flex', gap: '22px', borderBottom: '1px solid rgba(255,255,255,0.07)', marginBottom: '14px' }}>
                    {[['league', 'League'], ['kpis', 'KPIs']].map(([k, label]) => (
                        <button key={k} type="button" onClick={() => setInnerTab(k)} style={{
                            fontFamily: RAJ, fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.04em',
                            textTransform: 'uppercase', padding: '10px 2px', background: 'transparent',
                            border: 'none', borderBottom: '2px solid ' + (innerTab === k ? GOLD : 'transparent'),
                            color: innerTab === k ? GOLD : MUTED, cursor: 'pointer', position: 'relative', top: '1px',
                        }}>{label}</button>
                    ))}
                </div>
            )}

            {homeMerged && innerTab === 'kpis' ? (
                <div style={{ margin: isPhone ? '0 -14px' : '0 -24px' }}>{kpiSlot}</div>
            ) : (
            <React.Fragment>
            {/* The two things that matter: Standings | Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : '1.32fr 1fr', gap: '14px', alignItems: 'start' }}>

                <Panel
                    title="Standings"
                    meta={stMode === 'odds' ? '10,000-sim monte carlo' : (board.week ? 'through week ' + board.week + ' · last 5 form' : 'last 5 form')}
                    right={
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            {hasDivisions && stMode === 'table' && (
                                <div style={segWrap}>
                                    {['overall', 'division'].map(v => (
                                        <button key={v} onClick={() => setStandingsView(v)} style={segBtn(standingsView === v)}>
                                            {v === 'division' ? 'By Division' : 'Overall'}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {!noPlayoffs && (
                                <div style={segWrap}>
                                    <button onClick={() => setStMode('table')} style={segBtn(stMode === 'table')}>Table</button>
                                    <button onClick={() => setStMode('odds')} style={segBtn(stMode === 'odds')}>Playoff Picture</button>
                                </div>
                            )}
                        </div>
                    }
                >
                    {/* Your own odds lead the playoff view — the season-odds read,
                        folded into standings instead of a separate slab. */}
                    {stMode === 'odds' && oddsReady && me && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '9px', marginBottom: '11px' }}>
                            {[
                                { lab: 'Make Playoffs', val: me.playoffPct, color: GOOD },
                                { lab: 'First-Round Bye', val: me.byePct, color: INFO },
                                { lab: 'Win Title', val: me.titlePct, color: GOLD },
                            ].map(o => (
                                <div key={o.lab} style={{ background: WELL, border: '1px solid ' + LINE, borderRadius: 'var(--card-radius-sm, 8px)', padding: '10px 12px' }}>
                                    <div style={microHdr}>{o.lab}</div>
                                    <div style={{ ...mono, fontSize: '1.7rem', fontWeight: 700, color: o.color, marginTop: '3px', lineHeight: 1 }}>
                                        {o.val == null ? '—' : o.val + '%'}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    {stMode === 'odds' && !oddsReady && (
                        <div style={{ fontFamily: DM, fontSize: '0.8rem', color: MUTED, marginBottom: '10px' }}>
                            {odds.status === 'loading' ? 'Simulating the rest of the season…'
                                : 'Not enough games played to simulate the playoff picture yet.'}
                        </div>
                    )}

                    {!enrichedStandings.length ? (
                        <div style={{ fontFamily: DM, fontSize: '0.8rem', color: MUTED }}>No standings yet.</div>
                    ) : stMode === 'odds' ? (
                        <OddsTable teams={enrichedStandings} />
                    ) : (hasDivisions && standingsView === 'division') ? (
                        <div>
                            {divisionGroups.map(group => (
                                <div key={group.key} style={{ marginBottom: '12px' }}>
                                    <div style={{ ...microHdr, color: GOLD, padding: '6px', background: 'rgba(212,175,55,0.06)', borderRadius: 'var(--card-radius-xs, 5px)', marginBottom: '2px' }}>
                                        {group.name} <span style={{ color: MUTED, textTransform: 'none', letterSpacing: 0 }}>· {group.teams.length} teams</span>
                                    </div>
                                    <StandingsTable teams={group.teams} showCutline={false} />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <StandingsTable teams={enrichedStandings} showCutline={!noPlayoffs} />
                    )}
                </Panel>

                <Panel
                    title="Stats"
                    right={
                        <div style={segWrap}>
                            <button onClick={() => setStatScope('week')} style={segBtn(statScope === 'week')}>
                                {leaders.week ? 'Week ' + leaders.week : 'Week'}
                            </button>
                            <button onClick={() => setStatScope('season')} style={segBtn(statScope === 'season')}>Season</button>
                        </div>
                    }
                >
                    <div className="wr-hscroll" style={{ display: 'flex', gap: '3px', overflowX: 'auto', borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: '8px', marginBottom: '9px' }}>
                        {['Overall', ...leaguePositions].map(p => (
                            <button key={p} onClick={() => setLeaderPos(p)} style={{ ...segBtn(leaderPos === p), fontWeight: 700 }}>{p}</button>
                        ))}
                    </div>
                    {activeLeaders.status === 'loading' ? (
                        <div style={{ fontFamily: DM, fontSize: '0.8rem', color: MUTED }}>Loading {statScope === 'season' ? 'season' : 'week'} stats…</div>
                    ) : activeLeaders.status === 'unavailable' ? (
                        <div style={{ fontFamily: DM, fontSize: '0.8rem', color: MUTED }}>Season totals aren't available for this league.</div>
                    ) : !leaderRows.length ? (
                        <div style={{ fontFamily: DM, fontSize: '0.8rem', color: MUTED }}>No stats reported yet.</div>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        <th style={th}></th>
                                        <th style={th}>{leaderPos === 'Overall' ? 'Player' : 'Player'}</th>
                                        {leaderPos === 'Overall' && !isPhone && <th style={th}>Owner</th>}
                                        {statCols.map(c => <th key={c.key} style={thNum} title={c.label}>{c.short}</th>)}
                                        <th style={thNum}>PTS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {leaderRows.map((r, i) => (
                                        <tr key={r.pid}>
                                            <td style={{ ...td, ...mono, color: MUTED, width: '18px' }}>{i + 1}</td>
                                            <td style={{ ...td, maxWidth: '170px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                <div style={{ fontWeight: 600, color: WHITE }}>{r.name}</div>
                                                <div style={{ fontFamily: MONO, fontSize: '0.62rem', color: MUTED }}>{r.pos} · {r.team}</div>
                                            </td>
                                            {leaderPos === 'Overall' && !isPhone && (
                                                <td style={{ ...td, color: SILVER, fontSize: '0.72rem', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{_getOwnerName(r.rosterId)}</td>
                                            )}
                                            {statCols.map(c => (
                                                <td key={c.key} style={{ ...tdNum, color: SILVER }}>
                                                    {SC.formatStat(SC.computeStat(c.key, r.raw), c.format)}
                                                </td>
                                            ))}
                                            <td style={{ ...tdNum, fontWeight: 700, color: GOLD }}>{r.pts.toFixed(1)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Panel>
            </div>
            </React.Fragment>
            )}

        </div>
    );
}

window.LeagueCentralTab = LeagueCentralTab;
