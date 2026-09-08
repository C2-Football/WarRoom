/* global module, require */
/** Historical Original Duat campaign. Every weekly point comes from a supplied
 * NFL game log for the walking ruler's year and the same calendar week.
 * All-play ties earn half a win and half a loss; equal records break by points,
 * then faction ID. Weekly conquest score ties also break by faction ID.
 * Decisions use only completed campaign weeks and seasons before the army year.
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        require('../shared/time-league-roster.js');
        require('../shared/time-league-draft-room.js');
        require('../shared/time-league-season.js');
        const api = factory(require('./rules.js'), require('./army-generation.js'), require('./conquest.js'),
            require('./favors.js'), root.App.TimeLeagueSeason, root.App.TimeLeagueDraftRoom);
        (root.App = root.App || {}).DuatCampaign = api;
        module.exports = api;
    } else {
        root.App.DuatCampaign = factory(root.App.DuatRules, root.App.DuatArmies, root.App.DuatConquest,
            root.App.DuatFavors, root.App.TimeLeagueSeason, root.App.TimeLeagueDraftRoom);
    }
})(typeof window !== 'undefined' ? window : globalThis, function (Rules, Armies, Conquest, Favors, Season, DraftRoom) {
    'use strict';
    const SCORING = Object.freeze({ passTd: 4, reception: 0.5, rushRecYd: 0.1, passingYd: 0.04, turnover: -1 });
    const SKILL_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);
    const copy = value => JSON.parse(JSON.stringify(value));
    const round = value => Math.round(value * 100) / 100;
    const baseline = position => position === 'QB' ? 12 : position === 'TE' ? 5 : 7;
    const coverageCache = new WeakMap();
    function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
    function string(value, label) {
        if (typeof value !== 'string' || !value.trim() || value.length > 160) fail('INVALID_INPUT', 'Supply a valid ' + label + '.');
        return value.trim();
    }
    function timestamp(value) {
        if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('INVALID_TIME', 'Supply a valid timestamp.');
        return value;
    }
    function logsOf(data) {
        if (!data || !(data.logIndex instanceof Map)) fail('DATA_UNAVAILABLE', 'Historical game logs have not loaded.');
        return data.logIndex;
    }
    function cardsOf(data) {
        const raw = data?.cards;
        if (raw instanceof Map) return [...raw.values()];
        if (Array.isArray(raw)) return raw;
        if (Array.isArray(raw?.players)) return raw.players;
        fail('DATA_UNAVAILABLE', 'Historical player cards have not loaded.');
    }
    function availableSeasons(data) {
        const index = logsOf(data);
        const cached = coverageCache.get(index);
        if (cached?.size === index.size) return [...cached.seasons];
        const weeks = new Map();
        for (const row of index.values()) {
            if (!SKILL_POSITIONS.has(row.position) || !Number.isInteger(row.season) || !Number.isInteger(row.week) || row.week < 1 || row.week > 17) continue;
            if (!weeks.has(row.season)) weeks.set(row.season, new Set());
            weeks.get(row.season).add(row.week);
        }
        const seasons = [...weeks].filter(([, present]) => present.size === 17).map(([season]) => season).sort((a, b) => b - a);
        coverageCache.set(index, { size: index.size, seasons });
        return [...seasons];
    }
    function requireCoverage(seasons, data) {
        const complete = new Set(availableSeasons(data));
        if (seasons.some(season => !complete.has(season))) fail('INCOMPLETE_DATA', 'Each ruler year needs recorded NFL data for all 17 calendar weeks.');
    }
    function priorReference(card, season) {
        const previous = (card.seasons || []).filter(item => item.season < season && item.games > 0)
            .sort((a, b) => b.season - a.season)[0];
        return previous && Number.isFinite(previous.points)
            ? { referencePoints: round(previous.points / previous.games), referenceSeason: previous.season }
            : { referencePoints: baseline(card.position), referenceSeason: null };
    }
    function activeArmy(faction) { return faction.armies.find(army => army.id === faction.activeArmyId) || null; }
    function legalLineup(faction, ids) {
        const army = activeArmy(faction);
        if (!army || !Array.isArray(ids) || ids.length !== 5 || new Set(ids).size !== 5) return false;
        const players = ids.map(id => army.players.find(player => player.id === id));
        return players.every(Boolean) && players.filter(player => player.position === 'QB').length === 1
            && players.filter(player => ['RB', 'WR', 'TE'].includes(player.position)).length === 4;
    }
    function factionOf(state, factionId) {
        const faction = state.factions.find(item => item.id === factionId);
        if (!faction) fail('UNKNOWN_FACTION', 'Choose a faction in this campaign.');
        return faction;
    }
    function estimatePlayer(state, factionId, playerId) {
        const faction = factionOf(state, factionId);
        const player = faction.armies.flatMap(army => army.players).find(item => item.id === playerId);
        if (!player) fail('UNKNOWN_PLAYER', 'This player does not belong to the faction.');
        const observed = state.completedWeeks.filter(week => week.week < state.week)
            .map(week => week.factions.find(item => item.factionId === factionId)?.players.find(item => item.id === playerId))
            .filter(Boolean);
        const reference = Number.isFinite(player.referencePoints) ? player.referencePoints : baseline(player.position);
        const points = observed.length ? (observed.reduce((sum, item) => sum + item.basePoints, 0) + reference * 2) / (observed.length + 2) : reference;
        return { points: round(points), label: observed.length ? 'Through Week ' + (state.week - 1)
            : player.referenceSeason ? player.referenceSeason + ' season reference' : 'Position baseline' };
    }
    function recommendedLineup(state, factionId) {
        const faction = factionOf(state, factionId), army = activeArmy(faction);
        if (!army) return [];
        const ranked = [...army.players].sort((a, b) => estimatePlayer(state, factionId, b.id).points
            - estimatePlayer(state, factionId, a.id).points || a.id.localeCompare(b.id));
        return [...ranked.filter(player => player.position === 'QB').slice(0, 1),
            ...ranked.filter(player => player.position !== 'QB').slice(0, 4)].map(player => player.id);
    }
    function createCampaign(input, data) {
        const complete = availableSeasons(data);
        const seasons = input.seasons || complete.slice(0, 4);
        if (!Array.isArray(seasons) || seasons.length !== 4 || new Set(seasons).size !== 4 || seasons.some(season => !Number.isInteger(season))) {
            fail('INVALID_SEASONS', 'Choose four different complete historical seasons.');
        }
        requireCoverage(seasons, data);
        const hostFactionId = input.hostFactionId || Rules.FACTIONS[0].id;
        const humanFactionIds = [...new Set([hostFactionId, ...(input.humanFactionIds || [])])];
        if (humanFactionIds.some(id => !Rules.FACTIONS.some(faction => faction.id === id))) fail('INVALID_FACTIONS', 'Choose human factions from the Original Duat.');
        const seed = string(input.seed, 'campaign seed');
        const pool = cardsOf(data).filter(card => SKILL_POSITIONS.has(card.position)).flatMap(card => {
            const identity = card.identity || DraftRoom.canonicalPlayerIdentity(card);
            return seasons.filter(season => card.seasons?.some(item => item.season === season)).map(season => {
                const reference = priorReference(card, season);
                const archivedSeason = card.seasons.find(item => item.season === season);
                return { id: identity + ':' + season, identity, name: card.name, position: card.position, season,
                    // Preserve the original historical-army allocation weighting.
                    // This archive value is never a saved AI/UI projection.
                    ...reference, allocationWeight: Math.max(0.01, archivedSeason.points || 0), fantasyPoints: 0 };
            });
        });
        const generated = Armies.generateProportionalArmies({
            teams: Rules.FACTIONS.map(faction => ({ id: faction.id, name: faction.name })),
            players: pool, seasons, rosterSlots: Rules.ORIGINAL_DEFAULTS.rosterSlots,
            historyCount: 4, seed, currentSeason: Math.max(...seasons) + 1,
        });
        if (generated.shortfalls.length || generated.armies.length !== 56 || generated.armies.some(army => army.roster.length !== 8)) {
            fail('INSUFFICIENT_PLAYERS', 'These years cannot supply fourteen complete four-ruler armies.');
        }
        const factions = Rules.FACTIONS.map(identity => ({
            ...copy(identity), controller: humanFactionIds.includes(identity.id) ? 'human' : 'ai',
            armies: generated.armies.filter(army => army.teamId === identity.id).map(army => ({
                id: army.id, season: army.season, rulerNumber: army.rulerNumber,
                rulerName: army.season + ' Ruler', rollBand: copy(army.rollBand),
                players: army.roster.map(player => ({ id: player.id, identity: player.identity, name: player.name,
                    position: player.position, referencePoints: player.referencePoints, referenceSeason: player.referenceSeason })),
            })), activeArmyId: null, rulerRoll: null, lineup: [], favorBalance: Favors.STARTING_FAVOR_BALANCE,
            declaredFavor: null,
        }));
        const createdAt = timestamp(input.createdAt);
        return { version: 1, id: string(input.id, 'campaign ID'), name: string(input.name || 'The Duat', 'campaign name'),
            seed, createdAt, updatedAt: createdAt, phase: 'preseason', week: 1, seasons: [...seasons],
            hostFactionId, humanFactionIds, scoring: { ...SCORING }, factions,
            alliances: Rules.buildHeptadAlliances(factions.map(faction => faction.id), Rules.defaultHeptadSettings(14), seed,
                id => factions.find(faction => faction.id === id).name),
            conquest: Conquest.createConquest({ season: 1 }), completedWeeks: [], playoffField: [], championId: null,
            heptad: null, heavenly: null, activity: [{ week: 0, type: 'founded', message: 'Four historical rulers await each faction.', createdAt }] };
    }
    function computeStandings(state) {
        const rows = state.factions.map(faction => ({ factionId: faction.id, name: faction.name, wins: 0, losses: 0, ties: 0, points: 0 }));
        const byId = new Map(rows.map(row => [row.factionId, row]));
        for (const week of state.completedWeeks.filter(item => item.week <= 14)) {
            for (const result of week.factions) {
                const row = byId.get(result.factionId);
                row.points = round(row.points + result.total);
                for (const opponent of week.factions) {
                    if (opponent.factionId === result.factionId) continue;
                    if (result.total > opponent.total) row.wins++;
                    else if (result.total < opponent.total) row.losses++;
                    else { row.wins += 0.5; row.losses += 0.5; row.ties++; }
                }
            }
        }
        return rows.sort((a, b) => b.wins - a.wins || b.points - a.points || a.factionId.localeCompare(b.factionId))
            .map((row, index) => ({ ...row, rank: index + 1 }));
    }
    function historyFor(state, factionId) {
        return state.completedWeeks.map(week => ({ week: week.week,
            players: week.factions.find(faction => faction.factionId === factionId).players }));
    }
    function planningPlayers(faction) {
        return activeArmy(faction).players.map(player => ({ id: player.id, starter: faction.lineup.includes(player.id) }));
    }
    function unresolvedClaims(state) {
        return state.humanFactionIds.filter(id => state.conquest.pendingClaims[id] > 0 && Conquest.eligibleTerritories(state.conquest, id).length > 0);
    }
    function settleAIClaims(state, createdAt) {
        if (unresolvedClaims(state).length) return state;
        for (const faction of state.factions.filter(item => item.controller === 'ai')) {
            while (state.conquest.pendingClaims[faction.id] > 0) {
                const frontier = Conquest.eligibleTerritories(state.conquest, faction.id);
                if (!frontier.length) break;
                const random = Rules.createSeededRandom(state.seed + ':conquest:' + state.week + ':' + faction.id + ':' + state.conquest.events.length);
                const territoryId = frontier[Math.floor(random() * frontier.length)];
                state.conquest = Conquest.claimTerritory(state.conquest, { factionId: faction.id, territoryId, createdAt });
            }
        }
        return state;
    }
    function chooseAIFavor(state, faction) {
        if (!Rules.SACRED_WEEKS.includes(state.week) || faction.favorBalance < 10) return null;
        const playerId = [...faction.lineup].sort((a, b) => estimatePlayer(state, faction.id, b).points
            - estimatePlayer(state, faction.id, a).points || a.localeCompare(b))[0];
        const favorId = state.week >= 15 && faction.favorBalance >= 30 ? 'kratos-3'
            : state.week >= 10 && faction.favorBalance >= 40 ? 'kratos-2' : 'kratos-1';
        return Favors.validateDeclaration({ declaration: { favorId, playerId }, week: state.week, balance: faction.favorBalance,
            playerResults: planningPlayers(faction), history: historyFor(state, faction.id) });
    }
    function resolveWeek(state, data, createdAt) {
        requireCoverage(state.seasons, data);
        if (unresolvedClaims(state).length) fail('CLAIMS_PENDING', 'Choose the earned human territory claims before advancing.');
        settleAIClaims(state, createdAt);
        const logIndex = logsOf(data);
        for (const faction of state.factions) {
            if (faction.controller === 'ai') {
                faction.lineup = recommendedLineup(state, faction.id);
                faction.declaredFavor = chooseAIFavor(state, faction);
            }
            if (!legalLineup(faction, faction.lineup)) fail('INVALID_LINEUP', faction.name + ' must start one quarterback and four skill players.');
        }
        const results = state.factions.map(faction => {
            const army = activeArmy(faction);
            const rawPlayers = army.players.map(player => {
                const log = logIndex.get(Season.gameLogKey(player.identity, army.season, state.week));
                const basePoints = log ? Season.scoreStatLine(log.stats, SCORING, {}) : 0;
                if (!Number.isFinite(basePoints)) fail('INVALID_DATA', 'A historical score is invalid.');
                return { id: player.id, identity: player.identity, name: player.name, position: player.position,
                    starter: faction.lineup.includes(player.id), basePoints, effectivePoints: basePoints,
                    stats: log ? copy(log.stats) : null, hasRecordedGame: Boolean(log) };
            });
            const applied = Favors.applyFavor({ declaration: faction.declaredFavor, playerResults: rawPlayers,
                history: historyFor(state, faction.id), week: state.week, seed: state.seed + ':' + faction.id,
                balance: faction.favorBalance });
            faction.favorBalance = round(faction.favorBalance - applied.cost);
            const players = applied.players;
            const baseTotal = round(players.filter(player => player.starter).reduce((sum, player) => sum + player.basePoints, 0));
            const total = round(players.filter(player => player.starter).reduce((sum, player) => sum + player.effectivePoints, 0));
            const result = { factionId: faction.id, armyId: army.id, season: army.season, baseTotal, total,
                players, favor: applied.event || null, favorCost: applied.cost, favorBalance: faction.favorBalance };
            faction.declaredFavor = null;
            return result;
        });
        const allianceScores = Rules.scoreHeptadWeek(state.alliances, results.map(result => ({ teamId: result.factionId,
            total: result.baseTotal, starters: result.players.filter(player => player.starter).map(player => ({
                slot: player.position === 'QB' ? 'QB' : 'FLEX', points: player.basePoints })) })), 'best-ball');
        const completed = { week: state.week, factions: results, allianceScores, standings: [], heptad: null, heavenly: null };
        state.completedWeeks.push(completed);
        completed.standings = computeStandings(state);
        if (state.week <= 14) {
            const ranks = [...results].sort((a, b) => b.total - a.total || a.factionId.localeCompare(b.factionId));
            state.conquest = Conquest.recordWeek(state.conquest, { week: state.week, createdAt,
                results: ranks.map((result, index) => ({ factionId: result.factionId, place: index + 1, score: result.total })) });
        }
        const allianceTotal = (id, week) => state.completedWeeks.find(item => item.week === week)?.allianceScores.find(item => item.allianceId === id)?.total ?? null;
        state.heptad = Rules.runHeptadGauntlet(state.alliances, allianceTotal, 2);
        if (state.week === 14) state.playoffField = completed.standings.slice(0, 7).map(row => row.factionId);
        const factionTotal = (id, week) => state.completedWeeks.find(item => item.week === week)?.factions.find(item => item.factionId === id)?.total ?? null;
        state.heavenly = state.playoffField.length ? Rules.runHeavenlyBattle(state.playoffField, factionTotal) : null;
        completed.heptad = copy(state.heptad);
        completed.heavenly = copy(state.heavenly);
        state.activity.push({ week: state.week, type: 'week', message: 'Week ' + state.week + ' recorded from historical NFL games.', createdAt });
        if (state.week === 17) {
            if (!state.heavenly?.complete || !state.heavenly.championId) fail('INCOMPLETE_CHAMPIONSHIP', 'The Heavenly Battle has not resolved.');
            state.championId = state.heavenly.championId;
            state.phase = 'complete';
        }
        state.week++;
        settleAIClaims(state, createdAt);
        for (const faction of state.factions.filter(item => item.controller === 'ai')) faction.lineup = recommendedLineup(state, faction.id);
        return state;
    }
    function applyAction(state, action, data) {
        validateCampaign(state);
        if (!action || typeof action.type !== 'string') fail('INVALID_ACTION', 'Choose a campaign action.');
        const next = copy(state);
        const createdAt = timestamp(action.createdAt || state.updatedAt);
        if (action.type === 'reveal-rulers') {
            if (state.phase !== 'preseason') fail('INVALID_PHASE', 'The rulers have already been revealed.');
            requireCoverage(state.seasons, data);
            for (const faction of next.factions) {
                const random = Rules.createSeededRandom(state.seed + ':ruler:' + faction.id);
                faction.rulerRoll = 1 + Math.floor(random() * 20);
                faction.activeArmyId = faction.armies.find(army => faction.rulerRoll >= army.rollBand.min && faction.rulerRoll <= army.rollBand.max).id;
            }
            next.phase = 'season';
            for (const faction of next.factions) faction.lineup = recommendedLineup(next, faction.id);
            next.activity.push({ week: 0, type: 'reveal', message: 'Fourteen rulers walk again. The historical season begins.', createdAt });
        } else {
            if (state.phase !== 'season') fail('INVALID_PHASE', 'This action requires an active season.');
            if (action.type === 'advance-week') resolveWeek(next, data, createdAt);
            else {
                const faction = factionOf(next, action.factionId);
                if (action.type === 'set-lineup') {
                    if (!legalLineup(faction, action.playerIds)) fail('INVALID_LINEUP', 'Start exactly one quarterback and four different RB, WR or TE players from your walking army.');
                    if (faction.declaredFavor && !action.playerIds.includes(faction.declaredFavor.playerId)) fail('FAVOR_TARGET_BENCHED', 'Clear the favor before benching its target.');
                    faction.lineup = [...action.playerIds];
                } else if (action.type === 'declare-favor') {
                    faction.declaredFavor = Favors.validateDeclaration({ declaration: { favorId: action.favorId,
                        playerId: action.playerId, ...(action.sourceWeek === undefined ? {} : { sourceWeek: action.sourceWeek }) },
                        week: state.week, balance: faction.favorBalance, playerResults: planningPlayers(faction), history: historyFor(state, faction.id) });
                } else if (action.type === 'clear-favor') faction.declaredFavor = null;
                else if (action.type === 'claim') {
                    next.conquest = Conquest.claimTerritory(next.conquest, { factionId: faction.id, territoryId: action.territoryId, createdAt });
                    settleAIClaims(next, createdAt);
                } else fail('INVALID_ACTION', 'Unknown campaign action.');
            }
        }
        next.updatedAt = createdAt;
        return next;
    }
    function projectCampaign(state, viewerFactionId) {
        factionOf(state, viewerFactionId);
        const projected = copy(state);
        delete projected.seed;
        projected.factions = projected.factions.map(faction => {
            if (faction.id !== viewerFactionId) {
                faction.lineup = [];
                faction.declaredFavor = null;
                if (state.phase === 'preseason') { faction.armies = []; faction.activeArmyId = null; faction.rulerRoll = null; }
            }
            return faction;
        });
        return projected;
    }
    /** Validate a full saved campaign, not a redacted online projection.
     * Throws INVALID_CAMPAIGN for malformed saves; returns true on success.
     * This is structural validation, not proof that an imported save is honest.
     */
    function validateCampaign(state) {
        try { return assertCampaign(state); }
        catch (error) {
            if (error.code === 'INVALID_CAMPAIGN') throw error;
            fail('INVALID_CAMPAIGN', 'This saved campaign is malformed.');
        }
    }
    function assertCampaign(state) {
        const invalid = message => fail('INVALID_CAMPAIGN', message);
        const finite = value => typeof value === 'number' && Number.isFinite(value);
        if (!state || state.version !== 1 || !['preseason', 'season', 'complete'].includes(state.phase)) invalid('Unsupported Duat campaign.');
        if (!Number.isInteger(state.week) || state.week < 1 || state.week > 18
            || (state.phase === 'preseason' && state.week !== 1)
            || (state.phase === 'season' && state.week > 17)
            || (state.phase === 'complete' && state.week !== 18)) invalid('Invalid campaign week.');
        for (const key of ['id', 'name', 'seed', 'createdAt', 'updatedAt']) if (typeof state[key] !== 'string' || !state[key] || state[key].length > 160) invalid('Missing campaign identity.');
        if (!Number.isFinite(Date.parse(state.createdAt)) || !Number.isFinite(Date.parse(state.updatedAt))) invalid('Invalid campaign timestamp.');
        if (!Array.isArray(state.seasons) || state.seasons.length !== 4 || new Set(state.seasons).size !== 4
            || state.seasons.some(year => !Number.isInteger(year) || year < 1920 || year > 2100)) invalid('Invalid ruler years.');
        const ids = Rules.FACTIONS.map(faction => faction.id);
        const exactIds = values => Array.isArray(values) && values.length === 14 && new Set(values).size === 14 && values.every(id => ids.includes(id));
        if (!Array.isArray(state.factions) || !exactIds(state.factions.map(faction => faction?.id))) invalid('A Duat campaign needs fourteen original factions.');
        if (!Array.isArray(state.humanFactionIds) || !state.humanFactionIds.length || new Set(state.humanFactionIds).size !== state.humanFactionIds.length
            || state.humanFactionIds.some(id => !ids.includes(id)) || !state.humanFactionIds.includes(state.hostFactionId)) invalid('Invalid human faction seats.');
        const usedPlayers = new Set();
        for (const faction of state.factions) {
            if (faction.controller !== (state.humanFactionIds.includes(faction.id) ? 'human' : 'ai')) invalid('Invalid faction controller.');
            if (!Array.isArray(faction.armies) || faction.armies.length !== 4 || new Set(faction.armies.map(army => army?.season)).size !== 4
                || new Set(faction.armies.map(army => army?.rulerNumber)).size !== 4) invalid('Each faction requires four different rulers.');
            for (const army of faction.armies) {
                const band = Rules.DUAT_ORIGINAL_D20_BANDS[army.rulerNumber - 1];
                if (!state.seasons.includes(army.season) || army.id !== faction.id + ':' + army.season || !band
                    || army.rollBand?.min !== band.min || army.rollBand?.max !== band.max) invalid('Invalid ruler identity or d20 band.');
                if (!Array.isArray(army.players) || army.players.length !== 8 || new Set(army.players.map(player => player?.id)).size !== 8) invalid('A ruler needs eight distinct players.');
                for (const player of army.players) {
                    if (!player || typeof player.name !== 'string' || !player.name || !SKILL_POSITIONS.has(player.position)
                        || typeof player.identity !== 'string' || player.id !== player.identity + ':' + army.season
                        || player.identity !== DraftRoom.canonicalPlayerIdentity(player) || usedPlayers.has(player.id)) invalid('Invalid or duplicated historical player.');
                    if (!finite(player.referencePoints) || (player.referenceSeason !== null
                        && (!Number.isInteger(player.referenceSeason) || player.referenceSeason >= army.season))) invalid('Invalid preseason reference.');
                    usedPlayers.add(player.id);
                }
                if (!army.players.some(player => player.position === 'QB') || army.players.filter(player => player.position !== 'QB').length < 4) invalid('A ruler cannot field the original lineup.');
            }
            if (!finite(faction.favorBalance) || faction.favorBalance < 0 || faction.favorBalance > Favors.STARTING_FAVOR_BALANCE) invalid('Invalid favor treasury.');
            if (state.phase === 'preseason') {
                if (faction.activeArmyId !== null || faction.rulerRoll !== null || !Array.isArray(faction.lineup) || faction.lineup.length) invalid('A sealed ruler cannot have a lineup.');
            } else {
                const army = activeArmy(faction);
                if (!army || !Number.isInteger(faction.rulerRoll) || faction.rulerRoll < army.rollBand.min || faction.rulerRoll > army.rollBand.max
                    || !legalLineup(faction, faction.lineup)) invalid('Invalid walking ruler or lineup.');
            }
        }
        if (!Array.isArray(state.completedWeeks) || state.completedWeeks.length !== state.week - 1) invalid('Completed weeks must be consecutive.');
        for (const [index, week] of state.completedWeeks.entries()) {
            if (!week || week.week !== index + 1 || !Array.isArray(week.factions) || !exactIds(week.factions.map(result => result?.factionId))) invalid('Incomplete weekly results.');
            for (const result of week.factions) {
                const faction = factionOf(state, result.factionId), army = activeArmy(faction);
                if (result.armyId !== army.id || result.season !== army.season || !Array.isArray(result.players) || result.players.length !== 8) invalid('Invalid weekly army.');
                if (!finite(result.baseTotal) || !finite(result.total) || !finite(result.favorCost) || result.favorCost < 0) invalid('Invalid weekly score.');
                const playerIds = result.players.map(player => player?.id);
                if (new Set(playerIds).size !== 8 || playerIds.some(id => !army.players.some(player => player.id === id))) invalid('Invalid weekly players.');
                for (const player of result.players) if (!finite(player.basePoints) || !finite(player.effectivePoints)
                    || typeof player.starter !== 'boolean' || typeof player.hasRecordedGame !== 'boolean') invalid('Invalid player result.');
                if (!legalLineup(faction, result.players.filter(player => player.starter).map(player => player.id))
                    || result.baseTotal !== round(result.players.filter(player => player.starter).reduce((sum, player) => sum + player.basePoints, 0))
                    || result.total !== round(result.players.filter(player => player.starter).reduce((sum, player) => sum + player.effectivePoints, 0))) invalid('The weekly lineup does not match its total.');
            }
            if (!Array.isArray(week.allianceScores) || week.allianceScores.length !== 7) invalid('Missing alliance results.');
        }
        for (const faction of state.factions) {
            const spent = state.completedWeeks.reduce((sum, week) => sum + week.factions.find(result => result.factionId === faction.id).favorCost, 0);
            if (round(Favors.STARTING_FAVOR_BALANCE - spent) !== faction.favorBalance) invalid('The favor treasury does not match recorded spending.');
            if (faction.declaredFavor !== null) {
                if (state.phase !== 'season') invalid('Favors require an active season.');
                try { Favors.validateDeclaration({ declaration: faction.declaredFavor, week: state.week,
                    balance: faction.favorBalance, playerResults: planningPlayers(faction), history: historyFor(state, faction.id) }); }
                catch { invalid('Invalid pending favor.'); }
            }
        }
        if (!Array.isArray(state.alliances) || state.alliances.length !== 7
            || !exactIds(state.alliances.flatMap(alliance => alliance?.teamIds || []))
            || new Set(state.alliances.map(alliance => alliance.id)).size !== 7
            || state.alliances.some(alliance => alliance.teamIds.length !== 2)) invalid('Invalid Heptad alliances.');
        const conquest = state.conquest;
        if (!conquest || conquest.version !== 1 || !exactIds(conquest.factionIds) || !conquest.owners || !conquest.homes
            || !conquest.claimOrder || !conquest.pendingClaims || !Array.isArray(conquest.events)) invalid('Invalid conquest map.');
        const territoryIds = new Set(Rules.TERRITORIES.map(territory => territory.id));
        for (const [territoryId, owner] of Object.entries(conquest.owners)) if (!territoryIds.has(territoryId) || !ids.includes(owner)) invalid('Invalid territory owner.');
        for (const faction of Rules.FACTIONS) {
            if (conquest.homes[faction.id] !== faction.homeTerritoryId || conquest.owners[faction.homeTerritoryId] !== faction.id
                || !Array.isArray(conquest.claimOrder[faction.id]) || conquest.claimOrder[faction.id][0] !== faction.homeTerritoryId
                || new Set(conquest.claimOrder[faction.id]).size !== conquest.claimOrder[faction.id].length
                || conquest.claimOrder[faction.id].some(id => conquest.owners[id] !== faction.id)
                || !Number.isInteger(conquest.pendingClaims[faction.id]) || conquest.pendingClaims[faction.id] < 0 || conquest.pendingClaims[faction.id] > 28) invalid('Invalid faction territory state.');
        }
        if (!Array.isArray(state.playoffField) || !Array.isArray(state.activity)) invalid('Missing campaign progress.');
        if (state.week <= 14 && state.playoffField.length) invalid('Playoff seeds must wait for Week 14.');
        if (state.week >= 15 && (state.playoffField.length !== 7 || new Set(state.playoffField).size !== 7 || state.playoffField.some(id => !ids.includes(id)))) invalid('Invalid playoff field.');
        if (state.phase === 'complete' ? !state.heavenly?.complete || state.championId !== state.heavenly.championId || !ids.includes(state.championId)
            : state.championId !== null) invalid('Invalid champion.');
        return true;
    }
    return { SCORING, availableSeasons, createCampaign, applyAction, computeStandings, legalLineup,
        activeArmy, estimatePlayer, recommendedLineup, projectCampaign, validateCampaign };
});
