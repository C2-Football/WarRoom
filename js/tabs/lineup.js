// ══════════════════════════════════════════════════════════════════
// js/tabs/lineup.js — LineupTab: weekly Start/Sit Command Center.
// Interactive lineup builder: one unified table where each starting slot
// is a row (assigned player + projection + matchup + rolling form), and
// tapping a slot reveals every eligible roster player so you can set it.
// Working totals + optimal delta update live. League-scored via
// App.WeeklyProj / App.StartSit; objective tilts by GM mode.
// NOTE: builds/compares your lineup IN-APP. MFL leagues can push the working
// lineup straight to MyFantasyLeague ("Submit to MFL"); Sleeper has no public
// lineup-write API, so Sleeper lineups are still set on the platform.
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

    // ── Game Day Central: DvP, season schedule rail, Alex note, MFL push ──
    const [seasonData, setSeasonData] = React.useState(null);
    const [note, setNote] = React.useState('');
    const [submit, setSubmit] = React.useState({ status: 'idle', msg: '' });
    const [isNarrow, setIsNarrow] = React.useState(typeof window !== 'undefined' && window.innerWidth <= 900);

    // Real DvP: spin up the SOS engine (18-week defense-vs-position rankings),
    // then bump ctxTick so projections recompute with matchup context applied.
    React.useEffect(() => {
        const SOS = window.App && window.App.SOS;
        if (!SOS || !SOS.initialize) return;
        let alive = true;
        SOS.initialize(currentLeague && currentLeague.season, playersData, () => { if (alive) setCtxTick(t => t + 1); });
        return () => { alive = false; };
    }, [lineupKey]);

    // Responsive: collapse the right rail beneath the main column when narrow.
    React.useEffect(() => {
        const onResize = () => setIsNarrow(window.innerWidth <= 900);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

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
        const curTotal = curIds.reduce((s, pid) => { const p = proj[pid]; return s + (p && p.available ? (p.points[result.objective] || 0) : 0); }, 0);
        const benchPts = Math.round((result.optimal.total - curTotal) * 10) / 10;
        let topStart = null;
        (result.delta && result.delta.startInstead || []).forEach(s => { if (!topStart || s.pts > topStart.pts) topStart = s; });
        let winPct = null, oppName = null, margin = null;
        const M = window.App && window.App.Matchup;
        if (M && oppResult && oppResult.res) {
            const oppOpt = oppResult.res.optimal.starters.map(s => s.pid);
            const fc = M.forecast(M.dist(curIds, proj, 'median'), M.dist(oppOpt, oppResult.res.projections, 'median'));
            winPct = fc.winPct; margin = fc.margin;
            const users = (currentLeague && currentLeague.users) || [];
            const u = users.find(x => String(x.user_id) === String(oppResult.roster.owner_id));
            oppName = (oppResult.roster.metadata && oppResult.roster.metadata.team_name) || (u && u.display_name) || ('Team ' + oppResult.roster.roster_id);
        }
        const injuries = curIds.map(pid => { const p = proj[pid]; const st = p && p.injuryStatus; return st ? { name: pmeta(pid).name, status: st } : null; }).filter(Boolean);
        const topName = topStart ? pmeta(topStart.pid).name : null;
        return {
            week: result.week, benchPts, topStart, topName, winPct, oppName, margin, injuries, mode: result.mode,
            ctx: { week: result.week, winPct, margin, opponent: oppName, pointsLeftOnBench: benchPts, topUpgrade: topName, topUpgradeSlot: topStart ? topStart.slot : null, injuries: injuries.map(i => i.name + ' (' + i.status + ')'), objective: result.objective, mode: result.mode },
        };
    }
    function seededNote(f) {
        const AV = window.AlexVoice;
        if (!AV) return '';
        const seed = (currentLeague && (currentLeague.league_id || currentLeague.id) || '') + '|w' + f.week;
        let lead;
        if (f.winPct != null && f.oppName) {
            if (f.winPct >= 62) lead = AV.pick(seed + 'a', ['You’re favored this week', 'The numbers like your side', 'You’ve got the edge this week']) + ' — about ' + f.winPct + '% to beat ' + f.oppName + '.';
            else if (f.winPct >= 45) lead = AV.pick(seed + 'a', ['Coin-flip week', 'This one’s tight', 'Dead heat']) + ' against ' + f.oppName + ' (~' + f.winPct + '%).';
            else lead = AV.pick(seed + 'a', ['Uphill week', 'You’re the underdog', 'Tough draw']) + ' vs ' + f.oppName + ' (~' + f.winPct + '%) — chase ceiling.';
        } else {
            lead = AV.pick(seed + 'a', ['Let’s set the week', 'Here’s your week', 'Locking in the lineup']) + '.';
        }
        let mid;
        if (f.benchPts >= 1 && f.topName) mid = ' ' + AV.pick(seed + 'b', ['You’re leaving ' + f.benchPts + ' on the bench', 'There’s ' + f.benchPts + ' sitting on your bench', f.benchPts + ' points are stranded on the bench']) + ' — ' + f.topName + (f.topStart && f.topStart.slot ? ' into your ' + String(f.topStart.slot).replace('_', ' ') : '') + ' is the move.';
        else mid = ' ' + AV.pick(seed + 'b', ['Lineup’s optimal', 'Nothing left on the table', 'Your best is already in']) + ' — no changes needed.';
        let tail = '';
        if (f.injuries && f.injuries.length) tail = ' ' + AV.pick(seed + 'c', ['Keep an eye on', 'Watch', 'Monitor']) + ' ' + AV.joinNatural(f.injuries.map(i => i.name)) + '.';
        return (lead + mid + tail).trim();
    }
    React.useEffect(() => {
        if (!_projReady) return;                 // wait for real projections (avoid a stale AI-note cache)
        const facts = buildNoteFacts();
        if (!facts) { setNote(''); return; }
        const seeded = seededNote(facts);
        setNote(seeded);
        let alive = true;
        const AV = window.AlexVoice;
        if (AV && AV.enhance) {
            // Bucket win% into the cache key so a materially different matchup
            // outlook re-generates rather than reusing an early note.
            const wpBucket = facts.winPct == null ? 'na' : Math.round(facts.winPct / 10);
            AV.enhance({
                type: 'start-sit',
                message: 'Give me a punchy 1-2 sentence game-day coaching note for my fantasy team this week. Are we favored? Any must-start upgrade sitting on the bench? Any injuries to watch? Natural prose, no lists, no sign-off.',
                context: JSON.stringify(facts.ctx),
                fallback: seeded,
                cacheKey: 'gd-note-' + lineupKey + '-w' + facts.week + '-' + wpBucket,
            }).then(txt => { if (alive && txt && typeof txt === 'string') setNote(txt); }).catch(() => {});
        }
        return () => { alive = false; };
    }, [lineupKey, ctxTick, oppRosterId, _projReady]);

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
            setSubmit({ status: 'error', msg: 'Fill all ' + startingSlots.length + ' starting slots first — ' + emptySlots.map(s => s.slotName.replace('_', ' ')).join(', ') + ' empty. Tap “Apply Optimal” to fill them. MFL benches anyone left out.' });
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
    // projections are ready, so the table starts full and the completeness guard
    // is satisfiable. (We can't show MFL's actual current starters — the rosters
    // export doesn't include them.)
    const _optReady = !!(result && result.optimal && result.optimal.starters && result.optimal.starters.length);
    React.useEffect(() => {
        if (!isMfl || !_optReady) return;
        if (Object.keys(currentAssign).length || Object.keys(workingAssign).length) return; // platform starters, or user already editing
        const byName = {};
        result.optimal.starters.forEach(s => { (byName[s.slot] = byName[s.slot] || []).push(s.pid); });
        const next = {};
        startingSlots.forEach(sl => { const arr = byName[sl.slotName]; if (arr && arr.length) next[sl.idx] = String(arr.shift()); });
        if (Object.keys(next).length) setWorkingAssign(next);
    }, [lineupKey, isMfl, _optReady]);

    // Tier gate — matches app.js: free during pre-live, STARTSIT_DEPTH at launch.
    const _preLiveFree = !!(window.App && window.App.EMPIRE_FREE_PRELIVE);
    const _hasGameDay = _preLiveFree || typeof window.canAccess !== 'function' || !window.FEATURES || window.canAccess(window.FEATURES.STARTSIT_DEPTH);
    if (!_hasGameDay) {
        return (
            <div style={{ maxWidth: '560px', margin: '0 auto', padding: '56px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.72rem', letterSpacing: '0.08em', color: 'var(--silver, #9aa0a6)', fontWeight: 600 }}>GAME DAY CENTRAL</div>
                <div style={{ fontSize: '1.3rem', color: 'var(--gold, #d4af37)', fontWeight: 700, margin: '10px 0' }}>Unlock your game-day command center</div>
                <div style={{ color: 'var(--silver, #9aa0a6)', lineHeight: 1.6, marginBottom: '18px' }}>Weekly start/sit optimizer with floor–ceiling bands and real matchup context, opponent breakdown, a full-season schedule with win projections, and one-tap lineup push to MFL.</div>
                <button onClick={() => { if (window.showProLaunchPage) window.showProLaunchPage(); else if (window.showUpgradePrompt) window.showUpgradePrompt(window.FEATURES.STARTSIT_DEPTH); }}
                    style={{ padding: '10px 20px', fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer', borderRadius: '6px', border: '1px solid var(--acc-line2, rgba(212,175,55,0.4))', background: 'rgba(212,175,55,0.12)', color: 'var(--gold, #d4af37)' }}>Upgrade to War Room</button>
            </div>
        );
    }

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

    // ── MFL lineup push card (write to MyFantasyLeague) ──
    function renderMflPush() {
        if (!isMfl) return null;
        const s = submit.status;
        const inputStyle = { flex: '1 1 130px', minWidth: 0, padding: '7px 10px', background: 'var(--charcoal, #0e0e12)', border: `1px solid ${LINE}`, borderRadius: '5px', color: TEXT, fontSize: '0.8rem' };
        return (
            <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', padding: '12px 16px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '0.66rem', letterSpacing: '0.07em', color: GOLD, fontWeight: 700 }}>PUSH LINEUP TO MFL</div>
                    {mflCookie ? <span onClick={mflDisconnect} style={{ fontSize: '0.62rem', color: SILVER, cursor: 'pointer' }}>● connected · disconnect</span> : null}
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
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', position: isNarrow ? 'static' : 'sticky', top: '16px' }}>
                <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', padding: '14px 16px' }}>
                    <div style={{ fontSize: '0.64rem', letterSpacing: '0.07em', color: SILVER, fontWeight: 600 }}>SEASON OUTLOOK</div>
                    {d && d.summary ? (
                        <React.Fragment>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '8px' }}>
                                <span style={{ fontSize: '1.5rem', fontWeight: 800, color: GOLD, fontVariantNumeric: 'tabular-nums' }}>{d.summary.projRecord}</span>
                                <span style={{ fontSize: '0.64rem', color: SILVER }}>proj record</span>
                            </div>
                            <div style={{ display: 'flex', gap: '16px', marginTop: '9px' }}>
                                <div><div style={{ fontSize: '0.6rem', color: SILVER, letterSpacing: '0.04em' }}>NOW</div><div style={{ fontWeight: 700, color: TEXT }}>{d.summary.record}</div></div>
                                <div><div style={{ fontSize: '0.6rem', color: SILVER, letterSpacing: '0.04em' }}>PROJ PF</div><div style={{ fontWeight: 700, color: TEXT, fontVariantNumeric: 'tabular-nums' }}>{d.summary.projPF}</div></div>
                                {d.summary.winPct != null ? <div><div style={{ fontSize: '0.6rem', color: SILVER, letterSpacing: '0.04em' }}>WIN%</div><div style={{ fontWeight: 700, color: TEXT }}>{d.summary.winPct}%</div></div> : null}
                            </div>
                        </React.Fragment>
                    ) : <div style={{ color: SILVER, fontSize: '0.74rem', marginTop: '8px', opacity: 0.7 }}>Projecting your season…</div>}
                </div>
                <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', overflow: 'hidden' }}>
                    <div style={{ padding: '9px 14px', borderBottom: `1px solid ${LINE}`, fontSize: '0.64rem', letterSpacing: '0.07em', color: SILVER, fontWeight: 600 }}>SCHEDULE</div>
                    {d && d.weeks ? d.weeks.map(w => {
                        const wp = w.winPct;
                        const color = w.result ? (w.result === 'W' ? GREEN : w.result === 'L' ? RED : SILVER) : (wp == null ? SILVER : wp >= 55 ? GREEN : wp <= 45 ? RED : GOLD);
                        return (
                            <div key={w.week} style={{ display: 'grid', gridTemplateColumns: '26px 1fr 52px', gap: '8px', alignItems: 'center', padding: '6px 14px', borderBottom: `1px solid ${LINE}`, background: w.isCurrent ? 'var(--acc-fill2, rgba(212,175,55,0.08))' : 'transparent' }}>
                                <span style={{ fontSize: '0.62rem', color: w.isCurrent ? GOLD : SILVER, fontWeight: 700 }}>W{w.week}</span>
                                <span style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: '0.74rem', color: (w.isPast && !w.result) ? SILVER : TEXT }}>{w.bye ? <span style={{ color: SILVER, opacity: 0.6 }}>bye</span> : w.oppName}</span>
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

    return (
        <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '20px 16px 60px' }}>
            {/* Alex's game-day note */}
            {note ? (
                <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderLeft: `3px solid ${GOLD}`, borderRadius: '6px', padding: '12px 16px', marginBottom: '14px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.08em', color: GOLD, marginTop: '3px', whiteSpace: 'nowrap' }}>ALEX ·</span>
                    <span style={{ fontSize: '0.86rem', color: TEXT, lineHeight: 1.5 }}>{note}</span>
                </div>
            ) : null}

            <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : '1fr 300px', gap: '16px', alignItems: 'start' }}>
                <div style={{ minWidth: 0 }}>
                    {renderMflPush()}
                    {/* Hero — Your lineup vs Optimal */}
                    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', padding: '18px 20px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                        <div style={{ fontSize: '0.72rem', letterSpacing: '0.08em', color: SILVER, fontWeight: 600 }}>WEEK {result.week} · GAME DAY CENTRAL</div>
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
                Projections are league-scored from role, recent form{objective !== 'median' ? `, your ${result.mode.replace('_', '-')} strategy` : ''}, matchup and defense-vs-position; form columns are actual weekly points over the chosen window. Build and compare here{isMfl ? ' — then push straight to MFL above' : ' — set the final lineup on your platform'}.
            </div>
                </div>
                <div style={{ order: isNarrow ? 3 : 0 }}>{renderRail()}</div>
            </div>
        </div>
    );
}

window.LineupTab = LineupTab;
