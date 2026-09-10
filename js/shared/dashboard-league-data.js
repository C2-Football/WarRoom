// Read-only projections of league records, scored matchups and Cup state for
// dashboard cards. Missing data is never a zero or an invented tournament.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
    const idOf = roster => roster?.roster_id == null ? null : String(roster.roster_id);
    function owner(id, getOwnerName, league) {
        let label;
        try { label = getOwnerName?.(/^\d+$/.test(String(id)) ? Number(id) : id); } catch (_) { /* use league data */ }
        if (label) return label;
        const roster = league?.rosters?.find(r => idOf(r) === String(id));
        const user = league?.users?.find(u => String(u.user_id) === String(roster?.owner_id));
        return user?.metadata?.team_name || user?.display_name || user?.username || 'Team ' + id;
    }
    function standings(opts) {
        const { league, myRoster, getOwnerName } = opts || {}, myId = idOf(myRoster);
        const rows = (league?.rosters || []).filter(r => r.roster_id != null).map(roster => {
            const record = roster.settings || {}, id = idOf(roster);
            const wins = numeric(record.wins), losses = numeric(record.losses), ties = numeric(record.ties);
            const complete = [wins, losses, ties].every(n => n !== null && n >= 0);
            const played = complete ? wins + losses + ties : null;
            const pf = numeric(record.fpts) === null ? null : record.fpts + (numeric(record.fpts_decimal) ?? 0) / 100;
            return { id, name: owner(id, getOwnerName, league), wins, losses, ties, pf, played, winPct: played > 0 ? (wins + ties / 2) / played : null, rank: null, isMine: id === myId };
        });
        const compare = (a, b) => a.winPct === null && b.winPct === null ? 0 : a.winPct === null ? 1 : b.winPct === null ? -1 : b.winPct - a.winPct || (a.pf === null && b.pf === null ? 0 : a.pf === null ? 1 : b.pf === null ? -1 : b.pf - a.pf);
        rows.sort(compare);
        let previous = null;
        rows.forEach((row, index) => {
            if (row.winPct === null) return;
            row.rank = previous && compare(row, previous) === 0 ? previous.rank : index + 1;
            previous = row;
        });
        return { rows, mine: rows.find(r => r.isMine) || null, hasResults: rows.some(r => r.played > 0) };
    }
    const freshness = live => ({ status: live?.status || 'idle', updatedAt: live?.updatedAt ?? null, error: live?.error || null, week: live?.week ?? null });
    function matchups(opts) {
        const { live, myRoster, getOwnerName } = opts || {}, myId = idOf(myRoster);
        const groups = (live?.groups || []).map((group, index) => {
            const teams = (group.teams || []).map(row => {
                const id = idOf(row), points = numeric(row.custom_points) ?? numeric(row.points);
                return { id, name: owner(id, getOwnerName), points, isMine: id === myId };
            });
            const complete = teams.length >= 2 && teams.every(t => t.points !== null);
            return { id: String(group.key ?? group.matchupId ?? index), teams, complete, scoresAvailable: complete, margin: teams.length === 2 && complete ? Math.abs(teams[0].points - teams[1].points) : null };
        });
        const closeGames = groups.filter(g => g.margin !== null).slice().sort((a, b) => a.margin - b.margin);
        return { groups, mine: groups.find(g => g.teams.some(t => t.isMine)) || null, closeGames, ...freshness(live) };
    }
    function stats(opts) {
        const { live, playersData = {}, myRoster, getOwnerName } = opts || {}, myId = idOf(myRoster), players = new Map();
        (live?.rows || []).forEach(row => {
            const rosterId = idOf(row);
            Object.entries(row.players_points || {}).forEach(([pid, score]) => {
                if (pid === '0' || pid.startsWith('TEAM_') || numeric(score) === null) return;
                const metadata = playersData[pid] || {};
                if (!players.has(pid)) players.set(pid, {
                    pid, name: metadata.full_name || [metadata.first_name, metadata.last_name].filter(Boolean).join(' ') || pid,
                    position: App.LeagueStats?.normalizePosition(metadata.position) || metadata.position || '', team: metadata.team || '',
                    points: score, rosterIds: [], ownerNames: [], isMine: false, conflicting: false
                });
                const player = players.get(pid);
                if (player.points !== score) { player.points = null; player.conflicting = true; }
                if (!player.rosterIds.includes(rosterId)) { player.rosterIds.push(rosterId); player.ownerNames.push(owner(rosterId, getOwnerName)); }
                player.isMine = player.isMine || rosterId === myId;
            });
        });
        const leaders = Array.from(players.values()).filter(p => p.points !== null).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
        return { leaders, mine: leaders.find(p => p.isMine) || null, hasData: leaders.length > 0, ...freshness(live) };
    }
    function cup(opts) {
        const { state, myRoster, currentWeek, getOwnerName } = opts || {};
        if (!state) return null;
        const myId = idOf(myRoster), legacy = state.version !== 2, supplied = opts.engine || root.WoeppelCup;
        const engine = legacy ? (supplied?.tournament ? supplied : root.WoeppelCup) : supplied?.tournament || supplied;
        const base = { name: state.name || 'League Cup', format: legacy ? 'legacy' : state.format, status: 'active', champion: null, championId: null, nextWeek: null, myProgress: '', week: null, detail: '' };
        if (!engine) return { ...base, status: 'unavailable', detail: 'Tournament details are unavailable.' };
        const participants = legacy ? Object.values(state.groups || {}).flat() : state.teams || [];
        base.myProgress = participants.map(String).includes(myId) ? 'Still in contention' : 'Not entered';
        if (!state.locked) return { ...base, status: 'draft', detail: 'Tournament setup is not locked.', myProgress: participants.map(String).includes(myId) ? 'Entered in the draft field' : 'Not entered' };
        try {
            engine.validate(state);
            const schedule = legacy ? [6,7,8,9,10,11,15,16,17] : engine.schedule(state);
            let rounds = [], stages = [], result = null;
            if (state.format === 'survivor' && !legacy) {
                stages = engine.survivor(state); result = engine.result(state);
                const last = stages.at(-1);
                base.nextWeek = last?.final ? schedule.find(w => w > last.week) ?? null : last?.week ?? schedule[0];
                if (last?.pendingTie || last?.blocked && state.weeks?.[last.week]?.final) { base.status = 'blocked'; base.detail = last.reason || 'A survivor ruling is required.'; }
                const eliminated = stages.find(stage => stage.eliminated.includes(myId));
                if (eliminated) base.myProgress = 'Eliminated in Week ' + eliminated.week;
            } else {
                try { rounds = engine.knockout(state); }
                catch (e) {
                    base.detail = e.message;
                    if (!/Finalize/i.test(e.message)) base.status = 'blocked';
                }
                if (!legacy) result = engine.result(state);
                else {
                    const last = rounds.at(-1)?.[0];
                    if (rounds.length === 3 && rounds.at(-1).length === 1 && last?.winner) result = { champion: last.winner, week: last.week };
                }
                const unresolved = rounds.flat().find(m => !m.winner);
                base.nextWeek = unresolved?.week ?? schedule.find(w => !state.weeks?.[w]?.final) ?? null;
                if (unresolved && state.weeks?.[unresolved.week]?.final) { base.status = 'blocked'; base.detail = 'Week ' + unresolved.week + ' needs a tiebreak ruling or missing scores.'; }
                const loss = rounds.flat().find(m => m.winner && [m.a,m.b].map(String).includes(myId) && String(m.winner) !== myId);
                if (loss) base.myProgress = 'Knocked out in Week ' + loss.week;
                if (!rounds.length && participants.map(String).includes(myId)) {
                    try {
                        const table = engine.tables(state), row = (Array.isArray(table) ? table : Object.values(table).flat()).find(r => String(r.id) === myId);
                        if (row?.played) base.myProgress = row.points.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' qualifying points';
                    } catch (_) { /* preserve the reason above */ }
                }
                if (rounds.length && !rounds[0].some(m => [m.a,m.b].map(String).includes(myId)) && participants.map(String).includes(myId)) base.myProgress = 'Did not qualify';
            }
            if (result) return { ...base, status: 'complete', champion: owner(result.champion, getOwnerName), championId: String(result.champion), nextWeek: null, week: result.week, myProgress: String(result.champion) === myId ? 'Champion' : base.myProgress, detail: owner(result.champion, getOwnerName) + ' won the Cup.' };
            base.week = base.nextWeek;
            if (!base.detail) base.detail = base.nextWeek != null ? (Number(currentWeek) < base.nextWeek ? 'Next: Week ' : 'Awaiting finalized Week ') + base.nextWeek + ' results.' : 'Awaiting a commissioner ruling.';
            if (state.enabled === false) return { ...base, status: 'paused', detail: 'Tournament updates are paused.' };
            return base;
        } catch (e) { return { ...base, status: state.enabled === false ? 'paused' : 'blocked', detail: e.message || 'Tournament details need commissioner review.' }; }
    }
    const emptyCup = () => ({ status: 'idle', state: null, updatedAt: null, error: null, canManage: false });
    function createCupClient(options) {
        const env = options || {}, entries = new Map();
        const now = env.now || Date.now, schedule = env.setTimeout || root.setTimeout.bind(root), cancel = env.clearTimeout || root.clearTimeout.bind(root);
        const doc = env.document === undefined ? root.document : env.document, focus = env.focusTarget === undefined ? root : env.focusTarget;
        const invoke = env.invoke || (async body => {
            const db = App.OD?.getClient?.() || root.OD?.getClient?.();
            if (!db) throw Error('Sign in to view your league Cup.');
            return db.functions.invoke('league-cup', { body });
        });
        function entry(league) {
            const id = String(league.league_id || league.id), season = String(league.season), key = id + '|' + season;
            if (!entries.has(key)) entries.set(key, { id, season, value: emptyCup(), listeners: new Set(), pending: null, timer: null, attemptedAt: null });
            return entries.get(key);
        }
        const emit = e => e.listeners.forEach(fn => fn(e.value));
        function later(e) {
            if (e.timer !== null) cancel(e.timer); e.timer = null;
            if (e.listeners.size && !doc?.hidden) e.timer = schedule(() => { e.timer = null; refresh(e); }, 60000);
        }
        function refresh(e, force) {
            if (e.pending) return e.pending;
            if (!force && e.attemptedAt !== null && now() - e.attemptedAt < 30000) { later(e); return Promise.resolve(); }
            e.attemptedAt = now();
            e.value = { ...e.value, status: e.value.updatedAt === null ? 'loading' : 'refreshing', error: null }; emit(e);
            let timeout;
            e.pending = Promise.race([
                Promise.resolve().then(() => invoke({ action: 'load', leagueId: e.id, season: e.season })),
                new Promise((_, reject) => { timeout = schedule(() => reject(Error('Cup request timed out. Please refresh.')), 15000); })
            ]).then(response => {
                if (response?.error) throw Error(response.error.message || 'Cup could not be loaded.');
                const data = response?.data;
                if (data?.error) throw Error(data.error);
                if (!data || !Object.hasOwn(data, 'cup') || data.cup !== null && (!data.cup?.state || typeof data.cup.state !== 'object')) throw Error('The Cup response is unavailable. Please refresh.');
                e.value = { status: 'ready', state: data.cup?.state || null, updatedAt: now(), error: null, canManage: data.canManage === true };
            }).catch(error => { e.value = { ...e.value, status: e.value.updatedAt === null ? 'error' : 'stale', error: error.message || 'Cup could not be loaded.' }; })
                .finally(() => { cancel(timeout); e.pending = null; emit(e); later(e); });
            return e.pending;
        }
        return {
            subscribe(league, listener) {
                const e = entry(league); e.listeners.add(listener); listener(e.value);
                if (!doc?.hidden) refresh(e); else later(e);
                const wake = () => { if (doc?.hidden) { if (e.timer !== null) cancel(e.timer); e.timer = null; } else refresh(e); };
                doc?.addEventListener('visibilitychange', wake); focus?.addEventListener?.('focus', wake);
                return () => { e.listeners.delete(listener); doc?.removeEventListener('visibilitychange', wake); focus?.removeEventListener?.('focus', wake); if (!e.listeners.size) { if (e.timer !== null) cancel(e.timer); e.timer = null; } };
            },
            refresh(league) { return refresh(entry(league), true); }
        };
    }
    let cupClient;
    function useCup(opts) {
        const { league, enabled = true } = opts || {}, React = root.React;
        const supported = !!(league?.league_id || league?.id) && /^\d{4}$/.test(String(league?.season || ''));
        const key = String(league?.league_id || league?.id || '') + '|' + league?.season + '|' + enabled;
        const [result, setResult] = React.useState(() => ({ key, value: emptyCup() }));
        React.useEffect(() => {
            if (!enabled || !supported) return undefined;
            cupClient = cupClient || createCupClient(); let alive = true;
            const off = cupClient.subscribe(league, value => { if (alive) setResult({ key, value }); });
            return () => { alive = false; off(); };
        }, [key, supported]);
        const refresh = React.useCallback(() => {
            if (!enabled || !supported) return Promise.resolve();
            cupClient = cupClient || createCupClient(); return cupClient.refresh(league);
        }, [key, supported]);
        return { ...(result.key === key ? result.value : emptyCup()), ...(!supported ? { status: 'unsupported' } : !enabled ? { status: 'idle' } : {}), refresh };
    }
    App.DashboardLeagueData = { standings, matchups, stats, cup, createCupClient, useCup };
})(typeof window !== 'undefined' ? window : globalThis);
