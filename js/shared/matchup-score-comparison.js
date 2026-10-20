// Read-only submitted-lineup review. No scores, forecasts, or plans are written.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const finite = value => typeof value === 'number' && Number.isFinite(value);
    const number = value => finite(value) ? value : null;
    const pidOf = value => value != null && String(value) !== '' && String(value) !== '0' ? String(value) : null;
    const started = state => ['live', 'final', 'locked'].includes(state);
    const bench = new Set(['BN', 'BE', 'BENCH', 'IR', 'TAXI', 'RES', 'RESERVE']);
    const sum = values => values.length && values.every(finite) ? values.reduce((total, value) => total + value, 0) : null;
    const gap = (actual, baseline) => finite(actual) && finite(baseline) ? Math.round((actual - baseline) * 100) / 100 : null;
    const tone = (actual, baseline, complete) => {
        if (!complete || !finite(actual) || !finite(baseline)) return 'neutral';
        const delta = actual - baseline, band = Math.max(Math.abs(baseline) * .2, 1);
        return delta > band ? 'strong' : delta < -band ? 'quiet' : 'typical';
    };
    const normSlot = value => {
        const slot = String(value || 'START').trim().toUpperCase();
        return ({ 'D/ST': 'DEF', DST: 'DEF', PK: 'K', SUPERFLEX: 'SUPER_FLEX', 'WR/RB/TE': 'FLEX', 'W/R/T': 'FLEX', 'WR/TE': 'REC_FLEX', 'W/T': 'REC_FLEX', 'Q/W/R/T': 'SUPER_FLEX', OP: 'SUPER_FLEX' })[slot] || slot;
    };
    const kindOf = kinds => {
        const meaningful = kinds.filter(kind => kind !== 'empty');
        if (!meaningful.length) return 'empty';
        return meaningful.every(kind => kind === meaningful[0]) ? meaningful[0] : 'mixed';
    };
    const projectionLabel = kind => ({ pregame: 'Saved pregame', 'first-view': 'Saved first view', current: 'Current estimate', missing: 'Unavailable', empty: 'Empty slot', mixed: 'Mixed estimate sources' })[kind] || 'Unavailable';
    const matchesScope = (scope, league, week) => !scope || (
        (scope.leagueId == null || String(scope.leagueId) === String(league?.league_id || league?.id || ''))
        && (scope.season == null || Number(scope.season) === Number(league?.season))
        && (scope.week == null || Number(scope.week) === Number(week)));

    function build(options = {}) {
        const { league = {}, myRosterId, scoreStatus, scoreError, scoresSupported, gamesFresh,
            forecasts = {}, projections = {}, currentSeason, currentWeek } = options;
        const week = Number(options.week), season = Number(league.season);
        const phase = finite(Number(currentSeason)) && finite(Number(currentWeek))
            ? season > Number(currentSeason) || (season === Number(currentSeason) && week > Number(currentWeek)) ? 'future'
                : season < Number(currentSeason) || week < Number(currentWeek) ? 'past' : 'current'
            : 'unknown';
        const scoresReady = scoresSupported === true && scoreStatus === 'ready' && !scoreError;
        const fresh = scoresReady && gamesFresh === true;
        const status = scoresSupported !== true ? 'unsupported' : scoreError || scoreStatus === 'stale' || scoreStatus === 'error' ? 'stale' : scoreStatus || 'idle';
        const freshness = fresh ? 'fresh' : status === 'stale' ? 'stale' : status === 'refreshing' ? 'updating' : 'unverified';
        const empty = reason => ({ available: false, reason, hasStarted: false, allFinal: false,
            headerLabel: 'Matchup unavailable', status, freshness, ready: fresh, scoresReady, gamesFresh: gamesFresh === true, phase,
            sourceNote: 'Submitted matchup scores are unavailable.', totalMine: null, totalTheirs: null,
            projectedMine: null, projectedTheirs: null, baselineMine: null, baselineTheirs: null,
            myDelta: null, theirDelta: null, h2h: [], positionTotals: [], rosterIds: [], matchupId: null });
        if (!Number.isInteger(week) || week < 1 || week > 18 || !Number.isInteger(season) || !String(league.league_id || league.id || '') || myRosterId == null) return empty('invalid-scope');
        if (!matchesScope(options.scope, league, week) || !matchesScope(forecasts.scope, league, week)) return empty('scope-mismatch');
        if (scoresSupported !== true) return empty('unsupported');
        const rows = Array.isArray(options.rows) ? options.rows : [];
        const mine = rows.find(row => row?.roster_id != null && String(row.roster_id) === String(myRosterId));
        if (!mine || mine.matchup_id == null) return empty(mine ? 'bye' : 'missing-roster');
        const opponents = rows.filter(row => row?.roster_id != null && String(row.roster_id) !== String(myRosterId) && String(row.matchup_id) === String(mine.matchup_id));
        if (opponents.length !== 1) return empty('missing-opponent');
        const theirs = opponents[0];
        if (!Array.isArray(mine.starters) || !Array.isArray(theirs.starters)) return empty('missing-submitted-lineup');
        const duplicate = starters => { const ids = starters.map(pidOf).filter(Boolean); return new Set(ids).size !== ids.length; };
        if (duplicate(mine.starters) || duplicate(theirs.starters)) return empty('duplicate-submitted-player');
        const stateFor = pid => {
            if (!pid) return 'empty';
            try { const state = options.gameState?.(pid); return ['upcoming', 'live', 'final', 'locked', 'bye'].includes(state) ? state : 'unknown'; } catch (_) { return 'unknown'; }
        };
        const rawPoints = (row, pid) => pid ? number(row.players_points?.[pid]) : 0;
        const scoreEvidence = row => row.starters.some(value => {
            const pid = pidOf(value), state = stateFor(pid), points = rawPoints(row, pid);
            return started(state) || (state === 'unknown' && finite(points) && points !== 0);
        }) || ((number(row.custom_points) ?? number(row.points)) !== null && (number(row.custom_points) ?? number(row.points)) !== 0
            && row.starters.some(value => stateFor(pidOf(value)) === 'unknown'));
        const hasStarted = phase !== 'future' && (scoreEvidence(mine) || scoreEvidence(theirs));
        const baseSlots = (league.roster_positions || []).map(normSlot).filter(slot => !bench.has(slot));
        const slotMap = new Map(baseSlots.map((slotName, idx) => [idx, slotName]));
        (Array.isArray(options.slots) ? options.slots : []).forEach(slot => {
            if (Number.isInteger(slot?.idx) && slot.idx >= 0 && !bench.has(normSlot(slot.slotName))) slotMap.set(slot.idx, normSlot(slot.slotName));
        });
        const count = Math.max(mine.starters.length, theirs.starters.length, ...Array.from(slotMap.keys(), idx => idx + 1), 0);
        if (!count) return empty('missing-submitted-lineup');
        const player = (row, index) => {
            const reported = index < row.starters.length && Object.prototype.hasOwnProperty.call(row.starters, index);
            const pid = reported ? pidOf(row.starters[index]) : null, state = reported ? stateFor(pid) : 'unknown', raw = rawPoints(row, pid);
            const actual = (!hasStarted && phase !== 'past') || !reported ? null : !pid || state === 'bye' ? 0 : state === 'upcoming' ? null : started(state) || (state === 'unknown' && finite(raw) && (raw !== 0 || phase === 'past')) ? raw : null;
            const saved = pid ? forecasts.players?.[pid] : null;
            const savedKind = saved && finite(saved.points) && ['pregame', 'first-view'].includes(saved.kind) ? saved.kind : null;
            // A historical review cannot borrow a newly recomputed estimate.
            const current = pid && phase !== 'past' ? number(projections[pid]) : null;
            const projectionKind = !reported ? 'missing' : !pid ? 'empty' : savedKind || (finite(current) ? 'current' : 'missing');
            const projection = !reported ? null : !pid ? 0 : savedKind ? saved.points : current;
            const baseline = !reported ? null : !pid ? 0 : savedKind === 'pregame' ? saved.points : null;
            const complete = !!pid && phase !== 'future' && fresh && state === 'final' && finite(actual);
            const comparable = complete && finite(baseline);
            return { pid, reported, state, actual, projection, projectionKind, projectionLabel: projectionLabel(projectionKind), baseline,
                complete, comparable, delta: comparable ? gap(actual, baseline) : null, tone: tone(actual, baseline, comparable) };
        };
        const h2h = Array.from({ length: count }, (_, idx) => {
            const a = player(mine, idx), b = player(theirs, idx);
            return { idx, slot: slotMap.get(idx) || 'START', myPid: a.pid, theirPid: b.pid, myReported: a.reported, theirReported: b.reported,
                myActual: a.actual, theirActual: b.actual, myProjection: a.projection, theirProjection: b.projection,
                myState: a.state, theirState: b.state, myProjectionKind: a.projectionKind, theirProjectionKind: b.projectionKind,
                myProjectionLabel: a.projectionLabel, theirProjectionLabel: b.projectionLabel,
                projectionKind: kindOf([a.projectionKind, b.projectionKind]),
                myBaseline: a.baseline, theirBaseline: b.baseline, myComplete: a.complete, theirComplete: b.complete,
                myComparable: a.comparable, theirComparable: b.comparable, myDelta: a.delta, theirDelta: b.delta,
                myTone: a.tone, theirTone: b.tone };
        });
        const aggregate = group => {
            const result = { count: group.length };
            ['myActual', 'theirActual', 'myProjection', 'theirProjection', 'myBaseline', 'theirBaseline'].forEach(key => {
                const actualSide = key === 'myActual' ? 'my' : key === 'theirActual' ? 'their' : null;
                result[key] = sum(group.map(row => actualSide && hasStarted && row[actualSide + 'State'] === 'upcoming' ? 0 : row[key]));
            });
            for (const side of ['my', 'their']) {
                const occupied = group.filter(row => row[side + 'Pid']);
                result[side + 'Complete'] = occupied.length > 0 && group.every(row => row[side + 'Reported'] && (!row[side + 'Pid'] || row[side + 'Complete']));
                result[side + 'Comparable'] = result[side + 'Complete'] && finite(result[side + 'Baseline']);
                result[side + 'Delta'] = result[side + 'Comparable'] ? gap(result[side + 'Actual'], result[side + 'Baseline']) : null;
                result[side + 'Tone'] = tone(result[side + 'Actual'], result[side + 'Baseline'], result[side + 'Comparable']);
                result[side + 'ProjectionKind'] = kindOf(group.map(row => row[side + 'ProjectionKind']));
            }
            return result;
        };
        const groupMap = new Map();
        h2h.forEach(row => { if (!groupMap.has(row.slot)) groupMap.set(row.slot, []); groupMap.get(row.slot).push(row); });
        const positionTotals = Array.from(groupMap, ([slot, group]) => ({ slot, ...aggregate(group), players: group }));
        const totals = aggregate(h2h);
        const teamTotal = row => hasStarted || phase === 'past' ? number(row.custom_points) ?? number(row.points) : null;
        const totalMine = teamTotal(mine), totalTheirs = teamTotal(theirs);
        const allFinal = hasStarted && h2h.some(row => row.myPid || row.theirPid) && h2h.every(row => row.myReported && row.theirReported && (!row.myPid || row.myState === 'final' || row.myState === 'bye') && (!row.theirPid || row.theirState === 'final' || row.theirState === 'bye'));
        const laterEstimates = h2h.some(row => ['first-view', 'current'].includes(row.myProjectionKind) || ['first-view', 'current'].includes(row.theirProjectionKind));
        const hasPregame = h2h.some(row => row.myProjectionKind === 'pregame' || row.theirProjectionKind === 'pregame');
        const sourceNote = hasPregame ? 'Submitted starters · saved pregame where available.' : 'Submitted starters · no pregame saved on this device.';
        const sourceDetail = sourceNote
            + (laterEstimates ? ' Later estimates marked.' : '')
            + (finite(mine.custom_points) || finite(theirs.custom_points) ? ' Totals include custom league scoring.' : '');
        return { available: true, reason: null, hasStarted, allFinal,
            headerLabel: !hasStarted && phase !== 'past' ? 'Pregame projection' : status === 'stale' || !scoresReady ? 'Last available points' : !gamesFresh || !hasStarted ? 'Actual points · status unverified' : allFinal ? 'Final points' : 'Actual points',
            status, freshness, ready: fresh, scoresReady, gamesFresh: gamesFresh === true, phase, sourceNote: sourceDetail,
            totalMine, totalTheirs, projectedMine: totals.myProjection, projectedTheirs: totals.theirProjection,
            baselineMine: totals.myBaseline, baselineTheirs: totals.theirBaseline,
            myComplete: totals.myComplete, theirComplete: totals.theirComplete,
            myDelta: allFinal && totals.myComparable && finite(totalMine) ? gap(totalMine, totals.myBaseline) : null,
            theirDelta: allFinal && totals.theirComparable && finite(totalTheirs) ? gap(totalTheirs, totals.theirBaseline) : null,
            myProjectionKind: totals.myProjectionKind, theirProjectionKind: totals.theirProjectionKind,
            projectionKind: kindOf([totals.myProjectionKind, totals.theirProjectionKind]),
            myCustomTotal: finite(mine.custom_points), theirCustomTotal: finite(theirs.custom_points),
            h2h, positionTotals, rosterIds: [String(mine.roster_id), String(theirs.roster_id)], matchupId: mine.matchup_id };
    }
    App.MatchupScoreComparison = { build, projectionLabel };
})(typeof window !== 'undefined' ? window : globalThis);
