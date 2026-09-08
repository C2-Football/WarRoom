// Pure conquest rules adapted from The Duat app/campaign.ts at ada801d.
// The caller supplies standings and timestamps. This module never invents scores,
// handles account authorization, reads storage, or changes a football roster.
/* global module, require */
(function (root, factory) {
    const rules = typeof module !== 'undefined' && module.exports
        ? require('./rules.js') : root.App.DuatRules;
    const world = typeof module !== 'undefined' && module.exports
        ? require('./world.js') : root.App.DuatWorld;
    const provinces = typeof module !== 'undefined' && module.exports
        ? require('./provinces.js') : root.App.DuatProvinces;
    const api = factory(rules, world, provinces);
    (root.App = root.App || {}).DuatConquest = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function (rules, world, provinces) {
    'use strict';

    // Explicit rules for the expanded board. Original v1 saves retain their
    // original claims and geography and never silently gain warfare rules.
    const COMBAT_RULES = Object.freeze({
        actionCost: 1, actionCap: 3, weeklyActions: 1, winnerActions: 2,
        maxFortification: 3, fortificationBonus: 4, defenderBonus: 2,
        scoreDivisor: 10, rankBonus: 0.5, supportBonus: 1, maxSupport: 3,
        dieSides: 20, homelandPolicy: 'protected', ties: 'defender-holds',
        description: 'Strength is 10 + nonnegative weekly fantasy points / 10 + 0.5 per finishing place above last. Nearby friendly territories add up to 3 support. Defense adds 2 and 4 per fortification level. Each side rolls a d20; ties hold for the defender.',
    });
    const round = value => Math.round(value * 100) / 100;
    const dynasty = state => state.expansionVersion === 1;
    const original = state => dynasty(state) && state.conquestMode === 'original';
    const expanded = state => state.version === 2 && (state.worldId === world?.WORLD_ID
        || (dynasty(state) && state.worldId === provinces?.WORLD_ID));
    const currentSeason = (state, event) => !dynasty(state) || event.season === state.season
        || (!event.season && event.id?.startsWith(`result-${state.season}-`));
    const seasonField = state => dynasty(state) ? { season: state.season } : {};
    const ORIGINAL_RULES = Object.freeze({
        description: 'The top half earn a claim; first place earns two and may use sea passages. When unclaimed connected land is exhausted, a higher completed weekly score can take a neighboring rival region. Last place loses its newest region, with its final region protected. Playoff survivors earn one claim. A war between top-half factions also consumes one unspent opposing claim.',
        source: 'The World Map workbook, Title Page A4:A16',
        adaptation: 'The source leaves crossing interactions incomplete. Here first place may use a declared sea route from owned land for one earned claim. Tied scores hold for the defender. A weekly claim opportunity expires at the next result; the same opportunity funds peaceful expansion or a score-driven war.',
        homelandPolicy: 'final-territory-protected', ties: 'defender-holds', seaPolicy: 'weekly-first-place',
    });
    // Cache static catalog indexes, not state-dependent legality or results.
    const catalogIndexes = new WeakMap(), campaignCatalogs = new WeakMap();
    function indexFor(catalog) {
        if (!catalogIndexes.has(catalog)) {
            const adjacency = new Map(catalog.TERRITORIES.map(t => [t.id, []]));
            catalog.ROUTES.forEach(route => {
                adjacency.get(route.from)?.push({ id: route.to, route });
                adjacency.get(route.to)?.push({ id: route.from, route });
            });
            catalogIndexes.set(catalog, { adjacency, territoryOrder: new Map(catalog.TERRITORIES.map((t, i) => [t.id, i])) });
        }
        return catalogIndexes.get(catalog);
    }
    function routeAllowed(state, factionId, route) {
        return !original(state) || route.type !== 'sea' || latestResult(state, factionId)?.place === 1;
    }
    function catalogFor(state) {
        if (state.version === 1 && !state.worldId) return rules;
        if (expanded(state)) {
            if (state.worldId !== provinces?.WORLD_ID) return world;
            if (!state.routes?.length) return provinces;
            if (!campaignCatalogs.has(state.routes)) campaignCatalogs.set(state.routes, { ...provinces,
                ROUTES: [...provinces.ROUTES, ...state.routes], SOURCE: { ...provinces.SOURCE,
                    routeNote: provinces.SOURCE.routeNote + ' Province combat adds clearly named campaign passages between selected rival fronts.',
                    startingDomainNote: 'Province combat starts each faction with three contiguous administrative regions. Capitals are protected; frontier provinces can fall.',
                } });
            return campaignCatalogs.get(state.routes);
        }
        fail('UNKNOWN_WORLD', 'This campaign uses an unavailable world.');
    }

    function fail(code, message) {
        const error = new Error(message);
        error.code = code;
        throw error;
    }

    function createConquest({ season, factionIds = rules.FACTIONS.map(faction => faction.id), worldId, seed, expansionVersion }) {
        if (!Number.isInteger(season) || season < 1) fail('INVALID_SEASON', 'A campaign season is required.');
        if (!Array.isArray(factionIds) || factionIds.length < 2 || new Set(factionIds).size !== factionIds.length) {
            fail('INVALID_FACTIONS', 'Choose distinct factions for the campaign.');
        }
        const catalog = worldId ? catalogFor({ version: 2, worldId, expansionVersion }) : rules;
        if (worldId && (typeof seed !== 'string' || !seed.trim())) fail('INVALID_SEED', 'The expanded campaign needs a battle seed.');
        const owners = {}, claimOrder = {}, pendingClaims = {}, homes = {};
        for (const factionId of factionIds) {
            const faction = catalog.FACTIONS.find(item => item.id === factionId);
            const home = faction?.homeTerritoryId || catalog.TERRITORIES.find(item => item.homelandOf === factionId)?.id;
            if (!faction || !home || !catalog.TERRITORIES.some(item => item.id === home)) {
                fail('INVALID_FACTION', 'Every faction needs a known homeland.');
            }
            if (owners[home]) fail('DUPLICATE_HOME', 'Factions cannot share a homeland.');
            owners[home] = factionId;
            homes[factionId] = home;
            claimOrder[factionId] = [home];
            pendingClaims[factionId] = 0;
        }
        return { version: worldId ? 2 : 1, season, factionIds: [...factionIds], homes, owners, claimOrder, pendingClaims, events: [],
            ...(expansionVersion === 1 ? { expansionVersion } : {}),
            ...(worldId ? { worldId, seed, campaignActions: Object.fromEntries(factionIds.map(id => [id, 0])), fortifications: {} } : {}) };
    }

    function createDynastyConquest({ season, factionIds = world.FACTIONS.map(f => f.id), seed,
        conquestMode = 'combat', worldScale = 'countries' }) {
        if (!['combat', 'original'].includes(conquestMode) || !['countries', 'provinces'].includes(worldScale)) {
            fail('INVALID_SETTINGS', 'Choose a supported conquest format and geography.');
        }
        if (worldScale === 'provinces' && !provinces) fail('UNKNOWN_WORLD', 'The province geography has not loaded.');
        const state = { ...createConquest({ season, factionIds, seed, expansionVersion: 1,
            worldId: worldScale === 'provinces' ? provinces.WORLD_ID : world.WORLD_ID }), conquestMode, worldScale };
        return worldScale === 'provinces' && conquestMode === 'combat' ? establishProvinceFronts(state) : state;
    }

    function establishProvinceFronts(state) {
        const { adjacency } = indexFor(provinces), owners = { ...state.owners }, claimOrder = { ...state.claimOrder };
        const radians = value => value * Math.PI / 180;
        const distance = (left, right) => {
            const a = provinces.territoryById(left), b = provinces.territoryById(right);
            const latitude = radians(b.latitude - a.latitude), longitude = radians(b.longitude - a.longitude);
            return Math.sin(latitude / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(longitude / 2) ** 2;
        };
        for (const id of state.factionIds) {
            const domain = [...claimOrder[id]];
            while (domain.length < 3) {
                const candidates = [...new Set(domain.flatMap(t => adjacency.get(t).filter(n => n.route.type === 'land' && !owners[n.id]).map(n => n.id)))];
                candidates.sort((a, b) => distance(state.homes[id], a) - distance(state.homes[id], b) || a.localeCompare(b));
                if (!candidates.length) break;
                owners[candidates[0]] = id; domain.push(candidates[0]);
            }
            claimOrder[id] = domain;
        }
        const keys = new Set(provinces.ROUTES.map(r => [r.from, r.to].sort().join(':'))), routes = [];
        for (const id of state.factionIds) {
            const rivals = state.factionIds.filter(r => r !== id).sort((a, b) => distance(state.homes[id], state.homes[a]) - distance(state.homes[id], state.homes[b]) || a.localeCompare(b)).slice(0, 2);
            for (const rival of rivals) {
                const candidates = claimOrder[id].filter(t => t !== state.homes[id]).flatMap(from => claimOrder[rival].filter(t => t !== state.homes[rival]).map(to => ({ from, to, distance: distance(from, to) })));
                candidates.sort((a, b) => a.distance - b.distance || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
                const pair = candidates[0]; if (!pair) continue;
                const [from, to] = [pair.from, pair.to].sort(), key = from + ':' + to;
                if (keys.has(key)) continue; keys.add(key);
                routes.push({ from, to, type: 'sea', origin: 'declared-campaign-passage',
                    name: `${provinces.factionById(id).name} / ${provinces.factionById(rival).name} campaign passage` });
            }
        }
        return { ...state, owners, claimOrder, routes,
            startingDomains: Object.fromEntries(state.factionIds.map(id => [id, [...claimOrder[id]]])) };
    }

    function continueSeason(state, { season, createdAt }) {
        if (!dynasty(state)) fail('DYNASTY_UNAVAILABLE', 'This saved campaign does not use continuing conquest.');
        if (!Number.isInteger(season) || season !== state.season + 1) fail('INVALID_SEASON', 'Continue to the next dynasty season in order.');
        if (typeof createdAt !== 'string' || !createdAt) fail('INVALID_TIME', 'The next season needs a timestamp.');
        const empty = Object.fromEntries(state.factionIds.map(id => [id, 0]));
        return { ...state, season, pendingClaims: { ...empty }, campaignActions: { ...empty },
            events: [...state.events, { id: `season-${season}`, type: 'season-start', season, createdAt }] };
    }

    function checkFaction(state, factionId) {
        if (!state.factionIds.includes(factionId)) fail('UNKNOWN_FACTION', 'This faction does not belong to the campaign.');
    }

    function eligibleTerritories(state, factionId) {
        checkFaction(state, factionId);
        const owned = new Set(Object.keys(state.owners).filter(id => state.owners[id] === factionId));
        const eligible = new Set(), catalog = catalogFor(state);
        if (state.worldScale === 'provinces') {
            const { adjacency } = indexFor(catalog);
            for (const id of owned) for (const neighbor of adjacency.get(id) || []) {
                if (!state.owners[neighbor.id] && routeAllowed(state, factionId, neighbor.route)) eligible.add(neighbor.id);
            }
        } else for (const route of catalog.ROUTES) {
            if (!routeAllowed(state, factionId, route)) continue;
            if (owned.has(route.from) && !state.owners[route.to]) eligible.add(route.to);
            if (owned.has(route.to) && !state.owners[route.from]) eligible.add(route.from);
        }
        return [...eligible];
    }

    // Internal single-faction operation. Public callers must submit the entire
    // week's verified standings through recordWeek so loss/reward order is fixed.
    function recordResult(state, { factionId, week, place, score, createdAt }) {
        checkFaction(state, factionId);
        if (!Number.isInteger(week) || week < 1 || week > (expanded(state) ? 17 : 14)) fail('INVALID_WEEK', 'Record results within this campaign’s football season.');
        if (!Number.isInteger(place) || place < 1 || place > state.factionIds.length || !Number.isFinite(score)) {
            fail('INVALID_RESULT', 'A verified score and finishing place are required.');
        }
        if (typeof createdAt !== 'string' || !createdAt) fail('INVALID_TIME', 'The result needs a timestamp.');
        const id = `result-${state.season}-${week}-${factionId}`;
        const previous = state.events.find(event => event.id === id);
        if (previous) {
            if (previous.place !== place || previous.score !== score) fail('RESULT_CONFLICT', 'This week already has a different result.');
            return state;
        }
        const lastWeek = state.events.filter(event => event.factionId === factionId && event.type === 'result' && currentSeason(state, event))
            .reduce((last, event) => Math.max(last, event.week), 0);
        if (week !== lastWeek + 1) fail('WEEK_ORDER', 'Record campaign weeks in order.');
        const result = { id, factionId, week, place, score, type: 'result', claimsAwarded: 0, createdAt };
        if (week <= 14 && place === state.factionIds.length) {
            // The newest conquest is lost; a homeland can never fall.
            const protectedHomes = new Set(Object.values(state.homes));
            const removable = [...state.claimOrder[factionId]].reverse().find(territoryId => !protectedHomes.has(territoryId));
            if (!removable) return { ...state, events: [...state.events, { ...result, outcome: 'homeland-held' }] };
            const owners = { ...state.owners };
            delete owners[removable];
            const fortifications = expanded(state) ? { ...state.fortifications } : null;
            if (fortifications) delete fortifications[removable];
            return {
                ...state, owners,
                ...(fortifications ? { fortifications } : {}),
                claimOrder: { ...state.claimOrder, [factionId]: state.claimOrder[factionId].filter(item => item !== removable) },
                events: [...state.events, { ...result, outcome: 'loss' }, {
                    id: `loss-${state.season}-${week}-${factionId}`, factionId, week, type: 'loss', territoryId: removable, createdAt,
                }],
            };
        }
        const requested = week > 14 ? 0 : place === 1 ? 2 : place <= Math.ceil(state.factionIds.length / 2) ? 1 : 0;
        const frontier = eligibleTerritories(state, factionId);
        const remaining = catalogFor(state).TERRITORIES.filter(item => !state.owners[item.id]).length;
        const currentClaims = state.pendingClaims[factionId];
        const realmComplete = requested > 0 && frontier.length === 0;
        const awarded = realmComplete ? 0 : Math.min(requested, Math.max(0, remaining - currentClaims));
        return {
            ...state,
            pendingClaims: { ...state.pendingClaims, [factionId]: realmComplete ? 0 : currentClaims + awarded },
            events: [...state.events, {
                ...result, claimsAwarded: awarded,
                outcome: realmComplete ? 'realm-complete' : awarded ? 'claims' : 'held',
            }],
        };
    }

    function recordWeek(state, { week, results, createdAt, regularSeasonWeeks = 14, advancingFactionIds = [] }) {
        if (dynasty(state)) return recordDynastyWeek(state, { week, results, createdAt, regularSeasonWeeks, advancingFactionIds });
        if (!Array.isArray(results) || results.length !== state.factionIds.length
            || new Set(results.map(result => result?.factionId)).size !== state.factionIds.length
            || results.some(result => !result || !state.factionIds.includes(result.factionId))) {
            fail('INCOMPLETE_WEEK', 'Verified results for every faction are required.');
        }
        // A last-place territory returns to the frontier before anybody earns
        // claims. Canonical faction order breaks delivery-order dependence.
        if (new Set(results.map(result => result.place)).size !== state.factionIds.length) {
            fail('INVALID_RESULT', 'Every finishing place must be assigned exactly once.');
        }
        const ordered = [...results].sort((left, right) =>
            Number(right.place === state.factionIds.length) - Number(left.place === state.factionIds.length)
            || state.factionIds.indexOf(left.factionId) - state.factionIds.indexOf(right.factionId));
        const next = ordered.reduce((current, result) => recordResult(current, {
            factionId: result.factionId, place: result.place, score: result.score, week, createdAt,
        }), state);
        if (!expanded(state) || next === state || week === 17) return next;
        const campaignActions = { ...state.campaignActions };
        const awardEvents = [];
        for (const factionId of state.factionIds) {
            const id = `result-${state.season}-${week}-${factionId}`;
            if (state.events.some(event => event.id === id)) continue;
            const result = results.find(item => item.factionId === factionId);
            const requested = result.place === 1 ? COMBAT_RULES.winnerActions : COMBAT_RULES.weeklyActions;
            const awarded = Math.min(requested, COMBAT_RULES.actionCap - campaignActions[factionId]);
            campaignActions[factionId] += awarded;
            awardEvents.push({ id: `actions-${state.season}-${week}-${factionId}`, type: 'actions', factionId, week,
                actionsAwarded: awarded, balance: campaignActions[factionId], createdAt });
        }
        return { ...next, campaignActions, events: [...next.events, ...awardEvents] };
    }

    function recordDynastyWeek(state, { week, results, createdAt, regularSeasonWeeks, advancingFactionIds }) {
        if (!Number.isInteger(week) || week < 1 || week > 17) fail('INVALID_WEEK', 'Record results within the seventeen-week football season.');
        if (!Number.isInteger(regularSeasonWeeks) || regularSeasonWeeks < 1 || regularSeasonWeeks > 16) fail('INVALID_CALENDAR', 'Choose a regular season ending before the championship.');
        if (typeof createdAt !== 'string' || !createdAt) fail('INVALID_TIME', 'The result needs a timestamp.');
        if (!Array.isArray(results) || results.length !== state.factionIds.length
            || new Set(results.map(r => r?.factionId)).size !== state.factionIds.length
            || results.some(r => !r || !state.factionIds.includes(r.factionId))) fail('INCOMPLETE_WEEK', 'Verified results for every faction are required.');
        if (new Set(results.map(r => r.place)).size !== results.length || results.some(r => !Number.isInteger(r.place)
            || r.place < 1 || r.place > results.length || !Number.isFinite(r.score))) fail('INVALID_RESULT', 'Every faction needs a verified score and distinct finishing place.');
        if (!Array.isArray(advancingFactionIds) || new Set(advancingFactionIds).size !== advancingFactionIds.length
            || advancingFactionIds.some(id => !state.factionIds.includes(id))) fail('INVALID_PLAYOFF', 'Playoff advances must name distinct factions in this campaign.');
        const prior = state.events.filter(e => e.type === 'result' && currentSeason(state, e) && e.week === week);
        if (prior.length) {
            if (prior.length !== results.length || prior.some(e => { const r = results.find(r => r.factionId === e.factionId);
                return !r || e.place !== r.place || e.score !== r.score || e.regularSeasonWeeks !== regularSeasonWeeks
                    || e.playoffAdvanced !== (week > regularSeasonWeeks && advancingFactionIds.includes(e.factionId)); })) fail('RESULT_CONFLICT', 'This week already has different verified results.');
            return state;
        }
        const latest = state.events.filter(e => e.type === 'result' && currentSeason(state, e)).reduce((n, e) => Math.max(n, e.week), 0);
        if (week !== latest + 1) fail('WEEK_ORDER', 'Record campaign weeks in order.');
        const owners = { ...state.owners }, claimOrder = Object.fromEntries(state.factionIds.map(id => [id, [...state.claimOrder[id]]])), fortifications = { ...state.fortifications };
        const homes = new Set(Object.values(state.homes)), regular = week <= regularSeasonWeeks;
        const last = results.find(r => r.place === results.length);
        let lost = null;
        if (regular) {
            const owned = claimOrder[last.factionId].filter(id => owners[id] === last.factionId);
            lost = owned.length > 1 ? [...owned].reverse().find(id => original(state) || !homes.has(id)) : null;
            if (lost) { delete owners[lost]; delete fortifications[lost]; claimOrder[last.factionId] = owned.filter(id => id !== lost); }
        }
        const resultEvents = state.factionIds.map(factionId => {
            const r = results.find(r => r.factionId === factionId);
            return { ...r, id: `result-${state.season}-${week}-${factionId}`, type: 'result', season: state.season,
                week, regularSeasonWeeks, playoffAdvanced: !regular && advancingFactionIds.includes(factionId), claimsAwarded: 0,
                outcome: regular && r.place === results.length ? (lost ? 'loss' : original(state) ? 'final-territory-held' : 'homeland-held') : 'held', createdAt };
        });
        let next = { ...state, owners, claimOrder, fortifications, events: [...state.events, ...resultEvents] };
        const pendingClaims = { ...state.pendingClaims }, campaignActions = { ...state.campaignActions };
        for (const event of resultEvents) {
            const id = event.factionId;
            const requested = regular ? event.place === 1 ? 2 : event.place <= Math.ceil(results.length / 2) ? 1 : 0 : event.playoffAdvanced ? 1 : 0;
            const hasFrontier = eligibleTerritories(next, id).length > 0;
            const canWar = original(next) && attackableTerritories(next, id).some(territoryId => {
                const defender = latestResult(next, next.owners[territoryId]);
                return defender && event.score > defender.score;
            });
            const possible = hasFrontier || canWar;
            const remaining = catalogFor(state).TERRITORIES.length - Object.keys(owners).length;
            event.claimsAwarded = possible ? original(state) ? requested : Math.min(requested, Math.max(0, remaining - pendingClaims[id])) : 0;
            pendingClaims[id] = original(state) ? event.claimsAwarded : possible ? pendingClaims[id] + event.claimsAwarded : 0;
            if (event.claimsAwarded) event.outcome = 'claims';
            else if (requested && !possible) event.outcome = 'frontier-blocked';
            if (original(state)) campaignActions[id] = pendingClaims[id];
            else if (week < 17) campaignActions[id] = Math.min(COMBAT_RULES.actionCap, campaignActions[id] + (event.place === 1 ? COMBAT_RULES.winnerActions : COMBAT_RULES.weeklyActions));
        }
        next = { ...next, pendingClaims, campaignActions };
        if (lost) next.events = [...next.events, { id: `loss-${state.season}-${week}-${last.factionId}`, type: 'loss', season: state.season,
            factionId: last.factionId, week, territoryId: lost, createdAt }];
        return next;
    }

    function claimTerritory(state, { factionId, territoryId, createdAt }) {
        checkFaction(state, factionId);
        if (typeof createdAt !== 'string' || !createdAt) fail('INVALID_TIME', 'The claim needs a timestamp.');
        if ((state.pendingClaims[factionId] || 0) < 1) fail('NO_CLAIMS', 'This faction has no claims to spend.');
        if (!eligibleTerritories(state, factionId).includes(territoryId)) {
            fail('NOT_CONNECTED', 'Choose an unclaimed territory connected to your realm.');
        }
        const week = state.events.filter(event => event.factionId === factionId && event.type === 'result' && currentSeason(state, event))
            .reduce((latest, event) => Math.max(latest, event.week), 0);
        return {
            ...state,
            owners: { ...state.owners, [territoryId]: factionId },
            claimOrder: { ...state.claimOrder, [factionId]: [...state.claimOrder[factionId], territoryId] },
            pendingClaims: { ...state.pendingClaims, [factionId]: state.pendingClaims[factionId] - 1 },
            ...(original(state) ? { campaignActions: { ...state.campaignActions, [factionId]: state.pendingClaims[factionId] - 1 } } : {}),
            events: [...state.events, {
                ...seasonField(state), id: `claim-${state.season}-${state.events.length + 1}-${factionId}`, factionId, week, type: 'claim', territoryId, createdAt,
            }],
        };
    }

    function ownedTerritories(state, factionId) {
        checkFaction(state, factionId);
        return catalogFor(state).TERRITORIES.filter(item => state.owners[item.id] === factionId);
    }

    function landTotals(state, factionId) {
        const catalog = catalogFor(state), owned = ownedTerritories(state, factionId);
        const worldAreaKm2 = catalog.TERRITORIES.reduce((total, territory) => total + (territory.areaKm2 || 0), 0);
        const areaKm2 = owned.reduce((total, territory) => total + (territory.areaKm2 || 0), 0);
        return {
            territoryCount: owned.length, territories: owned.map(territory => territory.id),
            worldTerritoryCount: catalog.TERRITORIES.length,
            areaKm2: worldAreaKm2 ? areaKm2 : null, totalAreaKm2: worldAreaKm2 || null,
            worldAreaKm2: worldAreaKm2 || null, percent: worldAreaKm2 ? round(areaKm2 / worldAreaKm2 * 100) : null,
            territoryPercent: round(owned.length / catalog.TERRITORIES.length * 100),
        };
    }

    function neighborsOf(state, territoryId, factionId) {
        const neighbors = indexFor(catalogFor(state)).adjacency.get(territoryId) || [];
        return neighbors.filter(n => !factionId || routeAllowed(state, factionId, n.route)).map(n => n.id);
    }

    function attackableTerritories(state, factionId) {
        checkFaction(state, factionId);
        if (!expanded(state)) return [];
        if (original(state) && eligibleTerritories(state, factionId).length) return [];
        const catalog = catalogFor(state), homes = new Set(Object.values(state.homes)), targets = new Set();
        const ownedCounts = {};
        if (original(state)) Object.values(state.owners).forEach(owner => { ownedCounts[owner] = (ownedCounts[owner] || 0) + 1; });
        for (const [id, owner] of Object.entries(state.owners)) {
            if (owner !== factionId) continue;
            for (const neighbor of neighborsOf(state, id, factionId)) {
                const rival = state.owners[neighbor];
                if (rival && rival !== factionId && (original(state) ? ownedCounts[rival] > 1 : !homes.has(neighbor))) targets.add(neighbor);
            }
        }
        const { territoryOrder } = indexFor(catalog);
        return [...targets].sort((a, b) => territoryOrder.get(a) - territoryOrder.get(b));
    }

    function fortifiableTerritories(state, factionId) {
        checkFaction(state, factionId);
        if (!expanded(state) || original(state)) return [];
        const homes = new Set(Object.values(state.homes));
        return ownedTerritories(state, factionId).filter(territory => !homes.has(territory.id)
            && (state.fortifications[territory.id] || 0) < COMBAT_RULES.maxFortification).map(item => item.id);
    }

    function latestResult(state, factionId) {
        return state.events.filter(event => event.type === 'result' && event.factionId === factionId && currentSeason(state, event))
            .reduce((latest, event) => !latest || event.week > latest.week ? event : latest, null);
    }

    function previewAttack(state, { factionId, territoryId }) {
        checkFaction(state, factionId);
        const base = { factionId, attackerId: factionId, defenderId: state.owners[territoryId] || null,
            territoryId, cost: COMBAT_RULES.actionCost, fortificationCost: COMBAT_RULES.actionCost, canAttack: false };
        if (!expanded(state)) return { ...base, code: 'COMBAT_UNAVAILABLE', reason: 'This original campaign uses peaceful conquest rules.' };
        if (!original(state) && Object.values(state.homes).includes(territoryId)) return { ...base, code: 'HOMELAND_PROTECTED', reason: 'A faction’s homeland is protected.' };
        if (!attackableTerritories(state, factionId).includes(territoryId)) return { ...base, code: 'NOT_CONNECTED', reason: 'Attack rival land connected to your realm.' };
        const attacker = latestResult(state, factionId), defender = latestResult(state, base.defenderId);
        if (!attacker || !defender || attacker.week !== defender.week) return { ...base, code: 'NO_BATTLE_RESULTS', reason: 'Both armies need results from the same completed week.' };
        if (original(state)) {
            const enough = (state.pendingClaims[factionId] || 0) >= 1, wins = attacker.score > defender.score;
            return { ...base, mode: 'original', canAttack: enough && wins,
                ...(!enough ? { code: 'NO_CLAIMS', reason: 'Earn a claim through football results before going to war.' }
                    : !wins ? { code: 'SCORE_TOO_LOW', reason: 'Your completed weekly score must exceed the defender’s; ties hold.' } : {}),
                week: attacker.week, attackerScore: attacker.score, defenderScore: defender.score,
                attackerPlace: attacker.place, defenderPlace: defender.place, offense: attacker.score, defense: defender.score,
                attackSupport: 0, defenseSupport: 0, fortification: 0, fortificationBonus: 0,
                winChance: wins ? 1 : 0, winChancePercent: wins ? 100 : 0,
                requiredRollLabel: 'The higher completed weekly score wins; no dice are rolled.',
            };
        }
        const strength = result => 10 + Math.max(0, result.score) / COMBAT_RULES.scoreDivisor
            + (state.factionIds.length - result.place) * COMBAT_RULES.rankBonus;
        const neighbors = neighborsOf(state, territoryId);
        const attackSupport = Math.min(COMBAT_RULES.maxSupport, neighbors.filter(id => state.owners[id] === factionId).length) * COMBAT_RULES.supportBonus;
        const defenseSupport = Math.min(COMBAT_RULES.maxSupport, neighbors.filter(id => state.owners[id] === base.defenderId).length) * COMBAT_RULES.supportBonus;
        const fortification = state.fortifications[territoryId] || 0;
        const offense = round(strength(attacker) + attackSupport);
        const defense = round(strength(defender) + defenseSupport + COMBAT_RULES.defenderBonus + fortification * COMBAT_RULES.fortificationBonus);
        let wins = 0;
        for (let attackRoll = 1; attackRoll <= 20; attackRoll++) for (let defenseRoll = 1; defenseRoll <= 20; defenseRoll++) {
            if (round(offense + attackRoll) > round(defense + defenseRoll)) wins++;
        }
        const actions = state.campaignActions[factionId] || 0;
        return { ...base, canAttack: actions >= COMBAT_RULES.actionCost && attacker.week < 17,
            ...(attacker.week >= 17 ? { code: 'CAMPAIGN_COMPLETE', reason: 'The campaign has ended.' }
                : actions < COMBAT_RULES.actionCost ? { code: 'NO_ACTIONS', reason: 'Play another football week to earn campaign actions.' } : {}),
            week: attacker.week, attackerScore: attacker.score, defenderScore: defender.score,
            attackerPlace: attacker.place, defenderPlace: defender.place, offense, defense, attackSupport, defenseSupport,
            fortification, fortificationBonus: fortification * COMBAT_RULES.fortificationBonus,
            winChance: wins / 400, winChancePercent: round(wins / 4),
            requiredRoll: Math.max(1, Math.min(21, Math.floor(defense + 10 - offense) + 1)), assumedDefenseRoll: 10,
            requiredRollLabel: 'Attack roll needed if the defender rolls 10; 21 means no winning roll.',
        };
    }

    function seededRoll(seed, key) {
        // FNV-1a followed by integer avalanche, stable in Node and browsers.
        // Never call this from a preview: a projected room need not expose seed.
        let hash = 2166136261;
        for (const character of seed + '|' + key) { hash ^= character.codePointAt(0); hash = Math.imul(hash, 16777619); }
        hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d); hash ^= hash >>> 15;
        hash = Math.imul(hash, 0x846ca68b); hash ^= hash >>> 16;
        return (hash >>> 0) % COMBAT_RULES.dieSides + 1;
    }

    function attackTerritory(state, { factionId, territoryId, createdAt }) {
        const preview = previewAttack(state, { factionId, territoryId });
        if (!preview.canAttack) fail(preview.code, preview.reason);
        if (!original(state) && (typeof state.seed !== 'string' || !state.seed)) fail('INVALID_SEED', 'Only the authoritative campaign can resolve a battle.');
        if (typeof createdAt !== 'string' || !createdAt) fail('INVALID_TIME', 'The battle needs a timestamp.');
        const id = `battle-${state.season}-${preview.week}-${factionId}-${state.events.length + 1}`;
        const attackerRoll = original(state) ? 0 : seededRoll(state.seed, id + '|' + territoryId + '|attack');
        const defenderRoll = original(state) ? 0 : seededRoll(state.seed, id + '|' + territoryId + '|defense');
        const attackerTotal = round(preview.offense + attackerRoll), defenderTotal = round(preview.defense + defenderRoll);
        const captured = attackerTotal > defenderTotal;
        const catalog = catalogFor(state);
        const attackerName = catalog.factionById(factionId).name, defenderName = catalog.factionById(preview.defenderId).name;
        const territoryName = catalog.territoryById(territoryId).name;
        const event = { ...preview, ...seasonField(state), id, type: 'battle', factionId, attackerRoll, defenderRoll, attackerTotal, defenderTotal,
            captured, outcome: captured ? 'captured' : 'defended', createdAt,
            narrative: captured ? `${attackerName} captured ${territoryName} from ${defenderName}, ${attackerTotal} to ${defenderTotal}.`
                : `${defenderName} held ${territoryName} against ${attackerName}, ${defenderTotal} to ${attackerTotal}.`,
        };
        const opposingClaim = original(state) && preview.attackerPlace <= Math.ceil(state.factionIds.length / 2)
            && preview.defenderPlace <= Math.ceil(state.factionIds.length / 2) && captured
            ? Math.min(1, state.pendingClaims[preview.defenderId] || 0) : 0;
        if (original(state)) event.opposingClaimCancelled = opposingClaim;
        const next = { ...state,
            ...(original(state) ? { pendingClaims: { ...state.pendingClaims, [factionId]: state.pendingClaims[factionId] - 1,
                [preview.defenderId]: state.pendingClaims[preview.defenderId] - opposingClaim } } : {}),
            campaignActions: { ...state.campaignActions, [factionId]: state.campaignActions[factionId] - COMBAT_RULES.actionCost,
                ...(original(state) ? { [preview.defenderId]: state.campaignActions[preview.defenderId] - opposingClaim } : {}) },
            events: [...state.events, event],
        };
        if (!captured) return next;
        return { ...next, owners: { ...state.owners, [territoryId]: factionId },
            claimOrder: { ...state.claimOrder, [factionId]: [...state.claimOrder[factionId], territoryId],
                [preview.defenderId]: state.claimOrder[preview.defenderId].filter(id => id !== territoryId) },
            fortifications: { ...state.fortifications, [territoryId]: Math.max(0, preview.fortification - 1) },
        };
    }

    function fortifyTerritory(state, { factionId, territoryId, createdAt }) {
        checkFaction(state, factionId);
        if (!expanded(state) || original(state)) fail('COMBAT_UNAVAILABLE', 'This original campaign uses peaceful conquest rules.');
        const latest = latestResult(state, factionId);
        if (!latest || latest.week >= 17) fail('NO_BATTLE_RESULTS', 'Fortify between completed football weeks.');
        if ((state.campaignActions[factionId] || 0) < COMBAT_RULES.actionCost) fail('NO_ACTIONS', 'Play another football week to earn campaign actions.');
        if (!fortifiableTerritories(state, factionId).includes(territoryId)) fail('INVALID_FORTIFICATION', 'Fortify your own conquered land, up to three levels.');
        if (typeof createdAt !== 'string' || !createdAt) fail('INVALID_TIME', 'The fortification needs a timestamp.');
        const level = (state.fortifications[territoryId] || 0) + 1;
        return { ...state,
            campaignActions: { ...state.campaignActions, [factionId]: state.campaignActions[factionId] - COMBAT_RULES.actionCost },
            fortifications: { ...state.fortifications, [territoryId]: level },
            events: [...state.events, { ...seasonField(state), id: `fortify-${state.season}-${state.events.length + 1}-${factionId}`,
                type: 'fortify', factionId, territoryId, week: latest.week, level, cost: COMBAT_RULES.actionCost,
                defenseBonus: level * COMBAT_RULES.fortificationBonus, createdAt,
                narrative: `${catalogFor(state).factionById(factionId).name} fortified ${catalogFor(state).territoryById(territoryId).name} to level ${level}.`,
            }],
        };
    }

    return { createConquest, createDynastyConquest, continueSeason, ORIGINAL_RULES, catalogFor, eligibleTerritories, recordWeek, claimTerritory, COMBAT_RULES,
        ownedTerritories, landTotals, attackableTerritories, fortifiableTerritories, previewAttack, attackTerritory, fortifyTerritory };
});
