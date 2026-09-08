// Pure conquest rules adapted from The Duat app/campaign.ts at ada801d.
// The caller supplies standings and timestamps. This module never invents scores,
// handles account authorization, reads storage, or changes a football roster.
/* global module, require */
(function (root, factory) {
    const rules = typeof module !== 'undefined' && module.exports
        ? require('./rules.js') : root.App.DuatRules;
    const world = typeof module !== 'undefined' && module.exports
        ? require('./world.js') : root.App.DuatWorld;
    const api = factory(rules, world);
    (root.App = root.App || {}).DuatConquest = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function (rules, world) {
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
    const expanded = state => state.version === 2 && state.worldId === world?.WORLD_ID;
    function catalogFor(state) {
        if (state.version === 1 && !state.worldId) return rules;
        if (expanded(state)) return world;
        fail('UNKNOWN_WORLD', 'This campaign uses an unavailable world.');
    }

    function fail(code, message) {
        const error = new Error(message);
        error.code = code;
        throw error;
    }

    function createConquest({ season, factionIds = rules.FACTIONS.map(faction => faction.id), worldId, seed }) {
        if (!Number.isInteger(season) || season < 1) fail('INVALID_SEASON', 'A campaign season is required.');
        if (!Array.isArray(factionIds) || factionIds.length < 2 || new Set(factionIds).size !== factionIds.length) {
            fail('INVALID_FACTIONS', 'Choose distinct factions for the campaign.');
        }
        const catalog = worldId ? catalogFor({ version: 2, worldId }) : rules;
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
            ...(worldId ? { worldId, seed, campaignActions: Object.fromEntries(factionIds.map(id => [id, 0])), fortifications: {} } : {}) };
    }

    function checkFaction(state, factionId) {
        if (!state.factionIds.includes(factionId)) fail('UNKNOWN_FACTION', 'This faction does not belong to the campaign.');
    }

    function eligibleTerritories(state, factionId) {
        checkFaction(state, factionId);
        const owned = new Set(Object.keys(state.owners).filter(id => state.owners[id] === factionId));
        const eligible = new Set();
        for (const route of catalogFor(state).ROUTES) {
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
        const lastWeek = state.events.filter(event => event.factionId === factionId && event.type === 'result')
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

    function recordWeek(state, { week, results, createdAt }) {
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

    function claimTerritory(state, { factionId, territoryId, createdAt }) {
        checkFaction(state, factionId);
        if (typeof createdAt !== 'string' || !createdAt) fail('INVALID_TIME', 'The claim needs a timestamp.');
        if ((state.pendingClaims[factionId] || 0) < 1) fail('NO_CLAIMS', 'This faction has no claims to spend.');
        if (!eligibleTerritories(state, factionId).includes(territoryId)) {
            fail('NOT_CONNECTED', 'Choose an unclaimed territory connected to your realm.');
        }
        const week = state.events.filter(event => event.factionId === factionId && event.type === 'result')
            .reduce((latest, event) => Math.max(latest, event.week), 0);
        return {
            ...state,
            owners: { ...state.owners, [territoryId]: factionId },
            claimOrder: { ...state.claimOrder, [factionId]: [...state.claimOrder[factionId], territoryId] },
            pendingClaims: { ...state.pendingClaims, [factionId]: state.pendingClaims[factionId] - 1 },
            events: [...state.events, {
                id: `claim-${state.season}-${state.events.length + 1}-${factionId}`, factionId, week, type: 'claim', territoryId, createdAt,
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

    function neighborsOf(state, territoryId) {
        const neighbors = new Set();
        for (const route of catalogFor(state).ROUTES) {
            if (route.from === territoryId) neighbors.add(route.to);
            if (route.to === territoryId) neighbors.add(route.from);
        }
        return [...neighbors];
    }

    function attackableTerritories(state, factionId) {
        checkFaction(state, factionId);
        if (!expanded(state)) return [];
        const homes = new Set(Object.values(state.homes));
        return world.TERRITORIES.filter(territory => state.owners[territory.id]
            && state.owners[territory.id] !== factionId && !homes.has(territory.id)
            && neighborsOf(state, territory.id).some(id => state.owners[id] === factionId)).map(item => item.id);
    }

    function fortifiableTerritories(state, factionId) {
        checkFaction(state, factionId);
        if (!expanded(state)) return [];
        const homes = new Set(Object.values(state.homes));
        return ownedTerritories(state, factionId).filter(territory => !homes.has(territory.id)
            && (state.fortifications[territory.id] || 0) < COMBAT_RULES.maxFortification).map(item => item.id);
    }

    function latestResult(state, factionId) {
        return state.events.filter(event => event.type === 'result' && event.factionId === factionId)
            .reduce((latest, event) => !latest || event.week > latest.week ? event : latest, null);
    }

    function previewAttack(state, { factionId, territoryId }) {
        checkFaction(state, factionId);
        const base = { factionId, attackerId: factionId, defenderId: state.owners[territoryId] || null,
            territoryId, cost: COMBAT_RULES.actionCost, fortificationCost: COMBAT_RULES.actionCost, canAttack: false };
        if (!expanded(state)) return { ...base, code: 'COMBAT_UNAVAILABLE', reason: 'This original campaign uses peaceful conquest rules.' };
        if (Object.values(state.homes).includes(territoryId)) return { ...base, code: 'HOMELAND_PROTECTED', reason: 'A faction’s homeland is protected.' };
        if (!attackableTerritories(state, factionId).includes(territoryId)) return { ...base, code: 'NOT_CONNECTED', reason: 'Attack rival land connected to your realm.' };
        const attacker = latestResult(state, factionId), defender = latestResult(state, base.defenderId);
        if (!attacker || !defender || attacker.week !== defender.week) return { ...base, code: 'NO_BATTLE_RESULTS', reason: 'Both armies need results from the same completed week.' };
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
        if (typeof state.seed !== 'string' || !state.seed) fail('INVALID_SEED', 'Only the authoritative campaign can resolve a battle.');
        if (typeof createdAt !== 'string' || !createdAt) fail('INVALID_TIME', 'The battle needs a timestamp.');
        const id = `battle-${state.season}-${preview.week}-${factionId}-${state.events.length + 1}`;
        const attackerRoll = seededRoll(state.seed, id + '|' + territoryId + '|attack');
        const defenderRoll = seededRoll(state.seed, id + '|' + territoryId + '|defense');
        const attackerTotal = round(preview.offense + attackerRoll), defenderTotal = round(preview.defense + defenderRoll);
        const captured = attackerTotal > defenderTotal;
        const attackerName = world.factionById(factionId).name, defenderName = world.factionById(preview.defenderId).name;
        const territoryName = world.territoryById(territoryId).name;
        const event = { ...preview, id, type: 'battle', factionId, attackerRoll, defenderRoll, attackerTotal, defenderTotal,
            captured, outcome: captured ? 'captured' : 'defended', createdAt,
            narrative: captured ? `${attackerName} captured ${territoryName} from ${defenderName}, ${attackerTotal} to ${defenderTotal}.`
                : `${defenderName} held ${territoryName} against ${attackerName}, ${defenderTotal} to ${attackerTotal}.`,
        };
        const next = { ...state,
            campaignActions: { ...state.campaignActions, [factionId]: state.campaignActions[factionId] - COMBAT_RULES.actionCost },
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
        if (!expanded(state)) fail('COMBAT_UNAVAILABLE', 'This original campaign uses peaceful conquest rules.');
        const latest = latestResult(state, factionId);
        if (!latest || latest.week >= 17) fail('NO_BATTLE_RESULTS', 'Fortify between completed football weeks.');
        if ((state.campaignActions[factionId] || 0) < COMBAT_RULES.actionCost) fail('NO_ACTIONS', 'Play another football week to earn campaign actions.');
        if (!fortifiableTerritories(state, factionId).includes(territoryId)) fail('INVALID_FORTIFICATION', 'Fortify your own conquered land, up to three levels.');
        if (typeof createdAt !== 'string' || !createdAt) fail('INVALID_TIME', 'The fortification needs a timestamp.');
        const level = (state.fortifications[territoryId] || 0) + 1;
        return { ...state,
            campaignActions: { ...state.campaignActions, [factionId]: state.campaignActions[factionId] - COMBAT_RULES.actionCost },
            fortifications: { ...state.fortifications, [territoryId]: level },
            events: [...state.events, { id: `fortify-${state.season}-${state.events.length + 1}-${factionId}`,
                type: 'fortify', factionId, territoryId, week: latest.week, level, cost: COMBAT_RULES.actionCost,
                defenseBonus: level * COMBAT_RULES.fortificationBonus, createdAt,
                narrative: `${world.factionById(factionId).name} fortified ${world.territoryById(territoryId).name} to level ${level}.`,
            }],
        };
    }

    return { createConquest, eligibleTerritories, recordWeek, claimTerritory, COMBAT_RULES,
        ownedTerritories, landTotals, attackableTerritories, fortifiableTerritories, previewAttack, attackTerritory, fortifyTerritory };
});
