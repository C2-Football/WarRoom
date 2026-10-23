function ComparePhoneSection({ phone, title, children }) {
    return phone ? <details className="la-disclosure"><summary>{title}</summary><div className="la-disclosure-body">{children}</div></details> : <React.Fragment>{children}</React.Fragment>;
}
// js/tabs/compare.js - CompareTab: player and team comparison workspace.
//
// Shows team-vs-team roster strength, position edges, H2H history, and a
// full per-position roster diff.
//
// Depends on: window.App.LI (playerScores, championships, bracketData),
//             window.App.normPos / POS_COLORS / peakWindows / calcPPG.
// Exposes:    window.CompareTab

// Session cache of the opponent-INDEPENDENT H2H raw data (the league-history
// chain walk + each season's rosters + weekly matchup rows), keyed by root
// league. Walking 12 previous_league_id hops + per-season rosters + ~14 weeks of
// matchups is identical for every opponent — only the final meetings filter
// differs — so a rival sweep used to re-download the whole chain once per rival.
// Kept in memory (not localStorage) because raw matchup rows are large; the
// compact per-opponent `meetings` result keeps its own localStorage cache.
window._wrCompareRawCache = window._wrCompareRawCache || {};

function CompareTab({
    currentLeague,
    leagueSkin,
    myRoster,
    playersData,
    statsData,
    stats2025Data,
    priorStatsSeason,
    standings,
    sleeperUserId,
}) {
    const sameId = (a, b) => String(a) === String(b);
    const resolvedLeagueSkin = leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;
    const skinFeatures = resolvedLeagueSkin?.features || {};
    const seasonalFormat = skinFeatures.showAgeCurve === false || ['redraft', 'chopped', 'best_ball', 'dfs'].includes(resolvedLeagueSkin?.type);
    const valueShortLabel = resolvedLeagueSkin?.vocabulary?.valueShortLabel || 'DHQ';
    const valueLabel = resolvedLeagueSkin?.vocabulary?.valueLabel || 'DHQ Value';
    const leagueId = currentLeague?.league_id || currentLeague?.id || '';
    const playerHandoff = window.WR?.PlayerCompareHandoff;
    const replacementIntent = window._wrPlayerCompareTarget;
    const pendingPlayerReplacement = playerHandoff?.matches(replacementIntent, currentLeague, sleeperUserId)
        && replacementIntent.playerIds.every(pid => !!playersData?.[pid]) ? replacementIntent : null;
    const playerHandoffScope = JSON.stringify(playerHandoff?.context(currentLeague, sleeperUserId) || {});
    const intelReady = !!window.App?.LI_LOADED && String(window.App?.LI?.sourceLeagueId || '') === String(leagueId);
    function comparisonValues() {
        if (!seasonalFormat && !intelReady) return {};
        const raw = intelReady ? window.App?.LI?.playerScores || {} : {};
        if (resolvedLeagueSkin?.type === 'keeper' && typeof window.App?.PlayerValue?.getKeeperValue === 'function') {
            return new Proxy(raw, { get: (target, pid) => typeof pid === 'string' && Number.isFinite(target[pid]) && target[pid] >= 0
                ? window.App.PlayerValue.getKeeperValue(pid, { skin: resolvedLeagueSkin }) : target[pid] });
        }
        return seasonalFormat && window.App?.PlayerValue?.valueMap ? window.App.PlayerValue.valueMap({ skin: resolvedLeagueSkin }) : raw;
    }
    // Scout-free vs Pro: free keeps the full raw compare — matrix, per-row
    // leaders, age curves, duel totals headline, GM-lens chip. The buy/sell
    // Action row + the field-verdict Read gate on this predicate (mirrors
    // reconai compare-scout.js, which filters its Verdict row for free).
    const isPro = typeof window.wrIsPro === 'function' ? window.wrIsPro() : true;
    const [scoringRevision, refreshScoringForm] = React.useReducer(revision => revision + 1, 0);
    // Redraft → build ROS values so roster-strength comparisons reflect
    // rest-of-season production (no-op → DHQ for dynasty/keeper).
    React.useMemo(() => {
        try { window.App?.PlayerValue?.ensureRos?.({ leagueId, league: currentLeague, playersData, statsData,
            priorData: priorStatsSeason != null && Number(priorStatsSeason) !== Number(currentLeague?.season) - 1 ? {} : stats2025Data,
            skin: resolvedLeagueSkin }); }
        catch (e) { if (window.wrLog) window.wrLog('compare.ensureRos', e); }
        return null;
    }, [currentLeague, playersData, statsData, stats2025Data, priorStatsSeason, resolvedLeagueSkin, scoringRevision, intelReady]);
    const [compareTeamId, setCompareTeamId] = React.useState(() => {
        try {
            const preselect = window._wrComparePreselect;
            if (preselect != null && preselect !== '') return String(preselect);
            const stored = localStorage.getItem('wr_compare_team_' + (leagueId || 'default'));
            return stored || null;
        } catch { return null; }
    });
    const [compareScope, setCompareScope] = React.useState(() => {
        try {
            if (pendingPlayerReplacement) return 'players';
            // A player card deep-linked into compare → land directly in Players mode.
            if (window._wrAddComparePlayer != null && window._wrAddComparePlayer !== '') return 'players';
            return localStorage.getItem('wr_compare_scope_' + (leagueId || 'default')) || 'duel';
        } catch { return 'duel'; }
    });
    // Players mode: up to 4 players compared straight on DHQ + signals.
    const [comparePlayerIds, setComparePlayerIds] = React.useState(() => {
        try {
            if (pendingPlayerReplacement) return pendingPlayerReplacement.playerIds.slice();
            const raw = localStorage.getItem('wr_compare_players_' + (leagueId || 'default'));
            const list = raw ? JSON.parse(raw).map(String) : [];
            // Merge any pending deep-link target so it survives a remount even if the
            // ~50ms event misses a brief mount (e.g. tab churn).
            const pending = window._wrAddComparePlayer;
            if (pending != null && pending !== '' && !list.includes(String(pending))) list.push(String(pending));
            return list.slice(0, 4);
        } catch { return []; }
    });
    const [playerQuery, setPlayerQuery] = React.useState('');
    const playerSearchRef = React.useRef(null);
    // Phone (≤767) only: the add-player search opens in a WR.Sheet instead
    // of the inline dropdown. Unconditional hook — order stays stable.
    const [searchOpen, setSearchOpen] = React.useState(false);
    const [manualCompareIds, setManualCompareIds] = React.useState(() => {
        try {
            const raw = localStorage.getItem('wr_compare_group_' + (leagueId || 'default'));
            return raw ? JSON.parse(raw).map(String) : [];
        } catch { return []; }
    });
    const [selectedDivision, setSelectedDivision] = React.useState(() => {
        try { return localStorage.getItem('wr_compare_division_' + (leagueId || 'default')) || ''; } catch { return ''; }
    });
    const [h2hState, setH2hState] = React.useState({ loading: false, meetings: [], error: null, loadedFor: null });
    const [teamRankMetric, setTeamRankMetric] = React.useState(() => {
        try { const saved = localStorage.getItem('wr_compare_team_metric_v1_' + leagueId); return ['total', 'starterTotal', 'totalAssets'].includes(saved) ? saved : 'total'; } catch { return 'total'; }
    });
    const [playerMetricIds, setPlayerMetricIds] = React.useState(() => {
        try { const saved = JSON.parse(localStorage.getItem('wr_compare_metrics_v1_' + leagueId)); return Array.isArray(saved) && saved.length ? [...new Set(saved.filter(id => typeof id === 'string'))].slice(0, 6) : null; } catch { return null; }
    });
    const [draftData, setDraftData] = React.useState(null);
    const [draftRefresh, requestDraftRefresh] = React.useReducer(value => value + 1, 0);
    React.useEffect(() => {
        const type = resolvedLeagueSkin?.type;
        if (compareScope === 'players' || !['dynasty', 'keeper'].includes(type) || skinFeatures.showFuturePicks === false) return;
        const data = window.App?.TeamComparisonData;
        if (!data) return;
        let cancelled = false, timer;
        const key = data.contextKey(currentLeague);
        const seeded = currentLeague?._pickFeedState === 'ready' && Array.isArray(currentLeague?.tradedPicks)
            && currentLeague?._draftInventoryState === 'ready' && String(currentLeague?._draftInventory?.season) === String(currentLeague?.season)
            && (!currentLeague?.draft_id || String(currentLeague._draftInventory?.draftId) === String(currentLeague.draft_id));
        const read = async force => {
            setDraftData(previous => previous?.contextKey === key ? { ...previous, loading: true } : { contextKey: key, loading: true });
            const result = await data.load(currentLeague, { skin: resolvedLeagueSkin, force, isCurrent: () => !cancelled });
            if (cancelled || result.status === 'cancelled') return;
            setDraftData({ ...result, loading: false });
            if (result.context?._draftInventory?.phase === 'drafting') timer = setTimeout(() => read(true), 15000);
        };
        if (!seeded || draftRefresh > 0 || currentLeague?._draftInventory?.phase === 'drafting') read(draftRefresh > 0);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [leagueId, currentLeague?.season, currentLeague?.draft_id, currentLeague?._pickFeedState, currentLeague?._draftInventoryState, compareScope, resolvedLeagueSkin?.type, skinFeatures.showFuturePicks, draftRefresh]);
    const [heatPos, setHeatPos] = React.useState(null); // phone Position Heatmap: selected position (null → first)
    const [searchPos, setSearchPos] = React.useState('ALL');   // phone add-player search: position-group filter
    const [searchTeam, setSearchTeam] = React.useState('ALL'); // phone add-player search: owned-by-team filter (rosterId)
    React.useEffect(() => {
        const refresh = event => {
            if (event.detail?.leagueId != null && String(event.detail.leagueId) !== String(leagueId)) return;
            if (event.detail?.season != null && currentLeague?.season != null && String(event.detail.season) !== String(currentLeague.season)) return;
            refreshScoringForm();
        };
        window.addEventListener('wr:weekly-points-loaded', refresh);
        window.addEventListener('wr:ros-market-loaded', refresh);
        window.addEventListener('wr:projections-loaded', refresh);
        return () => {
            window.removeEventListener('wr:weekly-points-loaded', refresh);
            window.removeEventListener('wr:ros-market-loaded', refresh);
            window.removeEventListener('wr:projections-loaded', refresh);
        };
    }, [leagueId, currentLeague?.season]);

    // Phone tier (≤767): shared viewport seam (js/shared/viewport.js) — every
    // phone-conditional style below keys off this so tablet/desktop never change.
    const { isPhone } = window.WR.useViewport();
    // Shared filter control (js/components/wr-primitives.js).
    const _cmpWrSelect = window.WR && window.WR.Select;

    // Phone pattern kit (iPhone program Phase 2). wr-primitives.js loads
    // earlier in the babel chain, so presence is fixed for the page's
    // lifetime; every kit-dependent phone branch gates on _phoneKit and
    // falls back to the existing desktop markup when the kit is absent.
    const _kitReady = !!(window.WR && window.WR.HeroCard && window.WR.AssetRow && window.WR.FilterPill && window.WR.Sheet && window.WR.ActionBar);
    const _phoneKit = isPhone && _kitReady;
    const WrHeroCard = _kitReady ? window.WR.HeroCard : null;
    const WrAssetRow = _kitReady ? window.WR.AssetRow : null;
    const WrFilterPill = _kitReady ? window.WR.FilterPill : null;
    const WrPhoneSheet = _kitReady ? window.WR.Sheet : null;
    const WrPhoneActionBar = _kitReady ? window.WR.ActionBar : null;
    // Phone duel formatting (owner ask 2026-07-12): the Full-Roster-by-Position
    // section caps each room to the top rows with a per-position expander —
    // uncapped it ran 30+ rows × 9 rooms and the page scrolled forever.
    const [expandedRosterPos, setExpandedRosterPos] = React.useState(() => new Set());

    // GM Strategy is the single source of truth — re-renders live on save.
    const gm = window.WR.GmMode.useGmEffects(currentLeague);
    const gmTargetPositions = gm.targetPositions || new Set();
    const gmPosture = gm.marketPosture || 'hold';
    const gmPostureFrame = (() => {
        if (gmPosture === 'buy_low') return { label: 'Buy-Low Lens', hint: 'Strategy says hunt undervalued rooms in this matchup.', color: 'var(--win-green, var(--good))' };
        if (gmPosture === 'sell_high') return { label: 'Sell-High Lens', hint: 'Strategy says cash surplus rooms while value is hot.', color: 'var(--gold)' };
        if (gmPosture === 'exploit') return { label: 'Exploit Lens', hint: 'Strategy says press every edge and pounce on weakness.', color: 'var(--loss-red, var(--bad))' };
        return { label: 'Hold Lens', hint: 'Strategy says stand pat — read the field before moving.', color: 'var(--silver)' };
    })();

    React.useEffect(() => {
        const onOpenCompare = (event) => {
            const rid = event?.detail?.rosterId || window._wrComparePreselect;
            if (rid != null && rid !== '') {
                setCompareScope('duel');
                setCompareTeamId(String(rid));
            }
        };
        window.addEventListener('wr:open-compare', onOpenCompare);
        return () => window.removeEventListener('wr:open-compare', onOpenCompare);
    }, []);

    // Players mode deep-link: a player card's Compare button sets
    // window._wrAddComparePlayer then fires wr:add-compare-player. We consume the
    // global on mount (covers the lazy-mount race) AND listen for the event
    // (covers the already-mounted case). Adds dedupe + cap so double-fire is safe.
    React.useEffect(() => {
        const addId = (pid) => {
            if (pid == null || pid === '') return;
            const key = String(pid);
            setComparePlayerIds(prev => {
                const list = prev.map(String);
                if (list.includes(key)) return prev;
                return [...list, key].slice(0, 4);
            });
        };
        const consumeGlobal = () => {
            const pending = window._wrAddComparePlayer;
            if (pending != null && pending !== '') {
                addId(pending);
                setCompareScope('players');
            }
            try { delete window._wrAddComparePlayer; } catch { window._wrAddComparePlayer = null; }
        };
        consumeGlobal();
        const onAddCompare = (event) => {
            const pid = event?.detail?.pid != null ? event.detail.pid : window._wrAddComparePlayer;
            addId(pid);
            setCompareScope('players');
            try { delete window._wrAddComparePlayer; } catch { window._wrAddComparePlayer = null; }
        };
        window.addEventListener('wr:add-compare-player', onAddCompare);
        return () => window.removeEventListener('wr:add-compare-player', onAddCompare);
    }, []);

    // Scoped replacements seed an exact pair (or one player for an open roster
    // spot). The pending intent covers a lazy mount; the event covers a tab
    // that is already mounted. Only the matching intent can be cleared.
    React.useEffect(() => {
        const applyReplacement = target => {
            if (!playerHandoff?.matches(target, currentLeague, sleeperUserId)
                || !target.playerIds.every(pid => !!playersData?.[pid])) {
                playerHandoff?.clear(target);
                return;
            }
            setComparePlayerIds(target.playerIds.slice());
            setCompareScope('players');
            playerHandoff.clear(target);
        };
        if (window._wrPlayerCompareTarget) applyReplacement(window._wrPlayerCompareTarget);
        const onReplacePlayers = event => {
            // An older deferred event cannot replace a newer pending choice.
            if (window._wrPlayerCompareTarget?.requestId !== event?.detail?.requestId) return;
            applyReplacement(event.detail);
        };
        window.addEventListener('wr:replace-compare-players', onReplacePlayers);
        return () => window.removeEventListener('wr:replace-compare-players', onReplacePlayers);
    }, [playerHandoffScope, playersData]);

    React.useEffect(() => {
        if (!leagueId || !compareTeamId) return;
        try { localStorage.setItem('wr_compare_team_' + leagueId, String(compareTeamId)); } catch {}
    }, [leagueId, compareTeamId]);
    React.useEffect(() => {
        if (!leagueId) return;
        try { localStorage.setItem('wr_compare_scope_' + leagueId, compareScope); } catch {}
    }, [leagueId, compareScope]);
    React.useEffect(() => {
        if (!leagueId) return;
        try { localStorage.setItem('wr_compare_group_' + leagueId, JSON.stringify(manualCompareIds)); } catch {}
    }, [leagueId, manualCompareIds]);
    React.useEffect(() => {
        if (!leagueId) return;
        try { localStorage.setItem('wr_compare_division_' + leagueId, selectedDivision); } catch {}
    }, [leagueId, selectedDivision]);
    React.useEffect(() => {
        if (!leagueId) return;
        try { localStorage.setItem('wr_compare_players_' + leagueId, JSON.stringify(comparePlayerIds)); } catch {}
    }, [leagueId, comparePlayerIds]);
    React.useEffect(() => {
        if (!leagueId) return;
        try { localStorage.setItem('wr_compare_team_metric_v1_' + leagueId, teamRankMetric); } catch {}
    }, [leagueId, teamRankMetric]);
    React.useEffect(() => {
        if (!leagueId) return;
        try {
            const key = 'wr_compare_metrics_v1_' + leagueId;
            if (playerMetricIds === null) localStorage.removeItem(key);
            else localStorage.setItem(key, JSON.stringify(playerMetricIds));
        } catch {}
    }, [leagueId, playerMetricIds]);

    React.useEffect(() => {
        let cancelled = false;
        const theirRoster = (currentLeague?.rosters || []).find(r => sameId(r.roster_id, compareTeamId));
        const rootLeagueId = currentLeague?.league_id || currentLeague?.id;
        const myOwnerId = myRoster?.owner_id;
        const theirOwnerId = theirRoster?.owner_id;
        const platform = currentLeague?._platform || (currentLeague?._mfl ? 'mfl' : currentLeague?._espn ? 'espn' : currentLeague?._yahoo ? 'yahoo' : 'sleeper');
        const canLoadSleeperHistory = platform === 'sleeper' && rootLeagueId && theirRoster && myOwnerId && theirOwnerId;

        if (compareScope !== 'duel') {
            setH2hState({ loading: false, meetings: [], error: null, loadedFor: null });
            return;
        }

        if (!compareTeamId || !canLoadSleeperHistory) {
            setH2hState({ loading: false, meetings: [], error: platform === 'sleeper' ? null : 'H2H history is only available for Sleeper leagues right now.', loadedFor: compareTeamId });
            return;
        }

        async function fetchJson(url) {
            try {
                const res = await fetch(url);
                return res.ok ? res.json() : null;
            } catch {
                return null;
            }
        }

        // Opponent-INDEPENDENT: walk the league-history chain and pull each
        // season's rosters + weekly matchup rows. Cached in-session per root
        // league so switching opponents (or sweeping rivals) reuses it instead of
        // re-downloading the whole chain. The chain WALK stays sequential (each
        // hop needs the prior previous_league_id); per-season fetches then run in
        // parallel rather than season-by-season.
        async function loadRawChain() {
            const sleeperBase = 'https://api.sleeper.app/v1';
            const cutoffKey = String(currentLeague?.season || '') + ':' + window.App.TeamComparison.completedThroughWeek({
                season: currentLeague?.season, nflState: window.S?.nflState, leagueWeek: currentLeague?.current_week,
            });
            const cached = window._wrCompareRawCache[rootLeagueId];
            if (cached && Date.now() - cached.ts < 6 * 60 * 60 * 1000 && Array.isArray(cached.seasons)
                && cached.cutoffKey === cutoffKey) {
                return cached.seasons;
            }

            const chain = [];
            const seen = new Set();
            let lid = String(rootLeagueId);
            let hops = 0;
            while (lid && lid !== '0' && !seen.has(lid) && hops < 12) {
                seen.add(lid);
                const fetchedInfo = await fetchJson(sleeperBase + '/league/' + lid);
                const info = sameId(lid, rootLeagueId)
                    ? Object.assign({}, fetchedInfo || {}, currentLeague || {})
                    : fetchedInfo;
                if (!info) break;
                chain.push({ leagueId: lid, info, season: String(info.season || '') });
                lid = (fetchedInfo?.previous_league_id || info.previous_league_id) ? String(fetchedInfo?.previous_league_id || info.previous_league_id) : '';
                hops += 1;
            }

            const seasons = (await Promise.all(chain.map(async seasonEntry => {
                const info = seasonEntry.info || {};
                const season = String(info.season || seasonEntry.season || '');
                const rosters = sameId(seasonEntry.leagueId, rootLeagueId) && Array.isArray(currentLeague?.rosters)
                    ? currentLeague.rosters
                    : await fetchJson(sleeperBase + '/league/' + seasonEntry.leagueId + '/rosters');
                if (!Array.isArray(rosters) || !rosters.length) return null;
                const playoffStart = Number(info.settings?.playoff_week_start) || Number(currentLeague?.settings?.playoff_week_start) || 15;
                const maxWeek = Math.max(1, Math.min(18, playoffStart - 1));
                const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);
                const weeklyMatchups = await Promise.all(weeks.map(w =>
                    fetchJson(sleeperBase + '/league/' + seasonEntry.leagueId + '/matchups/' + w).then(rows => ({ week: w, rows: Array.isArray(rows) ? rows : [] }))
                ));
                return { leagueId: seasonEntry.leagueId, season, rosters, weeklyMatchups };
            }))).filter(Boolean);

            window._wrCompareRawCache[rootLeagueId] = { ts: Date.now(), cutoffKey, seasons };
            return seasons;
        }

        async function loadHistoricalH2H() {
            const cacheKey = 'wr_compare_h2h_v4_' + rootLeagueId + '_' + myOwnerId + '_' + theirOwnerId;
            const cutoffKey = String(currentLeague?.season || '') + ':' + window.App.TeamComparison.completedThroughWeek({
                season: currentLeague?.season, nflState: window.S?.nflState, leagueWeek: currentLeague?.current_week,
            });
            try {
                const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
                if (cached && Date.now() - cached.ts < 6 * 60 * 60 * 1000 && Array.isArray(cached.meetings)
                    && cached.cutoffKey === cutoffKey) {
                    return cached.meetings;
                }
            } catch {}

            const seasons = await loadRawChain();
            const meetings = [];
            const currentSeason = Number(currentLeague?.season || 0);

            for (const seasonEntry of seasons) {
                const season = seasonEntry.season;
                const rosters = seasonEntry.rosters;

                const historicalMine = rosters.find(r => sameId(r.owner_id, myOwnerId))
                    || (sameId(seasonEntry.leagueId, rootLeagueId) ? rosters.find(r => sameId(r.roster_id, myRoster?.roster_id)) : null);
                const historicalTheirs = rosters.find(r => sameId(r.owner_id, theirOwnerId))
                    || (sameId(seasonEntry.leagueId, rootLeagueId) ? rosters.find(r => sameId(r.roster_id, theirRoster?.roster_id)) : null);
                if (!historicalMine || !historicalTheirs) continue;

                seasonEntry.weeklyMatchups.forEach(({ week, rows }) => {
                    const throughWeek = window.App.TeamComparison.completedThroughWeek({
                        season, nflState: window.S?.nflState,
                        leagueWeek: Number(season) === currentSeason ? currentLeague?.current_week : null,
                    });
                    // A live score is not a completed regular-season meeting.
                    if (week > throughWeek) return;
                    const grouped = {};
                    rows.forEach(row => {
                        if (!row || row.roster_id == null || row.matchup_id == null) return;
                        const key = String(row.matchup_id);
                        (grouped[key] = grouped[key] || []).push(row);
                    });

                    Object.values(grouped).forEach(pair => {
                        const me = pair.find(row => sameId(row.roster_id, historicalMine.roster_id));
                        const them = pair.find(row => sameId(row.roster_id, historicalTheirs.roster_id));
                        if (!me || !them) return;
                        const myPts = window.App.TeamComparison.meetingScore(me);
                        const theirPts = window.App.TeamComparison.meetingScore(them);
                        if (myPts === null || theirPts === null) return;
                        meetings.push({
                            season,
                            week,
                            myPoints: myPts,
                            theirPoints: theirPts,
                            result: myPts > theirPts ? 'W' : myPts < theirPts ? 'L' : 'T',
                            margin: +(myPts - theirPts).toFixed(2),
                            matchupId: me.matchup_id,
                        });
                    });
                });
            }

            meetings.sort((a, b) => Number(b.season) - Number(a.season) || b.week - a.week);
            try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), cutoffKey, meetings })); } catch {}
            return meetings;
        }

        setH2hState({ loading: true, meetings: [], error: null, loadedFor: compareTeamId });
        loadHistoricalH2H()
            .then(meetings => {
                if (!cancelled) setH2hState({ loading: false, meetings, error: null, loadedFor: compareTeamId });
            })
            .catch(() => {
                if (!cancelled) setH2hState({ loading: false, meetings: [], error: 'Unable to load H2H history.', loadedFor: compareTeamId });
            });

        return () => { cancelled = true; };
    }, [leagueId, compareScope, compareTeamId, myRoster?.owner_id, myRoster?.roster_id, currentLeague?.rosters?.length,
        currentLeague?.season, currentLeague?.current_week, window.S?.nflState?.season, window.S?.nflState?.season_type,
        window.S?.nflState?.display_week, window.S?.nflState?.week]);

    // Position rank by DHQ across every scored player (e.g. "WR #14"), for the
    // Players-mode cards. Built once over the scored-player universe; recomputes
    // only when the player pool or the redraft basis changes. Self-contained
    // (own normPos/valueMap) so it can sit above the early return with the hooks.
    const posRankMap = React.useMemo(() => {
        const np = window.App?.normPos || ((x) => x);
        const sc = comparisonValues();
        const byPos = {};
        Object.keys(sc).forEach(pid => {
            const pl = playersData?.[pid] || playersData?.[String(pid)];
            if (!pl) return;
            const pos = np(pl.position);
            const v = sc[pid];
            if (!Number.isFinite(v) || v < 0) return;
            (byPos[pos] = byPos[pos] || []).push([String(pid), v]);
        });
        const rank = {};
        Object.keys(byPos).forEach(pos => {
            const rows = byPos[pos].sort((a, b) => b[1] - a[1]);
            rows.forEach(row => { rank[row[0]] = rows.findIndex(other => other[1] === row[1]) + 1; });
        });
        return rank;
    }, [playersData, currentLeague, statsData, stats2025Data, resolvedLeagueSkin, scoringRevision, intelReady]);

    if (!myRoster) {
        return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--silver)' }}>No roster found</div>;
    }

    const normPos = window.App.normPos;
    const posColors = window.App.POS_COLORS || {};
    const scores = comparisonValues();
    const allPositions = ['QB','RB','WR','TE','K','DEF','DL','LB','DB'];
    const posLabel = pos => window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos);
    const rosterById = {};
    (currentLeague?.rosters || []).forEach(r => { rosterById[String(r.roster_id)] = r; });
    const getRosterTotal = roster => window.App.TeamComparison.summarize({ roster, playersData, values: scores, normPos, positions: allPositions }).total;
    const myTotal = getRosterTotal(myRoster);
    const getOwnerName = (roster, fallback) => {
        const user = (currentLeague?.users || []).find(u => sameId(u.user_id, roster?.owner_id));
        return user?.metadata?.team_name || user?.display_name || fallback || ('Team ' + (roster?.roster_id ?? ''));
    };
    const leagueSeason = parseInt(currentLeague?.season, 10) || new Date().getFullYear();
    const draftRounds = Number(currentLeague?.settings?.draft_rounds || 5);
    const leagueTeamCount = (currentLeague?.rosters || []).length || 12;
    const pickMidSlot = Math.ceil(leagueTeamCount / 2);
    const getPickValue = (year, round) => {
        const rd = Number(round) || 1;
        const pickNumber = (rd - 1) * leagueTeamCount + pickMidSlot;
        if (typeof window.getIndustryPickValue === 'function') return window.getIndustryPickValue(pickNumber, leagueTeamCount, draftRounds);
        const sharedValue = window.App?.PlayerValue?.getPickValue?.(year, rd, leagueTeamCount, pickMidSlot);
        if (sharedValue != null) return sharedValue;
        return null;
    };
    const draftContextKey = String(currentLeague?.season || '') + ':' + String(leagueId);
    const scopedDraftData = draftData?.contextKey === draftContextKey ? draftData : null;
    const verifiedDraftLeague = scopedDraftData?.context ? { ...currentLeague, ...scopedDraftData.context }
        : currentLeague?._pickFeedState === 'ready' ? currentLeague
        : { ...currentLeague, tradedPicks: undefined, _pickFeedState: 'unavailable', _draftInventory: undefined, _draftInventoryState: 'unavailable' };
    const getDraftCapital = roster => window.App.TeamComparison.draftCapital({
        roster, league: verifiedDraftLeague, skin: resolvedLeagueSkin,
        rosterById, getOwnerName, getPickValue,
    });
    const getFaab = (roster) => {
        const isFaab = currentLeague?.settings?.waiver_type === 2 || Number(currentLeague?.settings?.waiver_budget || 0) > 0;
        const budget = isFaab && Number.isFinite(currentLeague?.settings?.waiver_budget) ? Math.max(0, currentLeague.settings.waiver_budget) : null;
        const spent = Number.isFinite(roster?.settings?.waiver_budget_used) ? Math.max(0, roster.settings.waiver_budget_used) : null;
        const remaining = budget != null && spent != null ? Math.max(0, budget - spent) : null;
        return {
            isFaab,
            budget,
            spent,
            remaining,
            pct: budget && remaining != null ? Math.round(remaining / budget * 100) : null,
            label: !isFaab ? 'No FAAB' : remaining == null ? 'FAAB unreported' : '$' + remaining + ' / $' + budget,
        };
    };
    const myName = getOwnerName(myRoster, 'You');
    const allTeamOptions = (currentLeague?.rosters || []).map(roster => {
        const standing = (standings || []).find(row => sameId(row.rosterId, roster.roster_id));
        const dhq = getRosterTotal(roster);
        const coverage = window.App.TeamComparison.summarize({ roster, playersData, values: scores, normPos, positions: allPositions });
        return { ...standing, rosterId: roster.roster_id, roster, dhq, complete: coverage.complete, gap: Math.abs(dhq - myTotal), name: standing?.displayName || getOwnerName(roster, 'Team ' + roster.roster_id) };
    });
    const opponentOptions = allTeamOptions.filter(team => !sameId(team.rosterId, myRoster.roster_id));

    const metadata = currentLeague?.metadata || {};
    const getDivisionKey = (roster) => String(roster?.settings?.division ?? 0);
    const getDivisionName = (key) => metadata['division_' + key + '_name'] || metadata['division_' + key] || (key === '0' ? 'Division 0' : 'Division ' + key);
    const divisions = {};
    allTeamOptions.forEach(t => {
        const key = getDivisionKey(t.roster);
        if (!divisions[key]) divisions[key] = [];
        divisions[key].push(t);
    });
    const divisionKeys = Object.keys(divisions).sort((a, b) => Number(a) - Number(b));
    const myDivision = getDivisionKey(myRoster);
    const activeDivision = selectedDivision || myDivision || divisionKeys[0] || '0';
    const validTeamIdSet = new Set(allTeamOptions.map(t => String(t.rosterId)));
    const cleanManualIds = manualCompareIds.filter(id => validTeamIdSet.has(String(id)));
    const defaultGroupIds = [...opponentOptions]
        .sort((a, b) => b.dhq - a.dhq)
        .slice(0, Math.min(3, opponentOptions.length))
        .map(t => String(t.rosterId));
    const selectedGroupIds = cleanManualIds.length >= 2 ? cleanManualIds : defaultGroupIds;
    const selectedGroupTeams = selectedGroupIds
        .map(id => allTeamOptions.find(t => sameId(t.rosterId, id)))
        .filter(Boolean);
    const selectedDivisionTeams = divisions[activeDivision] || [];
    const divisionIncludesUser = sameId(activeDivision, myDivision);
    const selectedLeagueTeams = opponentOptions;
    const setScope = (scope) => {
        setCompareScope(scope);
        if (scope === 'duel' && !compareTeamId && opponentOptions[0]) setCompareTeamId(String(opponentOptions[0].rosterId));
    };
    const toggleManualTeam = (id) => {
        const key = String(id);
        setManualCompareIds(prev => prev.map(String).includes(key) ? prev.filter(x => String(x) !== key) : [...prev.map(String), key]);
    };
    const pickManualPreset = (preset) => {
        if (preset === 'threats') setManualCompareIds([...opponentOptions].sort((a, b) => b.dhq - a.dhq).slice(0, 4).map(t => String(t.rosterId)));
        else if (preset === 'closest') setManualCompareIds([...opponentOptions].sort((a, b) => a.gap - b.gap).slice(0, 4).map(t => String(t.rosterId)));
        else if (preset === 'division') setManualCompareIds((divisions[myDivision] || []).map(t => String(t.rosterId)));
        else if (preset === 'clear') setManualCompareIds([]);
    };
    const addComparePlayer = (pid) => {
        if (pid == null || pid === '') return;
        const key = String(pid);
        setComparePlayerIds(prev => prev.map(String).includes(key) ? prev : [...prev.map(String), key].slice(0, 4));
        setPlayerQuery('');
    };
    const removeComparePlayer = (pid) => setComparePlayerIds(prev => prev.filter(x => String(x) !== String(pid)));
    const clearComparePlayers = () => setComparePlayerIds([]);
    // Mirrors tierFromDhq in player-card.js so the Players cards label tiers the
    // same way the full card does.
    const tierLabelFromDhq = (dhq) => dhq >= 7000 ? { label: 'Elite', color: 'var(--good)' }
        : dhq >= 5000 ? { label: 'Tier 1', color: 'var(--k-3498db, #3498db)' }
        : dhq >= 3500 ? { label: 'Tier 2', color: 'var(--gold)' }
        : dhq >= 2000 ? { label: 'Tier 3', color: 'var(--silver)' }
        : dhq > 0 ? { label: 'Depth', color: 'var(--silver)' }
        : { label: '—', color: 'var(--silver)' };

    const statsRefForField = statsData || {};
    const stats2025RefForField = stats2025Data || {};
    const scoringForField = currentLeague?.scoring_settings || {};
    const calcFieldStats = pid => window.App.PlayerComparison.summarize({
        pid, statsData: statsRefForField, priorData: stats2025RefForField, season: leagueSeason, priorStatsSeason,
        position: normPos(playersData?.[pid]?.position),
        calcPPG: row => {
            const points = typeof window.App.LeagueStats?.score === 'function'
                ? window.App.LeagueStats.score(row, scoringForField, normPos(playersData?.[pid]?.position))
                : window.App.calcRawPts?.(row, scoringForField);
            return points != null && row.gp > 0 ? points / row.gp : null;
        },
    });
    const enrichFieldPlayer = (pid) => {
        const p = playersData?.[pid] || playersData?.[String(pid)];
        if (!p) return null;
        const pos = normPos(p.position);
        const curve = typeof window.App?.getAgeCurve === 'function'
            ? window.App.getAgeCurve(pos)
            : { peak: (window.App?.peakWindows || {})[pos] || [24, 29], decline: [30, 32] };
        const valueEnd = curve.decline?.[1] || 32;
        const peakEnd = curve.peak?.[1] || 29;
        const age = p.age || null;
        return {
            pid,
            p,
            pos,
            age,
            team: p.team || 'FA',
            yrsExp: p.years_exp || 0,
            ...calcFieldStats(pid),
            dhq: Number.isFinite(scores[pid]) && scores[pid] >= 0 ? scores[pid] : 0,
            valueKnown: Number.isFinite(scores[pid]) && scores[pid] >= 0,
            peakYrs: age ? Math.max(0, peakEnd - age) : 0,
            valueYrs: age ? Math.max(0, valueEnd - age) : 0,
            pastValue: age ? age > valueEnd : false,
        };
    };
    const teamProfile = (teamOption, isMine) => {
        const roster = isMine ? myRoster : teamOption?.roster;
        if (!roster) return null;
        const summary = window.App.TeamComparison.summarize({ roster, playersData, values: scores, normPos, positions: allPositions });
        const players = (roster.players || []).map(enrichFieldPlayer).filter(Boolean);
        const pickCapital = getDraftCapital(roster);
        const faab = getFaab(roster);
        const user = (currentLeague?.users || []).find(u => sameId(u.user_id, roster.owner_id));
        const record = [summary.record.wins, summary.record.losses].map(n => n == null ? '—' : n).join('-') + (summary.record.ties > 0 ? '-' + summary.record.ties : '');
        return {
            ...summary, roster, rosterId: String(roster.roster_id), isMine: !!isMine,
            name: isMine ? myName : (teamOption?.name || getOwnerName(roster, 'Team ' + roster.roster_id)),
            record, division: getDivisionKey(roster), players, pickCapital, faab,
            avatar: user?.metadata?.avatar || (user?.avatar ? 'https://sleepercdn.com/avatars/' + user.avatar : null),
            totalAssets: summary.total + (pickCapital.valued ? pickCapital.totalValue || 0 : 0),
            assetsComplete: summary.complete && pickCapital.complete && pickCapital.valued,
        };
    };
    const openPlayerCard = (pid) => {
        if (!pid) return;
        if (window.WR && typeof window.WR.openPlayerCard === 'function') window.WR.openPlayerCard(pid);
        else if (typeof window._wrSelectPlayer === 'function') window._wrSelectPlayer(pid);
    };

    const pageStyle = { padding: isPhone ? '12px var(--wr-phone-gutter, 12px) 60px' : 'var(--space-xl) var(--space-xl) 60px', maxWidth: '1540px', margin: '0 auto' };
    const panelStyle = { background: 'var(--black)', border: 'var(--card-border)', borderRadius: 'var(--card-radius)' };
    const labelStyle = { fontSize: 'var(--text-micro)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.66 };
    const mono = { fontFamily: 'JetBrains Mono, monospace' };
    const selectStyle = {
        padding: '9px 14px',
        fontSize: isPhone ? '14px' : '0.82rem',
        fontFamily: 'var(--font-body)',
        background: 'var(--ov-3, rgba(255,255,255,0.04))',
        border: '1px solid var(--acc-line2, rgba(212,175,55,0.32))',
        borderRadius: 'var(--card-radius-sm, 8px)',
        color: 'var(--white)',
        minHeight: '44px',
    };
    const quickButtonStyle = (active) => ({
        padding: '8px 10px',
        background: active ? 'var(--acc-fill3, rgba(212,175,55,0.16))' : 'var(--ov-3, rgba(255,255,255,0.035))',
        border: '1px solid ' + (active ? 'var(--acc-line3, rgba(212,175,55,0.46))' : 'var(--ov-5, rgba(255,255,255,0.08))'),
        borderRadius: 'var(--card-radius-sm, 8px)',
        color: active ? 'var(--gold)' : 'var(--silver)',
        textAlign: 'left',
        cursor: 'pointer',
        minWidth: '142px',
        minHeight: '44px',
    });

    const scopeButtonStyle = (active) => ({
        padding: '8px 12px',
        borderRadius: 'var(--card-radius-sm, 8px)',
        border: '1px solid ' + (active ? 'var(--acc-line4, rgba(212,175,55,0.55))' : 'var(--ov-5, rgba(255,255,255,0.09))'),
        background: active ? 'var(--acc-fill3, rgba(212,175,55,0.16))' : 'var(--ov-3, rgba(255,255,255,0.035))',
        color: active ? 'var(--gold)' : 'var(--silver)',
        fontFamily: 'var(--font-title)',
        fontWeight: 800,
        fontSize: '0.92rem',
        cursor: 'pointer',
        minHeight: '44px',
    });
    const smallButtonStyle = (active) => ({
        padding: '6px 9px',
        borderRadius: 'var(--card-radius-sm, 8px)',
        border: '1px solid ' + (active ? 'var(--acc-line3, rgba(212,175,55,0.48))' : 'var(--ov-5, rgba(255,255,255,0.08))'),
        background: active ? 'var(--acc-fill3, rgba(212,175,55,0.14))' : 'var(--ov-2, rgba(255,255,255,0.03))',
        color: active ? 'var(--gold)' : 'var(--silver)',
        fontSize: isPhone ? '14px' : '0.72rem',
        fontWeight: 800,
        cursor: 'pointer',
        minHeight: '44px',
    });
    const renderScopeControls = () => (
        isPhone ? (
            // Phone (≤767): scope pills re-pour as the shared .wr-seg
            // segmented sub-nav (P2) — same lenses, same setScope setters;
            // the seg scrolls horizontally when the five don't fit.
            <label className="la-view-select">Compare<select value={compareScope} onChange={event => setScope(event.target.value)}>{[['duel','Teams'],['players','Players'],['group','Group'],['division','Division'],['league','League']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        ) : (
        <div className="wr-module-nav">
            {[
                ['duel', 'Teams', '1 opponent'],
                ['players', 'Players', 'head-to-head'],
                ['group', 'Group', '2+ teams'],
                ['division', 'Division', 'league divisions'],
                ['league', 'League', 'all teams'],
            ].map(([key, label, sub]) => (
                <button key={key} className={compareScope === key ? 'is-active' : ''} aria-pressed={compareScope === key} onClick={() => setScope(key)} title={sub}>
                    {label}
                </button>
            ))}
        </div>
        )
    );
    const renderFieldControls = () => {
        if (compareScope === 'group') {
            return (
                <div className="tcmp-field-controls" style={{ ...panelStyle, padding: '12px', marginBottom: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
                        <div>
                            <div style={{ ...labelStyle, color: 'var(--gold)', opacity: 1 }}>Group Builder</div>
                            <div style={{ fontSize: isPhone ? '14px' : '0.72rem', color: 'var(--silver)', opacity: 0.68 }}>Pick any 2 or more teams for a custom field. Your team is optional.</div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <button onClick={() => pickManualPreset('threats')} style={smallButtonStyle(false)}>Top 4 {valueShortLabel}</button>
                            <button onClick={() => pickManualPreset('closest')} style={smallButtonStyle(false)}>Closest 4</button>
                            <button onClick={() => pickManualPreset('division')} style={smallButtonStyle(false)}>My Division</button>
                            <button onClick={() => pickManualPreset('clear')} style={smallButtonStyle(false)}>Clear</button>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '7px' }}>
                        {allTeamOptions.map(t => {
                            const active = selectedGroupIds.map(String).includes(String(t.rosterId));
                            const manualActive = manualCompareIds.map(String).includes(String(t.rosterId));
                            return (
                                <button key={t.rosterId} aria-pressed={active} aria-label={'Select ' + t.name} onClick={() => toggleManualTeam(t.rosterId)} style={{
                                    padding: '8px 9px',
                                    minHeight: '44px',
                                    borderRadius: 'var(--card-radius-sm, 8px)',
                                    border: '1px solid ' + (manualActive ? 'var(--acc-line3, rgba(212,175,55,0.46))' : 'var(--ov-4, rgba(255,255,255,0.07))'),
                                    background: manualActive ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : active ? 'var(--ov-4, rgba(255,255,255,0.055))' : 'var(--ov-2, rgba(255,255,255,0.025))',
                                    color: manualActive ? 'var(--gold)' : 'var(--silver)',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                }}>
                                    <div style={{ fontWeight: 850, color: manualActive ? 'var(--gold)' : 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                                    <div style={{ ...mono, fontSize: 'var(--text-micro, 0.6875rem)', opacity: 0.66, marginTop: '2px' }}>{t.dhq.toLocaleString()}{t.complete ? '' : '*'} {valueShortLabel}{sameId(t.rosterId, myRoster.roster_id) ? ' · You' : ''}</div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            );
        }
        if (compareScope === 'division') {
            return (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
                    {divisionKeys.map(key => (
                        <button key={key} aria-pressed={key === activeDivision} onClick={() => setSelectedDivision(key)} style={quickButtonStyle(key === activeDivision)}>
                            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.72 }}>{getDivisionName(key)}</div>
                            <div style={{ ...mono, fontSize: 'var(--text-micro, 0.6875rem)', marginTop: '2px' }}>{(divisions[key] || []).length} teams</div>
                        </button>
                    ))}
                </div>
            );
        }
        return null;
    };

    const renderFieldAnalysis = (selectedTeams, fieldLabel, fieldSub, options = {}) => {
      const profilesById = new Map();
      if (options.includeUser !== false) {
        const mine = teamProfile(null, true);
        profilesById.set(mine.rosterId, mine);
      }
      selectedTeams.filter(Boolean).forEach(team => {
        const profile = teamProfile(team, sameId(team.rosterId, myRoster.roster_id));
        if (profile) profilesById.set(profile.rosterId, profile);
      });
      const profiles = [...profilesById.values()];
      if (profiles.length < 2) return <section className="tcmp-showcase tcmp-empty"><span className="tcmp-kicker">DYNASTY HQ / TEAM COMPARE</span><h2>Build your rivalry.</h2><p>Select another team to compare rosters, starters, and position strengths.</p></section>;
      const assetsAvailable = profiles.every(p => p.assetsComplete);
      const metric = teamRankMetric === 'totalAssets' && !assetsAvailable ? 'total' : teamRankMetric;
      const metricLabel = metric === 'starterTotal' ? 'Submitted starter value' : metric === 'totalAssets' ? 'Roster + draft value' : 'Roster value';
      const completeFor = p => metric === 'starterTotal' ? p.starterComplete : metric === 'totalAssets' ? p.assetsComplete : p.complete;
      const ranked = window.App.TeamComparison.rank(profiles, metric);
      const rankFor = profile => ranked.find(row => sameId(row.profile.rosterId, profile.rosterId));
      const focusProfile = profiles.find(p => p.isMine) || profiles[0];
      const comparisonProfiles = profiles.filter(p => !sameId(p.rosterId, focusProfile.rosterId));
      const focus = focusProfile;
      const rivals = comparisonProfiles;
      const accents = ['#ebc875', '#63cbe9', '#b6a1ff', '#ffac78'];
      const accent = p => p.isMine ? accents[0] : accents[1 + profiles.filter(x => !x.isMine).indexOf(p) % 3];
      const number = value => value == null ? '—' : Number(value).toLocaleString(undefined, {
        maximumFractionDigits: 1
      });
      const signed = value => (value > 0 ? '+' : '') + number(value);
      const faabLeft = profile => profile.faab.remaining == null ? '—' : '$' + number(profile.faab.remaining);
      const known = (value, complete) => complete ? number(value) : number(value) + '*';
      const validRanks = ranked.filter(row => row.rank != null);
      const leaders = validRanks.filter(row => row.rank === 1);
      const allComplete = profiles.every(completeFor);
      const activePositions = allPositions.filter(pos => profiles.some(p => p.players.some(player => player.pos === pos)));
      const roomDiffs = activePositions.map(pos => {
        const complete = profiles.every(p => p.posComplete[pos]);
        const average = rivals.reduce((sum, p) => sum + (p.posTotals[pos] || 0), 0) / rivals.length;
        return {
          pos,
          diff: (focus.posTotals[pos] || 0) - average,
          complete
        };
      }).filter(row => row.complete);
      const strength = roomDiffs.filter(row => row.diff > 0).sort((a, b) => b.diff - a.diff)[0];
      const exposure = roomDiffs.filter(row => row.diff < 0).sort((a, b) => a.diff - b.diff)[0];
      const duel = !!options.duel;
      const displayProfiles = profiles.length <= 4 ? duel ? profiles : ranked.map(row => row.profile) : [focus, ...ranked.map(row => row.profile).filter(p => p !== focus).slice(0, 3)];
      const topValue = Math.max(1, ...profiles.map(p => p[metric]));
      const rankText = p => {
        const row = rankFor(p);
        return row.rank == null ? 'Unranked' : (row.tied ? 'Tied ' : '') + '#' + row.rank + ' of ' + profiles.length;
      };
      const read = !allComplete ? 'Some player values or starter slots are unavailable. Totals marked * are partial; a complete field winner is not awarded.' : leaders.length > 1 ? leaders.map(row => row.profile.name).join(' and ') + ' are tied on ' + metricLabel.toLowerCase() + '.' : leaders[0].profile.name + ' leads ' + metricLabel.toLowerCase() + ' by ' + number(leaders[0].profile[metric] - validRanks[1].profile[metric]) + ' ' + valueShortLabel + '.';
      const activePos = activePositions.includes(heatPos) ? heatPos : activePositions.includes('QB') ? 'QB' : activePositions[0];
      const roomRanks = [...profiles].sort((a, b) => (b.posTotals[activePos] || 0) - (a.posTotals[activePos] || 0));
      const roomMax = Math.max(1, ...roomRanks.map(p => p.posTotals[activePos] || 0));
      const roomComplete = profiles.every(p => p.posComplete[activePos]);
      const rankPosition = p => 1 + roomRanks.filter(other => (other.posTotals[activePos] || 0) > (p.posTotals[activePos] || 0)).length;
      const detailProfiles = profiles.length <= 4 ? profiles : displayProfiles;
      const openDuel = p => {
        if (!p.isMine) {
          setCompareTeamId(p.rosterId);
          setScope('duel');
        }
      };
      const cardStat = (label, value, note) => <div><dt>{label}</dt><dd>{value}</dd>{note ? <small>{note}</small> : null}</div>;
      return <section className="tcmp-showcase" aria-label={duel ? 'Team head-to-head comparison' : fieldLabel + ' team comparison'}>
                <header className="tcmp-heading"><div><span className="tcmp-kicker">DYNASTY HQ / TEAM COMPARE · {fieldLabel}</span><h2>{duel ? 'Who owns the edge?' : 'See the whole field.'}</h2><p>{fieldSub}</p></div><span className="tcmp-basis">{valueShortLabel} values · {leagueSeason}</span></header>
                {!intelReady && ['dynasty', 'keeper'].includes(resolvedLeagueSkin?.type) ? <p role="status">Player values are loading for this league. Records and reported scoring remain available.</p> : null}
                <div className="tcmp-toolbar"><label>Compare by <select aria-label="Rank teams by" value={metric} onChange={event => setTeamRankMetric(event.target.value)}><option value="total">Roster value</option><option value="starterTotal">Submitted starter value</option>{assetsAvailable ? <option value="totalAssets">Roster + draft value</option> : null}</select></label><span>{profiles.length} teams · {metricLabel}</span></div>
                <div className="tcmp-deck" data-count={displayProfiles.length}>
                    {displayProfiles.map(profile => <article className="tcmp-team-card" key={profile.rosterId} style={{
            '--team-accent': accent(profile)
          }}>
                        <div className="tcmp-card-top"><span>{profile.isMine ? 'Your franchise' : duel ? 'The challenger' : 'In the field'}</span><strong>{rankText(profile)}</strong></div>
                        <div className="tcmp-card-identity"><span className="tcmp-avatar">{profile.name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase()}{profile.avatar ? <img src={profile.avatar} alt="" onError={event => {
                  event.currentTarget.style.display = 'none';
                }} /> : null}</span><div><h3 className={profile.name.length > 36 ? 'tcmp-long-name' : undefined}>{profile.name}</h3><p>{profile.record} · {getDivisionName(profile.division)}</p></div></div>
                        <div className="tcmp-value"><span>{metricLabel} · {valueShortLabel}</span><strong>{known(profile[metric], completeFor(profile))}</strong><small>{metric === 'starterTotal' ? 'Current submitted lineup' : metric === 'totalAssets' ? 'Players plus estimated draft capital' : profile.knownValueCount + ' of ' + profile.playerCount + ' players valued'}</small></div>
                        <div className="tcmp-track"><i style={{
                width: Math.min(100, profile[metric] / topValue * 100) + '%'
              }} /></div>
                        <dl className="tcmp-card-stats">{cardStat('Starters', known(profile.starterTotal, profile.starterComplete), valueShortLabel + ' value')}{cardStat('Bench / reserves', known(profile.benchTotal, profile.complete && profile.starterComplete), valueShortLabel + ' value')}{cardStat('Avg. roster age', profile.averageAge == null ? '—' : number(profile.averageAge), 'Known player ages')}{cardStat('Points for', number(profile.pointsFor), leagueSeason + ' season')}</dl>
                        <div className="tcmp-core" aria-label={profile.name + ' highest-value players'}>{profile.players.filter(player => Number.isFinite(scores[player.pid]) && scores[player.pid] >= 0).sort((a, b) => b.dhq - a.dhq).slice(0, 3).map(player => <button key={player.pid} title="Open player card" onClick={() => openPlayerCard(player.pid)} aria-label={'Open ' + player.p.full_name + ' player details'}><img src={'https://sleepercdn.com/content/nfl/players/thumb/' + player.pid + '.jpg'} alt="" onError={event => {
                  event.currentTarget.style.display = 'none';
                }} /><span>{player.p.last_name || player.p.full_name}</span></button>)}</div>
                        <div className="tcmp-card-note"><span>{profile.pickCapital.valued ? 'Draft capital' : profile.pickCapital.disabled ? 'Waiver budget' : 'Draft rights'}</span><strong>{profile.pickCapital.valued ? number(profile.pickCapital.totalValue) + (profile.pickCapital.complete ? '' : '*') + ' · ' + profile.pickCapital.count + ' picks' : profile.pickCapital.disabled ? profile.faab.isFaab ? faabLeft(profile) + ' left' : 'No FAAB' : profile.pickCapital.complete ? profile.pickCapital.count + ' picks · unpriced' : 'Not fully reported'}</strong></div>
                    </article>)}
                </div>
                {profiles.length > 4 ? <p className="tcmp-card-note">Featured: {focus.isMine ? 'your team' : focus.name} and three rivals. All {profiles.length} teams appear in the ranking below.</p> : null}
                <div className="tcmp-read"><strong>The comparison read</strong><p>{read}</p>{gm.hasStrategy && focus.isMine ? <small title={gmPostureFrame.hint}>{gmPostureFrame.label}</small> : null}</div>
                <div className="tcmp-strengths"><div><span>{focus.isMine ? 'Your' : focus.name + ' ·'} strongest advantage</span><strong>{strength ? posLabel(strength.pos) + ' · ' + signed(Math.round(strength.diff)) : 'No clear room advantage'}</strong><p>{strength ? 'Roster value over ' + (duel ? 'the opponent' : 'the other teams’ average') + '.' : 'No fully valued position has a positive gap.'}</p></div><div><span>{focus.isMine ? 'Your' : focus.name + ' ·'} biggest gap</span><strong>{exposure ? posLabel(exposure.pos) + ' · ' + signed(Math.round(exposure.diff)) : 'No clear room deficit'}</strong><p>{exposure ? 'Roster value below ' + (duel ? 'the opponent' : 'the other teams’ average') + '.' : 'No fully valued position has a negative gap.'}</p></div></div>
                <div className="tcmp-panels">
                    <section className="tcmp-panel"><div className="tcmp-panel-heading"><div><h3>{duel ? 'Position advantages' : 'Position leaderboard'}</h3><p>Full-roster {valueShortLabel} value by room</p></div><span>{activePositions.length} rooms</span></div>
                        {duel ? <div className="tcmp-room-list">{activePositions.map(pos => {
                const a = profiles[0],
                  b = profiles[1],
                  diff = (a.posTotals[pos] || 0) - (b.posTotals[pos] || 0);
                const complete = a.posComplete[pos] && b.posComplete[pos];
                const max = Math.max(1, a.posTotals[pos] || 0, b.posTotals[pos] || 0);
                return <div className="tcmp-room-duel" key={pos}><header><span>{posLabel(pos)}</span><strong>{!complete ? 'Partial values' : diff === 0 ? 'Even' : (diff > 0 ? a.isMine ? 'You' : a.name : b.name) + ' +' + number(Math.abs(diff))}</strong></header><div className="tcmp-room-pair">{profiles.map(p => <div key={p.rosterId} className="tcmp-room-side" style={{
                      '--team-accent': accent(p)
                    }}><span>{p.isMine ? 'You' : p.name}</span><strong>{known(p.posTotals[pos] || 0, p.posComplete[pos])}</strong><div className="tcmp-track"><i style={{
                          width: (p.posTotals[pos] || 0) / max * 100 + '%'
                        }} /></div></div>)}</div></div>;
              })}</div> : <React.Fragment><div className="tcmp-position-tabs" aria-label="Position to compare">{activePositions.map(pos => <button key={pos} aria-pressed={pos === activePos} onClick={() => setHeatPos(pos)}>{posLabel(pos)}</button>)}</div><div className="tcmp-position-ranks">{roomRanks.map(p => <div key={p.rosterId} className="tcmp-position-row" style={{
                  '--team-accent': accent(p)
                }}><span>{roomComplete ? '#' + rankPosition(p) : '—'}</span><strong>{p.name}</strong><div className="tcmp-track"><i style={{
                      width: (p.posTotals[activePos] || 0) / roomMax * 100 + '%'
                    }} /></div><span>{known(p.posTotals[activePos] || 0, p.posComplete[activePos])}</span></div>)}</div>{!roomComplete ? <p>Some room values are partial; no position ranks are awarded.</p> : null}</React.Fragment>}
                    </section>
                    <section className="tcmp-panel"><div className="tcmp-panel-heading"><div><h3>{duel ? 'The numbers side by side' : 'Team power board'}</h3><p>{duel ? 'Roster depth, capital, and waiver flexibility' : 'Ranked by ' + metricLabel.toLowerCase() + '. Open a rival to compare head to head.'}</p></div></div><div className="tcmp-ranking">{ranked.map(({
                profile: p,
                rank,
                tied
              }) => <div className="tcmp-rank-item" key={p.rosterId} data-mine={p.isMine} style={{
                '--team-accent': accent(p)
              }}><span className="tcmp-rank-number">{rank == null ? '—' : (tied ? '=' : '#') + rank}</span><button className="tcmp-rank-name" disabled={p.isMine} onClick={() => openDuel(p)} aria-label={p.isMine ? p.name + ', your team' : 'Compare against ' + p.name}><strong>{p.name}</strong><small>{p.isMine ? 'Your team · ' : ''}{p.record}</small></button><div className="tcmp-rank-value"><strong>{known(p[metric], completeFor(p))}</strong><small>{metricLabel}</small></div><dl className="tcmp-rank-stats">{cardStat('Roster', known(p.total, p.complete))}{cardStat('Starters', known(p.starterTotal, p.starterComplete))}{cardStat('Draft capital', p.pickCapital.valued ? number(p.pickCapital.totalValue) + (p.pickCapital.complete ? '' : '*') : '—')}{cardStat('FAAB left', p.faab.isFaab ? faabLeft(p) : '—')}</dl><div className="tcmp-track"><i style={{
                    width: Math.min(100, p[metric] / topValue * 100) + '%'
                  }} /></div></div>)}</div></section>
                </div>
                {duel ? renderTeamHistory(profiles[1]) : null}
                <details className="tcmp-details"><summary>Draft capital & waiver budgets<small>Ownership, estimated values, and FAAB</small></summary><div className="tcmp-details-body">{['dynasty', 'keeper'].includes(resolvedLeagueSkin?.type) && window.App?.TeamComparisonData ? <div className="tcmp-draft-refresh"><button type="button" disabled={scopedDraftData?.loading} onClick={() => requestDraftRefresh()} style={smallButtonStyle(false)}>{scopedDraftData?.loading ? 'Checking draft ownership…' : 'Refresh draft data'}</button>{scopedDraftData?.error ? <p role="status">{scopedDraftData.error}</p> : null}</div> : null}<div className="tcmp-capital-grid">{profiles.map(p => <article key={p.rosterId}><h4>{p.name}</h4><p>{p.pickCapital.note}</p>{p.pickCapital.picks.length ? <React.Fragment><p>{p.pickCapital.count} picks{p.pickCapital.valued ? ' · ' + number(p.pickCapital.totalValue) + ' estimated ' + valueShortLabel : ' · unpriced rights'}</p><ul>{Object.entries(p.pickCapital.byYear).map(([year, count]) => <li key={year}>{year} · {count} picks</li>)}</ul><p>Top picks: {p.pickCapital.topPicks.map(pick => pick.label).join(' · ')}</p></React.Fragment> : null}<p>{p.faab.isFaab ? p.faab.remaining == null ? 'FAAB budget or spending is unreported.' : faabLeft(p) + ' of $' + p.faab.budget + ' FAAB remaining' : 'No FAAB budget in this league'}</p></article>)}</div></div></details>
                <details className="tcmp-details"><summary>Full rosters by position<small>Open any player for the full card</small></summary><div className="tcmp-details-body">{profiles.length > 4 ? <p>Showing the four featured teams. Open a rival from the power board for a full head-to-head roster comparison.</p> : null}{activePositions.map(pos => {
              const atPos = detailProfiles.map(profile => ({
                profile,
                players: profile.players.filter(p => p.pos === pos).sort((a, b) => b.dhq - a.dhq)
              }));
              const maxLen = Math.max(0, ...atPos.map(column => column.players.length));
              if (!maxLen) return null;
              const cap = isPhone ? 4 : 6,
                expanded = expandedRosterPos.has(pos);
              return <section className="tcmp-roster-room" key={pos}><h4>{posLabel(pos)}{gmTargetPositions.has(pos) ? ' · Strategy target' : ''}</h4><div className="tcmp-roster-grid" style={{
                  '--team-count': detailProfiles.length
                }}>{atPos.map(({
                    profile,
                    players
                  }) => <div className="tcmp-roster-column" key={profile.rosterId}><h5>{profile.name}</h5>{players.length ? players.slice(0, expanded ? undefined : cap).map(player => <button title="Open player card" className="tcmp-roster-player" key={player.pid} onClick={() => openPlayerCard(player.pid)}><img src={'https://sleepercdn.com/content/nfl/players/thumb/' + player.pid + '.jpg'} alt="" onError={e => {
                        e.currentTarget.style.display = 'none';
                      }} /><span><strong>{player.p.full_name}</strong><small>{player.team}{player.ppg != null ? ' · ' + player.ppg + ' ' + player.ppgLabel : ''}</small></span><b>{Number.isFinite(scores[player.pid]) && scores[player.pid] >= 0 ? number(player.dhq) : '—'}</b></button>) : <p>No players</p>}</div>)}</div>{maxLen > cap ? <button style={smallButtonStyle(false)} onClick={() => setExpandedRosterPos(previous => {
                  const next = new Set(previous);
                  if (next.has(pos)) next.delete(pos);else next.add(pos);
                  return next;
                })}>{expanded ? 'Show top ' + cap : 'Show all ' + posLabel(pos) + ' players'}</button> : null}</section>;
            })}</div></details>
                <div className="tcmp-notes"><p>Values measure roster assets, not weekly projections or win probability. Starter value uses the submitted lineup; bench / reserves includes every other rostered player.</p>{profiles.some(p => !p.complete || !p.starterComplete || p.pickCapital.valued && !p.pickCapital.complete) ? <p>* Partial value: player values, starter slots, or draft ownership are unreported. Ranks require complete values.</p> : null}{profiles.some(p => p.pickCapital.valued) ? <p>Draft values are estimates using mid-round slots. Draft capital is separate from roster value unless you choose “Roster + draft value.”</p> : null}<p>Average age uses known player ages. Records and points for are reported season totals.</p></div>
                <footer className="tcmp-footer"><span>DYNASTY HQ</span><span>Your league. Your scoring. Your edge.</span></footer>
            </section>;
    };
    const renderTeamHistory = opponent => {
      const meetings = h2hState.loadedFor && sameId(h2hState.loadedFor, opponent.rosterId) ? h2hState.meetings : [];
      const wins = meetings.filter(m => m.result === 'W').length,
        losses = meetings.filter(m => m.result === 'L').length,
        ties = meetings.filter(m => m.result === 'T').length;
      const championships = intelReady ? window.App?.LI?.championships : null;
      const titleCount = id => Object.values(championships || {}).filter(c => sameId(c.champion, id)).length;
      const brackets = Object.values(intelReady ? window.App?.LI?.bracketData || {} : {}).filter(entry => entry.winners?.length);
      const playoffRecord = window.WrHistory?.playoffRecord;
      const sumPlayoffs = id => brackets.reduce((total, entry) => {
        const record = playoffRecord(entry.winners, id);
        return { w: total.w + record.w, l: total.l + record.l };
      }, { w: 0, l: 0 });
      const playoffMine = brackets.length && typeof playoffRecord === 'function' ? sumPlayoffs(myRoster.roster_id) : null;
      const playoffTheirs = playoffMine ? sumPlayoffs(opponent.rosterId) : null;
      return <details className="tcmp-details"><summary>Rivalry history<small>{h2hState.loading ? 'Loading meetings…' : meetings.length ? wins + '-' + losses + (ties ? '-' + ties : '') + ' across ' + meetings.length + ' meetings' : 'Past meetings and championships'}</small></summary><div className="tcmp-details-body"><p>Completed regular-season meetings between the current owners in the linked Sleeper league history.</p>{h2hState.loading ? <p>Loading owner-vs-owner history…</p> : meetings.length ? meetings.slice(0, 12).map(m => <div className="tcmp-history-row" key={m.season + '-' + m.week + '-' + m.matchupId}><span>{m.season} · W{m.week}</span><strong>{m.result} · {m.myPoints.toFixed(2)} – {m.theirPoints.toFixed(2)}</strong><span>{m.margin > 0 ? '+' : ''}{m.margin.toFixed(2)}</span></div>) : <p>{h2hState.error || 'No completed meetings found in the available linked history.'}</p>}{meetings.length > 12 ? <p>{meetings.length - 12} older meetings also included in the record.</p> : null}<p>{championships && Object.keys(championships).length ? myName + ': ' + titleCount(myRoster.roster_id) + ' titles · ' + opponent.name + ': ' + titleCount(opponent.rosterId) + ' titles in the available league history.' : 'Championship history is not available.'}</p>{playoffMine ? <p>Franchise playoff records: {myName} {playoffMine.w}-{playoffMine.l} · {opponent.name} {playoffTheirs.w}-{playoffTheirs.l}. Championship-path games only, from the available history.</p> : null}</div></details>;
    };

    // ── Players mode ─────────────────────────────────────────────────────────
    // Straight player-vs-player: up to 4 players, each as a focused compare card
    // anchored on DHQ, laid out across four quadrants. Best value in each row is
    // highlighted across the field.
    const renderPlayerSearch = () => {
        const q = playerQuery.trim().toLowerCase();
        let results = [];
        if (q.length >= 2) {
            const seen = new Set(comparePlayerIds.map(String));
            for (const pid of Object.keys(playersData || {})) {
                const p = playersData[pid];
                if (!p) continue;
                const pos = normPos(p.position);
                if (!allPositions.includes(pos)) continue;
                const nm = p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
                if (!nm || !nm.toLowerCase().includes(q)) continue;
                if (seen.has(String(pid))) continue;
                results.push({ pid, name: nm, pos, team: p.team || 'FA', dhq: scores[pid] || scores[String(pid)] || 0 });
            }
            results.sort((a, b) => b.dhq - a.dhq);
            results = results.slice(0, 8);
        }
        const atMax = comparePlayerIds.length >= 4;
        return (
            <div style={{ position: 'relative', minWidth: '230px', flex: '1 1 250px', maxWidth: '440px' }}>
                <input
                    ref={playerSearchRef}
                    aria-label="Search players to compare"
                    value={playerQuery}
                    onChange={e => setPlayerQuery(e.target.value)}
                    placeholder={atMax ? 'Four players max — remove one to swap' : 'Search a player to compare…'}
                    disabled={atMax}
                    style={{ ...selectStyle, width: '100%', opacity: atMax ? 0.5 : 1 }}
                />
                {results.length ? (
                    <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 40, background: 'var(--black, #0b0b0d)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.32))', borderRadius: 'var(--card-radius-sm, 8px)', overflow: 'hidden', boxShadow: '0 14px 34px rgba(0,0,0,0.55)' }}>
                        {results.map(r => (
                            <button key={r.pid} onClick={() => addComparePlayer(r.pid)} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: '9px', padding: '8px 10px', minHeight: isPhone ? '44px' : undefined, background: 'transparent', border: 'none', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.04))', cursor: 'pointer', textAlign: 'left' }}>
                                <img src={'https://sleepercdn.com/content/nfl/players/thumb/' + r.pid + '.jpg'} onError={e => e.target.style.display = 'none'} style={{ width: '26px', height: '26px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                                <span style={{ flex: 1, minWidth: 0, color: 'var(--white)', fontSize: isPhone ? '14px' : '0.8rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                                <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: posColors[r.pos] || 'var(--silver)', fontWeight: 800 }}>{posLabel(r.pos)} · {r.team}</span>
                                <span style={{ ...mono, fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', fontWeight: 800 }}>{Number.isFinite(scores[r.pid]) && scores[r.pid] >= 0 ? r.dhq.toLocaleString() : '—'}</span>
                            </button>
                        ))}
                    </div>
                ) : null}
            </div>
        );
    };

    const renderPlayerCompare = () => {
        const isRedraft = seasonalFormat;
        const accents = ['#e7bd58', '#63cbe9', '#b6a1ff', '#ffac78'];
        const number = (v, digits = 1) => v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
        const players = comparePlayerIds.map(String).slice(0, 4).map((pid, index) => {
            const base = enrichFieldPlayer(pid);
            if (!base) return { pid, missing: true };
            const meta = intelReady ? window.App?.LI?.playerMeta?.[pid] || {} : {};
            const stats = window.App.PlayerComparison.summarize({
                pid, statsData, priorData: stats2025Data, season: leagueSeason, priorStatsSeason, meta, position: base.pos,
                calcPPG: row => {
                    const points = typeof window.App.LeagueStats?.score === 'function'
                        ? window.App.LeagueStats.score(row, scoringForField, base.pos)
                        : window.App.calcRawPts?.(row, scoringForField);
                    return points != null && row.gp > 0 ? points / row.gp : null;
                },
                weeklyHistory: typeof window.App?.WeeklyProj?.weeklyHistory === 'function' ? id => window.App.WeeklyProj.weeklyHistory(id) : undefined,
            });
            const curve = window.App?.getAgeCurve?.(base.pos) || { peak: [24, 29] };
            const phase = !base.age ? 'Age unavailable' : base.age < curve.peak[0] ? 'Rising' : base.age <= curve.peak[1] ? 'In prime' : 'Veteran';
            const action = isPro && skinFeatures.showTrades !== false && typeof window.getPlayerAction === 'function' ? window.getPlayerAction(pid) : null;
            return { ...base, ...stats, name: base.p.full_name || [base.p.first_name, base.p.last_name].filter(Boolean).join(' ') || 'Unknown player',
                accent: accents[index], tier: tierLabelFromDhq(base.dhq), posRank: posRankMap[pid] || null,
                phase, action, context: [meta.statusReason, meta.roleLabel, meta.opportunityLabel].filter(Boolean).join(' · ') };
        });
        const valid = players.filter(p => !p.missing);
        const knownValues = valid.filter(p => p.valueKnown);
        const maxValue = Math.max(0, ...valid.map(p => p.dhq));
        const leaders = knownValues.filter(p => p.dhq === maxValue);
        const leader = knownValues.length === valid.length && knownValues.length > 1 && leaders.length === 1 ? leaders[0] : null;
        const sameSeason = new Set(valid.filter(p => p.ppg != null).map(p => p.season)).size <= 1;
        const fieldStyle = { '--cmp-count': Math.max(1, players.length) };
        const focusSearch = () => { if (_phoneKit) setSearchOpen(true); else playerSearchRef.current?.focus(); };
        const formPoints = valid.flatMap(p => (p.recentGames || []).map(g => g.pts));
        const formHigh = Math.max(1, ...formPoints);
        const formLow = Math.min(0, ...formPoints);

        const formChart = (pl) => {
            const games = pl.recentGames || [];
            if (!games.length) return <div className="cmp-form-empty">Completed-game scores unavailable</div>;
            const y = pts => 6 + (formHigh - pts) / (formHigh - formLow) * 38;
            const baseline = y(0);
            const description = games.map(g => 'Week ' + g.week + ': ' + number(g.pts) + ' points').join('; ');
            return <React.Fragment><svg className="cmp-form-chart" viewBox="0 0 200 46" preserveAspectRatio="none" role="img" aria-label={pl.name + ', recent completed games. ' + description}>
                <line x1="0" x2="200" y1={baseline} y2={baseline} stroke="currentColor" opacity="0.22" />
                {games.map((g, i) => {
                    const width = 200 / games.length;
                    const top = Math.min(baseline, y(g.pts));
                    return <g key={g.week}>
                        <rect x={i * width + 5} y={top} width={width - 10} height={Math.max(2, Math.abs(baseline - y(g.pts)))} rx="3" fill="var(--cmp-accent)" opacity={i === games.length - 1 ? 1 : 0.55} />
                    </g>;
                })}
            </svg><div className="cmp-form-weeks" style={{ '--cmp-games': games.length }} aria-hidden="true">{games.map(g => <span key={g.week}>W{g.week}</span>)}</div></React.Fragment>;
        };
        const stat = (label, value, note) => <div><span>{label}</span><strong>{value}</strong>{note ? <small>{note}</small> : null}</div>;
        const renderCard = (pl) => {
            if (pl.missing) return <article key={pl.pid} className="cmp-feature-card" style={{ padding: 18 }}>
                <p>This player is no longer in the player pool.</p><button onClick={() => removeComparePlayer(pl.pid)} style={smallButtonStyle(false)}>Remove player</button>
            </article>;
            const first = pl.p.first_name || pl.name.split(' ')[0];
            const last = pl.p.last_name || pl.name.split(' ').slice(1).join(' ') || pl.name;
            const valueLead = leader?.pid === pl.pid && valid.length > 1;
            return <article key={pl.pid} className="cmp-feature-card" style={{ '--cmp-accent': pl.accent }} aria-label={pl.name + ' comparison'}>
                <div className="cmp-feature-topline">
                    <span className="cmp-feature-badge">{valueLead ? valueShortLabel + ' leader' : pl.tier.label + ' · ' + posLabel(pl.pos)}</span>
                    <button className="cmp-feature-remove" aria-label={'Remove ' + pl.name + ' from comparison'} title={'Remove ' + pl.name} onClick={() => removeComparePlayer(pl.pid)}>×</button>
                </div>
                <button className="cmp-feature-identity" onClick={() => openPlayerCard(pl.pid)} aria-label={'Open ' + pl.name + ' player details'}>
                    <span className="cmp-feature-monogram" aria-hidden="true">{first.slice(0, 1)}{last.slice(0, 1)}</span>
                    <img className="cmp-feature-portrait" src={'https://sleepercdn.com/content/nfl/players/' + pl.pid + '.jpg'} alt="" onLoad={e => { e.currentTarget.previousElementSibling.style.visibility = 'hidden'; }} onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.previousElementSibling.style.visibility = 'visible'; }} />
                    <span className="cmp-feature-name"><small>{first}</small><strong>{last}</strong></span>
                    <span className="cmp-feature-bio">{posLabel(pl.pos)} · {pl.team}{pl.age ? ' · Age ' + pl.age : ''}</span>
                </button>
                <div className="cmp-feature-score"><span>{valueLabel}</span><strong>{pl.valueKnown ? pl.dhq.toLocaleString() : '—'}</strong><small>{pl.tier.label}</small></div>
                <div className="cmp-feature-meter" aria-hidden="true"><i style={{ width: (maxValue ? pl.dhq / maxValue * 100 : 0) + '%' }} /></div>
                <div className="cmp-feature-stats">
                    {stat(pl.ppgLabel, number(pl.ppg), pl.games != null ? pl.games + (pl.games === 1 ? ' game' : ' games') : 'Sample unavailable')}
                    {stat('Value rank', pl.posRank ? '#' + pl.posRank : '—', posLabel(pl.pos) + ' only')}
                    {isRedraft ? stat('Recent PPG', number(pl.recentPPG), (pl.recentGames || []).length + ' completed games') : stat('Runway', pl.age ? pl.valueYrs + ' yr' : '—', 'Age-curve estimate')}
                </div>
                {pl.usage?.length ? <div className="cmp-feature-usage"><div className="cmp-feature-stats" data-count="2">{pl.usage.map(u => <React.Fragment key={u.label}>{stat(u.label, number(u.value), u.unit)}</React.Fragment>)}</div></div> : null}
                <div className="cmp-feature-form"><div><span>{leagueSeason} · Last {pl.recentGames?.length || 5} games</span>{pl.recentPPG != null ? <span>{number(pl.recentPPG)} PPG</span> : null}</div>{formChart(pl)}</div>
                <div className="cmp-feature-foot"><span>{pl.phase}</span>{isPro && pl.action?.label ? <strong>{pl.action.label}</strong> : null}</div>
            </article>;
        };

        const defaultMetricIds = isRedraft ? ['value', 'ppg', 'recent'] : ['value', 'ppg', 'runway'];
        const usageLabels = [...new Set(valid.flatMap(p => (p.usageMetrics || []).map(stat => stat.label)))];
        const metricOptions = [
            { id: 'value', label: valueLabel, values: valid.map(p => p.valueKnown ? p.dhq : null), format: n => n.toLocaleString() },
            { id: 'ppg', label: sameSeason ? (valid.find(p => p.ppg != null)?.ppgLabel || 'Season PPG') : 'Season PPG¹', values: valid.map(p => p.ppg), format: n => number(n), comparable: sameSeason },
            ...(!isRedraft ? [{ id: 'runway', label: 'Dynasty runway', values: valid.map(p => p.age ? p.valueYrs : null), format: n => n + ' yr' }] : []),
            { id: 'recent', label: 'Recent PPG', values: valid.map(p => p.recentPPG), format: n => number(n) },
            { id: 'trend', label: 'YoY PPG change', values: valid.map(p => p.trend), format: n => (n > 0 ? '+' : '') + n + '%', comparable: false },
            { id: 'age', label: 'Age', values: valid.map(p => p.age), format: n => number(n), comparable: false },
            { id: 'games', label: 'Season games', values: valid.map(p => p.games), format: n => n.toLocaleString(), comparable: false },
            { id: 'rank', label: 'Rank within position', values: valid.map(p => p.posRank), format: n => '#' + n, comparable: false },
            ...usageLabels.map(label => ({ id: 'usage:' + label, label: label + ' /game',
                values: valid.map(p => p.usageMetrics.find(stat => stat.label === label)?.value ?? null),
                format: n => number(n), comparable: sameSeason,
            })),
        ];
        const chosenIds = playerMetricIds === null ? defaultMetricIds : playerMetricIds;
        const metrics = metricOptions.filter(metric => chosenIds.includes(metric.id));
        const toggleMetric = id => {
            const current = metrics.map(metric => metric.id);
            const next = current.includes(id) ? current.filter(key => key !== id) : [...current, id];
            if (next.length > 0 && next.length <= 6) setPlayerMetricIds(next);
        };
        const detailRows = [
            ['Season / sample', p => p.sourceLabel],
            ['Recent PPG', p => number(p.recentPPG)],
            ['YoY PPG change', p => p.trend == null ? '—' : (p.trend > 0 ? '+' : '') + p.trend + '%'],
            ['Age', p => p.age || '—'],
            ...(!isRedraft ? [['Peak years left', p => p.age ? p.peakYrs + ' yr' : '—']] : []),
            ['Experience', p => p.yrsExp + ' yr'],
            ['Role / status', p => p.context || '—'],
            ...(isPro ? [['Action', p => p.action?.label || '—']] : []),
        ];
        const valueSorted = [...knownValues].sort((a, b) => b.dhq - a.dhq);
        const gap = leader && valueSorted[1] ? leader.dhq - valueSorted[1].dhq : 0;
        const runwaySorted = [...valid].filter(p => p.age).sort((a, b) => b.valueYrs - a.valueYrs);
        const runwayLead = runwaySorted.length > 1 && runwaySorted[0].valueYrs > runwaySorted[1].valueYrs ? runwaySorted[0] : null;
        const verdict = leader
            ? leader.name + ' leads on ' + valueLabel + ' by ' + gap.toLocaleString() + '.' + (!isRedraft && runwayLead && runwayLead.pid !== leader.pid ? ' ' + runwayLead.name + ' offers the longer estimated runway (' + runwayLead.valueYrs + ' years).' : '')
            : knownValues.length < valid.length ? 'Value data is incomplete for this field. Compare the reported scoring and role information below.'
                : 'The leaders are tied on ' + valueLabel + '. Use scoring and role to weigh the tradeoff.';

        return <section className="cmp-showcase" aria-label="Player comparison">
            <div className="cmp-showcase-heading"><span>DYNASTY HQ / PLAYER COMPARE</span><span>{players.length} OF 4</span></div>
            {!intelReady && !isRedraft ? <p className="cmp-stat-note" role="status">Player values are loading for this league. Reported scoring remains available.</p> : null}
            <div className="cmp-showcase-title"><div><h2>{valid.length === 2 ? 'Who gets your edge?' : valid.length > 2 ? 'Size up the field.' : 'Build your matchup.'}</h2><p>{isRedraft ? 'Rest-of-season value. Scoring. Role.' : 'Today’s production. Tomorrow’s value.'}</p></div>{players.length ? <button onClick={clearComparePlayers} style={smallButtonStyle(false)}>Clear all</button> : null}</div>
            {isPhone && players.length > 2 ? <p className="cmp-stat-note" style={{ margin: '0 0 12px' }}>Swipe the cards to compare all {players.length} players →</p> : null}
            {players.length ? <div className="cmp-showcase-deck" data-count={players.length} style={fieldStyle}>{players.map(renderCard)}</div> : <div style={{ ...panelStyle, padding: '28px', textAlign: 'center' }}><p>Add up to four players to compare value, scoring, and opportunity.</p><button onClick={focusSearch} style={smallButtonStyle(true)}>Add your first player</button></div>}
            {players.length > 0 && players.length < 4 ? <button onClick={focusSearch} style={{ ...smallButtonStyle(false), marginTop: 12 }}>+ Add player</button> : null}
            {valid.length > 1 ? <React.Fragment>
                {isPro ? <div className="cmp-showcase-read"><strong>The matchup read</strong><p>{verdict}</p></div> : window.WrGatedMoreRow ? React.createElement(window.WrGatedMoreRow, { title: 'The Read — field verdict', sub: 'Who to value now vs later — Pro calls the field.', feature: 'analytics_depth' }) : null}
                <details className="cmp-stat-picker"><summary>Choose comparison stats <small>{metrics.length} shown</small></summary><div className="cmp-stat-picker-body"><p>Choose 1–6 stats for the comparison below. Cards keep their key numbers.</p><div className="cmp-stat-choices">{metricOptions.map(metric => {
                    const checked = metrics.some(row => row.id === metric.id);
                    return <label key={metric.id}><input type="checkbox" checked={checked} disabled={checked ? metrics.length === 1 : metrics.length >= 6} onChange={() => toggleMetric(metric.id)} /><span>{metric.label}</span></label>;
                })}</div><button type="button" onClick={() => setPlayerMetricIds(null)} style={smallButtonStyle(false)}>Reset to recommended</button><p>Usage stats use each player’s displayed season and sample. Missing stats show —; mixed seasons don’t receive a scoring edge.</p></div></details>
                <div className="cmp-overview-grid" style={{ '--cmp-count': valid.length }}>
                    <div className="cmp-edge-row"><span>Where they lead</span>{valid.map(p => <span key={p.pid} style={{ color: p.accent }}>{p.p.last_name || p.name}</span>)}</div>
                    {metrics.map(metric => {
                        const available = metric.values.filter(v => v != null);
                        const best = available.length ? Math.max(...available) : null;
                        const low = Math.min(0, ...available);
                        const tied = available.filter(v => v === best).length > 1;
                        return <div className="cmp-edge-row" key={metric.label}><span>{metric.label}</span>{valid.map((p, i) => {
                            const value = metric.values[i];
                            const win = value != null && value === best && available.length === valid.length && valid.length > 1 && metric.comparable !== false;
                            return <div className="cmp-edge-cell" key={p.pid} style={{ '--cmp-accent': p.accent }}><strong>{value == null ? '—' : metric.format(value)}</strong><small>{win ? tied ? 'Tied' : 'Edge' : '\u00a0'}</small><div className="cmp-edge-track" aria-hidden="true"><i style={{ width: value == null || best === low ? '0%' : ((value - low) / (best - low) * 100) + '%' }} /></div></div>;
                        })}</div>;
                    })}
                </div>
                {!metrics.length ? <p className="cmp-stat-note">Your selected stats are unavailable for this field. Choose other stats or reset to recommended.</p> : null}
                {!sameSeason ? <p className="cmp-stat-note">¹ Season PPG uses different years. See each card’s year and sample; no scoring edge is awarded.</p> : null}
                <details className="cmp-breakdown"><summary>Full stat breakdown</summary><div className="cmp-overview-grid" style={{ '--cmp-count': valid.length }}><div className="cmp-edge-row"><span>Metric</span>{valid.map(p => <span key={p.pid}>{p.p.last_name || p.name}</span>)}</div>{detailRows.map(([label, display]) => <div key={label} className="cmp-edge-row"><span>{label}</span>{valid.map(p => <span key={p.pid}>{display(p)}</span>)}</div>)}</div></details>
            </React.Fragment> : null}
            <div className="cmp-showcase-footer"><span>DYNASTY HQ</span><span>League scoring · Charts share a scale · Rank within position{!isRedraft ? ' · Runway is an age-curve estimate' : ''}</span></div>
        </section>;
    };

    // Phone add-player search (P3/P6): same pool filter as the desktop
    // dropdown (renderPlayerSearch), re-homed in a WR.Sheet list with a
    // 16px input (iOS zoom floor). Computed only while the sheet is open.
    // Add-player search (phone): owned-by-team map + result pool. Filters by
    // name, position group, and/or owning team — any active filter is enough
    // to browse (name not required when a pos/team filter is set).
    const searchTeams = (currentLeague?.rosters || [])
        .map(ros => ({ rid: String(ros.roster_id), name: getOwnerName(ros, 'Team ' + ros.roster_id), pids: new Set((ros.players || []).map(String)) }))
        .filter(t => t.pids.size);
    const pidOwnerRid = {}; const ridName = {};
    searchTeams.forEach(t => { ridName[t.rid] = t.name; t.pids.forEach(pid => { pidOwnerRid[pid] = t.rid; }); });
    let phoneSearchResults = [];
    if (_phoneKit && compareScope === 'players' && searchOpen) {
        const q = playerQuery.trim().toLowerCase();
        const posOn = searchPos !== 'ALL', teamOn = searchTeam !== 'ALL';
        if (comparePlayerIds.length < 4 && (q.length >= 2 || posOn || teamOn)) {
            const seen = new Set(comparePlayerIds.map(String));
            for (const pid of Object.keys(playersData || {})) {
                const p = playersData[pid];
                if (!p) continue;
                const pos = normPos(p.position);
                if (!allPositions.includes(pos)) continue;
                if (posOn && pos !== searchPos) continue;
                if (teamOn && pidOwnerRid[String(pid)] !== searchTeam) continue;
                const nm = p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
                if (!nm) continue;
                if (q.length >= 2 && !nm.toLowerCase().includes(q)) continue;
                if (seen.has(String(pid))) continue;
                phoneSearchResults.push({ pid, name: nm, pos, team: p.team || 'FA', dhq: scores[pid] || scores[String(pid)] || 0, owner: ridName[pidOwnerRid[String(pid)]] || null });
            }
            phoneSearchResults.sort((a, b) => b.dhq - a.dhq);
            phoneSearchResults = phoneSearchResults.slice(0, 40);
        }
    }
    const phoneAtMax = comparePlayerIds.length >= 4;
    const phonePickedName = (() => {
        if (comparePlayerIds.length !== 1) return '';
        const p = playersData?.[comparePlayerIds[0]] || playersData?.[String(comparePlayerIds[0])];
        return p ? (p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim()) : '1 of 4 picked';
    })();

    return (
      <div className={"compare-shell" + (isPhone ? " la-mobile la-compare" : "")} style={pageStyle}>
        {/* Phone tier (≤767) only — hit-slop for the small × remove glyphs
            (26px/22px visuals stay; the tap area grows to ≥44px, plan D7:
            hit-padding, not bigger buttons). Buttons are position:absolute,
            so the ::after anchors to them without layout impact. */}
        <style>{`
            @media (max-width: 767px) {
                .cmp-remove-x::after { content: ''; position: absolute; top: -11px; right: -11px; bottom: -11px; left: -11px; }
            }
        `}</style>
        <div className="wr-module-strip">
          <div className="wr-module-actions">
            {renderScopeControls()}
            {compareScope === 'duel' ? (
                _cmpWrSelect ? React.createElement(_cmpWrSelect, {
                  label: 'Team', value: compareTeamId ? String(compareTeamId) : '', placeholder: 'Select team…',
                  active: !!compareTeamId, title: 'Team to compare against',
                  onChange: v => setCompareTeamId(v || null),
                  options: [{ value: '', label: 'Select team to compare...' }].concat(opponentOptions.map(t => ({
                    value: String(t.rosterId), label: t.name, sub: (t.wins || 0) + '-' + (t.losses || 0),
                  }))),
                }) : null
            ) : compareScope === 'players' ? (_phoneKit ? (
                <WrFilterPill label="Add player" value={comparePlayerIds.length + '/4'} onClick={() => setSearchOpen(true)} />
            ) : renderPlayerSearch()) : (
                <div style={{ ...mono, color: 'var(--silver)', fontSize: isPhone ? '14px' : '0.76rem' }}>
                    {compareScope === 'group' ? (cleanManualIds.length >= 2 ? selectedGroupTeams.length + ' selected' : cleanManualIds.length ? cleanManualIds.length + ' of 2 needed' : 'default field')
                        : compareScope === 'division' ? getDivisionName(activeDivision)
                        : opponentOptions.length + ' opponents'}
                </div>
            )}
          </div>
        </div>

        {compareScope === 'players' ? renderPlayerCompare() : compareScope === 'duel' ? (
        <React.Fragment>
            {renderFieldAnalysis(opponentOptions.filter(team => sameId(team.rosterId, compareTeamId)), 'Head to head', 'Roster strength. Starting core. Room to build.', { duel: true })}
        </React.Fragment>
        ) : (
        <React.Fragment>
            <ComparePhoneSection phone={isPhone && compareScope === 'group'} title="Choose teams">{renderFieldControls()}</ComparePhoneSection>
            {compareScope === 'group'
                ? renderFieldAnalysis(
                    selectedGroupTeams,
                    'Custom Group',
                    cleanManualIds.length >= 2 ? 'Your selected teams, compared on equal terms.' : 'Showing a default 3-team field until you pick at least 2 teams.',
                    { includeUser: false }
                )
                : compareScope === 'division'
                    ? renderFieldAnalysis(
                        selectedDivisionTeams,
                        getDivisionName(activeDivision),
                        divisionIncludesUser ? 'Your division includes your roster and division rivals.' : 'Division-only lens; your roster is not added to this field.',
                        { includeUser: divisionIncludesUser }
                    )
                    : renderFieldAnalysis(selectedLeagueTeams, 'Full League', 'Every franchise. Every position. Find your next advantage.')}
        </React.Fragment>
        )}

        {/* Phone (P6): players-mode selection bar + add-player sheet. The bar
            shows ONLY at exactly 1 picked (never at 0 or ≥2); both the bar
            and the sheet drive the exact same addComparePlayer /
            setPlayerQuery seams as the desktop inline search. */}
        {_phoneKit && compareScope === 'players' ? (
        <React.Fragment>
            <WrPhoneActionBar visible={comparePlayerIds.length === 1} label="1 SELECTED"
                value={phonePickedName} tone="gold" actionLabel="ADD PLAYER"
                onAction={() => setSearchOpen(true)} onOpen={() => setSearchOpen(true)} />
            <WrPhoneSheet open={searchOpen} onClose={() => setSearchOpen(false)} title="Add player to compare" desktop={null}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 14px 4px' }}>
                    <input aria-label="Search players to compare" value={playerQuery} onChange={e => setPlayerQuery(e.target.value)}
                        placeholder={phoneAtMax ? 'Four players max — remove one to swap' : 'Search players by name…'}
                        disabled={phoneAtMax}
                        style={{ ...selectStyle, width: '100%', fontSize: '16px', opacity: phoneAtMax ? 0.5 : 1 }} />
                    {/* Position-group filter */}
                    <div className="wr-hscroll" style={{ display: 'flex', gap: '5px', overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: '2px' }}>
                        {['ALL', ...allPositions].map(pos => { const on = searchPos === pos, c = pos === 'ALL' ? 'var(--gold)' : (posColors[pos] || 'var(--silver)'); return <button key={pos} aria-pressed={on} onClick={() => setSearchPos(pos)} disabled={phoneAtMax} style={{ flex: 'none', minHeight: '38px', padding: '6px 11px', borderRadius: 'var(--card-radius-sm, 8px)', ...mono, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', cursor: 'pointer', whiteSpace: 'nowrap', color: on ? c : 'var(--silver)', background: on ? 'rgba(255,255,255,0.06)' : 'transparent', border: '1px solid ' + (on ? c : 'var(--ov-6, rgba(255,255,255,0.12))') }}>{pos === 'ALL' ? 'All pos' : posLabel(pos)}</button>; })}
                    </div>
                    {/* Owned-by-team filter */}
                    <select aria-label="Filter players by owning team" value={searchTeam} onChange={e => setSearchTeam(e.target.value)} disabled={phoneAtMax} style={{ ...selectStyle, width: '100%', fontSize: '16px' }}>
                        <option value="ALL">Any team — all rosters</option>
                        {searchTeams.map(t => <option key={t.rid} value={t.rid}>{t.name}</option>)}
                    </select>
                    {(searchPos !== 'ALL' || searchTeam !== 'ALL') ? (
                        <button type="button" onClick={() => { setSearchPos('ALL'); setSearchTeam('ALL'); }} style={{ ...smallButtonStyle(false), alignSelf: 'flex-start' }}>{'↺'} Clear filters</button>
                    ) : null}
                    {phoneSearchResults.map(r => (
                        <WrAssetRow key={r.pid} pos={r.pos} name={r.name} tag={r.team + (r.owner ? ' · ' + r.owner : ' · FA')}
                            slots={[{ label: valueShortLabel, value: r.dhq > 0 ? r.dhq.toLocaleString() : '—' }]}
                            onClick={() => { addComparePlayer(r.pid); setSearchOpen(false); }} />
                    ))}
                    {!phoneAtMax && playerQuery.trim().length < 2 && searchPos === 'ALL' && searchTeam === 'ALL' ? (
                        <div style={{ fontSize: isPhone ? '14px' : '0.78rem', color: 'var(--silver)', opacity: 0.6, padding: '6px 2px' }}>Search by name, or filter by position or team above.</div>
                    ) : null}
                    {!phoneAtMax && (playerQuery.trim().length >= 2 || searchPos !== 'ALL' || searchTeam !== 'ALL') && !phoneSearchResults.length ? (
                        <div style={{ fontSize: isPhone ? '14px' : '0.78rem', color: 'var(--silver)', opacity: 0.6, padding: '6px 2px' }}>No players match those filters.</div>
                    ) : null}
                </div>
            </WrPhoneSheet>
        </React.Fragment>
        ) : null}
      </div>
    );
}

window.CompareTab = CompareTab;
