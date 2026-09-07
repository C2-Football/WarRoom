// Authoritative online actions. Only identifiers and intent cross the network;
// roster entries, random draws, results and AI choices come from the engine.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    function applyOnlineAction(state, action, member, data, stamp) {
        const E = App.TimeLeagueEngine, AI = App.TimeLeagueAI;
        const cards = data.cards;
        const own = member.seat_team_id;
        const host = member.role === 'commissioner';
        const deny = (message) => { throw new Error(message); };
        const ownTeam = () => { if (action.teamId !== own) deny('You can only manage your own team.'); };
        const commissioner = () => { if (!host) deny('Only the commissioner can advance the league.'); };
        if (['lineup', 'auto-lineup', 'trade', 'respond-trade', 'ping-ai', 'cancel-claim'].includes(action.type) && state.phase === 'season' && ['ready', 'postgame'].includes(state.weekStage)) deny('Roster decisions are locked until the next planning gate.');
        let next = state;
        const gateAction = () => ({ claims: 'process-claims', lineup: 'finalize-rosters', ready: 'week', postgame: 'advance-week' })[state.weekStage];
        if (['vote-advance', 'timed-advance'].includes(action.type)) {
            if (state.phase !== 'season' || !gateAction()) deny('No weekly gate is open.');
            const humans = state.teams.filter(t => t.manager === 'human');
            if (!humans.some(t => t.teamId === own)) deny('Only a league manager can advance a gate.');
            if (action.type === 'vote-advance') {
                if (state.settings.advancementMode !== 'majority') deny('This league does not use majority advancement.');
                const votes = [...new Set([...(state.gateVotes || []), own])];
                if (votes.length <= humans.length / 2) return E.normalizeTimeLeague({ ...state, gateVotes: votes });
            } else {
                if (state.settings.advancementMode !== 'timed' || Date.parse(stamp) < Date.parse(state.gateStartedAt || stamp) + (state.settings.gateHours || 24) * 3600000) deny('The gate deadline has not arrived.');
            }
            return applyOnlineAction(state, { type: gateAction() }, { ...member, role: 'commissioner' }, data, stamp);
        }
        switch (action.type) {
        case 'draft': {
            const seat = E.currentDraftSeat(state);
            if (!seat || seat.teamId !== own) deny('Wait for your draft turn.');
            if (!cards.has(action.identity)) deny('Player not found.');
            next = E.applyDraftPick(state, cards.get(action.identity), { madeBy: 'human', createdAt: stamp });
            break;
        }
        case 'ai-pick':
        case 'ai-run': {
            commissioner();
            for (let i = 0; i < state.draftOrder.length; i++) {
                const seat = E.currentDraftSeat(next);
                if (next.phase !== 'draft' || !seat || next.teams.find(t => t.teamId === seat.teamId)?.manager !== 'ai') break;
                const card = AI.aiDraftChoice(next, cards);
                if (!card) break;
                const picked = E.applyDraftPick(next, card, { madeBy: 'ai', createdAt: stamp });
                if (picked === next) break;
                next = picked;
                if (action.type === 'ai-pick') break;
            }
            break;
        }
        case 'queue':
            ownTeam();
            if (!cards.has(action.identity) || E.draftedIdentities(state).has(action.identity)) deny('Player is unavailable.');
            next = { ...state, teams: state.teams.map(t => t.teamId === own ? { ...t, queue: App.TimeLeagueDraftRoom.toggleDraftQueue(t.queue, action.identity) } : t) };
            break;
        case 'lineup':
            ownTeam();
            if (state.phase !== 'season') deny('Lineups open during the season.');
            next = E.setEntrySlot(state, own, action.entryId, action.slot, action.targetEntryId);
            break;
        case 'auto-lineup':
            ownTeam();
            if (state.phase !== 'season') deny('Lineups open during the season.');
            next = E.autoFillLineup(state, own, cards);
            break;
        case 'team':
            ownTeam();
            if (typeof action.name !== 'string' || !action.name.trim() || action.name.length > 60) deny('Use a team name between 1 and 60 characters.');
            next = { ...state, teams: state.teams.map(t => t.teamId === own ? { ...t, name: action.name.trim(), helmet: action.helmet || t.helmet } : t) };
            break;
        case 'claim': {
            ownTeam();
            if (state.weekStage !== 'claims') deny('Waiver planning is not open.');
            const card = E.freeAgents(state, cards).find(c => c.identity === action.identity);
            if (!card) deny('That free agent is no longer available.');
            next = E.submitWaiverClaim(state, { teamId: own, addIdentity: card.identity, addName: card.name, addPosition: card.position, dropEntryId: action.dropEntryId || '', bidAmount: action.bidAmount }, stamp);
            break;
        }
        case 'cancel-claim':
            if (!state.pendingClaims.some(c => c.claimId === action.claimId && c.teamId === own)) deny('This claim belongs to another manager.');
            next = E.cancelWaiverClaim(state, action.claimId);
            break;
        case 'trade':
            ownTeam();
            if (state.weekStage !== 'claims') deny('Submit trade requests during waiver planning.');
            next = E.proposeTrade(state, { fromTeamId: own, toTeamId: action.toTeamId, giveEntryIds: action.giveEntryIds, receiveEntryIds: action.receiveEntryIds, note: String(action.note || '').slice(0, 500) }, stamp);
            break;
        case 'respond-trade':
            if (state.weekStage !== 'lineup') deny('Final trade decisions open after waivers settle.');
            if (!state.trades.some(t => t.tradeId === action.tradeId && t.toTeamId === own && t.status === 'pending')) deny('Only the receiving manager can answer this offer.');
            if (action.decision === 'delay') next = E.deferTrade(state, action.tradeId);
            else next = E.respondToTrade(state, action.tradeId, action.accept === true, '', stamp);
            break;
        case 'ping-ai':
            if (state.weekStage !== 'lineup') deny('Final trade decisions open after waivers settle.');
            if (!state.trades.some(t => t.fromTeamId === own && t.status === 'pending' && state.teams.some(team => team.teamId === t.toTeamId && team.manager === 'ai'))) deny('No pending offer to an AI manager.');
            next = AI.aiRespondToTrades(state, cards, stamp);
            break;
        case 'gate-settings':
            commissioner();
            if (!['commissioner', 'majority', 'timed'].includes(action.advancementMode) || !Number.isFinite(action.gateHours) || action.gateHours < 1 || action.gateHours > 168) deny('Choose an advancement mode and 1–168 hours per gate.');
            next = { ...state, settings: { ...state.settings, advancementMode: action.advancementMode, gateHours: action.gateHours }, gateStartedAt: stamp, gateVotes: [] };
            break;
        case 'reopen-lineups':
            commissioner();
            if (state.phase !== 'season' || state.weekStage !== 'ready') deny('Only a finalized lineup gate can be reopened.');
            next = { ...state, weekStage: 'lineup' };
            break;
        case 'start-playoffs':
            commissioner();
            next = E.startPlayoffs(state, Number(action.count));
            break;
        case 'advance-week':
            commissioner();
            if (state.phase !== 'season' || state.weekStage !== 'postgame') deny('Review the current week first.');
            next = { ...AI.aiGenerateTrades(state, cards, stamp), weekStage: 'claims' };
            break;
        case 'process-claims': {
            commissioner();
            if (state.phase !== 'season' || state.weekStage !== 'claims') deny('Open waiver planning first.');
            // Each AI files against the same pre-resolution pool as human managers.
            const staged = AI.aiSubmitWaiverClaims(state, cards, stamp);
            next = E.processWaivers(staged, cards, stamp);
            next = AI.aiRespondToTrades({ ...AI.aiGenerateTrades(next, cards, stamp), weekStage: 'lineup' }, cards, stamp);
            break;
        }
        case 'finalize-rosters':
            commissioner();
            if (state.phase !== 'season' || state.weekStage !== 'lineup') deny('Resolve waivers before finalizing rosters.');
            if (state.teams.filter(t => t.manager === 'human' && (state.currentWeek <= state.settings.regularSeasonWeeks || E.playoffPairs(state, state.currentWeek).some(pair => pair.includes(t.teamId)))).some(t => E.lineupProblems(state, t.teamId).length)) deny('Managers still need to fill every starting lineup before finalizing.');
            next = { ...state, weekStage: 'ready' };
            break;
        case 'week': {
            commissioner();
            if (state.phase !== 'season' || state.weekStage !== 'ready') deny('Complete the weekly planning steps first.');
            const prepared = AI.aiPrepareWeek(state, cards);
            const problems = prepared.teams.filter(t => t.manager === 'human' && (state.currentWeek <= state.settings.regularSeasonWeeks || E.playoffPairs(state, state.currentWeek).some(pair => pair.includes(t.teamId)))).flatMap(t => E.lineupProblems(prepared, t.teamId));
            if (problems.length && !action.force) deny('Managers still need to set their lineups.');
            next = E.finalizeCurrentWeek(prepared, data.logIndex, data.eraFactors, stamp);
            next = { ...next, weekStage: 'postgame' };
            break;
        }
        default: deny('Unknown game action.');
        }
        if (next === state && action.type !== 'auto-lineup') deny('That move is no longer legal. Refresh and try again.');
        if (state.phase === 'draft' && next.phase === 'season') next = AI.aiGenerateTrades(next, cards, stamp);
        if (next.weekStage !== state.weekStage || next.phase !== state.phase) next = { ...next, gateStartedAt: stamp, gateVotes: [] };
        const taken = E.draftedIdentities(next);
        next = { ...next, teams: next.teams.map(t => ({ ...t, queue: t.queue.filter(id => !taken.has(id)) })) };
        return E.normalizeTimeLeague(next);
    }
    App.TimeLeagueActions = { applyOnlineAction };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.TimeLeagueActions;
})(typeof window !== 'undefined' ? window : globalThis);
