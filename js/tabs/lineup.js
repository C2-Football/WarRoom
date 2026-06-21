// ══════════════════════════════════════════════════════════════════
// js/tabs/lineup.js — LineupTab: weekly Start/Sit Command Center.
// Interactive lineup builder: one unified table where each starting slot
// is a row (assigned player + projection + matchup + rolling form), and
// tapping a slot reveals every eligible roster player so you can set it.
// Working totals + optimal delta update live. League-scored via
// App.WeeklyProj / App.StartSit; objective tilts by GM mode.
// NOTE: builds/compares your lineup IN-APP — Sleeper/MFL have no public
// lineup-write API, so set the final lineup on your platform.
// ══════════════════════════════════════════════════════════════════

function LineupTab({
    myRoster, currentLeague, leagueSkin, playersData, statsData, stats2025Data,
    sleeperUserId, gmStrategy, setActiveTab, timeRecomputeTs,
}) {
    const WP = window.App && window.App.WeeklyProj;
    const SS = window.App && window.App.StartSit;
    const normPos = (window.App && window.App.normPos) || (p => p);
    const [ctxTick, setCtxTick] = React.useState(0); // bumps when NFL matchup context (opponent/weather/odds) loads

    const result = React.useMemo(() => {
        if (!WP || !myRoster || !currentLeague) return null;
        try {
            return WP.optimalForRoster(myRoster, currentLeague, {
                playersData, statsData, priorData: stats2025Data,
            });
        } catch (e) { if (window.wrLog) window.wrLog('lineup.compute', e); return null; }
    }, [myRoster, currentLeague, playersData, statsData, timeRecomputeTs, ctxTick]);

    const [formWindow, setFormWindow] = React.useState(5); // rolling-PPG window: 3 | 5 | 8 | 'season'
    const [openSlot, setOpenSlot] = React.useState(null);  // slot idx whose picker is expanded
    const [workingAssign, setWorkingAssign] = React.useState({}); // slotIdx -> pid (the user's working lineup)

    const GOLD = 'var(--gold, #d4af37)', SILVER = 'var(--silver, #9aa0a6)', TEXT = 'var(--text, #e8e8ea)';
    const GREEN = 'var(--k-2ecc71, #2ecc71)', RED = 'var(--k-e74c3c, #e74c3c)', AMBER = 'var(--k-f0a500, #f0a500)';
    const PANEL = 'var(--panel, #15151b)', LINE = 'var(--ov-4, rgba(255,255,255,0.08))';
    const GRID = '50px minmax(0,1fr) 58px 50px 48px 38px 38px';
    const SLOT_DISPLAY_ORDER = { QB: 1, RB: 2, WR: 3, TE: 4, REC_FLEX: 5, FLEX: 6, WRTQ: 7, SUPER_FLEX: 8, K: 20, DEF: 21, IDP_FLEX: 30, DL: 31, LB: 32, DB: 33, WILDCARD: 40 };
    const BENCH = new Set(['BN', 'BE', 'BENCH', 'IR', 'TAXI', 'RES']);
    const OBJ_LABEL = { floor: 'Floor · safe (win-now)', median: 'Median · balanced', ceiling: 'Ceiling · upside (rebuild)' };

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
        const arr = (myRoster && myRoster.starters) || [];
        const cur = {};
        startingSlots.forEach(sl => { const pid = arr[sl.idx]; if (pid && String(pid) !== '0') cur[sl.idx] = String(pid); });
        return cur;
    }, [myRoster, startingSlots]);

    // Reset the working lineup to the platform lineup ONLY when the league or
    // the platform starters actually change — keyed on a stable string so an
    // incidental re-render never wipes the user's in-progress edits / open slot.
    const lineupKey = (currentLeague && (currentLeague.league_id || currentLeague.id) || '') + '|' + ((myRoster && myRoster.starters) || []).join(',');
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
    const [showOpp, setShowOpp] = React.useState(false);
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

    if (!WP || !SS) {
        return <div style={{ padding: '48px 24px', color: SILVER }}>Start/Sit engine not loaded.</div>;
    }
    if (!result || !result.optimal || !result.optimal.starters.length) {
        return (
            <div style={{ padding: '56px 24px', textAlign: 'center', color: SILVER, maxWidth: '520px', margin: '0 auto' }}>
                <div style={{ fontSize: '1.1rem', color: GOLD, fontWeight: 600, marginBottom: '10px', letterSpacing: '0.04em' }}>LINEUP COMMAND CENTER</div>
                <div>No weekly projections yet. This lights up in-season once roster and stat data are synced — start/sit guidance is built from each player's role, recent form, and matchup, scored through your league's exact settings.</div>
            </div>
        );
    }

    const objective = result.objective;
    const projOf = pid => (pid && result.projections[pid]) || null;
    const objPts = pid => { const p = projOf(pid); return p && p.available !== false ? (p.points[objective] || 0) : (p ? (p.points[objective] || 0) : 0); };
    const formOf = pid => window.App.WeeklyProj.formStats(pid, formWindow);

    // Roster pools.
    const resSet = new Set((myRoster && myRoster.reserve) || []);
    const taxiSet = new Set((myRoster && myRoster.taxi) || []);
    const activeIds = ((myRoster && myRoster.players) || []).filter(id => id && !resSet.has(id) && !taxiSet.has(id)).map(String);
    const usedPids = new Set(Object.values(workingAssign).filter(Boolean).map(String));

    function eligibleFor(slot) {
        return activeIds
            .filter(pid => slot.elig.includes(normPos((playersData[pid] || {}).position) || (playersData[pid] || {}).position))
            .filter(pid => !usedPids.has(pid) || String(workingAssign[slot.idx]) === pid)
            .sort((a, b) => objPts(b) - objPts(a));
    }

    // Totals (objective-based, matching the solver).
    const workingTotal = Object.values(workingAssign).filter(Boolean).reduce((s, pid) => s + objPts(pid), 0);
    const optimalTotal = result.optimal.total;
    const benchPts = Math.round((optimalTotal - workingTotal) * 10) / 10;
    const isOptimal = benchPts <= 0.05;
    const scaleMax = Math.max(1, ...result.optimal.starters.map(s => { const p = projOf(s.pid); return (p && p.points && p.points.ceiling) || 0; }));

    function applyOptimal() {
        const byName = {};
        result.optimal.starters.forEach(s => { (byName[s.slot] = byName[s.slot] || []).push(s.pid); });
        const next = {};
        startingSlots.forEach(sl => { const arr = byName[sl.slotName]; if (arr && arr.length) next[sl.idx] = String(arr.shift()); });
        setWorkingAssign(next); setOpenSlot(null);
    }

    const formWinLabel = formWindow === 'season' ? 'SZN' : 'L' + formWindow;
    const winBtn = active => ({ padding: '3px 8px', fontSize: '0.64rem', fontWeight: 700, letterSpacing: '0.03em', cursor: 'pointer', borderRadius: '4px', border: `1px solid ${active ? GOLD : LINE}`, background: active ? 'rgba(212,175,55,0.14)' : 'transparent', color: active ? GOLD : SILVER });
    const actBtn = { padding: '5px 12px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer', borderRadius: '5px', border: `1px solid ${LINE}`, background: 'transparent', color: SILVER };

    function wxTag(weather) {
        if (!weather) return null;
        if (weather.indoor) return <span style={{ color: SILVER, opacity: 0.5, fontSize: '0.6rem', marginLeft: '6px' }}>dome</span>;
        const d = String(weather.display || '').toLowerCase();
        let tag = null;
        if (/wind/.test(d)) tag = 'WIND';
        else if (/snow|sleet|flurr/.test(d)) tag = 'SNOW';
        else if (/rain|shower|storm/.test(d)) tag = 'RAIN';
        else if (Number.isFinite(Number(weather.temp)) && Number(weather.temp) <= 20) tag = 'COLD';
        if (!tag) return null;
        const tip = (weather.display || '') + (weather.temp != null ? ' · ' + Math.round(weather.temp) + '°' : '');
        return <span title={tip} style={{ color: AMBER, fontSize: '0.56rem', fontWeight: 700, marginLeft: '6px', letterSpacing: '0.03em' }}>{tag}</span>;
    }

    // ── Player field cells (shared by slot rows, picker rows, bench rows) ──
    function PlayerCells({ pid }) {
        if (!pid) {
            return (<React.Fragment>
                <span style={{ color: SILVER, opacity: 0.6, fontStyle: 'italic' }}>Empty — tap to set</span>
                <span /><span /><span /><span /><span />
            </React.Fragment>);
        }
        const meta = pmeta(pid);
        const proj = projOf(pid);
        const pts = proj && proj.points;
        const grade = (proj && proj.matchupGrade) || '—';
        const opp = proj && proj.opponent;
        const status = (proj && proj.injuryStatus) || '';
        const unavail = proj && proj.available === false;
        const fs = formOf(pid);
        const weather = proj && proj.weather;
        const num = (v, c) => <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: c || SILVER }}>{v}</span>;
        return (<React.Fragment>
            <span style={{ minWidth: 0, overflow: 'hidden' }}>
                <span style={{ color: unavail ? SILVER : TEXT, fontWeight: 500, textDecoration: unavail ? 'line-through' : 'none' }}>{meta.name}</span>
                <span style={{ color: SILVER, fontSize: '0.7rem', marginLeft: '6px' }}>{meta.pos}{meta.team ? ' · ' + meta.team : ''}</span>
                {opp && opp.abbr ? <span style={{ color: SILVER, fontSize: '0.66rem', marginLeft: '6px', opacity: 0.85 }}>{opp.home ? 'vs ' : '@ '}{opp.abbr}</span> : null}
                {wxTag(weather)}
                {status ? <span style={{ color: status === 'BYE' ? SILVER : AMBER, fontSize: '0.62rem', marginLeft: '6px', fontWeight: 700 }}>{status}</span> : null}
            </span>
            <span style={{ textAlign: 'right' }}>
                <span style={{ color: TEXT, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{pts ? (pts[objective] || 0).toFixed(1) : '—'}</span>
                {pts ? <span style={{ display: 'block', color: SILVER, opacity: 0.6, fontSize: '0.56rem', fontVariantNumeric: 'tabular-nums' }}>{pts.floor.toFixed(0)}–{pts.ceiling.toFixed(0)}</span> : null}
            </span>
            <span style={{ textAlign: 'center' }}><span title={opp && opp.abbr ? ('vs ' + opp.abbr) : ('Matchup ' + grade)} style={{ fontWeight: 700, color: gradeColor(grade), fontSize: '0.78rem' }}>{grade}</span></span>
            {num(fs ? fs.rollingPPG.toFixed(1) : '—', TEXT)}
            {num(fs ? fs.high.toFixed(1) : '—', GREEN)}
            {num(fs ? fs.low.toFixed(1) : '—', SILVER)}
        </React.Fragment>);
    }

    const projTip = 'Projected points — optimizing for your ' + (objective === 'ceiling' ? 'ceiling (upside)' : objective === 'floor' ? 'floor (safe)' : 'median (balanced)') + ' strategy';
    const headerRow = (
        <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: '8px', padding: '7px 14px', borderBottom: `1px solid ${LINE}`, fontSize: '0.58rem', letterSpacing: '0.05em', color: SILVER, textTransform: 'uppercase' }}>
            <span title="Roster slot">Slot</span>
            <span title="Player · position · NFL team · this week's opponent">Player</span>
            <span title={projTip} style={{ textAlign: 'right' }}>Proj</span>
            <span title="Matchup grade A (great) → F (tough), from the opponent's Vegas implied total" style={{ textAlign: 'center' }}>Mtch</span>
            <span title={'Rolling average over the last ' + (formWindow === 'season' ? 'full season' : formWindow + ' weeks') + ' (actual points)'} style={{ textAlign: 'right' }}>{formWinLabel}</span>
            <span title="Season high — most fantasy points in a week" style={{ textAlign: 'right' }}>Hi</span>
            <span title="Season low — fewest points in a played week" style={{ textAlign: 'right' }}>Lo</span>
        </div>
    );

    // ── Matchup forecast: your WORKING lineup vs the opponent's ideal ──
    let matchup = null;
    {
        const M = window.App && window.App.Matchup;
        if (M && oppResult && oppResult.res) {
            const oppProj = oppResult.res.projections;
            const oppOpt = oppResult.res.optimal.starters;
            const myStarters = Object.values(workingAssign).filter(Boolean);
            const myDist = M.dist(myStarters, result.projections, 'median');
            const oppDist = M.dist(oppOpt.map(s => s.pid), oppProj, 'median');
            const fc = M.forecast(myDist, oppDist);
            const oppCurTotal = M.dist((oppResult.roster.starters || []).filter(Boolean), oppProj, 'median').mean;
            const users = (currentLeague && currentLeague.users) || [];
            const u = users.find(x => String(x.user_id) === String(oppResult.roster.owner_id));
            const oppName = (oppResult.roster.metadata && oppResult.roster.metadata.team_name) || (u && u.metadata && u.metadata.team_name) || (u && u.display_name) || ('Team ' + oppResult.roster.roster_id);
            const medOf = (pid, proj) => (pid && proj[pid] && proj[pid].points ? proj[pid].points.median : 0);

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
                if (myMed > theirMed) myEdges++;
                return { slot: sl.slotName, myPid, myMed, theirPid, theirMed };
            });
            // Position-group strength (each starter's projected pts summed by position).
            const myByPos = {}, theirByPos = {};
            myStarters.forEach(pid => { const p = normPos((playersData[pid] || {}).position) || '?'; myByPos[p] = (myByPos[p] || 0) + medOf(pid, result.projections); });
            oppOpt.forEach(s => { const p = normPos((playersData[s.pid] || {}).position) || '?'; theirByPos[p] = (theirByPos[p] || 0) + medOf(s.pid, oppProj); });
            const posStrength = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].filter(p => myByPos[p] || theirByPos[p]).map(p => ({ pos: p, mine: myByPos[p] || 0, theirs: theirByPos[p] || 0 }));

            matchup = { fc, oppName, oppCurTotal, oppIdealTotal: oppResult.res.optimal.total, oppProj, h2h, posStrength, myEdges, slotCount: h2h.length };
        }
    }

    return (
        <div style={{ maxWidth: '1120px', margin: '0 auto', padding: '20px 16px 60px' }}>
            {/* Hero — Your lineup vs Optimal */}
            <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', padding: '18px 20px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                        <div style={{ fontSize: '0.72rem', letterSpacing: '0.08em', color: SILVER, fontWeight: 600 }}>WEEK {result.week} · LINEUP COMMAND CENTER</div>
                        <div style={{ fontSize: '1.45rem', fontWeight: 700, color: isOptimal ? GREEN : GOLD, marginTop: '6px' }}>
                            {isOptimal ? 'Lineup is optimal' : `${benchPts.toFixed(1)} pts below optimal`}
                        </div>
                        <div style={{ color: SILVER, fontSize: '0.82rem', marginTop: '4px' }}>
                            Your lineup {workingTotal.toFixed(1)} · Optimal {optimalTotal.toFixed(1)}
                        </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.66rem', color: SILVER, letterSpacing: '0.06em' }}>OPTIMIZING FOR</div>
                        <div style={{ fontSize: '0.82rem', color: GOLD, fontWeight: 600, marginTop: '3px' }}>{OBJ_LABEL[objective] || objective}</div>
                        <div style={{ display: 'flex', gap: '6px', marginTop: '10px', justifyContent: 'flex-end' }}>
                            <button onClick={applyOptimal} style={{ ...actBtn, color: GOLD, borderColor: 'var(--acc-line2, rgba(212,175,55,0.4))', background: 'rgba(212,175,55,0.12)' }}>Apply Optimal</button>
                            <button onClick={() => { setWorkingAssign(currentAssign); setOpenSlot(null); }} style={actBtn}>Reset</button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Weekly matchup — opponent, projected scores, win probability */}
            {matchup ? (
                <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', padding: '16px 20px', marginBottom: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '0.7rem', letterSpacing: '0.08em', color: SILVER, fontWeight: 600 }}>WEEK {result.week} MATCHUP · vs {matchup.oppName}</div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '1.5rem', fontWeight: 700, color: TEXT, fontVariantNumeric: 'tabular-nums' }}>{matchup.fc.projMe.toFixed(1)}</span>
                                <span style={{ color: SILVER, fontSize: '0.8rem' }}>you</span>
                                <span style={{ color: SILVER, fontWeight: 700, margin: '0 2px' }}>–</span>
                                <span style={{ fontSize: '1.5rem', fontWeight: 700, color: TEXT, fontVariantNumeric: 'tabular-nums' }}>{matchup.fc.projOpp.toFixed(1)}</span>
                                <span style={{ color: SILVER, fontSize: '0.8rem' }}>them</span>
                            </div>
                            <div style={{ color: SILVER, fontSize: '0.75rem', marginTop: '5px' }}>
                                Their lineup: current {matchup.oppCurTotal.toFixed(1)} · ideal {matchup.oppIdealTotal.toFixed(1)}
                                {matchup.oppIdealTotal - matchup.oppCurTotal > 0.5 ? <span style={{ color: AMBER }}> · {(matchup.oppIdealTotal - matchup.oppCurTotal).toFixed(1)} on their bench</span> : null}
                                <span onClick={() => setShowOpp(v => !v)} style={{ color: GOLD, cursor: 'pointer', marginLeft: '8px', fontWeight: 600 }}>{showOpp ? 'hide' : 'view their lineup'}</span>
                            </div>
                        </div>
                        <div style={{ textAlign: 'center', minWidth: '96px' }}>
                            <div style={{ fontSize: '2rem', fontWeight: 800, lineHeight: 1, color: matchup.fc.winPct >= 55 ? GREEN : matchup.fc.winPct <= 45 ? RED : GOLD }}>{matchup.fc.winPct}%</div>
                            <div style={{ fontSize: '0.6rem', color: SILVER, letterSpacing: '0.06em', marginTop: '3px' }}>WIN PROBABILITY</div>
                            <div style={{ fontSize: '0.66rem', color: SILVER, marginTop: '4px' }}>{matchup.fc.margin >= 0 ? '+' : ''}{matchup.fc.margin.toFixed(1)} proj margin</div>
                        </div>
                    </div>
                    {showOpp ? (
                        <div style={{ marginTop: '12px', borderTop: `1px solid ${LINE}`, paddingTop: '12px' }}>
                            {/* Position-group strength: your projected pts vs theirs */}
                            <div style={{ fontSize: '0.6rem', letterSpacing: '0.06em', color: SILVER, marginBottom: '8px' }}>POSITION STRENGTH · your projected pts vs theirs</div>
                            {matchup.posStrength.map(ps => {
                                const tot = (ps.mine + ps.theirs) || 1, myShare = ps.mine / tot * 100, meLead = ps.mine >= ps.theirs;
                                return <div key={ps.pos} style={{ display: 'grid', gridTemplateColumns: '34px 52px 1fr 52px', gap: '8px', alignItems: 'center', padding: '3px 0' }}>
                                    <span style={{ fontSize: '0.66rem', fontWeight: 700, color: GOLD }}>{ps.pos}</span>
                                    <span style={{ textAlign: 'right', fontSize: '0.76rem', fontWeight: meLead ? 700 : 400, color: meLead ? GREEN : SILVER, fontVariantNumeric: 'tabular-nums' }}>{ps.mine.toFixed(1)}</span>
                                    <span style={{ position: 'relative', height: '6px', background: 'var(--ov-3, rgba(255,255,255,0.05))', borderRadius: '3px' }}>
                                        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: myShare + '%', background: meLead ? 'rgba(46,204,113,0.5)' : 'rgba(212,175,55,0.32)', borderRadius: '3px' }} />
                                        <span style={{ position: 'absolute', left: '50%', top: '-2px', bottom: '-2px', width: '1px', background: 'var(--ov-6, rgba(255,255,255,0.18))' }} />
                                    </span>
                                    <span style={{ textAlign: 'left', fontSize: '0.76rem', fontWeight: !meLead ? 700 : 400, color: !meLead ? RED : SILVER, fontVariantNumeric: 'tabular-nums' }}>{ps.theirs.toFixed(1)}</span>
                                </div>;
                            })}
                            {/* Slot-by-slot: your starter vs theirs */}
                            <div style={{ fontSize: '0.6rem', letterSpacing: '0.06em', color: SILVER, margin: '13px 0 4px' }}>SLOT-BY-SLOT · you lead {matchup.myEdges} of {matchup.slotCount}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr 70px 1fr', gap: '8px', padding: '4px 0', fontSize: '0.55rem', letterSpacing: '0.05em', color: SILVER, textTransform: 'uppercase', borderBottom: `1px solid ${LINE}` }}>
                                <span>Slot</span><span>You</span><span style={{ textAlign: 'center' }}>Edge</span><span style={{ textAlign: 'right' }}>{matchup.oppName}</span>
                            </div>
                            {matchup.h2h.map((r, i) => {
                                const me = pmeta(r.myPid), them = pmeta(r.theirPid);
                                const meWin = r.myMed > r.theirMed, theyWin = r.theirMed > r.myMed;
                                return <div key={i} style={{ display: 'grid', gridTemplateColumns: '56px 1fr 70px 1fr', gap: '8px', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${LINE}` }}>
                                    <span style={{ fontSize: '0.62rem', fontWeight: 700, color: GOLD }}>{r.slot.replace('_', ' ')}</span>
                                    <span style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: meWin ? TEXT : SILVER, fontWeight: meWin ? 600 : 400, fontSize: '0.8rem' }}>{r.myPid ? me.name : '—'}<span style={{ color: SILVER, fontSize: '0.66rem', marginLeft: '5px', fontVariantNumeric: 'tabular-nums' }}>{r.myMed.toFixed(1)}</span></span>
                                    <span style={{ textAlign: 'center', fontSize: '0.64rem', fontWeight: 700, color: meWin ? GREEN : theyWin ? RED : SILVER }}>{meWin ? '◄ ' + (r.myMed - r.theirMed).toFixed(1) : theyWin ? (r.theirMed - r.myMed).toFixed(1) + ' ►' : 'even'}</span>
                                    <span style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textAlign: 'right', color: theyWin ? TEXT : SILVER, fontWeight: theyWin ? 600 : 400, fontSize: '0.8rem' }}><span style={{ color: SILVER, fontSize: '0.66rem', marginRight: '5px', fontVariantNumeric: 'tabular-nums' }}>{r.theirMed.toFixed(1)}</span>{r.theirPid ? them.name : '—'}</span>
                                </div>;
                            })}
                        </div>
                    ) : null}
                </div>
            ) : null}

            {/* Unified interactive lineup table */}
            <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', borderBottom: `1px solid ${LINE}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.7rem', letterSpacing: '0.08em', color: SILVER, fontWeight: 600 }}>STARTING LINEUP · tap a slot to set it</span>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.58rem', color: SILVER, letterSpacing: '0.05em', marginRight: '2px' }}>FORM</span>
                        {[['L3', 3], ['L5', 5], ['L8', 8], ['SZN', 'season']].map(opt => (
                            <button key={opt[0]} onClick={() => setFormWindow(opt[1])} style={winBtn(formWindow === opt[1])}>{opt[0]}</button>
                        ))}
                    </div>
                </div>
                {headerRow}
                {[...startingSlots].sort((a, b) => (SLOT_DISPLAY_ORDER[a.slotName] ?? 50) - (SLOT_DISPLAY_ORDER[b.slotName] ?? 50)).map(sl => {
                    const pid = workingAssign[sl.idx] || null;
                    const open = openSlot === sl.idx;
                    const elig = open ? eligibleFor(sl) : [];
                    return (
                        <div key={sl.idx} style={{ borderBottom: `1px solid ${LINE}` }}>
                            <div onClick={() => setOpenSlot(open ? null : sl.idx)}
                                style={{ display: 'grid', gridTemplateColumns: GRID, gap: '8px', padding: '9px 14px', alignItems: 'center', cursor: 'pointer', background: open ? 'var(--acc-fill2, rgba(212,175,55,0.08))' : 'transparent' }}>
                                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: GOLD, letterSpacing: '0.04em' }}>{sl.slotName.replace('_', ' ')}<span style={{ color: SILVER, marginLeft: '4px', fontSize: '0.6rem' }}>{open ? '▾' : '▸'}</span></span>
                                <PlayerCells pid={pid} />
                            </div>
                            {open ? (
                                <div style={{ background: 'var(--ov-2, rgba(255,255,255,0.03))', borderTop: `1px solid ${LINE}`, padding: '4px 0' }}>
                                    <div style={{ padding: '5px 14px', fontSize: '0.58rem', letterSpacing: '0.05em', color: SILVER, textTransform: 'uppercase' }}>Eligible for {sl.slotName.replace('_', ' ')} — tap to start</div>
                                    {elig.map(epid => {
                                        const isCur = String(pid) === String(epid);
                                        return (
                                            <div key={epid} onClick={() => { setWorkingAssign(w => ({ ...w, [sl.idx]: epid })); setOpenSlot(null); }}
                                                style={{ display: 'grid', gridTemplateColumns: GRID, gap: '8px', padding: '7px 14px', alignItems: 'center', cursor: 'pointer', background: isCur ? 'rgba(212,175,55,0.10)' : 'transparent', borderLeft: isCur ? `3px solid ${GOLD}` : '3px solid transparent' }}>
                                                <span style={{ fontSize: '0.6rem', color: isCur ? GOLD : SILVER, fontWeight: 700 }}>{isCur ? 'IN' : ''}</span>
                                                <PlayerCells pid={epid} />
                                            </div>
                                        );
                                    })}
                                    {pid ? (
                                        <div onClick={() => { setWorkingAssign(w => { const n = { ...w }; delete n[sl.idx]; return n; }); setOpenSlot(null); }}
                                            style={{ padding: '7px 14px', cursor: 'pointer', color: RED, fontSize: '0.7rem', fontWeight: 600 }}>✕ Empty this slot</div>
                                    ) : null}
                                    {!elig.length ? <div style={{ padding: '7px 14px', color: SILVER, fontSize: '0.74rem', opacity: 0.7 }}>No eligible bench players.</div> : null}
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>

            <div style={{ color: SILVER, fontSize: '0.66rem', marginTop: '10px', lineHeight: 1.6, opacity: 0.9 }}>
                <strong style={{ color: TEXT }}>Proj</strong> projected pts (your {objective} strategy) · <strong style={{ color: TEXT }}>Mtch</strong> matchup grade A–F (opponent's implied total) · <strong style={{ color: TEXT }}>{formWinLabel}</strong> rolling avg of actual pts · <strong style={{ color: TEXT }}>Hi/Lo</strong> season best/worst week
            </div>
            <div style={{ color: SILVER, fontSize: '0.72rem', marginTop: '8px', lineHeight: 1.5 }}>
                Projections are league-scored from role, recent form{objective !== 'median' ? `, your ${result.mode.replace('_', '-')} strategy` : ''}, and matchup; form columns are actual weekly points over the chosen window. Build and compare lineups here — set the final one on your platform.
            </div>
        </div>
    );
}

window.LineupTab = LineupTab;
