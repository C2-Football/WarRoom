/* global module, globalThis */
// Bounded, read-only data queries for Alex-created views. No generated code,
// network requests, projections or unscoped global league data are evaluated.
(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) { root.WR = root.WR || {}; root.WR.DashboardViewData = api; }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';
    const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
    const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const own = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);
    const copy = value => JSON.parse(JSON.stringify(value));
    const fail = message => { throw new Error(message); };
    const COMMON = ['eq', 'neq', 'in', 'isMissing', 'isPresent'];
    const ORDERED = ['gt', 'gte', 'lt', 'lte'];
    const AGGREGATES = ['count', 'sum', 'avg', 'min', 'max'];
    function field(id, label, type, unit) {
        return { id, label, type, ...(unit ? { unit } : {}), operations: [...COMMON, ...(type === 'string' ? ['contains'] : type === 'number' || type === 'date' ? ORDERED : [])] };
    }
    const rosterFields = [
        field('playerId', 'Player ID', 'string'), field('name', 'Player', 'string'),
        field('position', 'Position', 'string'), field('nflTeam', 'NFL team', 'string'),
        field('age', 'Reported age', 'number', 'years'), field('slot', 'Roster slot', 'string'),
        field('teamId', 'Fantasy team ID', 'string'), field('teamName', 'Fantasy team', 'string'),
        field('gamesPlayed', 'Season games played', 'number', 'games'),
        field('fantasyPoints', 'Season league points', 'number', 'points'),
        field('ppg', 'Season points per game', 'number', 'points/game'),
    ];
    const SOURCES = [
        { id: 'roster', label: 'My roster', description: 'Your loaded roster and player metadata. Season points require a verified matching-season stats snapshot and use this league’s scoring.', fields: rosterFields, defaultColumns: ['name', 'position', 'nflTeam', 'age', 'slot'] },
        { id: 'leagueRoster', label: 'League rosters', description: 'Players on the loaded league rosters, including team ownership. One row per player and fantasy team; useful for position counts and age comparisons.', fields: rosterFields, defaultColumns: ['name', 'teamName', 'position', 'age'] },
        { id: 'standings', label: 'League records', description: 'Reported team records and points for. Rank uses win percentage then points for, with shared ranks for ties; it is not an official playoff-seeding forecast.', fields: [
            field('teamId', 'Fantasy team ID', 'string'), field('name', 'Fantasy team', 'string'),
            field('wins', 'Wins', 'number', 'games'), field('losses', 'Losses', 'number', 'games'), field('ties', 'Ties', 'number', 'games'),
            field('pointsFor', 'Points for', 'number', 'points'), field('winPct', 'Win percentage', 'number', 'percent'),
            field('rank', 'Record / points-for rank', 'number'), field('isMine', 'My team', 'boolean'),
        ], defaultColumns: ['name', 'wins', 'losses', 'ties', 'pointsFor'] },
        { id: 'transactions', label: 'Loaded league activity', description: 'The activity already loaded for this league, usually up to 50 recent transactions. This may include an older trade and is not a complete season history. Counts describe this loaded sample only.', fields: [
            field('transactionId', 'Transaction ID', 'string'), field('type', 'Activity type', 'string'), field('status', 'Status', 'string'),
            field('createdAt', 'Created at', 'date'), field('week', 'Week', 'number', 'week'), field('teams', 'Teams involved', 'string'),
            field('playersAdded', 'Players added', 'number', 'players'), field('playersDropped', 'Players dropped', 'number', 'players'),
            field('picksMoved', 'Picks moved', 'number', 'picks'),
        ], defaultColumns: ['createdAt', 'type', 'teams', 'playersAdded', 'playersDropped'] },
    ];
    function catalog() { return copy(SOURCES); }
    function sourceFor(id) { return SOURCES.find(source => source.id === id); }
    function fieldFor(source, id) { return source.fields.find(item => item.id === id); }
    function keysOnly(value, keys, message) {
        if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) fail(message);
    }
    function validDateString(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return false;
        const day = value.slice(0, 10), calendar = new Date(day + 'T00:00:00.000Z');
        // Date.parse normalizes impossible days (for example February 30).
        return Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 10) === day && Number.isFinite(Date.parse(value));
    }
    function validValue(value, definition) {
        if (definition.type === 'number') return numeric(value) !== null;
        if (definition.type === 'boolean') return typeof value === 'boolean';
        if (definition.type === 'date') return validDateString(value);
        return typeof value === 'string' && value.length <= 300;
    }
    function resultFields(query, source) {
        if (!query.aggregate) return source.fields;
        const original = query.aggregate.field && fieldFor(source, query.aggregate.field);
        const label = query.aggregate.op === 'count' ? (original ? 'Count of ' + original.label.toLowerCase() : 'Count') : ({ sum: 'Total', avg: 'Average', min: 'Lowest', max: 'Highest' })[query.aggregate.op] + ' ' + original.label.toLowerCase();
        return [...(query.groupBy ? [fieldFor(source, query.groupBy)] : []), field('value', label, 'number', query.aggregate.op === 'count' ? 'count' : original?.unit)];
    }
    function validateQuery(input) {
        keysOnly(input, ['source', 'columns', 'filters', 'sort', 'limit', 'groupBy', 'aggregate'], 'This data view contains unsupported query settings.');
        const source = sourceFor(input.source);
        if (!source) fail('Choose a connected dataset for this view.');
        const query = { source: source.id };
        if (input.groupBy != null) {
            if (!fieldFor(source, input.groupBy) || !input.aggregate) fail('Grouping needs a supported field and an aggregate.');
            query.groupBy = input.groupBy;
        }
        if (input.aggregate != null) {
            keysOnly(input.aggregate, ['field', 'op'], 'Choose a supported aggregate.');
            const operation = input.aggregate.op, definition = fieldFor(source, input.aggregate.field);
            if (!AGGREGATES.includes(operation) || (input.aggregate.field != null && !definition) || (operation !== 'count' && definition?.type !== 'number')) fail('This aggregate is not supported for that field.');
            query.aggregate = { op: operation, ...(definition ? { field: definition.id } : {}) };
        }
        const outputFields = resultFields(query, source);
        const columns = input.columns == null ? (query.aggregate ? outputFields.map(item => item.id) : source.defaultColumns) : input.columns;
        if (!Array.isArray(columns) || columns.length < 1 || columns.length > 12 || new Set(columns).size !== columns.length || columns.some(id => !outputFields.some(item => item.id === id))) fail('Choose up to 12 different fields from this dataset.');
        query.columns = columns.slice();
        if (input.filters != null) {
            if (!Array.isArray(input.filters) || input.filters.length > 12) fail('A view can contain up to 12 filters.');
            query.filters = input.filters.map(filter => {
                keysOnly(filter, ['field', 'op', 'value'], 'This view contains an unsupported filter.');
                const definition = fieldFor(source, filter.field);
                if (!definition || !definition.operations.includes(filter.op)) fail('This filter is not supported for that field.');
                if (['isMissing', 'isPresent'].includes(filter.op)) {
                    if (own(filter, 'value') && filter.value != null) fail('Missing-value filters do not take a value.');
                    return { field: definition.id, op: filter.op };
                }
                if (filter.op === 'in') {
                    if (!Array.isArray(filter.value) || !filter.value.length || filter.value.length > 30 || filter.value.some(value => !validValue(value, definition))) fail('Choose values of the correct type for this filter.');
                } else if (!validValue(filter.value, definition)) fail('Choose a value of the correct type for this filter.');
                return { field: definition.id, op: filter.op, value: copy(filter.value) };
            });
        }
        if (input.sort != null) {
            keysOnly(input.sort, ['field', 'direction'], 'Choose a supported sort.');
            if (!outputFields.some(item => item.id === input.sort.field) || !['asc', 'desc'].includes(input.sort.direction)) fail('Choose a supported field and direction to sort.');
            query.sort = { field: input.sort.field, direction: input.sort.direction };
        }
        if (input.limit != null && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)) fail('A view can display between 1 and 100 rows.');
        query.limit = input.limit ?? 50;
        return query;
    }
    function fieldsFor(input) {
        const query = validateQuery(input), fields = resultFields(query, sourceFor(query.source));
        return query.columns.map(key => copy(fields.find(item => item.id === key)));
    }
    function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
    function id(value) { return value == null ? null : String(value); }
    function ownerName(roster, context) {
        const user = context.currentLeague?.users?.find(row => id(row.user_id) === id(roster?.owner_id));
        let name = text(roster?.metadata?.team_name) || text(user?.metadata?.team_name);
        if (!name && typeof context.getOwnerName === 'function') {
            try { name = text(context.getOwnerName(roster?.roster_id)); } catch (_) { /* use source metadata */ }
            if (name === 'Unknown') name = null;
        }
        return name || text(user?.display_name) || text(user?.username) || (roster?.roster_id != null ? 'Team ' + roster.roster_id : null);
    }
    function statsSnapshot(context) {
        const snapshot = context.statsSnapshot, season = context.currentLeague?.season;
        // Plain statsData may be from the time-travel selector or previous season.
        if (!plain(snapshot) || season == null || String(snapshot.season) !== String(season) || snapshot.week != null || !plain(snapshot.statsByPid)) return null;
        if (snapshot.seasonType != null && !['regular', 'regular_season'].includes(snapshot.seasonType)) return null;
        return snapshot;
    }
    function playerRows(context, wholeLeague) {
        const league = context.currentLeague || {}, rosters = wholeLeague ? league.rosters : context.myRoster ? [context.myRoster] : null;
        if (!Array.isArray(rosters)) return { unavailable: true, rows: [], note: wholeLeague ? 'League rosters have not loaded.' : 'Choose your team to use roster data.' };
        if (rosters.some(roster => !Array.isArray(roster?.players))) return { unavailable: true, rows: [], note: 'Player lists have not loaded for these rosters.' };
        const snapshot = statsSnapshot(context), scorer = context.leagueStats || root.App?.LeagueStats;
        const hasScoring = plain(league.scoring_settings) && Object.values(league.scoring_settings).some(value => numeric(value) !== null);
        const rows = [];
        let projectedAges = false;
        rosters.forEach(roster => {
            const membership = key => Array.isArray(roster[key]) ? new Set(roster[key].map(String)) : null;
            const starters = membership('starters'), reserve = membership('reserve'), taxi = membership('taxi');
            const seen = new Set();
            roster.players.forEach(rawId => {
                const playerId = id(rawId);
                if (!playerId || playerId === '0' || seen.has(playerId)) return;
                seen.add(playerId);
                const player = own(context.playersData, playerId) ? context.playersData[playerId] || {} : {};
                if (player._projected === true) projectedAges = true;
                let name = text(player.full_name) || text([player.first_name, player.last_name].filter(Boolean).join(' '));
                if (!name && typeof context.getPlayerName === 'function') { try { name = text(context.getPlayerName(playerId)); } catch (_) { /* ID remains visible */ } }
                const position = text(player.position), raw = snapshot && own(snapshot.statsByPid, playerId) ? snapshot.statsByPid[playerId] : null;
                const gamesPlayed = numeric(raw?.gp), cleanRaw = plain(raw) ? Object.fromEntries(Object.entries(raw).filter(([, value]) => numeric(value) !== null)) : null;
                const hasStats = cleanRaw && Object.keys(cleanRaw).some(key => !['gp', 'season', 'week', 'player_id', 'team_id', 'game_id', 'season_type'].includes(key));
                let fantasyPoints = null;
                if (hasStats && hasScoring && typeof scorer?.score === 'function') {
                    try { fantasyPoints = numeric(scorer.score(cleanRaw, league.scoring_settings, position)); } catch (_) { /* no guessed scoring fallback */ }
                }
                const slot = reserve?.has(playerId) ? 'IR' : taxi?.has(playerId) ? 'Taxi' : starters?.has(playerId) ? 'Starter' : starters ? 'Bench' : null;
                rows.push({ playerId, name: name || 'Player ' + playerId, position, nflTeam: text(player.team), age: player._projected === true ? null : numeric(player.age), slot,
                    teamId: id(roster.roster_id), teamName: ownerName(roster, context), gamesPlayed: gamesPlayed !== null && gamesPlayed >= 0 ? gamesPlayed : null,
                    fantasyPoints, ppg: fantasyPoints !== null && gamesPlayed > 0 ? fantasyPoints / gamesPlayed : null });
            });
        });
        return { rows, updatedAt: snapshot?.updatedAt, statsAvailable: !!snapshot, scoringAvailable: !!snapshot && typeof scorer?.score === 'function' && hasScoring, projectedAges };
    }
    function standingRows(context) {
        const rosters = context.currentLeague?.rosters;
        if (!Array.isArray(rosters)) return { unavailable: true, rows: [], note: 'League records have not loaded.' };
        const rows = rosters.filter(roster => roster?.roster_id != null).map(roster => {
            const record = roster.settings || {}, nonNegative = value => numeric(value) !== null && value >= 0 ? value : null;
            const wins = nonNegative(record.wins), losses = nonNegative(record.losses), ties = nonNegative(record.ties);
            const played = [wins, losses, ties].every(value => value !== null) ? wins + losses + ties : null;
            const integer = numeric(record.fpts), decimal = numeric(record.fpts_decimal);
            return { teamId: id(roster.roster_id), name: ownerName(roster, context), wins, losses, ties,
                pointsFor: integer === null ? null : integer + (decimal ?? 0) / 100,
                winPct: played > 0 ? (wins + ties / 2) / played * 100 : null, rank: null,
                isMine: context.myRoster?.roster_id != null && id(roster.roster_id) === id(context.myRoster.roster_id) };
        });
        // Unknown team records or tiebreak data can change every ordinal rank.
        if (rows.length && rows.every(row => row.winPct !== null && row.pointsFor !== null)) {
            rows.sort((a, b) => b.winPct - a.winPct || b.pointsFor - a.pointsFor);
            rows.forEach((row, index) => { const previous = rows[index - 1]; row.rank = previous && previous.winPct === row.winPct && previous.pointsFor === row.pointsFor ? previous.rank : index + 1; });
        }
        return { rows, note: 'Rank compares win percentage, then points for. League-specific playoff tiebreakers may differ.' };
    }
    function isoDate(value) {
        if (typeof value !== 'string' && numeric(value) === null) return null;
        if (typeof value === 'string' && !validDateString(value)) return null;
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date.toISOString() : null;
    }
    function transactionRows(context) {
        if (!Array.isArray(context.transactions)) return { unavailable: true, rows: [], note: 'League activity has not loaded.' };
        const seen = new Set(), rows = [];
        context.transactions.forEach(transaction => {
            if (!plain(transaction)) return;
            const transactionId = id(transaction.transaction_id ?? transaction.id);
            if (transactionId != null && seen.has(transactionId)) return;
            if (transactionId != null) seen.add(transactionId);
            const teams = Array.isArray(transaction.roster_ids) ? transaction.roster_ids.map(rosterId => {
                const roster = context.currentLeague?.rosters?.find(row => id(row.roster_id) === id(rosterId));
                return ownerName(roster || { roster_id: rosterId }, context);
            }).filter(Boolean).join(', ') : null;
            const count = value => plain(value) ? Object.keys(value).length : null;
            rows.push({ transactionId, type: text(transaction.type), status: text(transaction.status), createdAt: isoDate(transaction.created),
                week: numeric(transaction.leg) ?? numeric(transaction.week), teams: teams || null,
                playersAdded: count(transaction.adds), playersDropped: count(transaction.drops), picksMoved: Array.isArray(transaction.draft_picks) ? transaction.draft_picks.length : null });
        });
        return { rows, note: 'Loaded activity only; this is not a complete season history. Missing asset details remain unavailable.' };
    }
    function comparable(value, definition) { return definition.type === 'date' ? Date.parse(value) : typeof value === 'string' ? value.toLowerCase() : value; }
    function matches(row, filter, source) {
        const actual = row[filter.field];
        if (filter.op === 'isMissing') return actual == null;
        if (filter.op === 'isPresent') return actual != null;
        if (actual == null) return false;
        const definition = fieldFor(source, filter.field), left = comparable(actual, definition), right = comparable(filter.value, definition);
        switch (filter.op) {
        case 'eq': return left === right;
        case 'neq': return left !== right;
        case 'in': return filter.value.some(value => left === comparable(value, definition));
        case 'contains': return left.includes(right);
        case 'gt': return left > right;
        case 'gte': return left >= right;
        case 'lt': return left < right;
        case 'lte': return left <= right;
        default: return false;
        }
    }
    function aggregateRows(rows, query) {
        const groups = new Map();
        if (!query.groupBy) groups.set(null, rows);
        else rows.forEach(row => { const key = row[query.groupBy] ?? null; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); });
        return Array.from(groups, ([group, members]) => {
            const { field: key, op } = query.aggregate, values = key ? members.map(row => row[key]).filter(value => value != null) : [];
            let value = null;
            if (op === 'count') value = key ? values.length : members.length;
            else if (values.length) {
                const total = values.reduce((sum, item) => sum + item, 0);
                value = op === 'sum' ? total : op === 'avg' ? total / values.length : values.reduce((best, item) => op === 'min' ? Math.min(best, item) : Math.max(best, item));
            }
            return { ...(query.groupBy ? { [query.groupBy]: group } : {}), value: numeric(value) };
        });
    }
    function resolve(input, context = {}) {
        let query;
        try { query = validateQuery(input); }
        catch (error) { return { status: 'invalid', rows: [], fields: [], source: null, note: error.message }; }
        const source = sourceFor(query.source), allFields = resultFields(query, source), fields = query.columns.map(key => copy(allFields.find(item => item.id === key)));
        const provenance = { id: source.id, label: source.label, ...(context.currentLeague?.season != null ? { season: String(context.currentLeague.season) } : {}) };
        const dataset = query.source === 'roster' || query.source === 'leagueRoster' ? playerRows(context, query.source === 'leagueRoster') : query.source === 'standings' ? standingRows(context) : transactionRows(context);
        const response = { status: 'ready', rows: [], fields, source: provenance };
        if (dataset.note) response.note = dataset.note;
        if (dataset.updatedAt != null) response.updatedAt = dataset.updatedAt;
        if (dataset.unavailable) return { ...response, status: 'unavailable' };
        if (['roster', 'leagueRoster'].includes(query.source)) {
            const unavailable = [...(!dataset.statsAvailable ? ['gamesPlayed'] : []), ...(!dataset.scoringAvailable ? ['fantasyPoints', 'ppg'] : []), ...(dataset.projectedAges ? ['age'] : [])];
            const operations = [...(query.filters || []).map(filter => filter.field), query.sort?.field, query.aggregate?.field, query.groupBy];
            const missing = [...query.columns, ...operations].filter(key => unavailable.includes(key));
            if (missing.length) {
                response.note = [
                    missing.some(key => key !== 'age') && 'Season scoring is unavailable until matching-season statistics and league scoring are verified.',
                    missing.includes('age') && 'Reported ages are unavailable while only projected player metadata is loaded.',
                    'Other roster details remain available.',
                ].filter(Boolean).join(' ');
                // Missing whole-source data is not a negative result: a filter,
                // count or sort cannot confidently operate on an unloaded metric.
                if (operations.some(key => unavailable.includes(key)) || query.columns.every(key => unavailable.includes(key))) return { ...response, status: 'unavailable' };
            }
        }
        let rows = dataset.rows.filter(row => (query.filters || []).every(filter => matches(row, filter, source)));
        if (query.aggregate && query.aggregate.op !== 'count') {
            const missing = rows.filter(row => row[query.aggregate.field] == null).length;
            if (missing) {
                const label = fieldFor(source, query.aggregate.field).label.toLowerCase();
                const note = 'Calculated from reported values; ' + missing + ' missing ' + label + ' value' + (missing === 1 ? ' was' : 's were') + ' excluded.';
                response.note = [response.note, note].filter(Boolean).join(' ');
            }
        }
        if (query.aggregate) rows = aggregateRows(rows, query);
        if (query.sort) {
            const definition = allFields.find(item => item.id === query.sort.field), direction = query.sort.direction === 'asc' ? 1 : -1;
            rows.sort((a, b) => {
                const left = a[definition.id], right = b[definition.id];
                if (left == null || right == null) return left == null && right == null ? 0 : left == null ? 1 : -1;
                const first = comparable(left, definition), second = comparable(right, definition);
                return (first < second ? -1 : first > second ? 1 : 0) * direction;
            });
        }
        response.rows = rows.slice(0, query.limit).map(row => Object.fromEntries(query.columns.map(key => [key, row[key] ?? null])));
        response.status = response.rows.length ? 'ready' : 'empty';
        return response;
    }
    return { catalog, validate: validateQuery, validateQuery, fieldsFor, resolve };
});
