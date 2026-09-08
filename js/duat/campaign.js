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
            require('./favors.js'), root.App.TimeLeagueSeason, root.App.TimeLeagueDraftRoom, require('./world.js'));
        (root.App = root.App || {}).DuatCampaign = api;
        module.exports = api;
    } else {
        root.App.DuatCampaign = factory(root.App.DuatRules, root.App.DuatArmies, root.App.DuatConquest,
            root.App.DuatFavors, root.App.TimeLeagueSeason, root.App.TimeLeagueDraftRoom, root.App.DuatWorld);
    }
})(typeof window !== 'undefined' ? window : globalThis, function (Rules, Armies, Conquest, Favors, Season, DraftRoom, World) {
    'use strict';
    const SCORING = Object.freeze({ passTd: 4, reception: 0.5, rushRecYd: 0.1, passingYd: 0.04, turnover: -1 });
    const ROSTERS = Object.freeze({
        duat: { name: 'Original Duat', slots: ['QB','FLEX','FLEX','FLEX','FLEX'] },
        classic: { name: 'Classic fantasy', slots: ['QB','RB','RB','WR','WR','TE','FLEX'] },
        superflex: { name: 'Superflex', slots: ['QB','RB','RB','WR','WR','TE','FLEX','SUPER_FLEX'] }
    });
    function normalizeSettings(input = {}) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_SETTINGS', 'Choose valid campaign settings.');
        const defaults = { leagueSize: 14, mummyCount: 4, roster: 'duat', bench: 3, favors: true, favorBudget: 100, conquest: true, playoffTeams: 7 };
        if (Object.keys(input).some(key => !Object.hasOwn(defaults, key))) fail('INVALID_SETTINGS', 'Unknown campaign setting.');
        const value = { ...defaults, ...input };
        if (![8,10,12,14,16].includes(value.leagueSize) || ![1,2,4,5].includes(value.mummyCount)
            || !Object.hasOwn(ROSTERS, value.roster) || !Number.isInteger(value.bench) || value.bench < 1 || value.bench > 6
            || typeof value.favors !== 'boolean' || typeof value.conquest !== 'boolean'
            || !Number.isInteger(value.favorBudget) || value.favorBudget < 0 || value.favorBudget > 500
            || ![2,4,6,7,8].includes(value.playoffTeams) || value.playoffTeams > value.leagueSize) fail('INVALID_SETTINGS', 'Choose supported league, roster, treasury and playoff settings.');
        return value;
    }
    function normalizeScoring(input = {}) {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !Object.hasOwn(SCORING,key))) fail('INVALID_SCORING', 'Choose valid scoring rules.');
        const value = { ...SCORING, ...input }, ranges = { passTd:[0,10], reception:[0,2], rushRecYd:[0,1], passingYd:[0,1], turnover:[-10,0] };
        for (const [key,[min,max]] of Object.entries(ranges)) if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) fail('INVALID_SCORING', 'Scoring values are outside the supported range.');
        return value;
    }
    function settingsOf(state) { return state?.version === 3 ? normalizeSettings(state.settings) : normalizeSettings(); }
    function slotsOf(faction) { return ROSTERS[faction?.roster || 'duat'].slots; }
    function regularSeasonWeeks(state) { return state?.calendarVersion === 2 ? 17 - Math.ceil(Math.log2(settingsOf(state).playoffTeams)) : 14; }
    function rosterSize(state) { const settings = settingsOf(state); return ROSTERS[settings.roster].slots.length + settings.bench; }
    function pickCount(state) { return settingsOf(state).leagueSize * settingsOf(state).mummyCount * rosterSize(state); }
    function rulerBands(count) { return Array.from({length:count}, (_,i) => ({ min: i*20/count+1, max:(i+1)*20/count, label: (i*20/count+1)+'–'+((i+1)*20/count) })); }
    function accepts(slot, position) { return slot === position || slot === 'SUPER_FLEX' || slot === 'FLEX' && position !== 'QB'; }
    // Small dynamic program finds the strongest legal lineup without using future results.
    function bestLineup(players, slots, points = player => player.referencePoints || 0) {
        const states = new Map([[0, {score:0, players:[]}]]);
        for (const player of players) for (const [mask, entry] of [...states]) {
            for (let i=0;i<slots.length;i++) if (!(mask & (1<<i)) && accepts(slots[i], player.position)) {
                const next = mask | (1<<i), score = entry.score + points(player);
                if (!states.has(next) || score > states.get(next).score) { const selected = [...entry.players]; selected[i] = player; states.set(next,{score,players:selected}); }
            }
        }
        return states.get((1<<slots.length)-1)?.players || [];
    }
    function shortages(players, slots) {
        const counts = Object.fromEntries(['QB','RB','WR','TE'].map(p => [p,players.filter(player=>player.position===p).length]));
        const need = {QB:0,RB:0,WR:0,TE:0,FLEX:0,SUPER_FLEX:0};
        for (const slot of slots) {
            const eligible = slot === 'FLEX' ? ['RB','WR','TE'] : slot === 'SUPER_FLEX' ? ['QB','RB','WR','TE'] : [slot];
            const position = eligible.find(p=>counts[p]>0);
            if (position) counts[position]--; else need[slot]++;
        }
        return need;
    }
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
    function priorReference(card, season, scoring) {
        const previous = (card.seasons || []).filter(item => item.season < season && item.games > 0)
            .sort((a, b) => b.season - a.season)[0];
        return previous && Number.isFinite(previous.points)
            ? { referencePoints: round((scoring ? Season.scoreStatLine(previous, scoring, {}) : previous.points) / previous.games), referenceSeason: previous.season }
            : { referencePoints: baseline(card.position), referenceSeason: null };
    }
    function activeArmy(faction) { return faction.armies.find(army => army.id === faction.activeArmyId) || null; }
    function legalLineup(faction, ids) {
        const army = activeArmy(faction);
        const slots = slotsOf(faction);
        if (!army || !Array.isArray(ids) || ids.length !== slots.length || new Set(ids).size !== slots.length) return false;
        const players = ids.map(id => army.players.find(player => player.id === id));
        return players.every(Boolean) && bestLineup(players, slots).length === slots.length;
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
        return bestLineup(ranked, slotsOf(faction), player => estimatePlayer(state, factionId, player.id).points).map(player=>player.id);
    }

    const draftPoolCache = new WeakMap();
    function draftPool(data, season, scoring) {
        const source = data?.cards;
        if (!source || typeof source !== 'object') fail('DATA_UNAVAILABLE', 'Historical player cards have not loaded.');
        let cache = draftPoolCache.get(source);
        if (!cache) { cache = new Map(); draftPoolCache.set(source, cache); }
        const key = season + ":" + JSON.stringify(scoring || null);
        if (!cache.has(key)) cache.set(key, cardsOf(data)
            .filter(card => SKILL_POSITIONS.has(card.position) && card.seasons?.some(item => item.season === season))
            .map(card => {
                const identity = card.identity || DraftRoom.canonicalPlayerIdentity(card);
                return { id: identity + ':' + season, identity, name: card.name, position: card.position,
                    season, ...priorReference(card, season, scoring) };
            }).sort((a, b) => b.referencePoints - a.referencePoints || a.id.localeCompare(b.id)));
        return cache.get(key);
    }
    function turnAt(state, cursor) {
        if (!state.draft || cursor < 0 || cursor >= pickCount(state)) return null;
        const teams = settingsOf(state).leagueSize, rounds = rosterSize(state);
        const armyIndex = Math.floor(cursor / (teams * rounds));
        const within = cursor % (teams * rounds), round = Math.floor(within / teams) + 1, position = within % teams;
        return { number: cursor + 1, factionId: state.draft.order[round % 2 ? position : teams - 1 - position],
            armyNumber: armyIndex + 1, round, pickInRound: position + 1, season: state.seasons[armyIndex] };
    }

    function draftTurn(state) {
        return state.phase === 'draft' && state.draft?.status === 'active' ? turnAt(state, state.draft.cursor) : null;
    }
    function draftCandidates(state, data, options = {}) {
        const turn = draftTurn(state);
        if (!turn) return [];
        const faction = factionOf(state, turn.factionId), army = faction.armies.find(item => item.season === turn.season);
        const used = new Set(state.factions.flatMap(item => item.armies.flatMap(team => team.players.map(player => player.id))));
        const pool = draftPool(data, turn.season, state.version === 3 ? state.scoring : undefined).filter(player => !used.has(player.id));
        const slots = slotsOf(faction), slotsLeft = rosterSize(state) - army.players.length - 1;
        const otherNeeds = state.factions.filter(f=>f.id!==faction.id).map(f=>shortages(f.armies.find(a=>a.season===turn.season).players, slots));
        const available = Object.fromEntries(['QB','RB','WR','TE'].map(p=>[p,pool.filter(player=>player.position===p).length]));
        const query = String(options.query || '').trim().toLowerCase();
        return pool.filter(player => {
            const own = shortages([...army.players,player], slots);
            if (Object.values(own).reduce((a,b)=>a+b,0) > slotsLeft) return false;
            const needed = {...own}; for (const other of otherNeeds) for (const key of Object.keys(needed)) needed[key] += other[key];
            const left = {...available}; left[player.position]--;
            for (const position of ['QB','RB','WR','TE']) { left[position] -= needed[position]; if(left[position]<0) return false; }
            if (left.RB + left.WR + left.TE < needed.FLEX || Object.values(left).reduce((a,b)=>a+b,0) < needed.FLEX + needed.SUPER_FLEX) return false;
            return (!options.position || player.position === options.position) && (!query || player.name.toLowerCase().includes(query));
        }).map(player => ({ ...player }));
    }

    function saveDraftPick(state, player, createdAt) {
        const turn = turnAt(state, state.draft.cursor), faction = factionOf(state, turn.factionId);
        const army = faction.armies.find(item => item.season === turn.season);
        const { season: _season, ...card } = player;
        army.players.push(card);
        state.draft.picks.push({ ...turn, playerId: player.id, playerName: player.name, position: player.position });
        state.draft.cursor++;
        if (state.draft.cursor === pickCount(state)) {
            state.draft.status = 'complete'; state.phase = 'reveal';
            state.activity.push({ week: 0, type: 'draft-complete', message: 'The armies are complete. The archaeologist can begin opening the tombs.', createdAt });
        }
    }
    function advanceAIDraft(state, data, createdAt) {
        while (state.phase === 'draft') {
            const turn = draftTurn(state);
            if (!turn || state.humanFactionIds.includes(turn.factionId)) break;
            const faction = factionOf(state, turn.factionId), army = faction.armies.find(item => item.season === turn.season);
            const qb = army.players.filter(player => player.position === 'QB').length;
            const skill = army.players.length - qb;
            const candidates = draftCandidates(state, data);
            if (!candidates.length) fail('INSUFFICIENT_PLAYERS', 'This draft cannot fill every legal army.');
            const random = Rules.createSeededRandom(state.seed + ':draft-ai:' + state.draft.cursor);
            const ranked = candidates.map(player => ({ player, value: player.referencePoints
                * (shortages(army.players, slotsOf(faction))[player.position] > 0 ? 1.2 : 0.55) + random() * 0.2 }))
                .sort((a, b) => b.value - a.value || a.player.id.localeCompare(b.player.id));
            saveDraftPick(state, ranked[0].player, createdAt);
        }
        return state;
    }
    function revealProgress(state) {
        const order = state.archaeology?.order || [];
        const revealedCount = state.archaeology?.revealedFactionIds?.length || 0;
        return { revealedCount, total: order.length, nextFactionId: order[revealedCount] || null,
            complete: order.length > 0 && revealedCount === order.length, latest: state.archaeology?.latest ? copy(state.archaeology.latest) : null };
    }
    function revealFaction(state, factionId, createdAt) {
        const faction = factionOf(state, factionId), random = Rules.createSeededRandom(state.seed + ':ruler:' + faction.id);
        faction.rulerRoll = 1 + Math.floor(random() * 20);
        const army = faction.armies.find(item => faction.rulerRoll >= item.rollBand.min && faction.rulerRoll <= item.rollBand.max);
        faction.activeArmyId = army.id;
        faction.lineup = recommendedLineup(state, faction.id);
        state.archaeology.revealedFactionIds.push(faction.id);
        state.archaeology.latest = { factionId: faction.id, factionName: faction.name, armyId: army.id,
            rulerRoll: faction.rulerRoll, season: army.season, players: copy(army.players),
            narration: { title: 'The tomb of ' + faction.name,
                lines: ['The archaeologist brushes the dust from ' + faction.armies.length + ' royal seals.',
                    'The die falls on ' + faction.rulerRoll + '. The ' + army.season + ' ruler answers.',
                    army.players.length + ' names emerge from the stone. ' + faction.name + ' has its walking army.'] } };
        state.activity.push({ week: 0, type: 'archaeology', factionId: faction.id,
            message: faction.name + ' awakens its ' + army.season + ' ruler.', createdAt });
        if (state.archaeology.revealedFactionIds.length === state.factions.length) {
            state.phase = 'season';
            state.activity.push({ week: 0, type: 'reveal', message: state.factions.length + ' rulers walk again. Week 1 is open.', createdAt });
        }
    }
    function createDraftCampaign(input, data) {
        const version = input.version === 3 ? 3 : 2, settings = version === 3 ? normalizeSettings(input.settings) : normalizeSettings();
        const scoring = version === 3 ? normalizeScoring(input.scoring) : {...SCORING};
        const slots = ROSTERS[settings.roster].slots, size = slots.length + settings.bench;
        const seasons = input.seasons || availableSeasons(data).slice(0, settings.mummyCount);
        if (!Array.isArray(seasons) || seasons.length !== settings.mummyCount || new Set(seasons).size !== settings.mummyCount || seasons.some(season => !Number.isInteger(season))) fail('INVALID_SEASONS', 'Choose one complete historical season per mummy roster.');
        requireCoverage(seasons, data);
        const hostFactionId = input.hostFactionId || World.FACTIONS[0].id;
        const requested = input.factionIds || [...new Set([hostFactionId, ...(input.humanFactionIds || []), ...World.FACTIONS.map(faction => faction.id)])].slice(0, settings.leagueSize);
        if (!Array.isArray(requested) || requested.length !== settings.leagueSize || new Set(requested).size !== settings.leagueSize || requested.some(id => !World.factionById(id))) fail('INVALID_FACTIONS', 'Choose the selected number of different factions for the campaign.');
        const humanFactionIds = [...new Set([hostFactionId, ...(input.humanFactionIds || [])])];
        if (humanFactionIds.some(id => !requested.includes(id))) fail('INVALID_FACTIONS', 'Every human faction must be part of the active factions.');
        for (const season of seasons) {
            const pool = draftPool(data, season, version === 3 ? scoring : undefined);
            const need = shortages([], slots);
            if (pool.length < settings.leagueSize * size || ['QB','RB','WR','TE'].some(position => pool.filter(p=>p.position===position).length < need[position]*settings.leagueSize)
                || pool.filter(p=>p.position!=='QB').length < (slots.filter(s=>s!=='QB' && s!=='SUPER_FLEX').length)*settings.leagueSize) fail('INSUFFICIENT_PLAYERS', 'These years cannot supply every legal army. Reduce league or roster size.');
        }
        const seed = string(input.seed, 'campaign seed'), createdAt = timestamp(input.createdAt);
        const factions = requested.map(id => ({ ...copy(World.factionById(id)), ...(version === 3 ? {roster:settings.roster} : {}), controller: humanFactionIds.includes(id) ? 'human' : 'ai',
            armies: seasons.map((season, index) => ({ id: id + ':' + season, season, rulerNumber: index + 1,
                rulerName: season + ' Ruler', rollBand: copy(rulerBands(settings.mummyCount)[index]), players: [] })),
            activeArmyId: null, rulerRoll: null, lineup: [], favorBalance: settings.favors ? settings.favorBudget : 0, declaredFavor: null }));
        return { version, ...(version === 3 ? {settings, calendarVersion:2} : {}), id: string(input.id, 'campaign ID'), name: string(input.name || 'The Duat', 'campaign name'),
            seed, createdAt, updatedAt: createdAt, phase: 'draft', week: 1, seasons: [...seasons],
            hostFactionId, humanFactionIds, scoring, factions,
            draft: { status: 'waiting', order: Armies.seededShuffle(requested, seed + ':draft-order'), cursor: 0,
                totalPicks: settings.leagueSize * settings.mummyCount * size, picks: [] },
            archaeology: { order: Armies.seededShuffle(requested, seed + ':archaeology'), revealedFactionIds: [], latest: null },
            alliances: Rules.buildHeptadAlliances(requested, { allianceSize: 2, scoring: 'best-ball', startWeek: 2 }, seed,
                id => factions.find(faction => faction.id === id).name),
            conquest: Conquest.createConquest({ season: 1, factionIds: requested, worldId: World.WORLD_ID, seed: seed + ':world' }),
            completedWeeks: [], playoffField: [], championId: null, heptad: null, heavenly: null,
            activity: [{ week: 0, type: 'founded', message: settings.mummyCount + ' royal armies must be drafted before the tombs can open.', createdAt }] };
    }

    function createCampaign(input, data) {
        if (input.version !== undefined && ![1, 2, 3].includes(input.version)) fail('INVALID_VERSION', 'Choose a supported campaign version.');
        if (input.version !== 1) return createDraftCampaign(input, data);
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
        for (const week of state.completedWeeks.filter(item => item.week <= regularSeasonWeeks(state))) {
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
        if (!settingsOf(state).conquest) return [];
        return state.humanFactionIds.filter(id => state.conquest.pendingClaims[id] > 0 && Conquest.eligibleTerritories(state.conquest, id).length > 0);
    }
    function settleAIWorldActions(state, createdAt) {
        if (!settingsOf(state).conquest || state.version < 2 || state.phase !== 'season') return state;
        for (const faction of state.factions.filter(item => item.controller === 'ai')) {
            while (state.conquest.campaignActions[faction.id] > 0) {
                const previews = Conquest.attackableTerritories(state.conquest, faction.id)
                    .map(territoryId => ({ territoryId, ...Conquest.previewAttack(state.conquest, { factionId: faction.id, territoryId }) }))
                    .filter(item => item.canAttack).sort((a, b) => b.winChance - a.winChance || a.territoryId.localeCompare(b.territoryId));
                const random = Rules.createSeededRandom(state.seed + ':world-ai:' + state.week + ':' + faction.id + ':' + state.conquest.events.length);
                const threshold = 0.45 + random() * 0.15;
                if (previews.length && previews[0].winChance >= threshold) {
                    state.conquest = Conquest.attackTerritory(state.conquest, { factionId: faction.id, territoryId: previews[0].territoryId, createdAt });
                    continue;
                }
                const defenses = Conquest.fortifiableTerritories(state.conquest, faction.id)
                    .sort((a, b) => (state.conquest.fortifications[a] || 0) - (state.conquest.fortifications[b] || 0) || a.localeCompare(b));
                if (!defenses.length) break;
                state.conquest = Conquest.fortifyTerritory(state.conquest, { factionId: faction.id, territoryId: defenses[0], createdAt });
            }
        }
        return state;
    }
    function settleAIClaims(state, createdAt) {
        if (!settingsOf(state).conquest) return state;
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
        return settleAIWorldActions(state, createdAt);
    }
    function chooseAIFavor(state, faction) {
        if (!settingsOf(state).favors || !Rules.SACRED_WEEKS.includes(state.week) || faction.favorBalance < 10) return null;
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
            if (!legalLineup(faction, faction.lineup)) fail('INVALID_LINEUP', faction.name + ' must fill every starting roster slot.');
        }
        const results = state.factions.map(faction => {
            const army = activeArmy(faction);
            const rawPlayers = army.players.map(player => {
                const log = logIndex.get(Season.gameLogKey(player.identity, army.season, state.week));
                const basePoints = log ? Season.scoreStatLine(log.stats, state.scoring, {}) : 0;
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
        const allianceScores = state.alliances.map(alliance => {
            const pool = results.filter(r=>alliance.teamIds.includes(r.factionId)).flatMap(r=>r.players.filter(p=>p.starter));
            return { allianceId: alliance.id, total: round(bestLineup(pool, slotsOf(state.factions[0]), p=>p.basePoints).reduce((sum,p)=>sum+p.basePoints,0)) };
        });
        const completed = { week: state.week, factions: results, allianceScores, standings: [], heptad: null, heavenly: null };
        state.completedWeeks.push(completed);
        completed.standings = computeStandings(state);
        if (settingsOf(state).conquest && (state.week <= 14 || state.version >= 2)) {
            const ranks = [...results].sort((a, b) => b.total - a.total || a.factionId.localeCompare(b.factionId));
            state.conquest = Conquest.recordWeek(state.conquest, { week: state.week, createdAt,
                results: ranks.map((result, index) => ({ factionId: result.factionId, place: index + 1, score: result.total })) });
        }
        const allianceTotal = (id, week) => state.completedWeeks.find(item => item.week === week)?.allianceScores.find(item => item.allianceId === id)?.total ?? null;
        state.heptad = Rules.runHeptadGauntlet(state.alliances, allianceTotal, 2);
        if (state.week === regularSeasonWeeks(state)) state.playoffField = completed.standings.slice(0, settingsOf(state).playoffTeams).map(row => row.factionId);
        const factionTotal = (id, week) => state.completedWeeks.find(item => item.week === week)?.factions.find(item => item.factionId === id)?.total ?? null;
        state.heavenly = state.playoffField.length ? Rules.runHeavenlyBattle(state.playoffField, factionTotal, 18 - Math.ceil(Math.log2(settingsOf(state).playoffTeams))) : null;
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
        if (['claim','attack','fortify'].includes(action.type) && !settingsOf(state).conquest) fail('CONQUEST_DISABLED', 'Conquest is turned off for this campaign.');
        if (['declare-favor','clear-favor'].includes(action.type) && !settingsOf(state).favors) fail('FAVORS_DISABLED', 'Divine favors are turned off for this campaign.');
        const next = copy(state);
        const createdAt = timestamp(action.createdAt || state.updatedAt);
        if (['start-draft', 'draft-pick', 'reveal-next'].includes(action.type)) {
            if (state.version < 2) fail('INVALID_ACTION', 'This campaign uses the original preseason flow.');
            if (action.type !== 'draft-pick' && action.factionId && action.factionId !== state.hostFactionId) fail('HOST_REQUIRED', 'Only the host can advance the draft or archaeology.');
            if (action.type === 'start-draft') {
                if (state.phase !== 'draft' || state.draft.status !== 'waiting') fail('INVALID_PHASE', 'This draft has already started.');
                requireCoverage(state.seasons, data);
                next.draft.status = 'active';
                next.activity.push({ week: 0, type: 'draft-started', message: 'The army draft is open. Every human controls their own picks.', createdAt });
                advanceAIDraft(next, data, createdAt);
            } else if (action.type === 'draft-pick') {
                const turn = draftTurn(state);
                if (!turn) fail('INVALID_PHASE', 'The draft is not accepting picks.');
                if (turn.factionId !== action.factionId || !state.humanFactionIds.includes(action.factionId)) fail('DRAFT_TURN', 'Wait for your faction’s turn to draft.');
                const player = draftCandidates(state, data).find(item => item.id === action.playerId);
                if (!player) fail('INVALID_PICK', 'Choose an available player who leaves room for a legal army.');
                saveDraftPick(next, player, createdAt);
                advanceAIDraft(next, data, createdAt);
            } else {
                if (state.phase !== 'reveal') fail('INVALID_PHASE', 'Finish the draft before opening the tombs.');
                revealFaction(next, revealProgress(state).nextFactionId, createdAt);
            }
        } else if (action.type === 'reveal-rulers') {
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
                    if (!legalLineup(faction, action.playerIds)) fail('INVALID_LINEUP', 'Choose a complete legal starting lineup from your walking army.');
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
                } else if (action.type === 'attack' || action.type === 'fortify') {
                    if (next.version < 2) fail('INVALID_ACTION', 'This map does not use country battles.');
                    const operation = action.type === 'attack' ? Conquest.attackTerritory : Conquest.fortifyTerritory;
                    next.conquest = operation(next.conquest, { factionId: faction.id, territoryId: action.territoryId, createdAt });
                } else fail('INVALID_ACTION', 'Unknown campaign action.');
            }
        }
        next.updatedAt = createdAt;
        return next;
    }
    function projectCampaign(state, viewerFactionId, data) {
        factionOf(state, viewerFactionId);
        const projected = copy(state);
        delete projected.seed;
        if (projected.conquest) delete projected.conquest.seed;
        projected.factions = projected.factions.map(faction => {
            if (faction.id !== viewerFactionId) {
                faction.lineup = [];
                faction.declaredFavor = null;
                const sealed = state.version === 1 ? state.phase === 'preseason'
                    : !state.archaeology.revealedFactionIds.includes(faction.id);
                if (sealed) { faction.armies = []; faction.activeArmyId = null; faction.rulerRoll = null; }
            }
            return faction;
        });
        if (state.version >= 2) {
            projected.draft.picks = state.draft.picks.map(pick => pick.factionId === viewerFactionId ? copy(pick)
                : { number: pick.number, factionId: pick.factionId, armyNumber: pick.armyNumber, round: pick.round,
                    season: pick.season, sealed: true });
            projected.draft.turn = draftTurn(state);
            projected.draft.candidates = projected.draft.turn?.factionId === viewerFactionId && data ? draftCandidates(state, data) : [];
            projected.archaeology.progress = revealProgress(state);
        }
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
        const settings = settingsOf(state), size = rosterSize(state), totalPicks = pickCount(state), budget = settings.favors ? settings.favorBudget : 0;
        if (state?.version === 3 && (!state.settings || Object.keys(settings).some(key=>state.settings[key] !== settings[key]) || !state.scoring || Object.keys(normalizeScoring(state.scoring)).some(key=>state.scoring[key] !== normalizeScoring(state.scoring)[key]))) invalid('Invalid campaign rules.');
        if (state?.calendarVersion !== undefined && (state.version !== 3 || state.calendarVersion !== 2)) invalid('Invalid campaign calendar.');
        const finite = value => typeof value === 'number' && Number.isFinite(value);
        if (!state || ![1, 2, 3].includes(state.version) || !(state.version === 1 ? ['preseason', 'season', 'complete'] : ['draft', 'reveal', 'season', 'complete']).includes(state.phase)) invalid('Unsupported Duat campaign.');
        if (!Number.isInteger(state.week) || state.week < 1 || state.week > 18
            || (['preseason', 'draft', 'reveal'].includes(state.phase) && state.week !== 1)
            || (state.phase === 'season' && state.week > 17)
            || (state.phase === 'complete' && state.week !== 18)) invalid('Invalid campaign week.');
        for (const key of ['id', 'name', 'seed', 'createdAt', 'updatedAt']) if (typeof state[key] !== 'string' || !state[key] || state[key].length > 160) invalid('Missing campaign identity.');
        if (!Number.isFinite(Date.parse(state.createdAt)) || !Number.isFinite(Date.parse(state.updatedAt))) invalid('Invalid campaign timestamp.');
        if (!Array.isArray(state.seasons) || state.seasons.length !== settings.mummyCount || new Set(state.seasons).size !== settings.mummyCount
            || state.seasons.some(year => !Number.isInteger(year) || year < 1920 || year > 2100)) invalid('Invalid ruler years.');
        const catalog = state.version >= 2 ? World.FACTIONS : Rules.FACTIONS;
        const knownIds = catalog.map(faction => faction.id);
        if (!Array.isArray(state.factions) || state.factions.length !== settings.leagueSize || new Set(state.factions.map(f => f?.id)).size !== settings.leagueSize || state.factions.some(f => !knownIds.includes(f?.id))) invalid('The saved factions do not match the league size.');
        const ids = state.factions.map(faction => faction.id);
        const drafting = state.version >= 2 && state.phase === 'draft';
        const exactIds = values => Array.isArray(values) && values.length === settings.leagueSize && new Set(values).size === settings.leagueSize && values.every(id => ids.includes(id));
        if (!Array.isArray(state.factions) || !exactIds(state.factions.map(faction => faction?.id))) invalid('The campaign requires its selected factions.');
        if (!Array.isArray(state.humanFactionIds) || !state.humanFactionIds.length || new Set(state.humanFactionIds).size !== state.humanFactionIds.length
            || state.humanFactionIds.some(id => !ids.includes(id)) || !state.humanFactionIds.includes(state.hostFactionId)) invalid('Invalid human faction seats.');
        if (state.version >= 2) {
            const draft = state.draft, archaeology = state.archaeology;
            if (!draft || !exactIds(draft.order) || !Number.isInteger(draft.cursor) || draft.cursor < 0 || draft.cursor > totalPicks
                || draft.totalPicks !== totalPicks || !Array.isArray(draft.picks) || draft.picks.length !== draft.cursor) invalid('Invalid army draft progress.');
            if (drafting ? !['waiting', 'active'].includes(draft.status) || draft.cursor === totalPicks
                || (draft.status === 'waiting' && draft.cursor !== 0)
                : draft.status !== 'complete' || draft.cursor !== totalPicks) invalid('The draft stage does not match its picks.');
            for (const [index, pick] of draft.picks.entries()) {
                const turn = turnAt(state, index);
                if (!pick || Object.keys(turn).some(key => pick[key] !== turn[key])) invalid('Draft picks must follow the snake order.');
                const army = state.factions.find(f => f.id === pick.factionId).armies?.find(a => a.season === pick.season);
                const player = army?.players?.find(p => p.id === pick.playerId);
                if (!player || pick.playerName !== player.name || pick.position !== player.position) invalid('A draft receipt does not match its army.');
            }
            for (const faction of state.factions) for (const army of faction.armies || []) {
                const picks = draft.picks.filter(p => p.factionId === faction.id && p.season === army.season);
                if (!Array.isArray(army.players) || picks.length !== army.players.length
                    || new Set(picks.map(p => p.playerId)).size !== picks.length) invalid('The draft cannot duplicate or invent players.');
            }
            if (!archaeology || !exactIds(archaeology.order) || !Array.isArray(archaeology.revealedFactionIds)
                || archaeology.revealedFactionIds.length > settings.leagueSize || archaeology.revealedFactionIds.some((id, index) => id !== archaeology.order[index])) invalid('Invalid archaeology order.');
            const revealed = archaeology.revealedFactionIds.length;
            if (drafting ? revealed !== 0 : state.phase === 'reveal' ? revealed >= settings.leagueSize : revealed !== settings.leagueSize) invalid('The archaeology stage does not match revealed teams.');
            if (revealed === 0 ? archaeology.latest !== null : !archaeology.latest || archaeology.latest.factionId !== archaeology.revealedFactionIds.at(-1)) invalid('Invalid latest tomb reveal.');
            if (revealed) {
                const latest = archaeology.latest, faction = state.factions.find(f => f.id === latest.factionId), army = activeArmy(faction);
                if (!army || latest.armyId !== army.id || latest.season !== army.season || latest.rulerRoll !== faction.rulerRoll
                    || !Array.isArray(latest.players) || latest.players.length !== size
                    || latest.players.some((player, index) => player.id !== army.players[index]?.id || player.name !== army.players[index]?.name)
                    || typeof latest.narration?.title !== 'string' || !Array.isArray(latest.narration?.lines)
                    || latest.narration.lines.length < 1 || latest.narration.lines.some(line => typeof line !== 'string')) invalid('Invalid archaeological player reveal.');
            }

        }
        const usedPlayers = new Set();
        for (const faction of state.factions) {
            if (state.version === 3 && faction.roster !== settings.roster) invalid('Faction roster rules do not match campaign rules.');
            if (faction.controller !== (state.humanFactionIds.includes(faction.id) ? 'human' : 'ai')) invalid('Invalid faction controller.');
            if (!Array.isArray(faction.armies) || faction.armies.length !== settings.mummyCount || new Set(faction.armies.map(army => army?.season)).size !== settings.mummyCount
                || new Set(faction.armies.map(army => army?.rulerNumber)).size !== settings.mummyCount) invalid('Each faction requires the configured number of rulers.');
            for (const army of faction.armies) {
                const band = rulerBands(settings.mummyCount)[army.rulerNumber - 1];
                if (!state.seasons.includes(army.season) || army.id !== faction.id + ':' + army.season || !band
                    || army.rollBand?.min !== band.min || army.rollBand?.max !== band.max) invalid('Invalid ruler identity or d20 band.');
                if (!Array.isArray(army.players) || (drafting ? army.players.length > size : army.players.length !== size) || new Set(army.players.map(player => player?.id)).size !== army.players.length) invalid('A ruler needs the configured number of distinct players.');
                for (const player of army.players) {
                    if (!player || typeof player.name !== 'string' || !player.name || !SKILL_POSITIONS.has(player.position)
                        || typeof player.identity !== 'string' || player.id !== player.identity + ':' + army.season
                        || player.identity !== DraftRoom.canonicalPlayerIdentity(player) || usedPlayers.has(player.id)) invalid('Invalid or duplicated historical player.');
                    if (!finite(player.referencePoints) || (player.referenceSeason !== null
                        && (!Number.isInteger(player.referenceSeason) || player.referenceSeason >= army.season))) invalid('Invalid preseason reference.');
                    usedPlayers.add(player.id);
                }
                if ((!drafting || army.players.length === size) && Object.values(shortages(army.players, slotsOf(faction))).some(n=>n>0)) invalid('A ruler cannot field the campaign lineup.');
            }
            if (!finite(faction.favorBalance) || faction.favorBalance < 0 || faction.favorBalance > budget) invalid('Invalid favor treasury.');
            if (state.phase === 'preseason' || drafting || (state.phase === 'reveal' && !state.archaeology?.revealedFactionIds?.includes(faction.id))) {
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
                if (result.armyId !== army.id || result.season !== army.season || !Array.isArray(result.players) || result.players.length !== size) invalid('Invalid weekly army.');
                if (!finite(result.baseTotal) || !finite(result.total) || !finite(result.favorCost) || result.favorCost < 0) invalid('Invalid weekly score.');
                const playerIds = result.players.map(player => player?.id);
                if (new Set(playerIds).size !== size || playerIds.some(id => !army.players.some(player => player.id === id))) invalid('Invalid weekly players.');
                for (const player of result.players) if (!finite(player.basePoints) || !finite(player.effectivePoints)
                    || typeof player.starter !== 'boolean' || typeof player.hasRecordedGame !== 'boolean') invalid('Invalid player result.');
                if (!legalLineup(faction, result.players.filter(player => player.starter).map(player => player.id))
                    || result.baseTotal !== round(result.players.filter(player => player.starter).reduce((sum, player) => sum + player.basePoints, 0))
                    || result.total !== round(result.players.filter(player => player.starter).reduce((sum, player) => sum + player.effectivePoints, 0))) invalid('The weekly lineup does not match its total.');
            }
            if (!Array.isArray(week.allianceScores) || week.allianceScores.length !== settings.leagueSize / 2) invalid('Missing alliance results.');
        }
        for (const faction of state.factions) {
            const spent = state.completedWeeks.reduce((sum, week) => sum + week.factions.find(result => result.factionId === faction.id).favorCost, 0);
            if (round(budget - spent) !== faction.favorBalance) invalid('The favor treasury does not match recorded spending.');
            if (faction.declaredFavor !== null) {
                if (!settings.favors || state.phase !== 'season') invalid('Favors require an enabled active season.');
                try { Favors.validateDeclaration({ declaration: faction.declaredFavor, week: state.week,
                    balance: faction.favorBalance, playerResults: planningPlayers(faction), history: historyFor(state, faction.id) }); }
                catch { invalid('Invalid pending favor.'); }
            }
        }
        if (!Array.isArray(state.alliances) || state.alliances.length !== settings.leagueSize / 2
            || !exactIds(state.alliances.flatMap(alliance => alliance?.teamIds || []))
            || new Set(state.alliances.map(alliance => alliance.id)).size !== settings.leagueSize / 2
            || state.alliances.some(alliance => alliance.teamIds.length !== 2)) invalid('Invalid Heptad alliances.');
        const conquest = state.conquest;
        if (!conquest || conquest.version !== (state.version >= 2 ? 2 : 1) || !exactIds(conquest.factionIds) || !conquest.owners || !conquest.homes
            || !conquest.claimOrder || !conquest.pendingClaims || !Array.isArray(conquest.events)) invalid('Invalid conquest map.');
        const territoryIds = new Set((state.version >= 2 ? World.TERRITORIES : Rules.TERRITORIES).map(territory => territory.id));
        for (const [territoryId, owner] of Object.entries(conquest.owners)) if (!territoryIds.has(territoryId) || !ids.includes(owner)) invalid('Invalid territory owner.');
        for (const faction of catalog.filter(faction => ids.includes(faction.id))) {
            if (conquest.homes[faction.id] !== faction.homeTerritoryId || conquest.owners[faction.homeTerritoryId] !== faction.id
                || !Array.isArray(conquest.claimOrder[faction.id]) || conquest.claimOrder[faction.id][0] !== faction.homeTerritoryId
                || new Set(conquest.claimOrder[faction.id]).size !== conquest.claimOrder[faction.id].length
                || conquest.claimOrder[faction.id].some(id => conquest.owners[id] !== faction.id)
                || !Number.isInteger(conquest.pendingClaims[faction.id]) || conquest.pendingClaims[faction.id] < 0 || conquest.pendingClaims[faction.id] > 28) invalid('Invalid faction territory state.');
        }
        if (state.version >= 2) {
            if (conquest.worldId !== World.WORLD_ID || typeof conquest.seed !== 'string' || !conquest.seed
                || !conquest.campaignActions || !conquest.fortifications) invalid('Invalid country conquest state.');
            for (const id of ids) if (!Number.isInteger(conquest.campaignActions[id]) || conquest.campaignActions[id] < 0 || conquest.campaignActions[id] > 3) invalid('Invalid campaign action reserve.');
            for (const [id, level] of Object.entries(conquest.fortifications)) if (!territoryIds.has(id) || !conquest.owners[id]
                || !Number.isInteger(level) || level < 0 || level > 3) invalid('Invalid territorial fortification.');
        }
        if (!Array.isArray(state.playoffField) || !Array.isArray(state.activity)) invalid('Missing campaign progress.');
        if (state.week <= regularSeasonWeeks(state) && state.playoffField.length) invalid('Playoff seeds must wait for the regular season to finish.');
        if (state.week > regularSeasonWeeks(state) && (state.playoffField.length !== settings.playoffTeams || new Set(state.playoffField).size !== settings.playoffTeams || state.playoffField.some(id => !ids.includes(id)))) invalid('Invalid playoff field.');
        if (state.phase === 'complete' ? !state.heavenly?.complete || state.championId !== state.heavenly.championId || !ids.includes(state.championId)
            : state.championId !== null) invalid('Invalid champion.');
        return true;
    }
    return { SCORING, ROSTERS, normalizeSettings, normalizeScoring, settingsOf, regularSeasonWeeks, rosterSize, slotsOf, bestLineup, availableSeasons, createCampaign, applyAction, computeStandings, legalLineup,
        activeArmy, estimatePlayer, recommendedLineup, projectCampaign, validateCampaign, draftTurn, draftCandidates, revealProgress };
});
