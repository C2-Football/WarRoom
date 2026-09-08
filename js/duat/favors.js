/* global module */
/**
 * Executable historical Duat favors. No storage, network, clock or random state.
 * Effects and prices: original The Duat/app/duat-data.ts favor catalog.
 * Seasonal treasury: original The Duat/app/DuatApp.tsx, "You begin each season
 * with one $100 treasury". Campaign configuration may override that balance.
 *
 * The caller supplies only finalized, faction-specific history from this season.
 * Apply the returned effective scores to all-play and the Heavenly Battle only;
 * Heptad best ball continues to consume the unchanged basePoints.
 * Other catalog favors are deliberately not exposed as executable options.
 */
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const SACRED_WEEKS = Object.freeze([5, 7, 10, 14, 15, 16, 17]);
    const STARTING_FAVOR_BALANCE = 100;
    const FAVORS = Object.freeze([
        { id: 'kratos-1', name: 'Kratos’ Wrath I', deity: 'Kratos', tier: 'Pious', cost: 10, kind: 'multiply', multiplier: 2, effect: 'Double one starter’s total points.' },
        { id: 'horus-1', name: 'Horus’ Defense I', deity: 'Horus', tier: 'Pious', cost: 10, kind: 'floor', floor: 15, effect: 'Give one starter with a recorded game a 15-point floor.' },
        { id: 'kratos-2', name: 'Kratos’ Wrath II', deity: 'Kratos', tier: 'Devout', cost: 20, kind: 'multiply', multiplier: 2.5, effect: 'Score 2.5× one starter’s total points.' },
        { id: 'horus-2', name: 'Horus’ Defense II', deity: 'Horus', tier: 'Devout', cost: 20, kind: 'floor', floor: 20, effect: 'Give one starter with a recorded game a 20-point floor.' },
        { id: 'janus-2', name: 'Janus’ Recollection II', deity: 'Janus', tier: 'Devout', cost: 20, kind: 'recall', previousWeekOnly: true, effect: 'Import one starter’s recorded base score from the previous week.' },
        { id: 'kratos-3', name: 'Kratos’ Wrath III', deity: 'Kratos', tier: 'Divine', cost: 30, kind: 'multiply', multiplier: 3.5, effect: 'Score 3.5× one starter’s total points.' },
        { id: 'janus-3', name: 'Janus’ Recollection III', deity: 'Janus', tier: 'Divine', cost: 30, kind: 'recall', previousWeekOnly: false, effect: 'Import one starter’s recorded base score from a previous week this season.' }
    ].map(favor => Object.freeze({ ...favor, timing: 'Sacred week', supported: true })));
    const SUPPORTED_IDS = Object.freeze(FAVORS.map(favor => favor.id));
    // The sourcebook edition is opt-in; published campaigns keep their seven
    // original effects and prices. Absence protection is an explicit adaptation.
    const EXPANDED_FAVORS = Object.freeze([...FAVORS,
        { id: 'patecatl-1', name: 'Patecatl’s Embrace I', deity: 'Patecatl', tier: 'Pious', cost: 10, kind: 'absence', higher: false, effect: 'For an absent starter, use the lower of their completed-game average and prior-season reference.', adaptation: 'Historical absence protection includes injury, bye or another absence. With no completed game, the prior-season reference is used. No reference means this favor cannot resolve.' },
        { id: 'patecatl-2', name: 'Patecatl’s Embrace II', deity: 'Patecatl', tier: 'Devout', cost: 20, kind: 'absence', higher: true, effect: 'For an absent starter, use the higher of their completed-game average and prior-season reference.', adaptation: 'Historical absence protection includes injury, bye or another absence. With no completed game, double the prior-season reference. No reference means this favor cannot resolve.' },
        { id: 'nyx', name: 'Nyx’s Night Vigil', deity: 'Nyx', tier: 'Devout', cost: 25, kind: 'multiply', multiplier: 2.5, effect: 'Keep a sacred night vigil and score 2.5× one starter’s points.', adaptation: 'In historical campaigns the sacred-week vigil replaces the original primetime-game requirement.' }
    ].map(favor => Object.freeze({ ...favor, timing: 'Sacred week', supported: true })));

    function round(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }
    function integer(value) {
        return value !== '' && value !== null && value !== undefined && Number.isInteger(Number(value)) ? Number(value) : NaN;
    }
    function idOf(value) { return value === null || value === undefined ? '' : String(value).trim(); }
    function error(message) { throw new Error(message); }
    function getFavor(favorId, expansionVersion) { return (expansionVersion === 1 ? EXPANDED_FAVORS : FAVORS).find(favor => favor.id === favorId); }
    function requireBalance(balance) {
        if (typeof balance !== 'number' || !Number.isFinite(balance) || balance < 0) error('Favor balance must be a nonnegative number.');
        return balance;
    }
    function requirePlayers(players) {
        if (!Array.isArray(players)) error('The current army is required to declare a favor.');
        const ids = new Set();
        players.forEach(player => {
            const id = idOf(player && player.id);
            if (!id || ids.has(id)) error('The current army must contain unique player IDs.');
            ids.add(id);
        });
        return players;
    }
    function historicalPlayer(history, week, playerId) {
        const records = (Array.isArray(history) ? history : []).filter(entry => entry && integer(entry.week) === week);
        if (records.length !== 1) error('Janus requires one finalized record for the selected previous week.');
        const record = records[0];
        if (record.finalized === false || record.status === 'pending' || record.status === 'scheduled') {
            error('Janus can use only finalized previous weeks.');
        }
        const players = requirePlayers(record.players);
        const player = players.find(entry => idOf(entry.id) === playerId);
        if (!player || player.hasRecordedGame === false || !Number.isFinite(player.basePoints)) {
            error('Janus requires that player’s recorded base score in the selected previous week.');
        }
        return player;
    }

    /** Only supported, affordable favors in the current sacred window. */
    function listAvailable({ week, balance = STARTING_FAVOR_BALANCE } = {}) {
        requireBalance(balance);
        if (!SACRED_WEEKS.includes(integer(week))) return [];
        return FAVORS.filter(favor => favor.cost <= balance).map(favor => ({ ...favor }));
    }

    /**
     * Accepts either flat declaration fields or {declaration, playerResults}.
     * Throws before an action is stored; returned prices always come from canon.
     * Before reveal, an unknown hasRecordedGame is allowed for Horus. Resolution
     * rechecks the actual historical record before spending any favor.
     */
    function validateDeclaration(options = {}) {
        const declaration = options.declaration || options;
        const week = integer(options.week !== undefined ? options.week : declaration.week);
        if (!SACRED_WEEKS.includes(week)) error('Favors can be declared only in sacred weeks 5, 7, 10, 14, 15, 16 and 17.');
        if (declaration.week !== undefined && integer(declaration.week) !== week) error('This favor was declared for a different week.');
        const favorId = idOf(declaration.favorId);
        const favor = getFavor(favorId, options.expansionVersion);
        if (!favor) error('This favor is not supported in historical campaigns yet.');
        const balance = requireBalance(options.balance === undefined ? STARTING_FAVOR_BALANCE : options.balance);
        if (balance < favor.cost) error(`This favor requires ${favor.cost} favor; the treasury has ${balance}.`);
        const playerId = idOf(declaration.playerId);
        const players = requirePlayers(options.playerResults || options.players);
        const player = players.find(entry => idOf(entry.id) === playerId);
        if (!player || player.starter !== true) error('Choose a player in the current starting lineup.');
        if (favor.kind === 'floor' && player.hasRecordedGame === false) error('Horus is unavailable for a player without a recorded game (injury or bye).');
        if (favor.kind === 'absence') {
            if (player.hasRecordedGame === true) error('Patecatl protects only a starter without a recorded game.');
            if (!Number.isFinite(player.referencePoints) || !Number.isInteger(player.referenceSeason)) error('Patecatl needs a genuine prior-season reference for this player.');
        }
        const normalized = { favorId, playerId, week, cost: favor.cost };
        if (favor.kind === 'recall') {
            const sourceWeek = declaration.sourceWeek === undefined && favor.previousWeekOnly
                ? week - 1 : integer(declaration.sourceWeek);
            if (!Number.isInteger(sourceWeek) || sourceWeek < 1 || sourceWeek >= week) error('Janus requires a previous week this season; current and future weeks are unavailable.');
            if (favor.previousWeekOnly && sourceWeek !== week - 1) error('Janus II can use only the immediately previous week.');
            historicalPlayer(options.history, sourceWeek, playerId);
            normalized.sourceWeek = sourceWeek;
        }
        return normalized;
    }

    function effectiveScore(player) {
        const points = player.effectivePoints === undefined ? player.basePoints : player.effectivePoints;
        if (!Number.isFinite(points) || !Number.isFinite(player.basePoints)) error('Favor resolution requires finite player base and effective scores.');
        return points;
    }
    function teamTotal(players) {
        return round(players.filter(player => player.starter === true).reduce((total, player) => total + effectiveScore(player), 0));
    }

    /**
     * Returns copied players and an auditable event. A now-ineligible declaration
     * remains unavailable, returns cost 0, and leaves every score unchanged.
     * No declaration returns the ordinary starter total and event null.
     */
    function applyFavor(options = {}) {
        const players = requirePlayers(options.playerResults).map(player => ({ ...player }));
        const ordinaryTotal = teamTotal(players);
        if (!options.declaration) return { players, total: ordinaryTotal, cost: 0, event: null };
        let declaration;
        try {
            declaration = validateDeclaration({ ...options, playerResults: players });
            const favor = getFavor(declaration.favorId, options.expansionVersion);
            const target = players.find(player => idOf(player.id) === declaration.playerId);
            if (favor.kind === 'floor' && target.hasRecordedGame !== true) error('Horus is unavailable because a recorded game could not be confirmed.');
            if (favor.kind === 'absence' && target.hasRecordedGame !== false) error('Patecatl is unavailable because this player’s absence could not be confirmed.');
            const beforePoints = effectiveScore(target);
            let afterPoints;
            if (favor.kind === 'multiply') afterPoints = round(target.basePoints * favor.multiplier);
            else if (favor.kind === 'floor') afterPoints = round(Math.max(target.basePoints, favor.floor));
            else if (favor.kind === 'absence') {
                const previous = (options.history || []).filter(entry => integer(entry.week) < declaration.week && entry.finalized !== false)
                    .flatMap(entry => entry.players || []).filter(p => p.id === target.id && p.hasRecordedGame === true && Number.isFinite(p.basePoints));
                const average = previous.length ? previous.reduce((sum, p) => sum + p.basePoints, 0) / previous.length : null;
                afterPoints = round(average === null ? target.referencePoints * (favor.higher ? 2 : 1)
                    : favor.higher ? Math.max(average, target.referencePoints) : Math.min(average, target.referencePoints));
            } else afterPoints = round(historicalPlayer(options.history, declaration.sourceWeek, declaration.playerId).basePoints);
            if (!Number.isFinite(afterPoints)) error('This favor could not produce a valid score.');
            target.effectivePoints = afterPoints;
            const event = {
                type: 'favor', status: 'applied', favorId: declaration.favorId, name: favor.name,
                playerId: declaration.playerId, week: declaration.week, cost: favor.cost,
                basePoints: target.basePoints, beforePoints, afterPoints, delta: round(afterPoints - beforePoints)
            };
            if (declaration.sourceWeek !== undefined) event.sourceWeek = declaration.sourceWeek;
            return { players, total: teamTotal(players), cost: favor.cost, event };
        } catch (cause) {
            const favorId = idOf(options.declaration.favorId);
            return {
                players, total: ordinaryTotal, cost: 0,
                event: {
                    type: 'favor', status: 'unavailable', favorId,
                    playerId: idOf(options.declaration.playerId), week: integer(options.week),
                    cost: 0, reason: cause.message
                }
            };
        }
    }

    function validateDeclarations(options = {}) {
        if (options.expansionVersion !== 1) error('Multiple favors require a sourcebook campaign.');
        const declarations = options.declarations || [];
        if (!Array.isArray(declarations) || declarations.length > 20) error('Choose a valid list of favors.');
        const normalized = declarations.map(declaration => validateDeclaration({ ...options, declaration }));
        if (new Set(normalized.map(d => d.playerId)).size !== normalized.length) error('A starter can receive only one favor per sacred week.');
        const reserved = normalized.reduce((sum, d) => sum + d.cost, 0);
        if (reserved > requireBalance(options.balance === undefined ? STARTING_FAVOR_BALANCE : options.balance)) error('The combined favors exceed the available treasury.');
        return normalized;
    }
    function applyFavors(options = {}) {
        const declarations = options.declarations || [];
        if (options.expansionVersion !== 1) error('Multiple favors require a sourcebook campaign.');
        // Validate reservation and unique targets without looking ahead at absence.
        const planning = requirePlayers(options.playerResults).map(p => { const result = { ...p }; delete result.hasRecordedGame; return result; });
        const normalized = validateDeclarations({ ...options, declarations, playerResults: planning });
        let players = options.playerResults.map(p => ({ ...p })), cost = 0;
        const events = [];
        for (const declaration of normalized) {
            const applied = applyFavor({ ...options, declaration, playerResults: players, balance: (options.balance ?? STARTING_FAVOR_BALANCE) - cost });
            players = applied.players; cost += applied.cost; if (applied.event) events.push(applied.event);
        }
        return { players, total: teamTotal(players), cost, events, reserved: normalized.reduce((sum,d)=>sum+d.cost,0) };
    }

    const api = Object.freeze({
        SACRED_WEEKS, STARTING_FAVOR_BALANCE, STARTING_BALANCE: STARTING_FAVOR_BALANCE,
        FAVORS, EXPANDED_FAVORS, SUPPORTED_IDS, listAvailable, getFavor, validateDeclaration, applyFavor, validateDeclarations, applyFavors
    });
    App.DuatFavors = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
