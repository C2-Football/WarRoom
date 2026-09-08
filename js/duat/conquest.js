// Pure conquest rules adapted from The Duat app/campaign.ts at ada801d.
// The caller supplies standings and timestamps. This module never invents scores,
// handles account authorization, reads storage, or changes a football roster.
/* global module, require */
(function (root, factory) {
    const rules = typeof module !== 'undefined' && module.exports
        ? require('./rules.js') : root.App.DuatRules;
    const api = factory(rules);
    (root.App = root.App || {}).DuatConquest = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function (rules) {
    'use strict';

    function fail(code, message) {
        const error = new Error(message);
        error.code = code;
        throw error;
    }

    function createConquest({ season, factionIds = rules.FACTIONS.map(faction => faction.id) }) {
        if (!Number.isInteger(season) || season < 1) fail('INVALID_SEASON', 'A campaign season is required.');
        if (!Array.isArray(factionIds) || factionIds.length < 2 || new Set(factionIds).size !== factionIds.length) {
            fail('INVALID_FACTIONS', 'Choose distinct factions for the campaign.');
        }
        const owners = {}, claimOrder = {}, pendingClaims = {}, homes = {};
        for (const factionId of factionIds) {
            const faction = rules.FACTIONS.find(item => item.id === factionId);
            const home = faction?.homeTerritoryId || rules.TERRITORIES.find(item => item.homelandOf === factionId)?.id;
            if (!faction || !home || !rules.TERRITORIES.some(item => item.id === home)) {
                fail('INVALID_FACTION', 'Every faction needs a known homeland.');
            }
            if (owners[home]) fail('DUPLICATE_HOME', 'Factions cannot share a homeland.');
            owners[home] = factionId;
            homes[factionId] = home;
            claimOrder[factionId] = [home];
            pendingClaims[factionId] = 0;
        }
        return { version: 1, season, factionIds: [...factionIds], homes, owners, claimOrder, pendingClaims, events: [] };
    }

    function checkFaction(state, factionId) {
        if (!state.factionIds.includes(factionId)) fail('UNKNOWN_FACTION', 'This faction does not belong to the campaign.');
    }

    function eligibleTerritories(state, factionId) {
        checkFaction(state, factionId);
        const owned = new Set(Object.keys(state.owners).filter(id => state.owners[id] === factionId));
        const eligible = new Set();
        for (const route of rules.ROUTES) {
            if (owned.has(route.from) && !state.owners[route.to]) eligible.add(route.to);
            if (owned.has(route.to) && !state.owners[route.from]) eligible.add(route.from);
        }
        return [...eligible];
    }

    // Internal single-faction operation. Public callers must submit the entire
    // week's verified standings through recordWeek so loss/reward order is fixed.
    function recordResult(state, { factionId, week, place, score, createdAt }) {
        checkFaction(state, factionId);
        if (!Number.isInteger(week) || week < 1 || week > 14) fail('INVALID_WEEK', 'Conquest results belong to weeks 1–14.');
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
        if (place === state.factionIds.length) {
            // The newest conquest is lost; a homeland can never fall.
            const protectedHomes = new Set(Object.values(state.homes));
            const removable = [...state.claimOrder[factionId]].reverse().find(territoryId => !protectedHomes.has(territoryId));
            if (!removable) return { ...state, events: [...state.events, { ...result, outcome: 'homeland-held' }] };
            const owners = { ...state.owners };
            delete owners[removable];
            return {
                ...state, owners,
                claimOrder: { ...state.claimOrder, [factionId]: state.claimOrder[factionId].filter(item => item !== removable) },
                events: [...state.events, { ...result, outcome: 'loss' }, {
                    id: `loss-${state.season}-${week}-${factionId}`, factionId, week, type: 'loss', territoryId: removable, createdAt,
                }],
            };
        }
        const requested = place === 1 ? 2 : place <= Math.ceil(state.factionIds.length / 2) ? 1 : 0;
        const frontier = eligibleTerritories(state, factionId);
        const remaining = rules.TERRITORIES.filter(item => !state.owners[item.id]).length;
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
        const ordered = [...results].sort((left, right) =>
            Number(right.place === state.factionIds.length) - Number(left.place === state.factionIds.length)
            || state.factionIds.indexOf(left.factionId) - state.factionIds.indexOf(right.factionId));
        return ordered.reduce((current, result) => recordResult(current, {
            factionId: result.factionId, place: result.place, score: result.score, week, createdAt,
        }), state);
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

    return { createConquest, eligibleTerritories, recordWeek, claimTerritory };
});
