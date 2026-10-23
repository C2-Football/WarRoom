/* global module, globalThis */
// Read-only, typed evidence for generated lenses. The model selects data; it
// cannot supply URLs, executable expressions, credentials or arbitrary fetches.
(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.WR = root.WR || {}; root.WR.LensData = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';
    const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
    const own = (x, k) => x != null && Object.prototype.hasOwnProperty.call(x, k);
    const number = x => typeof x === 'number' && Number.isFinite(x) ? x : null;
    const id = x => x == null ? null : String(x);
    const text = x => typeof x === 'string' && x.trim() ? x.trim().slice(0, 300) : null;
    const clone = x => JSON.parse(JSON.stringify(x));
    const fail = message => { throw Error(message); };
    const base = 'https://api.sleeper.app/v1/';
    const leagueId = l => id(l?.league_id || l?.id);
    const field = (id, label, type = 'number', unit) => ({ id, label, type, ...(unit ? { unit } : {}) });
    const str = (id, label) => field(id, label, 'string');
    const playerFields = [str('playerId', 'Player ID'), str('name', 'Player'), str('position', 'Position'), str('nflTeam', 'NFL team'), field('age', 'Reported age', 'number', 'years'), str('injuryStatus', 'Reported injury status'), str('slot', 'Roster slot'), str('teamId', 'Fantasy team ID'), str('teamName', 'Fantasy team'), field('isMine', 'My team', 'boolean'), field('gamesPlayed', 'Games played', 'number', 'games'), field('fantasyPoints', 'League fantasy points', 'number', 'points'), field('ppg', 'Points per game', 'number', 'points/game'), field('value', 'Scoped DHQ dynasty value', 'number', 'DHQ'), field('positionRank', 'Position rank by observed season PPG')];
    const teamFields = [str('teamId', 'Fantasy team ID'), str('name', 'Fantasy team'), field('wins', 'Wins'), field('losses', 'Losses'), field('ties', 'Ties'), field('pointsFor', 'Points for', 'number', 'points'), field('winPct', 'Win percentage', 'number', 'percent'), field('rank', 'Record / points-for rank'), field('isMine', 'My team', 'boolean')];
    const statsFields = [str('season', 'Season'), field('week', 'Week'), field('passingYards', 'Passing yards'), field('passingTDs', 'Passing touchdowns'), field('rushingYards', 'Rushing yards'), field('rushingTDs', 'Rushing touchdowns'), field('receptions', 'Receptions'), field('targets', 'Receiving targets'), field('receivingYards', 'Receiving yards'), field('receivingTDs', 'Receiving touchdowns'), field('tackles', 'Total tackles'), field('sacks', 'Sacks'), field('interceptions', 'Defensive interceptions')];
    const sources = [
        { id: 'roster', label: 'My roster', description: 'Your verified roster, current player metadata and observed season stats. Missing fields stay unknown.', fields: playerFields, params: ['leagueId', 'season'] },
        { id: 'leagueRoster', label: 'League rosters', description: 'One row per player and fantasy team. Season stats use the selected league scoring.', fields: playerFields, params: ['leagueId', 'season'] },
        { id: 'standings', label: 'League records', description: 'Reported records; rank uses win percentage then points for, not official playoff seeding.', fields: teamFields, params: ['leagueId', 'season'] },
        { id: 'tradeTargets', label: 'Players and their fantasy teams', description: 'Other teams’ players joined to their teams’ records, rank and points. Filter teamWinPct below 50 for losing teams, then compare PPG, position rank or available DHQ value. Does not establish willingness to trade.', fields: [...playerFields, field('teamWins', 'Team wins'), field('teamLosses', 'Team losses'), field('teamTies', 'Team ties'), field('teamWinPct', 'Team win percentage', 'number', 'percent'), field('teamRank', 'Team record / points-for rank'), field('teamPointsFor', 'Team points for', 'number', 'points'), str('teamRecord', 'Team record')], params: ['leagueId', 'season'] },
        { id: 'playerStats', label: 'NFL season player statistics', description: 'Reported NFL player statistics scored for this league. Includes rostered players and free agents.', fields: [...playerFields, ...statsFields], params: ['leagueId', 'season'] },
        { id: 'weeklyPlayerStats', label: 'NFL weekly player statistics', description: 'Reported player statistics for one explicit regular-season week.', fields: [...playerFields, ...statsFields], params: ['leagueId', 'season', 'week'] },
        { id: 'gameLogs', label: 'Player weekly history', description: 'One known player’s reported weekly stats. Missing weeks remain unknown, including bye weeks.', fields: [...playerFields, ...statsFields], params: ['leagueId', 'season', 'playerId', 'weeks'] },
        { id: 'transactions', label: 'Loaded league transactions', description: 'Only the transactions already loaded for this league; not guaranteed to be a complete season.', fields: [str('transactionId', 'Transaction ID'), str('type', 'Activity type'), str('status', 'Status'), field('createdAt', 'Created at', 'date'), field('week', 'Week'), str('teams', 'Teams involved'), field('playersAdded', 'Players added'), field('playersDropped', 'Players dropped'), field('picksMoved', 'Picks moved')], params: ['leagueId', 'season'] },
        { id: 'matchups', label: 'Fantasy matchup scores', description: 'League-scored team totals and opponents for an explicit week; scores may still be live.', fields: [str('season', 'Season'), field('week', 'Week'), str('teamId', 'Team ID'), str('teamName', 'Fantasy team'), str('opponentTeamId', 'Opponent team ID'), str('opponentName', 'Opponent'), str('matchupId', 'Matchup ID'), field('points', 'Team points', 'number', 'points'), field('opponentPoints', 'Opponent points', 'number', 'points'), field('isMine', 'My team', 'boolean')], params: ['leagueId', 'season', 'week'] },
        { id: 'draftPicks', label: 'Observed draft selections', description: 'Recorded selections in the verified primary draft for this league season; not future pick ownership.', fields: [str('season', 'Season'), str('draftId', 'Draft ID'), field('round', 'Round'), field('pickNumber', 'Overall pick'), str('playerId', 'Player ID'), str('name', 'Player'), str('position', 'Position'), str('teamId', 'Receiving roster ID'), str('teamName', 'Receiving team')], params: ['leagueId', 'season'] },
        { id: 'leagueHistory', label: 'Linked league season records', description: 'Team season records from verified linked previous seasons; uses each season’s own owner and scoring. Archive coverage may be incomplete.', fields: [str('leagueId', 'Season league ID'), str('season', 'Season'), str('ownerId', 'Owner account ID'), ...teamFields], params: ['leagueId', 'season'] },
        { id: 'portfolio', label: 'Connected league overview', description: 'Your explicitly connected leagues and verified teams. Coverage reflects loaded leagues, not every possible account league.', fields: [str('leagueId', 'League ID'), str('leagueName', 'League'), str('season', 'Season'), str('platform', 'Platform'), str('teamId', 'My roster ID'), str('teamName', 'My team'), field('rosterSize', 'Rostered players'), field('wins', 'Wins'), field('losses', 'Losses'), field('ties', 'Ties'), field('pointsFor', 'Points for', 'number', 'points'), field('winPct', 'Win percentage', 'number', 'percent')], params: [] },
    ];
    sources.forEach(source => { source.defaultColumns = source.fields.slice(0, 24).map(f => f.id); });
    const definition = source => sources.find(s => s.id === source);
    function catalog() { return clone(sources).map(s => ({ ...s, filters: ['eq', 'neq', 'in', 'contains', 'gt', 'gte', 'lt', 'lte', 'isMissing', 'isPresent'], maxRows: 200 })); }
    function keys(value, allowed, label) { if (!plain(value) || Object.keys(value).some(k => !allowed.includes(k))) fail('Unsupported ' + label + '.'); }
    function date(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return false;
        const n = new Date(value), day = new Date(value.slice(0, 10) + 'T00:00:00Z');
        return Number.isFinite(n.getTime()) && Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value.slice(0, 10);
    }
    const validValue = (value, f) => f.type === 'number' ? number(value) !== null : f.type === 'boolean' ? typeof value === 'boolean' : f.type === 'date' ? date(value) : typeof value === 'string' && value.length <= 300;
    function validateNeeds(needs) {
        if (!Array.isArray(needs) || !needs.length || needs.length > 6) fail('Choose between one and six datasets.');
        const ids = new Set();
        return needs.map(input => {
            keys(input, ['id', 'source', 'columns', 'filters', 'sort', 'limit', 'params'], 'dataset query');
            if (typeof input.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(input.id) || ['constructor', 'prototype', '__proto__'].includes(input.id) || ids.has(input.id)) fail('Dataset IDs must be unique simple names.');
            ids.add(input.id);
            const source = definition(input.source); if (!source) fail('Choose a connected dataset.');
            const columns = input.columns ?? source.defaultColumns;
            if (!Array.isArray(columns) || !columns.length || columns.length > 24 || new Set(columns).size !== columns.length || columns.some(c => !source.fields.some(f => f.id === c))) fail('Choose up to 24 fields from the dataset catalog.');
            const filters = input.filters ?? [];
            if (!Array.isArray(filters) || filters.length > 12) fail('Use up to twelve filters.');
            filters.forEach(filter => {
                keys(filter, ['field', 'op', 'value'], 'filter');
                const f = source.fields.find(f => f.id === filter.field);
                if (!f || !['eq', 'neq', 'in', 'isMissing', 'isPresent', ...(f.type === 'string' ? ['contains'] : []), ...(['number', 'date'].includes(f.type) ? ['gt', 'gte', 'lt', 'lte'] : [])].includes(filter.op)) fail('Choose a typed filter from the dataset catalog.');
                if (['isMissing', 'isPresent'].includes(filter.op)) { if (filter.value != null) fail('Missing-value filters do not take a value.'); }
                else if (filter.op === 'in') { if (!Array.isArray(filter.value) || !filter.value.length || filter.value.length > 30 || filter.value.some(v => !validValue(v, f))) fail('Invalid filter values.'); }
                else if (!validValue(filter.value, f)) fail('Invalid filter value.');
            });
            if (input.sort != null) { keys(input.sort, ['field', 'direction'], 'sort'); if (!source.fields.some(f => f.id === input.sort.field) || !['asc', 'desc'].includes(input.sort.direction)) fail('Choose a field and sort direction.'); }
            const limit = input.limit ?? 100; if (!Number.isInteger(limit) || limit < 1 || limit > 200) fail('A dataset can display up to 200 rows.');
            const params = input.params ?? {}; keys(params, source.params, 'dataset parameters');
            if (params.leagueId != null && (typeof params.leagueId !== 'string' || !params.leagueId.length || params.leagueId.length > 100)) fail('Invalid league ID.');
            if (params.season != null && !/^\d{4}$/.test(String(params.season))) fail('Choose a valid season.');
            const validWeek = w => Number.isInteger(w) && w >= 1 && w <= 18;
            if (params.week != null && !validWeek(params.week)) fail('Choose a regular-season week from 1 to 18.');
            if (params.weeks != null && (!Array.isArray(params.weeks) || !params.weeks.length || params.weeks.length > 18 || new Set(params.weeks).size !== params.weeks.length || params.weeks.some(w => !validWeek(w)))) fail('Choose up to eighteen different weeks.');
            if (params.playerId != null && (typeof params.playerId !== 'string' || !params.playerId.length || params.playerId.length > 80)) fail('Invalid player ID.');
            if (input.source === 'weeklyPlayerStats' && params.week == null) fail('Weekly player stats need an explicit week.');
            if (input.source === 'matchups' && params.week == null) fail('Matchups need an explicit week.');
            if (input.source === 'gameLogs' && (!params.playerId || !params.weeks)) fail('Game logs need a known player and explicit weeks.');
            return clone({ ...input, columns, filters, limit, params });
        });
    }
    function ownerName(roster, league, context) {
        const user = (league.users || []).find(u => id(u.user_id) === id(roster?.owner_id));
        let fallback = null;
        if (leagueId(league) === leagueId(context.currentLeague) && typeof context.getOwnerName === 'function') { try { fallback = text(context.getOwnerName(roster.roster_id)); } catch (_) { /* source metadata below */ } }
        return text(roster?.metadata?.team_name) || text(user?.metadata?.team_name) || (fallback !== 'Unknown' ? fallback : null) || text(user?.display_name) || text(user?.username) || (roster?.roster_id != null ? 'Team ' + roster.roster_id : null);
    }
    function myRoster(league, context) {
        if (leagueId(league) === leagueId(context.currentLeague)) return (league.rosters || []).find(r => id(r.roster_id) === id(context.myRoster?.roster_id)) || null;
        const owner = context.myRoster?.owner_id;
        return (league.rosters || []).find(r => (league.myRosterId != null && id(r.roster_id) === id(league.myRosterId)) || (league.myUserId != null && id(r.owner_id) === id(league.myUserId)) || (isSleeper(league) && isSleeper(context.currentLeague || {}) && owner != null && id(r.owner_id) === id(owner))) || null;
    }
    function standings(league, context) {
        if (!Array.isArray(league.rosters)) fail('League records have not loaded.');
        const mine = myRoster(league, context);
        const rows = league.rosters.map(r => {
            const s = r.settings || {}, positive = v => number(v) !== null && v >= 0 ? v : null;
            const wins = positive(s.wins), losses = positive(s.losses), ties = positive(s.ties), played = [wins, losses, ties].every(x => x !== null) ? wins + losses + ties : null;
            return { teamId: id(r.roster_id), name: ownerName(r, league, context), wins, losses, ties, pointsFor: number(s.fpts) === null ? null : s.fpts + (number(s.fpts_decimal) ?? 0) / 100, winPct: played > 0 ? (wins + ties / 2) / played * 100 : null, rank: null, isMine: mine ? id(r.roster_id) === id(mine.roster_id) : null };
        });
        if (rows.length && rows.every(r => r.winPct !== null && r.pointsFor !== null)) {
            const sorted = rows.slice().sort((a, b) => b.winPct - a.winPct || b.pointsFor - a.pointsFor);
            sorted.forEach((r, i) => { const prev = sorted[i - 1]; r.rank = prev && prev.winPct === r.winPct && prev.pointsFor === r.pointsFor ? prev.rank : i + 1; });
        }
        return rows;
    }
    function isSleeper(league) {
        const p = league._platform || league.platform || league.provider || league._source || 'sleeper';
        return p === 'sleeper' && !league._espn && !league._mfl && !league._yahoo && !/^(espn|mfl|yahoo|demo|manual)_/.test(leagueId(league) || '');
    }
    function player(pid, roster, league, context, snapshot, scorer) {
        const p = own(context.playersData, pid) ? context.playersData[pid] || {} : {};
        const raw = snapshot?.statsByPid?.[pid], clean = plain(raw) ? Object.fromEntries(Object.entries(raw).filter(([, v]) => number(v) !== null)) : null;
        const hasStats = clean && Object.keys(clean).some(k => !['gp', 'season', 'week', 'player_id', 'team_id', 'game_id', 'season_type'].includes(k));
        const scoring = league.scoring_settings, hasScoring = plain(scoring) && Object.values(scoring).some(v => number(v) !== null);
        const points = hasStats && hasScoring && typeof scorer?.score === 'function' ? number(scorer.score(clean, scoring, p.position)) : null;
        const gp = number(raw?.gp), gamesPlayed = gp !== null && gp >= 0 ? gp : null;
        let name = text(p.full_name) || text([p.first_name, p.last_name].filter(Boolean).join(' '));
        if (!name && typeof context.getPlayerName === 'function') { try { name = text(context.getPlayerName(pid)); } catch (_) { /* use ID */ } }
        const mine = myRoster(league, context), membership = key => Array.isArray(roster?.[key]) && roster[key].map(String).includes(pid);
        const li = root.App?.LI;
        const valueKnown = root.App?.LI_LOADED === true && id(li?.sourceLeagueId) === leagueId(league) && (!li.sourceSeason || String(li.sourceSeason) === String(league.season)) && p._projected !== true;
        const values = li?._baseScoresBackup || li?.playerScores;
        return { playerId: pid, name: name || 'Player ' + pid, position: text(p.position), nflTeam: text(p.team), age: p._projected === true ? null : number(p.age), injuryStatus: text(p.injury_status), slot: membership('reserve') ? 'IR' : membership('taxi') ? 'Taxi' : membership('starters') ? 'Starter' : Array.isArray(roster?.starters) ? 'Bench' : null, teamId: id(roster?.roster_id), teamName: roster ? ownerName(roster, league, context) : null, isMine: roster && mine ? id(roster.roster_id) === id(mine.roster_id) : roster ? null : false, gamesPlayed, fantasyPoints: points, ppg: points !== null && gamesPlayed > 0 ? points / gamesPlayed : null, value: valueKnown && own(values, pid) ? number(values[pid]) : null, positionRank: null };
    }
    function observedStats(raw) {
        const n = key => number(raw?.[key]);
        const solo = n('idp_tkl_solo') ?? n('tkl_solo'), assist = n('idp_tkl_ast') ?? n('tkl_ast');
        return { passingYards: n('pass_yd'), passingTDs: n('pass_td'), rushingYards: n('rush_yd'), rushingTDs: n('rush_td'), receptions: n('rec'), targets: n('rec_tgt'), receivingYards: n('rec_yd'), receivingTDs: n('rec_td'), tackles: n('idp_tkl') ?? n('tkl') ?? (solo !== null && assist !== null ? solo + assist : null), sacks: n('idp_sack') ?? n('sack'), interceptions: n('idp_int') ?? n('int') };
    }
    function iso(value) { const d = value == null ? null : new Date(value); return d && Number.isFinite(d.getTime()) ? d.toISOString() : null; }
    function queryRows(rows, query, warn) {
        const required = query.filters.filter(f => !['isMissing', 'isPresent'].includes(f.op)).map(f => f.field);
        if (rows.length && required.some(key => rows.every(r => r[key] == null))) fail('The requested comparison needs a field that is unavailable in this snapshot.');
        const unknownFilters = rows.filter(row => required.some(key => row[key] == null)).length;
        if (unknownFilters) warn(`${unknownFilters} rows have unknown comparison fields and cannot be confirmed as matching these filters.`);
        const missingSort = rows.length && query.sort && rows.every(r => r[query.sort.field] == null);
        if (missingSort) warn('Requested ranking is unavailable; rows retain source order.');
        else if (query.sort) { const unknown = rows.filter(row => row[query.sort.field] == null).length; if (unknown) warn(`${unknown} rows have no reported ranking value and appear after known values when they match the filters.`); }
        let result = rows.filter(row => query.filters.every(f => {
            let v = row[f.field];
            if (f.op === 'isMissing') return v == null;
            if (f.op === 'isPresent') return v != null;
            if (v == null) return false;
            const isDate = definition(query.source).fields.find(field => field.id === f.field)?.type === 'date';
            if (f.op === 'in') return isDate ? f.value.some(value => Date.parse(value) === Date.parse(v)) : f.value.includes(v);
            if (f.op === 'contains') return v.toLowerCase().includes(f.value.toLowerCase());
            const expected = isDate ? Date.parse(f.value) : f.value; if (isDate) v = Date.parse(v);
            return ({ eq: () => v === expected, neq: () => v !== expected, gt: () => v > expected, gte: () => v >= expected, lt: () => v < expected, lte: () => v <= expected })[f.op]();
        }));
        if (query.sort && !missingSort) { const { field, direction } = query.sort; result = result.slice().sort((a, b) => a[field] == null ? b[field] == null ? 0 : 1 : b[field] == null ? -1 : (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0) * (direction === 'asc' ? 1 : -1)); }
        return result.slice(0, query.limit).map(row => Object.fromEntries(query.columns.map(key => [key, row[key] ?? null])));
    }
    async function resolve(needs, context = {}) {
        const queries = validateNeeds(needs), result = { datasets: [], sources: [], warnings: [] }, evidenceKeys = new Map();
        let rowBytesRemaining = 300000;
        const initialLeague = leagueId(context.currentLeague), initialSeason = String(context.currentLeague?.season || '');
        const initialOwner = root.App?.AccountStorage?.owner?.() ?? null;
        function check() {
            if (context.signal?.aborted || context.isCurrent?.() === false || (root.App?.AccountStorage?.owner?.() ?? null) !== initialOwner || leagueId(context.currentLeague) !== initialLeague || String(context.currentLeague?.season || '') !== initialSeason) { const e = Error('Lens loading was interrupted because its account or league changed.'); e.name = 'AbortError'; throw e; }
        }
        check();
        const allowed = [...new Map([context.currentLeague, ...(Array.isArray(context.allowedLeagues) ? context.allowedLeagues : [])].filter(l => leagueId(l)).map(l => [leagueId(l), l])).values()];
        // Explicit current context wins over a lighter portfolio stub.
        if (context.currentLeague && initialLeague) { const i = allowed.findIndex(l => leagueId(l) === initialLeague); allowed[i] = context.currentLeague; }
        const statsLoads = new Map(), scorer = context.leagueStats || root.App?.LeagueStats;
        async function stats(league, week) {
            const season = String(league.season), snapshot = context.statsSnapshot;
            if (snapshot && String(snapshot.season) === season && (snapshot.week ?? null) === (week ?? null) && plain(snapshot.statsByPid) && (!snapshot.seasonType || ['regular', 'regular_season'].includes(snapshot.seasonType))) return snapshot;
            if (!/^\d{4}$/.test(season) || typeof scorer?.load !== 'function') fail('Observed statistics are unavailable.');
            const key = season + '|' + (week ?? 'season');
            if (!statsLoads.has(key)) statsLoads.set(key, Promise.resolve().then(() => { check(); return scorer.load({ season, ...(week ? { week } : {}) }); }));
            const loaded = await statsLoads.get(key); check();
            if (!loaded || String(loaded.season) !== season || (loaded.week ?? null) !== (week ?? null) || !plain(loaded.statsByPid) || (loaded.seasonType != null && !['regular', 'regular_season'].includes(loaded.seasonType))) fail('Statistics returned a different season or week.');
            return loaded;
        }
        async function json(path, league) {
            check(); if (!isSleeper(league)) fail('This source is currently available for Sleeper leagues only.');
            if (typeof root.fetch !== 'function') fail('The data connection is unavailable.');
            const controller = new root.AbortController(), abort = () => controller.abort();
            context.signal?.addEventListener('abort', abort, { once: true });
            const timer = root.setTimeout(abort, 15000);
            try {
                const response = await root.fetch(base + path, { signal: controller.signal, cache: 'no-store' }); check();
                if (!response.ok) fail('The requested source could not load.');
                const value = await response.json(); check(); return value;
            } finally { root.clearTimeout(timer); context.signal?.removeEventListener('abort', abort); }
        }
        function evidence(title, league, suffix, asOf, note) {
            const key = [leagueId(league) || 'portfolio', suffix || title].join(':');
            if (!evidenceKeys.has(key)) {
                if (result.sources.length >= 40) fail('This lens reaches the source limit; narrow its league or history scope.');
                const sourceId = 'source_' + (result.sources.length + 1); evidenceKeys.set(key, sourceId);
                result.sources.push({ id: sourceId, title, ...(suffix && isSleeper(league) ? { url: base + suffix } : {}), asOf: iso(asOf), note: note || '' });
            }
            return evidenceKeys.get(key);
        }
        for (const query of queries) {
            check(); const spec = definition(query.source), sourceIds = []; let rows = [], note = '', asOf = null, status = 'ready';
            try {
                const league = query.source === 'portfolio' ? context.currentLeague : allowed.find(l => leagueId(l) === (query.params.leagueId || initialLeague));
                if (query.source !== 'portfolio' && !league) fail('This league is not in the connected league scope.');
                if (query.params.season != null && String(query.params.season) !== String(league.season)) fail('Choose the connected league for that season.');
                const lid = leagueId(league), season = String(league?.season || ''), mine = league ? myRoster(league, context) : null;
                if (['roster', 'leagueRoster', 'tradeTargets', 'playerStats', 'weeklyPlayerStats', 'gameLogs'].includes(query.source)) {
                    if (!plain(context.playersData)) fail('Player metadata has not loaded.');
                    if (['roster', 'tradeTargets'].includes(query.source) && !mine) fail('Choose your verified team before using this source.');
                    if (!Array.isArray(league.rosters) || league.rosters.some(r => !Array.isArray(r.players))) fail('League player lists have not loaded.');
                    let snapshot = null;
                    if (query.source !== 'gameLogs') {
                        try { snapshot = await stats(league, query.source === 'weeklyPlayerStats' ? query.params.week : null); }
                        catch (error) { check(); if (['playerStats', 'weeklyPlayerStats'].includes(query.source)) throw error; note = 'Season statistics are unavailable; missing performance fields remain unknown. '; }
                    }
                    check(); asOf = snapshot?.updatedAt;
                    const owners = new Map(); league.rosters.forEach(r => r.players.forEach(pid => { const key = id(pid); if (!owners.has(key)) owners.set(key, r); }));
                    if (query.source === 'gameLogs') {
                        const pid = query.params.playerId;
                        if (!own(context.playersData, pid) && !owners.has(pid)) fail('Choose a known player for game logs.');
                        let reportedWeeks = 0;
                        for (const week of query.params.weeks.slice().sort((a, b) => a - b)) {
                            let snap = null; try { snap = await stats(league, week); } catch (_) { check(); note = 'Some requested weeks are unavailable; unknown weeks are not zero-point games.'; }
                            check(); if (snap?.updatedAt) asOf = asOf ? Math.min(asOf, snap.updatedAt) : snap.updatedAt;
                            if (plain(snap?.statsByPid?.[pid])) reportedWeeks++;
                            rows.push({ ...player(pid, owners.get(pid), league, context, snap, scorer), ...observedStats(snap?.statsByPid?.[pid]), season, week });
                            sourceIds.push(evidence('Sleeper observed weekly statistics', league, `stats/nfl/regular/${season}/${week}`, snap?.updatedAt, 'League-scored NFL statistics; missing weekly appearances stay unknown.'));
                        }
                        if (!reportedWeeks) fail('No requested week has reported statistics for this player. Missing weeks are not zero-point games.');
                    } else if (['playerStats', 'weeklyPlayerStats'].includes(query.source)) {
                        rows = Object.keys(snapshot.statsByPid).filter(pid => !pid.startsWith('TEAM_')).map(pid => ({ ...player(pid, owners.get(pid), league, context, snapshot, scorer), ...observedStats(snapshot.statsByPid[pid]), season, week: query.params.week ?? null }));
                    } else {
                        const rosters = query.source === 'roster' ? [mine] : league.rosters;
                        rosters.forEach(r => [...new Set(r.players.map(String))].filter(pid => pid && pid !== '0').forEach(pid => rows.push(player(pid, r, league, context, snapshot, scorer))));
                    }
                    if (snapshot && query.source !== 'weeklyPlayerStats') {
                        const ranks = new Map(), byPosition = new Map();
                        Object.keys(snapshot.statsByPid).filter(pid => !pid.startsWith('TEAM_')).forEach(pid => { const row = player(pid, null, league, context, snapshot, scorer); if (row.position && row.ppg !== null) { if (!byPosition.has(row.position)) byPosition.set(row.position, []); byPosition.get(row.position).push(row); } });
                        byPosition.forEach(group => { group.sort((a, b) => b.ppg - a.ppg); group.forEach((row, i) => ranks.set(row.playerId, i && row.ppg === group[i - 1].ppg ? ranks.get(group[i - 1].playerId) : i + 1)); });
                        rows.forEach(r => { r.positionRank = ranks.get(r.playerId) ?? null; });
                    }
                    if (query.source === 'tradeTargets') {
                        const teams = new Map(standings(league, context).map(r => [r.teamId, r]));
                        rows = rows.filter(r => r.isMine === false).map(r => { const t = teams.get(r.teamId); return { ...r, teamWins: t?.wins, teamLosses: t?.losses, teamTies: t?.ties, teamWinPct: t?.winPct, teamRank: t?.rank, teamPointsFor: t?.pointsFor, teamRecord: t && [t.wins, t.losses, t.ties].every(v => v !== null) ? `${t.wins}-${t.losses}${t.ties ? '-' + t.ties : ''}` : null }; });
                        note += 'Other teams only. Team rank compares win percentage then points for. These records do not establish an owner’s willingness to trade. ';
                    }
                    note += 'Position rank compares reported season PPG among players with known positions. DHQ values appear only when scoped league evidence is loaded. Injury metadata may be stale.';
                    sourceIds.push(evidence('Loaded league rosters and player metadata', league, isSleeper(league) ? `league/${encodeURIComponent(lid)}/rosters` : null, null, 'Current loaded ownership; player metadata is cached.'));
                    if (snapshot) sourceIds.push(evidence('Sleeper observed player statistics', league, `stats/nfl/regular/${season}${query.params.week ? '/' + query.params.week : ''}`, snapshot.updatedAt, 'Fantasy points use the selected league scoring rules.'));
                    if (rows.some(r => r.value !== null)) sourceIds.push(evidence('DHQ league valuation snapshot', league, null, null, 'Model dynasty values, not market prices or owner asking prices.'));
                } else if (query.source === 'standings') {
                    rows = standings(league, context); note = 'Rank compares win percentage then points for; league-specific playoff seeding may differ.';
                    sourceIds.push(evidence('Loaded league records', league, `league/${encodeURIComponent(lid)}/rosters`, null, note));
                } else if (query.source === 'transactions') {
                    const txns = lid === initialLeague ? context.transactions : league.transactions;
                    if (!Array.isArray(txns)) fail('Transactions have not loaded for this league.');
                    const seen = new Set(); rows = txns.filter(t => plain(t) && (t.transaction_id == null || !seen.has(id(t.transaction_id)) && seen.add(id(t.transaction_id)))).map(t => ({ transactionId: id(t.transaction_id ?? t.id), type: text(t.type), status: text(t.status), createdAt: iso(t.created ?? t.status_updated), week: number(t.leg ?? t.week), teams: Array.isArray(t.roster_ids) ? t.roster_ids.map(rid => ownerName(league.rosters?.find(r => id(r.roster_id) === id(rid)) || { roster_id: rid }, league, context)).join(', ') : null, playersAdded: plain(t.adds) ? Object.keys(t.adds).length : null, playersDropped: plain(t.drops) ? Object.keys(t.drops).length : null, picksMoved: Array.isArray(t.draft_picks) ? t.draft_picks.length : null }));
                    note = 'Loaded transaction sample only; missing activity does not establish no activity.'; sourceIds.push(evidence('Loaded league transaction sample', league, null, null, note));
                } else if (query.source === 'matchups') {
                    const week = query.params.week, raw = await json(`league/${encodeURIComponent(lid)}/matchups/${week}`, league);
                    if (!Array.isArray(raw) || !raw.length || raw.some(r => r?.roster_id == null) || new Set(raw.map(r => id(r.roster_id))).size !== raw.length || (league.rosters?.length && league.rosters.some(r => !raw.some(x => id(x.roster_id) === id(r.roster_id))))) fail('The matchup feed is incomplete.');
                    const points = r => number(r?.custom_points) ?? number(r?.points);
                    rows = raw.map(r => { const rivals = r.matchup_id == null ? [] : raw.filter(o => id(o.roster_id) !== id(r.roster_id) && id(o.matchup_id) === id(r.matchup_id)); const opp = rivals.length === 1 ? rivals[0] : null; const name = row => row ? ownerName(league.rosters?.find(t => id(t.roster_id) === id(row.roster_id)) || row, league, context) : null; return { season, week, teamId: id(r.roster_id), teamName: name(r), opponentTeamId: id(opp?.roster_id), opponentName: name(opp), matchupId: id(r.matchup_id), points: points(r), opponentPoints: points(opp), isMine: mine ? id(mine.roster_id) === id(r.roster_id) : null }; });
                    asOf = Date.now(); note = 'Reported league-scored totals; current-week scores can change. An unmatched roster does not establish a bye.'; sourceIds.push(evidence('Sleeper matchup scores', league, `league/${encodeURIComponent(lid)}/matchups/${week}`, asOf, note));
                } else if (query.source === 'draftPicks') {
                    const drafts = await json(`league/${encodeURIComponent(lid)}/drafts`, league);
                    if (!Array.isArray(drafts)) fail('Draft metadata is unavailable.');
                    const candidates = drafts.filter(d => String(d.season) === season && (!d.league_id || id(d.league_id) === lid));
                    const draft = candidates.find(d => id(d.draft_id) === id(league.draft_id)) || (candidates.length === 1 ? candidates[0] : null);
                    if (!draft?.draft_id) fail('A single primary draft could not be verified.');
                    const picks = await json(`draft/${encodeURIComponent(draft.draft_id)}/picks`, league); if (!Array.isArray(picks)) fail('Draft selections are unavailable.');
                    rows = picks.map(p => { const roster = league.rosters?.find(r => id(r.roster_id) === id(p.roster_id)); const meta = context.playersData?.[p.player_id] || p.metadata || {}; return { season, draftId: id(draft.draft_id), round: number(p.round), pickNumber: number(p.pick_no), playerId: id(p.player_id), name: text(meta.full_name) || text([meta.first_name, meta.last_name].filter(Boolean).join(' ')), position: text(meta.position), teamId: id(p.roster_id), teamName: roster ? ownerName(roster, league, context) : null }; });
                    asOf = Date.now(); note = 'Observed draft selections; receiving roster is not necessarily the selecting account or current owner.'; sourceIds.push(evidence('Sleeper draft selections', league, `draft/${encodeURIComponent(draft.draft_id)}/picks`, asOf, note));
                } else if (query.source === 'leagueHistory') {
                    if (!isSleeper(league) || typeof root.WrWireStories?.loadArchive !== 'function') fail('Linked season history is unavailable for this connection.');
                    const archive = await root.WrWireStories.loadArchive({ league, signal: context.signal }); check();
                    if (!Array.isArray(archive?.seasons)) fail('Linked season history is unavailable.');
                    for (const entry of archive.seasons) {
                        const historical = entry.league; if (!historical || !/^\d{4}$/.test(String(historical.season)) || Number(historical.season) >= Number(season)) continue;
                        rows.push(...standings(historical, context).map(r => ({ ...r, leagueId: leagueId(historical), season: String(historical.season), ownerId: id(historical.rosters?.find(o => id(o.roster_id) === r.teamId)?.owner_id) })));
                        sourceIds.push(evidence('Linked season records: ' + historical.season, historical, `league/${encodeURIComponent(leagueId(historical))}/rosters`, archive.at, 'Each season uses its reported owner IDs and records.'));
                    }
                    asOf = archive.at; note = archive.complete ? 'Verified linked previous seasons only; current season excluded.' : 'History is incomplete. ' + (text(archive.reason) || 'Results cover loaded previous seasons only.');
                    if (!archive.complete) result.warnings.push(note);
                    if (!rows.length && !archive.complete) fail(note);
                } else if (query.source === 'portfolio') {
                    if (!Array.isArray(context.allowedLeagues)) fail('Connected portfolio scope has not been supplied.');
                    rows = allowed.map(l => { const mine = myRoster(l, context), record = Array.isArray(l.rosters) ? standings(l, context).find(r => r.teamId === id(mine?.roster_id)) : null; return { leagueId: leagueId(l), leagueName: text(l.name), season: String(l.season || ''), platform: text(l._platform || l.platform || (l._mfl ? 'mfl' : l._espn ? 'espn' : l._yahoo ? 'yahoo' : 'sleeper')), teamId: id(mine?.roster_id), teamName: mine ? ownerName(mine, l, context) : null, rosterSize: Array.isArray(mine?.players) ? new Set(mine.players.filter(p => p && id(p) !== '0').map(String)).size : null, wins: record?.wins ?? null, losses: record?.losses ?? null, ties: record?.ties ?? null, pointsFor: record?.pointsFor ?? null, winPct: record?.winPct ?? null }; });
                    note = 'Only explicitly connected, loaded leagues are included; unknown team ownership remains blank.';
                    if (context.portfolioCoverage && (context.portfolioCoverage.complete === false || context.portfolioCoverage.staleCount > 0 || context.portfolioCoverage.knownCount > rows.length)) { note += ' Portfolio coverage is incomplete or stale.'; result.warnings.push(note); }
                    sourceIds.push(evidence('Connected league portfolio', league, null, null, note));
                }
                check(); rows = queryRows(rows, query, warning => { note += ' ' + warning; result.warnings.push(query.id + ': ' + warning); });
                const bounded = []; let truncated = false;
                for (const row of rows) { const bytes = JSON.stringify(row).length; if (bytes > rowBytesRemaining) { truncated = true; break; } rowBytesRemaining -= bytes; bounded.push(row); }
                if (truncated) { note += ' Rows were limited to keep the saved lens responsive.'; result.warnings.push(query.id + ': Snapshot row limit reached.'); }
                if (rows.length && !bounded.length) fail('The saved lens has reached its data limit. Request fewer rows.');
                rows = bounded; status = rows.length ? 'ready' : 'empty';
            } catch (error) {
                check(); status = 'unavailable'; rows = []; note = text(error?.message) || 'This dataset is unavailable.';
                result.warnings.push(query.id + ': ' + note);
            }
            const dataset = { id: query.id, source: query.source, fields: query.columns.map(key => clone(spec.fields.find(f => f.id === key))), rows, status, note, asOf: iso(asOf), sourceIds: [...new Set(sourceIds)] };
            result.datasets.push(dataset); check(); context.onProgress?.(clone(dataset));
        }
        // Snapshots are per request, at most six datasets of two hundred rows.
        // No account data or result cache survives this invocation.
        result.warnings = [...new Set(result.warnings)].slice(0, 20); check(); return result;
    }
    return { catalog, validateNeeds, resolve };
});
