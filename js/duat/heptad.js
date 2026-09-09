/* global module, require */
/** Heptad scoring receipts, alliance history and the optional Pinnacle Battle.
 * Pure helpers: callers authorize actions and supply finalized weekly results.
 * The 2024 archive establishes best ball; its unspecified options are explicit.
 */
(function (root, factory) {
    const api = factory(typeof module !== 'undefined' && module.exports ? require('./rules.js') : root.App.DuatRules);
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    (root.App = root.App || {}).DuatHeptad = api;
})(typeof window !== 'undefined' ? window : globalThis, function (Rules) {
    'use strict';
    const DEFAULT_OPTIONS = Object.freeze({ pool: 'starters', duplicates: 'allow', favorPoints: false });
    const SLOTS = new Set(['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX']);
    const copy = value => JSON.parse(JSON.stringify(value));
    const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
    function fail(message) { const error = new Error(message); error.code = 'INVALID_HEPTAD'; throw error; }
    function normalizeOptions(input = {}) {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !Object.hasOwn(DEFAULT_OPTIONS, key))) fail('Choose valid Heptad rules.');
        const value = { ...DEFAULT_OPTIONS, ...input };
        if (!['starters', 'army'].includes(value.pool) || !['allow', 'unique-athlete'].includes(value.duplicates) || typeof value.favorPoints !== 'boolean') fail('Choose valid Heptad rules.');
        return value;
    }
    function describeOptions(input) {
        const rules = normalizeOptions(input);
        return `Best ball from ${rules.pool === 'army' ? 'both full armies' : 'both submitted starting lineups'}. ${rules.favorPoints ? 'Favor adjustments count' : 'Base scores only'}; ${rules.duplicates === 'allow' ? 'different seasons of one athlete may both count' : 'each athlete may count once'}.`;
    }
    function validateName(value) {
        if (typeof value !== 'string' || /[<>\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)) fail('Use a plain-text alliance name without markup or line breaks.');
        const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
        if ([...name].length < 2 || [...name].length > 60) fail('Alliance names need 2 to 60 characters.');
        return name;
    }
    function renameAlliance(alliances, allianceId, value) {
        const name = validateName(value);
        if (!Array.isArray(alliances) || !alliances.some(alliance => alliance.id === allianceId)) fail('Choose an existing alliance.');
        if (alliances.some(alliance => alliance.id !== allianceId && alliance.name.toLocaleLowerCase() === name.toLocaleLowerCase())) fail('Another alliance already carries that name.');
        return alliances.map(alliance => alliance.id === allianceId ? { ...copy(alliance), name, customName: true } : copy(alliance));
    }
    function accepts(slot, position) { return slot === position || slot === 'SUPER_FLEX' || slot === 'FLEX' && position !== 'QB'; }
    function scoreAlliance(alliance, factionResults, slots, input = {}) {
        const options = normalizeOptions(input);
        if (!Array.isArray(slots) || !slots.length || slots.length > 12 || slots.some(slot => !SLOTS.has(slot))) fail('Supply the campaign starting slots.');
        if (!alliance?.id || !Array.isArray(alliance.teamIds) || new Set(alliance.teamIds).size !== alliance.teamIds.length || alliance.teamIds.length < 2) fail('Supply an alliance and its factions.');
        if (!Array.isArray(factionResults)) fail('Supply finalized faction results.');
        const pool = [], seenCards = new Set();
        for (const factionId of alliance.teamIds) {
            const rows = factionResults.filter(row => row.factionId === factionId);
            if (rows.length !== 1 || rows[0].finalized === false || !Array.isArray(rows[0].players)) fail('Heptad waits for every partner’s finalized result.');
            const row = rows[0];
            for (const player of row.players) {
                if (options.pool === 'starters' && player.starter !== true) continue;
                const points = options.favorPoints ? player.effectivePoints : player.basePoints;
                if (!player.id || !['QB', 'RB', 'WR', 'TE'].includes(player.position) || !Number.isFinite(points) || !Number.isFinite(player.basePoints)) fail('Heptad requires recorded player scores.');
                const key = factionId + ':' + player.id;
                if (seenCards.has(key)) fail('A player card cannot appear twice in one army.');
                seenCards.add(key);
                if (options.duplicates === 'unique-athlete' && (typeof player.identity !== 'string' || !player.identity)) fail('Unique-athlete scoring requires an athlete identity.');
                pool.push({ factionId, playerId: player.id, id: player.id, identity: player.identity || player.id,
                    name: String(player.name || player.id), position: player.position, season: row.season ?? player.season ?? null,
                    points, basePoints: player.basePoints, effectivePoints: Number.isFinite(player.effectivePoints) ? player.effectivePoints : player.basePoints });
            }
        }
        // Each group may supply at most one card. Freezing the DP before a group
        // prevents two year-versions of an athlete from occupying different slots.
        pool.sort((a, b) => a.factionId.localeCompare(b.factionId) || a.playerId.localeCompare(b.playerId));
        const groups = new Map();
        for (const player of pool) {
            const key = options.duplicates === 'unique-athlete' ? player.identity : player.factionId + ':' + player.playerId;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(player);
        }
        let states = new Map([[0, { total: 0, players: [] }]]);
        for (const group of groups.values()) {
            const nextStates = new Map(states);
            for (const player of group) for (const [mask, state] of states) for (let i = 0; i < slots.length; i++) {
                if (mask & (1 << i) || !accepts(slots[i], player.position)) continue;
                const next = mask | (1 << i), total = state.total + player.points;
                if (!nextStates.has(next) || total > nextStates.get(next).total) {
                    const players = [...state.players]; players[i] = { ...player, slot: slots[i] };
                    nextStates.set(next, { total, players });
                }
            }
            states = nextStates;
        }
        const best = states.get((1 << slots.length) - 1);
        if (!best) fail('The alliance cannot fill a legal best-ball lineup.');
        const contributors = best.players.map(player => ({ ...player, points: round(player.points), basePoints: round(player.basePoints), effectivePoints: round(player.effectivePoints) }));
        const mvp = [...contributors].sort((a, b) => b.points - a.points || a.factionId.localeCompare(b.factionId) || a.playerId.localeCompare(b.playerId))[0];
        return { allianceId: alliance.id, total: round(best.total), contributors, mvp: copy(mvp), options,
            members: alliance.teamIds.map(factionId => ({ factionId, counted: contributors.filter(p => p.factionId === factionId).length,
                points: round(contributors.filter(p => p.factionId === factionId).reduce((sum, p) => sum + p.points, 0)) })) };
    }
    function scoreWeek(alliances, factionResults, slots, options) { return alliances.map(alliance => scoreAlliance(alliance, factionResults, slots, options)); }
    function matchMVP(match, completedWeeks) {
        const week = completedWeeks.find(row => row.week === match.week);
        const pool = (week?.allianceScores || []).filter(score => [match.homeId, match.awayId].includes(score.allianceId))
            .flatMap(score => (score.contributors || []).map(player => ({ ...player, allianceId: score.allianceId })));
        return pool.sort((a, b) => b.points - a.points || a.allianceId.localeCompare(b.allianceId) || a.playerId.localeCompare(b.playerId))[0] || null;
    }
    function progress(alliances, heptad, startWeek = 2) {
        const matches = heptad?.matches || [];
        const next = heptad?.next || (!matches.length && alliances.length >= 2
            ? { bracket: 'top', week: startWeek, homeId: [...alliances].sort((a,b)=>a.entry-b.entry)[0].id, awayId: [...alliances].sort((a,b)=>a.entry-b.entry)[1].id } : null);
        return [...alliances].sort((a, b) => a.entry - b.entry).map(alliance => {
            const own = matches.filter(match => [match.homeId, match.awayId].includes(alliance.id));
            const losses = own.filter(match => match.loserId === alliance.id).length;
            return { ...copy(alliance), entranceWeek: startWeek + Math.max(0, alliance.entry - 2), played: own.length,
                wins: own.length - losses, losses, lives: Math.max(0, 2 - losses),
                status: heptad?.championId === alliance.id ? 'champion' : losses >= 2 ? 'eliminated' : own.length ? losses ? 'redemption' : 'unbeaten' : 'waiting',
                next: next && [next.homeId, next.awayId].includes(alliance.id) ? copy(next) : null };
        });
    }
    function createPinnacle({ heptad, alliances, startWeek = 2, lastWeek = 17 }) {
        if (!heptad?.complete || !heptad.championId) return null;
        const champion = alliances.find(a => a.id === heptad.championId), challenger = alliances.find(a => a.id === heptad.pinnacleChallengerId);
        if (!champion) fail('The Heptad champion must belong to this season.');
        const earliestWeek = Math.max(Rules.heptadSchedule(alliances.length, startWeek).pinnacleWeek,
            1 + Math.max(0, ...(heptad.matches || []).map(match => match.week)));
        return { version: 1, status: challenger && earliestWeek <= lastWeek ? 'offered' : 'unavailable',
            championId: champion.id, challengerId: challenger?.id || null,
            participantFactionIds: [...champion.teamIds, ...(challenger?.teamIds || [])], earliestWeek, lastWeek,
            week: null, approvedFactionIds: [], result: null };
    }
    function requireParticipant(pinnacle, factionId) {
        if (!pinnacle?.participantFactionIds?.includes(factionId)) fail('Only factions in the Pinnacle Battle may decide this challenge.');
        if (!['offered', 'proposed', 'scheduled'].includes(pinnacle.status)) fail('This Pinnacle challenge is no longer open.');
    }
    function proposePinnacle(pinnacle, { week, currentWeek, factionId, autoApproveFactionIds = [] }) {
        requireParticipant(pinnacle, factionId);
        if (pinnacle.status === 'scheduled') fail('The agreed Pinnacle week is locked.');
        if (!Number.isInteger(currentWeek) || !Number.isInteger(week) || week < Math.max(currentWeek, pinnacle.earliestWeek) || week > pinnacle.lastWeek) fail('Choose an unplayed week after the Heptad final.');
        if (!Array.isArray(autoApproveFactionIds) || autoApproveFactionIds.some(id => !pinnacle.participantFactionIds.includes(id))) fail('Only participating factions may approve the Pinnacle Battle.');
        const approvedFactionIds = [...new Set([factionId, ...autoApproveFactionIds])];
        return { ...copy(pinnacle), week, approvedFactionIds,
            status: pinnacle.participantFactionIds.every(id => approvedFactionIds.includes(id)) ? 'scheduled' : 'proposed' };
    }
    function approvePinnacle(pinnacle, { factionId, currentWeek }) {
        requireParticipant(pinnacle, factionId);
        if (pinnacle.status !== 'proposed' || !Number.isInteger(currentWeek) || pinnacle.week < currentWeek) fail('Choose a new unplayed Pinnacle week before approving.');
        const approvedFactionIds = [...new Set([...pinnacle.approvedFactionIds, factionId])];
        return { ...copy(pinnacle), approvedFactionIds,
            status: pinnacle.participantFactionIds.every(id => approvedFactionIds.includes(id)) ? 'scheduled' : 'proposed' };
    }
    function declinePinnacle(pinnacle, { factionId }) {
        requireParticipant(pinnacle, factionId);
        if (pinnacle.status === 'scheduled') fail('The agreed Pinnacle week is locked.');
        return { ...copy(pinnacle), status: 'declined', declinedByFactionId: factionId };
    }
    function resolvePinnacle(pinnacle, completedWeek) {
        if (!pinnacle || pinnacle.status !== 'scheduled' || completedWeek?.week !== pinnacle.week) return pinnacle ? copy(pinnacle) : null;
        if (completedWeek.finalized === false) fail('The Pinnacle Battle waits for finalized scores.');
        const scoreFor = id => {
            const scores = (completedWeek.allianceScores || []).filter(score => score.allianceId === id);
            if (scores.length !== 1 || !Number.isFinite(scores[0].total)) fail('Both Pinnacle alliances need a finalized score.');
            return scores[0].total;
        };
        const homeScore = scoreFor(pinnacle.championId), awayScore = scoreFor(pinnacle.challengerId);
        // Explicit adaptation: a tied optional title defense stays with its holder.
        const winnerId = homeScore >= awayScore ? pinnacle.championId : pinnacle.challengerId;
        const result = { bracket: 'pinnacle', week: pinnacle.week, homeId: pinnacle.championId, awayId: pinnacle.challengerId,
            homeScore, awayScore, winnerId, loserId: winnerId === pinnacle.championId ? pinnacle.challengerId : pinnacle.championId,
            tied: homeScore === awayScore, defended: winnerId === pinnacle.championId };
        result.mvp = matchMVP(result, [completedWeek]);
        return { ...copy(pinnacle), status: 'complete', result };
    }
    function recordsForSeason({ seasonId, seasonLabel = null, alliances, heptad, completedWeeks = [], pinnacle = null }) {
        if (typeof seasonId !== 'string' || !seasonId.trim()) fail('Alliance records require a stable season identity.');
        return progress(alliances, heptad).map(alliance => {
            const matches = (heptad?.matches || []).filter(match => [match.homeId, match.awayId].includes(alliance.id));
            let pointsFor = 0, pointsAgainst = 0;
            for (const match of matches) { pointsFor += match.homeId === alliance.id ? match.homeScore : match.awayScore; pointsAgainst += match.homeId === alliance.id ? match.awayScore : match.homeScore; }
            const wins = matches.filter(match => match.winnerId === alliance.id).length;
            const best = matches.map(match => ({ week: match.week, points: match.homeId === alliance.id ? match.homeScore : match.awayScore }))
                .sort((a,b)=>b.points-a.points || a.week-b.week)[0] || null;
            return { seasonId, ...(seasonLabel ? {seasonLabel:String(seasonLabel)} : {}), allianceId: alliance.id, name: alliance.name, teamIds: [...alliance.teamIds], entry: alliance.entry,
                played: matches.length, wins, losses: matches.length - wins, winPercent: matches.length ? round(wins / matches.length * 100) : 0,
                pointsFor: round(pointsFor), pointsAgainst: round(pointsAgainst), pointDifference: round(pointsFor - pointsAgainst), bestWeek: best,
                redemptionWins: matches.filter(match => match.bracket === 'bottom' && match.winnerId === alliance.id).length,
                finalist: matches.some(match => ['championship', 'rematch'].includes(match.bracket)), champion: heptad?.championId === alliance.id,
                pinnacleWins: pinnacle?.result?.winnerId === alliance.id ? 1 : 0,
                mvps: matches.map(match => matchMVP(match, completedWeeks)).filter(player => player?.allianceId === alliance.id) };
        });
    }
    function archiveSeason(history, context) {
        if (!Array.isArray(history)) fail('Supply the alliance record archive.');
        if (!context.heptad?.complete) fail('Finish the Heptad before archiving its records.');
        return [...history.filter(record => record.seasonId !== context.seasonId).map(copy), ...recordsForSeason(context)];
    }
    // The original Heptad is seven alliance teams, not seven scheduled matches.
    function tournamentName(alliancesOrCount) {
        const count=Array.isArray(alliancesOrCount)?alliancesOrCount.length:alliancesOrCount;
        return ({2:'Dyad',3:'Triad',4:'Tetrad',5:'Pentad',6:'Hexad',7:'Heptad',8:'Octad'})[count] || 'Alliance';
    }
    function championGallery(history) { return history.filter(record => record.champion).map(copy); }
    return { DEFAULT_OPTIONS, tournamentName, normalizeOptions, describeOptions, validateName, renameAlliance, scoreAlliance, scoreWeek, matchMVP,
        progress, createPinnacle, proposePinnacle, approvePinnacle, declinePinnacle, resolvePinnacle, recordsForSeason, archiveSeason, championGallery };
});
