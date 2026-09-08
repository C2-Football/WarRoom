// The online read model. This explicit allowlist is deliberately separate from
// authoritative game state: adding a private engine field never exposes it.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
    const list = value => Array.isArray(value) ? value : [];
    const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined &&
        (value[key] === null || ['string', 'number', 'boolean'].includes(typeof value[key]))).map(key => [key, value[key]]));
    const numbers = value => Object.fromEntries(Object.entries(value || {}).filter(([, n]) => typeof n === 'number' && Number.isFinite(n)));
    const strings = value => list(value).filter(item => typeof item === 'string');
    const fields = text => text.split(' ');
    const ENTRY = fields('entryId identity name position slot acquiredVia acquiredWeek');
    const PICK = fields('overall round teamId entryId identity name position madeBy auctionPrice');
    const TEAM = fields('teamId name manager aiPersona primaryColor secondaryColor backdrop faabRemaining draftBudgetRemaining');
    const HELMET = fields('assetId artworkMode shell color shellColor accentColor decal monogram facemask facemaskColor stripe stripeStyle stripeColor paintStyle visor');
    const SETTINGS = fields('regularSeasonWeeks playoffTeams advancementMode gateHours maxQuarterbacks eraAdjusted waiversEnabled tradesEnabled waiverMode faabBudget aiDifficulty draftFormat draftPickSeconds draftAiSeconds draftAuctionBudget draftOrderMode gameDeckVersion');
    const STATS = fields('passYd passTd passInt rushYd rushTd rec recYd recTd fumblesLost twoPointConversions');

    function draftVisibility(state, seatTeamId) {
        const allPositions = state.settings?.eraRules?.mode === 'position-roulette'
            ? POSITIONS.filter(position => App.TimeLeagueEngine.positionIsStartable(state.settings, position)) : [];
        const publicSeasons = state.phase !== 'draft' && state.seasonsRevealed === true;
        const saved = strings(state.draftEraReveals?.[seatTeamId]);
        return { allPositions, revealedPositions: publicSeasons ? [...allPositions] : allPositions.filter(position => saved.includes(position)) };
    }

    function revealPositions(state, seatTeamId, position) {
        if (state.phase !== 'draft' || state.settings?.eraRules?.mode !== 'position-roulette') throw new Error('This draft has no sealed position archives.');
        if (!state.teams.some(team => team.teamId === seatTeamId && team.manager === 'human')) throw new Error('Only your own manager can reveal an archive.');
        const visibility = draftVisibility(state, seatTeamId);
        if (position !== 'all' && !visibility.allPositions.includes(position)) throw new Error('Choose a position in this league.');
        const requested = position === 'all' ? visibility.allPositions : [position];
        const revealed = [...new Set([...visibility.revealedPositions, ...requested])];
        // A missing assignment cannot be declared revealed. Existing stored
        // assignments are never re-rolled by a reveal request.
        if (requested.some(item => !state.settings.eraRules.positionDecades?.[item])) throw new Error('This position archive is unavailable.');
        const draftEraReveals = Object.fromEntries(state.teams.filter(team => team.manager === 'human').map(team => [team.teamId,
            team.teamId === seatTeamId ? visibility.allPositions.filter(item => revealed.includes(item)) : draftVisibility(state, team.teamId).revealedPositions]));
        return { ...state, draftEraReveals };
    }

    function allErasRevealed(state, seatTeamId) {
        const visibility = draftVisibility(state, seatTeamId);
        return visibility.revealedPositions.length === visibility.allPositions.length;
    }

    function publicSettings(state, visibility) {
        const settings = state.settings || {}, scoring = settings.scoring || {}, eras = settings.eraRules || {};
        const result = { ...pick(settings, SETTINGS), rosterSlots: pick(settings.rosterSlots, App.TimeLeagueRoster.ROSTER_SLOT_IDS),
            draftTeamOrder: App.TimeLeagueEngine.draftTeamOrder(state),
            scoring: { ...pick(scoring, fields('passTd reception rushRecYd passingYd turnover')) },
            eraRules: { mode: eras.mode, decades: strings(eras.decades) } };
        if (scoring.stats) result.scoring.stats = pick(scoring.stats, STATS);
        if (scoring.extended) result.scoring.extended = pick(scoring.extended, App.TimeLeagueSeason.EXTENDED_STAT_IDS);
        if (Array.isArray(scoring.bonuses)) result.scoring.bonuses = scoring.bonuses.map(item => pick(item, ['stat', 'threshold', 'points']));
        const disclosed = POSITIONS.filter(position => eras.positionDecades?.[position] &&
            (eras.mode !== 'position-roulette' || visibility.revealedPositions.includes(position)));
        if (disclosed.length) result.eraRules.positionDecades = Object.fromEntries(disclosed.map(position => [position, eras.positionDecades[position]]));
        return result;
    }

    function publicActivity(state, sealed) {
        let pickIndex = 0;
        return list(state.activity).map((item, index) => {
            const event = pick(item, fields('id week kind message createdAt'));
            if (!sealed) {
                if (event.kind === 'waiver' && event.week === state.currentWeek) event.message = 'A manager submitted a waiver claim.';
                return event;
            }
            // Legacy draft log text can contain the edition or the entire era
            // assignment. Reconstruct it from public pick facts, never redact a
            // handful of words from a private free-form string.
            event.id = /^a\d+$/.test(item.id) ? item.id : `draft-activity-${index + 1}`;
            if (event.kind === 'draft') {
                const drafted = state.draftPicks[pickIndex++];
                const team = state.teams.find(row => row.teamId === drafted?.teamId);
                event.message = drafted ? `Pick ${drafted.overall} — ${team?.name || 'Manager'} selects ${drafted.name}, ${drafted.position}${drafted.auctionPrice ? ` for $${drafted.auctionPrice}` : ''}` : 'A draft pick was made.';
            } else if (event.kind === 'league') {
                event.message = index === 0 ? `League founded — ${state.name}, ${state.teams.length} seats` : 'The draft room is open. Reveal your position archives to continue.';
            } else event.message = 'The league was updated.';
            return event;
        });
    }

    function publicWeeks(state) {
        return list(state.finalizedWeeks).map(week => ({ week: week.week,
            results: list(week.results).map(result => ({ teamId: result.teamId, total: result.total,
                starters: list(result.starters).map(entry => ({ ...pick(entry, fields('entryId identity name position drawnSeason slot points factor availability sourceWeek source sourceGameId coverage')),
                    stats: entry.stats ? { ...pick(entry.stats, STATS), ...(entry.stats.extra ? { extra: numbers(entry.stats.extra) } : {}) } : null })) })),
            matchups: list(week.matchups).map(match => pick(match, fields('home away homePoints awayPoints winner'))), headlines: strings(week.headlines),
            ...(week.playerProduction ? { playerProduction: list(week.playerProduction).map(entry => ({ ...pick(entry, fields('entryId identity name position drawnSeason slot points factor availability')), stats: entry.stats ? { ...pick(entry.stats, STATS), ...(entry.stats.extra ? { extra: numbers(entry.stats.extra) } : {}) } : null })) } : {}) }));
    }

    function sanitizePlayerReports(reports, currentWeek) {
        const result = {};
        for (const [key, report] of Object.entries(reports || {}).slice(0, 5000)) {
            if (!report || typeof report !== 'object') continue;
            result[key] = {
                ...pick(report, fields('week remaining average estimatedRemaining signal currentAvailable currentStars maxRemainingStars')),
                completed: list(report.completed).filter(row => Number.isInteger(row.week) && row.week < currentWeek).map(row => ({
                    ...pick(row, fields('week points stars')), sourceWeek: Number.isInteger(row.sourceWeek) && row.sourceWeek >= 1 && row.sourceWeek <= 25 ? row.sourceWeek : null,
                })),
                ...(report.waiver ? { waiver: pick(report.waiver, fields('drawnSeason startWeek endWeek totalPoints remainingPoints remainingWeeks estimated')) } : {}),
            };
        }
        return result;
    }

    function playerReports(state, cards, logIndex, factors) {
        if (!logIndex?.size) return {};
        const S = App.TimeLeagueSeason, E = App.TimeLeagueEngine;
        const end = E.seasonEndWeek(state);
        const entries = new Map(state.teams.flatMap(team => team.roster).map(entry => [S.editionKey(entry), entry]));
        const free = new Map();
        for (const card of E.freeAgents(state, cards)) {
            const drawnSeason = E.waiverSeason(state, card);
            if (drawnSeason == null) continue;
            const entry = { identity: card.identity, position: card.position, drawnSeason };
            entries.set(S.editionKey(entry), entry); free.set(S.editionKey(entry), card);
        }
        const selectedFactors = state.settings.eraAdjusted ? factors : null;
        return Object.fromEntries([...entries].map(([key, entry]) => {
            const outlook = S.rosterOutlook(entry, state.currentWeek, end, logIndex, state.settings.scoring, selectedFactors, state);
            const stars = S.weeklyStarOutlook(entry, state.currentWeek, end, logIndex, state.settings.scoring, selectedFactors, state);
            return [key, {
                week: state.currentWeek, remaining: outlook.remaining, average: outlook.average, estimatedRemaining: outlook.estimatedRemaining,
                signal: outlook.signal, currentAvailable: outlook.schedule.find(row => row.week === state.currentWeek)?.available ?? null,
                currentStars: stars.stars, maxRemainingStars: stars.maxRemainingStars,
                completed: state.finalizedWeeks.map(row => {
                    const saved = S.completedProduction(state, entry, row.week);
                    const log = S.resolveGameLog(state, entry, row.week, logIndex, end);
                    // A completed source reference is sufficient: clients have
                    // the public NFL archive. Never duplicate every stat line
                    // across thousands of free agents in each network reply.
                    return { week: row.week, sourceWeek: log?.week ?? null, points: saved ? saved.points : S.gamePoints(state, entry, log, state.settings.scoring, selectedFactors),
                        stars: stars.schedule.find(item => item.week === row.week)?.stars ?? null };
                }),
                ...(free.has(key) ? { waiver: E.waiverPreview(state, free.get(key), logIndex, factors) } : {}),
            }];
        }));
    }

    function projectPublicState(state, seatTeamId, privateMessages = [], cards = new Map(), stamp = new Date().toISOString(), data = {}) {
        if (!state.teams.some(team => team.teamId === seatTeamId && team.manager === 'human')) throw new Error('You do not have a manager seat in this league.');
        const sealed = state.phase === 'draft' || state.seasonsRevealed !== true;
        const visibility = draftVisibility(state, seatTeamId);
        const result = {
            ...pick(state, fields('version leagueId name createdAt phase currentWeek weekStage gateStartedAt championTeamId')),
            publicSnapshotVersion: 1,
            draftVisibility: visibility,
            settings: publicSettings(state, visibility),
            teams: state.teams.map(team => ({ ...pick(team, TEAM), helmet: pick(team.helmet, HELMET),
                roster: list(team.roster).map(entry => pick(entry, sealed ? ENTRY : [...ENTRY, 'drawnSeason'])),
                queue: team.teamId === seatTeamId ? strings(team.queue) : [] })),
            draftOrder: list(state.draftOrder).map(seat => pick(seat, fields('overall round teamId'))),
            draftClock: pick(state.draftClock, fields('status startedAt deadlineAt remainingMs')),
            draftAuction: { ...pick(state.draftAuction, fields('nominationIndex lastAiAt')), nomination: state.draftAuction?.nomination
                ? pick(state.draftAuction.nomination, fields('identity name position nominatedBy highTeamId highBid')) : null },
            draftPicks: list(state.draftPicks).map(drafted => pick(drafted, PICK)),
            seasonsRevealed: !sealed,
            gateVotes: strings(state.gateVotes),
            schedule: list(state.schedule).map(week => ({ week: week.week, pairs: list(week.pairs).map(pair => strings(pair)) })),
            finalizedWeeks: sealed ? [] : publicWeeks(state),
            pendingClaims: sealed ? [] : list(state.pendingClaims).filter(claim => claim.teamId === seatTeamId)
                .map(claim => pick(claim, fields('claimId teamId addIdentity addName addPosition dropEntryId week bidAmount'))),
            waiverResults: sealed ? [] : list(state.waiverResults).map(item => ({ ...pick(item, fields('week identity name winnerTeamId')), contenderTeamIds: strings(item.contenderTeamIds) })),
            trades: sealed ? [] : list(state.trades).map(trade => ({ ...pick(trade, fields('tradeId fromTeamId toTeamId week status respondedWeek deferredUntilWeek note createdAt')),
                giveEntryIds: strings(trade.giveEntryIds), receiveEntryIds: strings(trade.receiveEntryIds), delayedWeeks: list(trade.delayedWeeks).filter(Number.isInteger) })),
            activity: publicActivity(state, sealed),
            rivalMessages: list(privateMessages).filter(message => message.fromTeamId === seatTeamId || message.toTeamId === seatTeamId)
                .map(message => pick(message, fields('id fromTeamId toTeamId text tone week createdAt sequence replyToId'))),
            rivalRelationships: list(state.rivalRelationships).filter(item => item.otherTeamId === seatTeamId)
                .map(item => pick(item, fields('ownerTeamId otherTeamId heat updatedWeek'))),
        };
        if (!sealed && state.settings.gameDeckVersion === 1) result.playerReports = sanitizePlayerReports(playerReports(state, cards, data.logIndex, data.eraFactors), state.currentWeek);
        if (!sealed) result.waiverEditions = { week: state.currentWeek, seasons: Object.fromEntries(App.TimeLeagueEngine.freeAgents(state, cards)
            .map(card => [card.identity, App.TimeLeagueEngine.waiverSeason(state, card, state.currentWeek)])
            .filter(([, season]) => Number.isInteger(season))) };
        if (state.phase === 'draft' && state.settings.draftFormat === 'auction') result.draftAutomation = {
            auctionPending: App.TimeLeagueAI.aiAuctionStep(state, cards, stamp) !== state,
        };
        return result;
    }

    const api = { projectPublicState, draftVisibility, revealPositions, allErasRevealed, sanitizePlayerReports };
    App.TimeLeaguePublicState = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
