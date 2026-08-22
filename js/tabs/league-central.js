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

    // ── Stat leaders for the most recently reported week ──
    const [leaders, setLeaders] = React.useState({ status: 'idle', week: null, rows: [] });
    React.useEffect(() => {
        const SOS = window.App?.SOS;
        if (!SOS?.getWeekStats || typeof window.calcFantasyPts !== 'function' || !currentLeague || !statWeek) return;
        let alive = true;
        setLeaders(s => ({ ...s, status: 'loading', week: statWeek }));
        Promise.resolve(SOS.getWeekStats(season, statWeek)).then(weekStats => {
            if (!alive) return;
            const scoring = currentLeague.scoring_settings || {};
            const seen = new Set();
            const rows = [];
            (currentLeague.rosters || []).forEach(r => {
                (r.players || []).forEach(pid => {
                    if (seen.has(pid)) return;
                    seen.add(pid);
                    const raw = weekStats[pid];
                    if (!raw) return;
                    const pts = window.calcFantasyPts(raw, scoring);
                    if (!(pts > 0)) return;
                    const player = playersData?.[pid] || {};
                    rows.push({
                        pid, pts: Math.round(pts * 10) / 10,
                        pos: window.App?.normPos?.(player.position) || player.position || '??',
                        name: _getPlayerName(pid), team: player.team || '', rosterId: r.roster_id,
                    });
                });
            });
            rows.sort((a, b) => b.pts - a.pts);
            if (alive) setLeaders({ status: 'ready', week: statWeek, rows });
        }).catch(e => { window.wrLog?.('leagueCentral.leaders', e); if (alive) setLeaders({ status: 'error', week: statWeek, rows: [] }); });
        return () => { alive = false; };
    }, [leagueId, statWeek]);

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
            if (luckRow?.weekly?.length) {
                const played = [...luckRow.weekly].filter(g => g.result).sort((a, b) => b.week - a.week);
                if (played.length) {
                    const r = played[0].result;
                    let n = 0;
                    for (const g of played) { if (g.result === r) n++; else break; }
                    streak = r + n;
                }
            }
            return {
                ...team,
                pointsFor: pf || team.pointsFor || 0,
                pointsAgainst: pa,
                division: getDivisionKey(team.rosterId),
                streak,
                playoffPct: simRow ? simRow.playoffPct : null,
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

    // ── KPIs ──
    const cutlineGB = React.useMemo(() => {
        if (enrichedStandings.length <= playoffTeams) return null;
        const inTeam = enrichedStandings[playoffTeams - 1];
        const outTeam = enrichedStandings[playoffTeams];
        if (!inTeam || !outTeam) return null;
        const gb = ((inTeam.wins - outTeam.wins) + (outTeam.losses - inTeam.losses)) / 2;
        return { gb, inTeam, outTeam };
    }, [enrichedStandings, playoffTeams]);

    const weekHigh = React.useMemo(() => {
        if (!weekHasScores) return null;
        let best = null;
        board.rows.forEach(r => {
            const pts = Number(r.points) || 0;
            if (!best || pts > best.pts) best = { pts, rosterId: r.roster_id };
        });
        return best;
    }, [board.rows, weekHasScores]);

    const movesThisWeek = React.useMemo(() => {
        const cutoff = Date.now() - 7 * 86400000;
        const recent = (transactions || []).filter(t => (t.created || 0) >= cutoff);
        const trades = recent.filter(t => t.type === 'trade').length;
        const waivers = recent.filter(t => t.type !== 'trade').length;
        return { total: recent.length, trades, waivers };
    }, [transactions]);

    // ── Trending — Risers & Fallers ──
    // League-wide, off the shared historical-season cache in
    // js/shared/stat-catalog.js (App.StatCatalog.ensureHistSeason/
    // historicalSeason/trendCalc — the same helpers Custom Reports' PPG/
    // usage trend columns use). Every ROSTERED player's own position
    // signature stat (targets for a WR, CMP% for a QB, tackles for IDP,
    // etc.) is compared across the last 2 completed seasons; ranked by
    // signed delta. Nothing here claims a trend from 1 data point — a
    // player with only one season on record just doesn't show up.
    const [trendTick, setTrendTick] = React.useState(0);
    React.useEffect(() => {
        const h = () => setTrendTick(t => t + 1);
        window.addEventListener('wr:hist-season-loaded', h);
        return () => window.removeEventListener('wr:hist-season-loaded', h);
    }, []);
    const trending = React.useMemo(() => {
        const SC = window.App?.StatCatalog;
        const rosters = currentLeague?.rosters || [];
        if (!SC || !rosters.length) return { status: 'unavailable', risers: [], fallers: [] };
        const seasonNum = Number(season) || new Date().getFullYear();
        const y1 = seasonNum - 1, y2 = seasonNum - 2;
        SC.ensureHistSeason(y1); SC.ensureHistSeason(y2);
        const h1 = SC.historicalSeason(y1), h2 = SC.historicalSeason(y2);
        if (!h1 && !h2) return { status: 'loading', risers: [], fallers: [] };
        const rows = [];
        const seen = new Set();
        rosters.forEach(r => {
            (r.players || []).forEach(pid => {
                if (seen.has(pid)) return;
                seen.add(pid);
                const p = playersData?.[pid]; if (!p) return;
                const pos = window.App?.normPos?.(p.position) || p.position;
                const topStat = SC.getTopStat(pos);
                if (!topStat) return;
                const rawY2 = h2 ? h2[pid] : null, rawY1 = h1 ? h1[pid] : null;
                const pts = [[y2, rawY2], [y1, rawY1]]
                    .map(([yr, raw]) => ({ yr, v: raw ? SC.computeStat(topStat.key, raw, { perGame: true }) : null }))
                    .filter(pt => pt.v != null);
                if (pts.length < 2) return;
                // A count/rate stat's %-change explodes off a near-zero
                // baseline (0.1 → 1.5 targets/gm reads as "+1025%") — real
                // math, but noise, not signal. Require the higher of the two
                // seasons to clear a small floor before it's a "trend."
                // Percentage-point stats (snap%, comp%) don't have this
                // problem — their delta is already an absolute point move.
                if (topStat.format !== 'pct' && Math.max(...pts.map(pt => pt.v)) < 2) return;
                const t = SC.trendCalc(pts, topStat.format);
                if (t.delta == null || t.delta === 0) return;
                rows.push({
                    pid, name: _getPlayerName(pid), pos, team: p.team || '',
                    rosterId: r.roster_id, statLabel: topStat.short, text: t.text, delta: t.delta,
                    isPct: topStat.format === 'pct',
                });
            });
        });
        rows.sort((a, b) => b.delta - a.delta);
        const positive = rows.filter(r => r.delta > 0);
        const negative = rows.filter(r => r.delta < 0);
        return {
            status: 'ready',
            risers: positive.slice(0, 5),
            fallers: negative.slice(-5).reverse(),
        };
    }, [currentLeague, playersData, season, trendTick]);

    // ── Shells ──
    const Panel = ({ title, meta, right, children }) => (
        <div style={{ background: PANEL, border: '1px solid ' + LINE, borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <span style={{ fontFamily: RAJ, fontWeight: 700, fontSize: '1.05rem', letterSpacing: '0.03em', color: WHITE }}>{title}</span>
                {meta ? <span style={{ ...microHdr, textTransform: 'none', letterSpacing: 0 }}>{meta}</span> : null}
                {right ? <div style={{ marginLeft: 'auto' }}>{right}</div> : null}
            </div>
            {children}
        </div>
    );
    const Kpi = ({ label, value, sub }) => (
        <div style={{ background: WELL, border: '1px solid ' + LINE, borderRadius: '8px', padding: '10px 12px', flex: '1 1 150px', minWidth: '140px' }}>
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
        <div style={{ width: '26px', height: '26px', borderRadius: '6px', background: 'rgba(212,175,55,0.14)', color: GOLD, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: RAJ, fontWeight: 700, fontSize: '0.68rem', flexShrink: 0 }}>
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
    const leaderRows = (leaderPos === 'Overall' ? leaders.rows : leaders.rows.filter(r => r.pos === leaderPos)).slice(0, 8);

    return (
        <div style={{ padding: isPhone ? '14px' : '20px 24px', maxWidth: '1400px', margin: '0 auto' }}>
            <div style={{ marginBottom: '16px' }}>
                <div style={{ fontFamily: RAJ, fontWeight: 700, fontSize: isPhone ? '1.3rem' : '1.6rem', color: WHITE, letterSpacing: '0.02em' }}>League Central</div>
                <div style={{ fontFamily: DM, fontSize: '0.8rem', color: MUTED, marginTop: '2px' }}>
                    {currentLeague?.name || 'League'} · {season} · {teamCount} Teams
                    {board.week ? <> · Week {board.week}</> : null}
                </div>
            </div>

            {/* KPI strip */}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
                {!noPlayoffs && (
                    <Kpi label="Playoff Cutline" value={cutlineGB ? (cutlineGB.gb === 0 ? 'Tied' : cutlineGB.gb.toFixed(1) + ' GB') : '—'}
                        sub={cutlineGB ? (playoffTeams + 'th vs ' + (playoffTeams + 1) + 'th seed') : (odds.status === 'loading' ? 'Loading…' : 'Not enough games played')} />
                )}
                <Kpi label={'Week ' + (board.week || '') + ' High Score'} value={weekHigh ? weekHigh.pts.toFixed(1) : '—'}
                    sub={weekHigh ? _getOwnerName(weekHigh.rosterId) : (board.status === 'loading' ? 'Loading…' : 'No scores reported yet')} />
                <Kpi label="Moves This Week" value={movesThisWeek.total}
                    sub={movesThisWeek.total ? (movesThisWeek.trades + ' trade' + (movesThisWeek.trades !== 1 ? 's' : '') + ' · ' + movesThisWeek.waivers + ' waiver claim' + (movesThisWeek.waivers !== 1 ? 's' : '')) : 'Quiet week so far'} />
            </div>

            {/* Scoreboard strip */}
            <Panel title="This Week's Games" meta={board.week ? 'Week ' + board.week : null}>
                {board.status === 'loading' ? (
                    <div style={{ fontFamily: DM, fontSize: '0.8rem', color: MUTED }}>Loading matchups…</div>
                ) : !board.rows.length ? (
                    <div style={{ fontFamily: DM, fontSize: '0.8rem', color: MUTED }}>No matchups scheduled.</div>
                ) : (
                    <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '4px' }}>
                        {Object.values(board.rows.reduce((acc, r) => {
                            if (r.matchup_id == null) return acc;
                            (acc[r.matchup_id] = acc[r.matchup_id] || []).push(r);
                            return acc;
                        }, {})).filter(pair => pair.length === 2).sort((a, b) => {
                            const mine = p => p.some(x => sameId(x.roster_id, myRoster?.roster_id));
                            if (mine(a) !== mine(b)) return mine(a) ? -1 : 1;
                            return (Number(b[0].points) + Number(b[1].points)) - (Number(a[0].points) + Number(a[1].points));
                        }).map((pair, i) => {
                            const started = pair.some(p => Number(p.points) > 0);
                            const [a, b] = [...pair].sort((x, y) => Number(y.points) - Number(x.points));
                            const nameFor = rid => { const t = enrichedStandings.find(t => sameId(t.rosterId, rid)); return t ? (t.teamName || t.displayName) : _getOwnerName(rid); };
                            const recFor = rid => { const t = enrichedStandings.find(t => sameId(t.rosterId, rid)); return t ? (t.wins + '-' + t.losses) : ''; };
                            return (
                                <div key={i} style={{ background: WELL, border: '1px solid ' + LINE, borderRadius: '8px', padding: '10px 12px', minWidth: '210px', flexShrink: 0 }}>
                                    <div style={{ ...microHdr, marginBottom: '6px', color: started ? GOOD : MUTED }}>{started ? 'Reporting' : 'Not started'}</div>
                                    {[a, b].map((p, j) => (
                                        <div key={j} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: j === 0 ? '4px' : 0 }}>
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ fontFamily: DM, fontWeight: j === 0 && started ? 700 : 500, fontSize: '0.8rem', color: j === 0 && started ? GOLD : WHITE, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>{nameFor(p.roster_id)}</div>
                                                <div style={{ fontFamily: MONO, fontSize: '0.65rem', color: MUTED }}>{recFor(p.roster_id)}</div>
                                            </div>
                                            <div style={{ ...mono, fontSize: '0.9rem', fontWeight: j === 0 && started ? 700 : 500, color: j === 0 && started ? GOLD : SILVER }}>{started ? Number(p.points).toFixed(1) : '—'}</div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                )}
            </Panel>

            <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : '1.6fr 1fr', gap: '16px', alignItems: 'start' }}>
                {/* Standings */}
                <div>
                    <Panel title="Standings & Playoff Picture" right={hasDivisions ? (
                        <div style={{ display: 'flex', gap: '2px', background: WELL, borderRadius: '6px', padding: '2px', border: '1px solid ' + LINE }}>
                            {['division', 'overall'].map(v => (
                                <button key={v} onClick={() => setStandingsView(v)} style={{
                                    fontFamily: MONO, fontSize: '0.65rem', letterSpacing: '0.05em', textTransform: 'uppercase',
                                    padding: '5px 9px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                                    background: standingsView === v ? 'rgba(212,175,55,0.16)' : 'transparent',
                                    color: standingsView === v ? GOLD : MUTED,
                                }}>{v === 'division' ? 'By Division' : 'Overall'}</button>
                            ))}
                        </div>
                    ) : null}>
                        {!enrichedStandings.length ? (
                            <div style={{ fontFamily: DM, fontSize: '0.8rem', color: MUTED }}>No standings yet.</div>
                        ) : (hasDivisions && standingsView === 'division') ? (
                            <div>
                                {divisionGroups.map(group => (
                                    <div key={group.key} style={{ marginBottom: '10px' }}>
                                        <div style={{ ...microHdr, color: GOLD, padding: '6px 6px', background: 'rgba(212,175,55,0.06)', borderRadius: '4px', marginBottom: '2px' }}>
                                            {group.name} <span style={{ color: MUTED, textTransform: 'none', letterSpacing: 0 }}>· {group.teams.length} teams</span>
                                        </div>
                                        <StandingsHeader showDiv={false} />
                                        {group.teams.map((team, idx) => <StandingsRow key={team.rosterId} team={team} rank={idx + 1} showDiv={false} />)}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div>
                                <StandingsHeader showDiv={hasDivisions} />
                                {enrichedStandings.map((team, idx) => (
                                    <React.Fragment key={team.rosterId}>
                                        <StandingsRow team={team} rank={idx + 1} showDiv={hasDivisions} />
                                        {idx === playoffTeams - 1 && idx < enrichedStandings.length - 1 && (
                                            <div style={{ borderBottom: '1px dashed ' + LINE, margin: '2px 0' }} />
                                        )}
                                    </React.Fragment>
                                ))}
                            </div>
                        )}
                    </Panel>
                </div>

                {/* Stat leaders + transactions */}
                <div>
                    <Panel title="Stat Leaders" meta={leaders.week ? 'Week ' + leaders.week : null}>
                        <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', marginBottom: '10px', borderBottom: '1px solid ' + LINE, paddingBottom: '8px' }}>
                            {['Overall', ...leaguePositions].map(p => (
                                <button key={p} onClick={() => setLeaderPos(p)} style={{
                                    fontFamily: MONO, fontSize: '0.65rem', letterSpacing: '0.05em', textTransform: 'uppercase',
                                    padding: '5px 9px', borderRadius: '4px', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                                    background: leaderPos === p ? 'rgba(212,175,55,0.16)' : 'transparent',
                                    color: leaderPos === p ? GOLD : MUTED,
                                }}>{p}</button>
                            ))}
                        </div>
                        {leaders.status === 'loading' ? (
                            <div style={{ fontFamily: DM, fontSize: '0.8rem', color: MUTED }}>Loading stat leaders…</div>
                        ) : !leaderRows.length ? (
                            <div style={{ fontFamily: DM, fontSize: '0.8rem', color: MUTED }}>No stats reported yet.</div>
                        ) : leaderRows.map((r, i) => (
                            <div key={r.pid} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 2px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                <span style={{ ...mono, fontSize: '0.72rem', color: MUTED, width: '16px' }}>{i + 1}</span>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ fontFamily: DM, fontWeight: 600, fontSize: '0.8rem', color: WHITE, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                                    <div style={{ fontFamily: DM, fontSize: '0.68rem', color: MUTED }}>{r.pos} · {r.team} · {_getOwnerName(r.rosterId)}</div>
                                </div>
                                <span style={{ ...mono, fontSize: '0.85rem', fontWeight: 700, color: GOLD }}>{r.pts.toFixed(1)}</span>
                            </div>
                        ))}
                    </Panel>

                    <Panel title="Recent Transactions" right={
                        <span onClick={() => setActiveTab && setActiveTab('analytics')} style={{ fontFamily: MONO, fontSize: '0.65rem', color: MUTED, cursor: 'pointer' }}>View all →</span>
                    }>
                        {!transactions?.length ? (
                            <div style={{ fontFamily: DM, fontSize: '0.8rem', color: MUTED }}>No recent activity.</div>
                        ) : transactions.slice(0, 8).map((txn, i) => {
                            const addPids = Object.keys(txn.adds || {}).filter(pid => txn.type !== 'trade' || sameId(txn.adds[pid], txn.roster_ids?.[0]));
                            const dropPids = Object.keys(txn.drops || {}).filter(pid => txn.type !== 'trade' || sameId(txn.drops[pid], txn.roster_ids?.[0]));
                            const accent = txn.type === 'trade' ? GOLD : txn.type === 'waiver' ? GOOD : BAD;
                            return (
                                <div key={i} style={{ borderLeft: '3px solid ' + accent, padding: '6px 0 6px 10px', marginBottom: '6px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                        <span style={{ fontFamily: MONO, fontSize: '0.65rem', fontWeight: 700, color: accent, textTransform: 'uppercase' }}>{txn.type === 'free_agent' ? 'FA' : txn.type}</span>
                                        <span style={{ fontFamily: DM, fontSize: '0.75rem', color: WHITE }}>{_getOwnerName(txn.roster_ids?.[0])}</span>
                                        {txn.type === 'trade' && txn.roster_ids?.[1] != null && <span style={{ fontFamily: DM, fontSize: '0.75rem', color: MUTED }}>⇄ {_getOwnerName(txn.roster_ids[1])}</span>}
                                        <span style={{ fontFamily: MONO, fontSize: '0.65rem', color: FAINT, marginLeft: 'auto' }}>{_timeAgo(txn.created)}</span>
                                    </div>
                                    <div style={{ fontFamily: DM, fontSize: '0.72rem', marginTop: '2px' }}>
                                        {addPids.map(pid => <span key={'a' + pid} style={{ color: GOOD, marginRight: '6px' }}>+{_getPlayerName(pid)}</span>)}
                                        {dropPids.map(pid => <span key={'d' + pid} style={{ color: BAD, marginRight: '6px' }}>-{_getPlayerName(pid)}</span>)}
                                        {txn.settings?.waiver_bid > 0 && <span style={{ color: WARN }}>${txn.settings.waiver_bid}</span>}
                                        {txn.type === 'trade' && txn.draft_picks?.length > 0 && <span style={{ color: GOLD }}> +{txn.draft_picks.length} pick{txn.draft_picks.length !== 1 ? 's' : ''}</span>}
                                    </div>
                                </div>
                            );
                        })}
                    </Panel>
                </div>
            </div>

            {/* Trending — league-wide risers/fallers by usage delta */}
            <Panel title="Trending — Risers & Fallers" meta="usage change, last 2 seasons">
                {trending.status === 'unavailable' ? null : trending.status === 'loading' ? (
                    <div style={{ fontFamily: DM, fontSize: '0.8rem', color: MUTED }}>Loading historical data…</div>
                ) : (!trending.risers.length && !trending.fallers.length) ? (
                    <div style={{ fontFamily: DM, fontSize: '0.8rem', color: MUTED }}>Not enough multi-season data on this roster set yet.</div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : '1fr 1fr', gap: '16px' }}>
                        <div>
                            <div style={{ ...microHdr, color: GOOD, marginBottom: '8px' }}>▲ Risers</div>
                            {!trending.risers.length ? (
                                <div style={{ fontFamily: DM, fontSize: '0.78rem', color: MUTED }}>None this cycle.</div>
                            ) : trending.risers.map(r => (
                                <div key={r.pid} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 2px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{ fontFamily: DM, fontWeight: 600, fontSize: '0.8rem', color: WHITE, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                                        <div style={{ fontFamily: DM, fontSize: '0.68rem', color: MUTED }}>{r.pos} · {r.team} · {_getOwnerName(r.rosterId)} · {r.statLabel} {r.text}</div>
                                    </div>
                                    <span style={{ ...mono, fontSize: '0.85rem', fontWeight: 700, color: GOOD, flexShrink: 0 }}>+{r.delta}{r.isPct ? 'pt' : '%'}</span>
                                </div>
                            ))}
                        </div>
                        <div>
                            <div style={{ ...microHdr, color: BAD, marginBottom: '8px' }}>▼ Fallers</div>
                            {!trending.fallers.length ? (
                                <div style={{ fontFamily: DM, fontSize: '0.78rem', color: MUTED }}>None this cycle.</div>
                            ) : trending.fallers.map(r => (
                                <div key={r.pid} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 2px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{ fontFamily: DM, fontWeight: 600, fontSize: '0.8rem', color: WHITE, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                                        <div style={{ fontFamily: DM, fontSize: '0.68rem', color: MUTED }}>{r.pos} · {r.team} · {_getOwnerName(r.rosterId)} · {r.statLabel} {r.text}</div>
                                    </div>
                                    <span style={{ ...mono, fontSize: '0.85rem', fontWeight: 700, color: BAD, flexShrink: 0 }}>{r.delta}{r.isPct ? 'pt' : '%'}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </Panel>
        </div>
    );
}

window.LeagueCentralTab = LeagueCentralTab;
