// ══════════════════════════════════════════════════════════════════
// js/components/league-wire.js — window.WrLeagueWire
//
// The always-on ticker pinned to the bottom of Dynasty HQ. Carries the
// league-wide context that doesn't deserve its own panel:
//
//   real NFL scores (preseason / regular / postseason aware)
//   NFL-wide statistical leaders
//   this league's fantasy scores, biggest / closest / ugliest win
//   the biggest FAAB claim, risers & fallers, cutline, move count
//
// Self-sufficient by design: it owns every fetch it needs rather than
// receiving computed state, because it renders on EVERY league tab — not
// just the one that happens to compute standings. That costs one extra
// matchups request per league (a few KB, uncached upstream); the weekly
// stat fetches are sessionStorage-cached so they are free on repeat.
//
// DESKTOP + TABLET ONLY. On phones the bottom edge belongs to PhoneDock,
// and a scrolling marquee is the wrong idiom on a small touch screen.
//
// Honesty rules carried over from the League Central original:
//   - a game that hasn't kicked shows kickoff time, never a fabricated 0-0
//   - preseason is always tagged PRE (a preseason final looks identical to
//     a real one otherwise)
//   - team D/ST units and Sleeper's TEAM_* aggregate rows are excluded from
//     "NFL leader", which is an individual award
//   - a trend off a near-zero baseline reports the absolute per-game move,
//     not a "+2100%" that is arithmetic rather than signal
//   - every item is dropped when its source data is missing, never
//     rendered as a placeholder
//
// Exposes: window.WrLeagueWire
// ══════════════════════════════════════════════════════════════════
function WrLeagueWire({ currentLeague, standings, transactions, playersData, getOwnerName, getPlayerName }) {
    const GOLD = 'var(--gold, #d4af37)';
    const SILVER = 'var(--silver, #bdb8ad)';
    const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';

    const vp = window.WR?.useViewport?.() || {};
    const isPhone = !!vp.isPhone;

    const leagueId = currentLeague?.league_id || currentLeague?.id || '';
    const season = currentLeague?.season || '';
    const playoffTeams = Math.max(2, Number(currentLeague?.settings?.playoff_teams) || 6);
    const sameId = (a, b) => String(a) === String(b);

    const _getPlayerName = getPlayerName || (pid => playersData?.[pid]?.full_name || ('Player ' + pid));
    const _getOwnerName = getOwnerName || (rid => {
        const r = currentLeague?.rosters?.find(x => sameId(x.roster_id, rid));
        const u = currentLeague?.users?.find(x => x.user_id === r?.owner_id);
        return u?.display_name || u?.username || 'Unknown';
    });

    // ── This league's scoreboard ──
    const [board, setBoard] = React.useState({ week: null, rows: [] });
    React.useEffect(() => {
        if (isPhone || !leagueId || typeof window.fetchMatchups !== 'function') return undefined;
        const WP = window.App?.WeeklyProj;
        if (!WP) return undefined;
        const wk = Math.max(1, Math.min(18, WP.currentWeek()));
        let alive = true;
        window.fetchMatchups(leagueId, wk)
            .then(rows => { if (alive) setBoard({ week: wk, rows: rows || [] }); })
            .catch(() => { /* wire just skips fantasy scores */ });
        return () => { alive = false; };
    }, [leagueId, isPhone]);

    const weekHasScores = board.rows.filter(r => Number(r.points) > 0).length >= 2;
    const statWeek = board.week ? Math.max(1, weekHasScores ? board.week : board.week - 1) : null;

    // ── Top fantasy scorer per position (rostered players only) ──
    const [leaders, setLeaders] = React.useState([]);
    React.useEffect(() => {
        if (isPhone || !statWeek || !currentLeague) return undefined;
        const SOS = window.App?.SOS;
        if (!SOS?.getWeekStats || typeof window.calcFantasyPts !== 'function') return undefined;
        let alive = true;
        Promise.resolve(SOS.getWeekStats(season, statWeek)).then(ws => {
            if (!alive) return;
            const scoring = currentLeague.scoring_settings || {};
            const seen = new Set();
            const rows = [];
            (currentLeague.rosters || []).forEach(r => {
                (r.players || []).forEach(pid => {
                    if (seen.has(pid)) return;
                    seen.add(pid);
                    const raw = (ws || {})[pid];
                    if (!raw) return;
                    const pts = window.calcFantasyPts(raw, scoring);
                    if (!(pts > 0)) return;
                    const p = playersData?.[pid] || {};
                    rows.push({
                        pid, pts: Math.round(pts * 10) / 10, name: _getPlayerName(pid),
                        pos: window.App?.normPos?.(p.position) || p.position || '??',
                    });
                });
            });
            rows.sort((a, b) => b.pts - a.pts);
            setLeaders(rows);
        }).catch(() => { /* skip */ });
        return () => { alive = false; };
    }, [leagueId, statWeek, season, isPhone]);

    // ── Live NFL scoreboard (phase-aware) ──
    const [nflScores, setNflScores] = React.useState([]);
    React.useEffect(() => {
        if (isPhone) return undefined;
        const NC = window.App?.NflContext;
        if (!NC?.loadScores) return undefined;
        let alive = true, id = null, warmup = null, tries = 0;
        const tick = async () => {
            try {
                const ph = NC.currentPhase ? NC.currentPhase() : { week: window.App?.WeeklyProj?.currentWeek?.() || 1, seasontype: 2 };
                const games = await NC.loadScores(ph.week, ph.season || window.S?.nflState?.season, ph.seasontype);
                if (alive) setNflScores((games || []).map(g => ({ ...g, isPre: !!ph.isPre, phaseWeek: ph.week })));
            } catch (e) { /* skip this cycle */ }
        };
        // S.nflState lands with the league bootstrap, which can be AFTER this
        // mounts. Ticking early makes currentPhase() fall back to regular
        // season — the whole of August would show week-1 kickoff times and not
        // self-correct for a full minute.
        const start = () => {
            if (!window.S?.nflState && ++tries < 15) { warmup = setTimeout(start, 1000); return; }
            tick();
            id = setInterval(tick, 60000);
        };
        start();
        return () => { alive = false; if (id) clearInterval(id); if (warmup) clearTimeout(warmup); };
    }, [isPhone]);

    // ── NFL-wide leaders, for whatever phase/week is live ──
    const buildNflLeaders = React.useCallback((statsByPid, wk, phaseType) => {
        const w = wk
            ? (phaseType === 'pre' ? 'PRE' + wk + ' ' : phaseType === 'post' ? 'POST' + wk + ' ' : 'WK' + wk + ' ')
            : 'NFL ';
        const CATS = [
            { key: 'pass_yd', label: w + 'PASS', unit: 'yds' },
            { key: 'rush_yd', label: w + 'RUSH', unit: 'yds' },
            { key: 'rec_yd', label: w + 'REC', unit: 'yds' },
            { key: 'idp_sack', label: w + 'SACKS', unit: 'sacks', alt: 'sack' },
        ];
        return CATS.map(c => {
            let best = null;
            for (const pid in statsByPid) {
                // Resolve the player FIRST. Sleeper's map carries TEAM_*
                // aggregate rows whose whole-team totals outrank every
                // individual; picking the max first and filtering after means
                // these categories silently never render. Team D/ST units are
                // excluded for the same reason — an individual award.
                const p = playersData?.[pid];
                if (!p || !p.full_name || p.position === 'DEF') continue;
                const raw = statsByPid[pid];
                const v = Number(raw?.[c.key] ?? (c.alt ? raw?.[c.alt] : 0)) || 0;
                if (v > 0 && (!best || v > best.v)) best = { v, p };
            }
            if (!best) return null;
            const val = c.unit === 'sacks' ? (Math.round(best.v * 10) / 10) : Math.round(best.v);
            return {
                kind: 'nflstat', label: c.label,
                text: (best.p.full_name || 'Player') + ' ' + val + ' ' + c.unit + (best.p.team ? ' · ' + best.p.team : ''),
            };
        }).filter(Boolean);
    }, [playersData]);

    const nflStatCtx = React.useMemo(() => {
        const NC = window.App?.NflContext;
        const ph = NC?.currentPhase
            ? NC.currentPhase()
            : { seasontype: 2, week: Number(window.App?.WeeklyProj?.currentWeek?.()) || Number(board.week) || 1 };
        const type = ph.seasontype === 1 ? 'pre' : ph.seasontype === 3 ? 'post' : 'regular';
        // Hold last week's leaders until this week's games actually kick off —
        // a blank stats block from Tuesday to Sunday is worse than the most
        // recent real one.
        const started = (nflScores || []).some(g => g.state === 'in' || g.state === 'post');
        const week = started ? ph.week : Math.max(1, ph.week - 1);
        return { week, type, season: ph.season || season };
    }, [nflScores, board.week, season]);

    const [nflLeaders, setNflLeaders] = React.useState([]);
    React.useEffect(() => {
        if (isPhone) return undefined;
        const SOS = window.App?.SOS;
        if (!SOS?.getWeekStats || !nflStatCtx.week) return undefined;
        let alive = true;
        Promise.resolve(SOS.getWeekStats(nflStatCtx.season, nflStatCtx.week, nflStatCtx.type))
            .then(ws => { if (alive) setNflLeaders(buildNflLeaders(ws || {}, nflStatCtx.week, nflStatCtx.type)); })
            .catch(() => { if (alive) setNflLeaders([]); });
        return () => { alive = false; };
    }, [nflStatCtx, buildNflLeaders, isPhone]);

    // ── Risers & fallers ──
    const [trendTick, setTrendTick] = React.useState(0);
    React.useEffect(() => {
        if (isPhone) return undefined;
        const h = () => setTrendTick(t => t + 1);
        window.addEventListener('wr:hist-season-loaded', h);
        // The event alone is a race we lose often enough to matter: the
        // historical fetch is IndexedDB-backed and on a warm cache resolves
        // BEFORE this listener attaches, leaving trends stuck forever.
        const SC = window.App?.StatCatalog;
        const seasonNum = Number(season) || new Date().getFullYear();
        let tries = 0, timer = null;
        const check = () => {
            if (!SC) return;
            if (SC.historicalSeason(seasonNum - 1) || SC.historicalSeason(seasonNum - 2)) { setTrendTick(t => t + 1); return; }
            if (++tries < 20) timer = setTimeout(check, 500);
        };
        timer = setTimeout(check, 300);
        return () => {
            window.removeEventListener('wr:hist-season-loaded', h);
            if (timer) clearTimeout(timer);
        };
    }, [season, isPhone]);

    const trending = React.useMemo(() => {
        const SC = window.App?.StatCatalog;
        const rosters = currentLeague?.rosters || [];
        if (isPhone || !SC || !rosters.length) return { risers: [], fallers: [] };
        const seasonNum = Number(season) || new Date().getFullYear();
        const y1 = seasonNum - 1, y2 = seasonNum - 2;
        SC.ensureHistSeason(y1); SC.ensureHistSeason(y2);
        const h1 = SC.historicalSeason(y1), h2 = SC.historicalSeason(y2);
        if (!h1 && !h2) return { risers: [], fallers: [] };
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
                const pts = [[y2, h2 ? h2[pid] : null], [y1, h1 ? h1[pid] : null]]
                    .map(([yr, raw]) => ({ yr, v: raw ? SC.computeStat(topStat.key, raw, { perGame: true }) : null }))
                    .filter(pt => pt.v != null);
                if (pts.length < 2) return;
                if (topStat.format !== 'pct' && Math.max(...pts.map(pt => pt.v)) < 2) return;
                const t = SC.trendCalc(pts, topStat.format);
                if (t.delta == null || t.delta === 0) return;
                // The floor above only checks the HIGHER season, so 0.1 -> 2.2
                // tackles/gm still clears it and reports "+2100%". With no
                // usable baseline, report the absolute per-game move instead.
                const first = pts[0].v, last = pts[pts.length - 1].v;
                const usablePct = topStat.format === 'pct' || Math.min(first, last) >= 1;
                const delta = usablePct ? t.delta : Math.round((last - first) * 10) / 10;
                const unit = topStat.format === 'pct' ? 'pt' : (usablePct ? '%' : '/gm');
                if (!delta) return;
                const rel = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : (last - first) * 100;
                rows.push({
                    name: _getPlayerName(pid), statLabel: topStat.short, delta, unit,
                    score: Math.max(-300, Math.min(300, rel)),
                });
            });
        });
        rows.sort((a, b) => b.score - a.score);
        return {
            risers: rows.filter(r => r.delta > 0).slice(0, 3),
            fallers: rows.filter(r => r.delta < 0).slice(-3).reverse(),
        };
    }, [currentLeague, playersData, season, trendTick, isPhone]);

    // ── Assemble ──
    const items = React.useMemo(() => {
        if (isPhone) return [];
        const out = [];
        const nameFor = rid => {
            const t = (standings || []).find(x => sameId(x.rosterId, rid));
            return t ? (t.teamName || t.displayName || _getOwnerName(rid)) : _getOwnerName(rid);
        };

        // Real NFL leads, the way a sports ticker does.
        (nflScores || []).slice(0, 10).forEach(g => {
            const pre = g.isPre ? 'PRE ' : '';
            if (g.state === 'in') {
                out.push({ kind: 'nfllive', label: pre + (g.shortDetail || 'LIVE'), text: g.away + ' ' + g.awayScore + ' — ' + g.home + ' ' + g.homeScore });
            } else if (g.state === 'post') {
                out.push({ kind: 'nfl', label: pre + 'FINAL', text: g.away + ' ' + g.awayScore + ' — ' + g.home + ' ' + g.homeScore });
            } else {
                out.push({ kind: 'nfl', label: g.isPre ? 'PRE WK' + (g.phaseWeek || '') : 'NFL', text: g.away + ' @ ' + g.home + ' · ' + (g.shortDetail || 'Scheduled') });
            }
        });
        (nflLeaders || []).forEach(l => out.push(l));

        // This league
        const pairs = Object.values((board.rows || []).reduce((acc, r) => {
            if (r.matchup_id == null) return acc;
            (acc[r.matchup_id] = acc[r.matchup_id] || []).push(r);
            return acc;
        }, {})).filter(p => p.length === 2);
        pairs.forEach(pair => {
            if (!pair.some(p => Number(p.points) > 0)) return;
            const [a, b] = [...pair].sort((x, y) => Number(y.points) - Number(x.points));
            out.push({ kind: 'score', label: 'WK ' + board.week, text: nameFor(a.roster_id) + ' ' + Number(a.points).toFixed(1) + ' — ' + nameFor(b.roster_id) + ' ' + Number(b.points).toFixed(1) });
        });
        const margins = pairs.filter(p => p.some(x => Number(x.points) > 0)).map(pair => {
            const [a, b] = [...pair].sort((x, y) => Number(y.points) - Number(x.points));
            return { m: Number(a.points) - Number(b.points), win: a, lose: b };
        }).sort((x, y) => y.m - x.m);
        if (margins.length) {
            const big = margins[0], close = margins[margins.length - 1];
            out.push({ kind: 'rec', label: 'BIGGEST WIN', text: nameFor(big.win.roster_id) + ' +' + big.m.toFixed(1) + ' over ' + nameFor(big.lose.roster_id) });
            if (margins.length > 1) out.push({ kind: 'rec', label: 'CLOSEST', text: nameFor(close.win.roster_id) + ' +' + close.m.toFixed(1) + ' over ' + nameFor(close.lose.roster_id) });
            const ugly = margins.slice().sort((x, y) => Number(x.win.points) - Number(y.win.points))[0];
            if (ugly) out.push({ kind: 'rec', label: 'UGLIEST WIN', text: nameFor(ugly.win.roster_id) + ' won on ' + Number(ugly.win.points).toFixed(1) });
            let hi = null;
            (board.rows || []).forEach(r => { const p = Number(r.points) || 0; if (!hi || p > hi.p) hi = { p, rid: r.roster_id }; });
            if (hi && hi.p > 0) out.push({ kind: 'top', label: 'HIGH SCORE', text: nameFor(hi.rid) + ' ' + hi.p.toFixed(1) });
        }

        const positions = (window.getLeaguePositions ? window.getLeaguePositions({ league: currentLeague }) : ['QB', 'RB', 'WR', 'TE']) || [];
        positions.forEach(pos => {
            const top = leaders.find(r => r.pos === pos);
            if (top) out.push({ kind: 'top', label: 'TOP ' + pos, text: top.name + ' ' + top.pts.toFixed(1) });
        });

        const cutoff = Date.now() - 7 * 86400000;
        const recent = (transactions || []).filter(t => (t.created || 0) >= cutoff);
        const bids = recent.filter(t => Number(t.settings?.waiver_bid) > 0)
            .sort((a, b) => Number(b.settings.waiver_bid) - Number(a.settings.waiver_bid));
        if (bids.length) {
            const b = bids[0];
            const got = Object.keys(b.adds || {})[0];
            out.push({ kind: 'faab', label: 'TOP FAAB', text: _getOwnerName(b.roster_ids?.[0]) + ' $' + b.settings.waiver_bid + (got ? ' → ' + _getPlayerName(got) : '') });
        }

        (trending.risers || []).forEach(r => out.push({ kind: 'trend', label: 'RISER', text: r.name + ' ' + r.statLabel + ' +' + r.delta + r.unit }));
        (trending.fallers || []).forEach(r => out.push({ kind: 'trend', label: 'FALLER', text: r.name + ' ' + r.statLabel + ' ' + r.delta + r.unit }));

        if ((standings || []).length > playoffTeams) {
            const inT = standings[playoffTeams - 1], outT = standings[playoffTeams];
            if (inT && outT) {
                const gb = ((inT.wins - outT.wins) + (outT.losses - inT.losses)) / 2;
                out.push({
                    kind: 'rec', label: 'CUTLINE',
                    text: gb === 0
                        ? (playoffTeams + 'th and ' + (playoffTeams + 1) + 'th seed are tied')
                        : gb.toFixed(1) + ' game' + (gb === 1 ? '' : 's') + ' separate the ' + playoffTeams + 'th and ' + (playoffTeams + 1) + 'th seed',
                });
            }
        }
        if (recent.length) {
            const trades = recent.filter(t => t.type === 'trade').length;
            out.push({
                kind: 'faab', label: 'MOVES',
                text: recent.length + ' this week · ' + trades + ' trade' + (trades === 1 ? '' : 's') + ' · ' + (recent.length - trades) + ' waiver claim' + ((recent.length - trades) === 1 ? '' : 's'),
            });
        }
        return out;
    }, [nflScores, nflLeaders, board, leaders, transactions, trending, standings, currentLeague, playoffTeams, isPhone]);

    React.useEffect(() => {
        if (document.getElementById('wr-league-wire-css')) return;
        const st = document.createElement('style');
        st.id = 'wr-league-wire-css';
        st.textContent =
            '@keyframes wrWire{from{transform:translateX(0)}to{transform:translateX(-50%)}}' +
            '.wr-wire-track{animation:wrWire 90s linear infinite;display:flex;width:max-content}' +
            '.wr-wire-track:hover{animation-play-state:paused}' +
            '@media(prefers-reduced-motion:reduce){.wr-wire-track{animation:none}}';
        document.head.appendChild(st);
    }, []);

    // Phones keep the bottom edge for PhoneDock, and a marquee is the wrong
    // idiom on a small touch screen. Every hook above already ran.
    if (isPhone || !items.length) return null;

    const TONE = {
        nfl: { bg: 'rgba(255,255,255,0.09)', fg: 'var(--white, #f5f2ea)' },
        nfllive: { bg: 'rgba(46,204,113,0.2)', fg: 'var(--good, #2ecc71)' },
        nflstat: { bg: 'rgba(78,205,196,0.18)', fg: '#4ECDC4' },
        score: { bg: 'rgba(255,255,255,0.07)', fg: SILVER },
        rec: { bg: 'rgba(93,173,226,0.18)', fg: 'var(--info, #5dade2)' },
        top: { bg: 'rgba(212,175,55,0.18)', fg: GOLD },
        faab: { bg: 'rgba(240,165,0,0.18)', fg: 'var(--warn, #f0a500)' },
        trend: { bg: 'rgba(155,138,251,0.2)', fg: 'var(--purple, #9b8afb)' },
    };
    const row = (it, i) => {
        const tone = TONE[it.kind] || TONE.score;
        return (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '0 17px', fontFamily: MONO, fontSize: '0.72rem', color: SILVER, borderRight: '1px solid rgba(255,255,255,0.05)', whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: 'var(--text-label, 0.75rem)', fontWeight: 800, letterSpacing: '0.09em', padding: '2px 6px', borderRadius: 'var(--card-radius-xs, 5px)', textTransform: 'uppercase', background: tone.bg, color: tone.fg }}>{it.label}</span>
                {it.text}
            </span>
        );
    };
    return (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, height: '38px', background: '#0a0a0c', borderTop: '1px solid rgba(212,175,55,0.16)', display: 'flex', alignItems: 'center', zIndex: 80, overflow: 'hidden' }}>
            <div style={{ flex: '0 0 auto', height: '100%', display: 'flex', alignItems: 'center', gap: '7px', padding: '0 14px', background: '#171206', color: GOLD, fontFamily: MONO, fontSize: 'var(--text-label, 0.75rem)', fontWeight: 800, letterSpacing: '0.11em', borderRight: '1px solid rgba(212,175,55,0.16)', zIndex: 2 }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--good, #2ecc71)', boxShadow: '0 0 7px var(--good, #2ecc71)' }} />
                LEAGUE WIRE
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
                <div className="wr-wire-track">
                    {items.map(row)}{items.map((it, i) => row(it, i + items.length))}
                </div>
            </div>
        </div>
    );
}

window.WrLeagueWire = WrLeagueWire;
