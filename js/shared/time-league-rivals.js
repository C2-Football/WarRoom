/* global module */
// Rival mail is derived from completed events, never hidden bids or future scores.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const voices = {
        warlord: { label: 'The Warlord', win: ['That is how you take a week.', 'I came for the win. I got it.'], loss: ['You took this round. Enjoy the quiet while it lasts.', 'That one stings. I am coming back with a better lineup.'], tie: ['A draw settles nothing. We finish this next time.'], eliminated: ['Your playoff run ends here. I am not stopping yet.'], knockedOut: ['You ended my run. Make that win count.'], offer: ['I see a deal. Bring your best answer.', 'Your roster has something I want. Here is my opening offer.'], accepted: ['Deal done. Now let us see who made the better move.'], rejected: ['No deal. I will find another way to win.'], delayed: ['Next week, then. This offer cannot wait forever.'], waiverWin: ['I got {player}. You will need a second option.'], waiverLoss: ['You beat me to {player}. I had plans for that player.'] },
        archivist: { label: 'The Archivist', win: ['Another result for the ledger. Preparation paid off.', 'The result is in. I will keep the same discipline.'], loss: ['The ledger records a loss. Time to review my assumptions.', 'You earned the result. I have some notes to revisit.'], tie: ['Precisely level. An unusually inconclusive entry.'], eliminated: ['Your season closes here. My next chapter is still unwritten.'], knockedOut: ['You closed the book on my season. A well-earned result.'], offer: ['I think this exchange improves both rosters. Have a look.', 'I have reviewed our rosters. This is the deal I can justify.'], accepted: ['Terms agreed. The ledger is updated.'], rejected: ['No agreement. I will revisit the market.'], delayed: ['Filed for next week. We can revisit the terms then.'], waiverWin: ['{player} joins my roster. Our competing claims are settled.'], waiverLoss: ['Your claim secured {player}. I will revise my shortlist.'] },
        gambler: { label: 'The Gambler', win: ['The cards came up my way. What a week!', 'That is the kind of payoff I play for.'], loss: ['Well, that bet missed. I still like my next hand.', 'You cashed in this week. I am not leaving the table.'], tie: ['A push! All that drama and we split it.'], eliminated: ['That is the knockout! I am still playing for the jackpot.'], knockedOut: ['You called my bluff and ended my run. Go win the whole thing.'], offer: ['Want to shake things up? Take a look at this deal.', 'I have a swing in mind. You in?'], accepted: ['We have a deal. Let the next hand begin!'], rejected: ['No takers. Back to the table I go.'], delayed: ['Holding the cards until next week. Do not forget this hand.'], waiverWin: ['{player} is mine! That was a claim worth playing.'], waiverLoss: ['You snagged {player}! There goes my next big swing.'] },
        steward: { label: 'The Steward', win: ['A good team effort this week. See you at the next one.', 'Glad we got that result. Plenty of season to manage.'], loss: ['Good win. I need to get more out of my lineup next time.', 'You had the better week. Back to work for me.'], tie: ['Nothing between us this week. Good contest.'], eliminated: ['A tough way for your run to end. Good competition this season.'], knockedOut: ['You earned your place. Good luck with the rest of the playoffs.'], offer: ['This could fill a need for each of us. What do you think?', 'I put together a balanced swap. Have a look when you can.'], accepted: ['Thanks for working out a deal. Hope it helps us both.'], rejected: ['We could not find a fit this time. We can try again.'], delayed: ['No rush. Let us revisit this next week.'], waiverWin: ['I landed {player}. I know you had a claim in too.'], waiverLoss: ['Nice pickup with {player}. I was hoping to add that depth myself.'] },
    };
    const titleVoices = {
        warlord: { titleWon: ['The championship is mine. You made me work for it.'], titleLost: ['You took the title. I will remember this when we meet again.'] },
        archivist: { titleWon: ['The final entry is a championship. A season worth keeping in the archives.'], titleLost: ['The record is settled: you are the champion. Congratulations on the season.'] },
        gambler: { titleWon: ['Jackpot! The championship came home. What a final hand!'], titleLost: ['You won the whole pot. Enjoy that trophy — you earned it.'] },
        steward: { titleWon: ['We brought home the championship. Thank you for a hard-fought final.'], titleLost: ['Congratulations, champion. You finished the job. That was a good season.'] },
    };
    for (const [persona, lines] of Object.entries(titleVoices)) Object.assign(voices[persona], lines);
    function messagesFor(state, recipientTeamId, options = {}) {
        const teams = state.teams || [];
        const human = teams.find(team => team.teamId === recipientTeamId && team.manager === 'human');
        if (!human) return [];
        const messages = [];
        const emit = (id, ai, kind, week, context, detail, tradeId) => {
            if (!ai || ai.manager !== 'ai' || (options.throughWeek != null && week > options.throughWeek)) return;
            const voice = voices[ai.aiPersona] || voices.steward;
            const lines = voice[kind];
            let hash = 0;
            for (const char of `${state.seed}:${id}`) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
            messages.push({ id, fromTeamId: ai.teamId, toTeamId: human.teamId, name: ai.name, persona: voice.label, kind, week, context, detail, tradeId, text: lines[hash % lines.length].replace('{player}', detail || 'that player') });
        };
        for (const week of state.finalizedWeeks || []) {
            if (options.throughWeek != null && week.week > options.throughWeek) continue;
            const match = week.matchups.find(row => row.home === human.teamId || row.away === human.teamId);
            if (!match) continue;
            const ai = teams.find(team => team.teamId === (match.home === human.teamId ? match.away : match.home));
            const playoff = week.week > state.settings.regularSeasonWeeks;
            const final = playoff && week.week === App.TimeLeagueEngine?.seasonEndWeek(state) && match.winner === state.championTeamId;
            const kind = final ? match.winner === human.teamId ? 'titleLost' : 'titleWon' : !match.winner ? 'tie' : match.winner === human.teamId ? playoff ? 'knockedOut' : 'loss' : playoff ? 'eliminated' : 'win';
            emit(`game:${week.week}:${human.teamId}`, ai, kind, week.week, final ? 'Championship final' : playoff ? 'Playoff final' : 'Game final', `${teams.find(team => team.teamId === match.home)?.name}: ${match.homePoints.toFixed(1)} · ${teams.find(team => team.teamId === match.away)?.name}: ${match.awayPoints.toFixed(1)}`);
        }
        for (const trade of state.trades || []) {
            if (trade.fromTeamId !== human.teamId && trade.toTeamId !== human.teamId) continue;
            const ai = teams.find(team => team.teamId === (trade.fromTeamId === human.teamId ? trade.toTeamId : trade.fromTeamId));
            const names = ids => (ids || []).map(id => teams.flatMap(team => team.roster || []).find(entry => entry.entryId === id)?.name).filter(Boolean);
            const receives = names(trade.fromTeamId === human.teamId ? trade.receiveEntryIds : trade.giveEntryIds);
            const sends = names(trade.fromTeamId === human.teamId ? trade.giveEntryIds : trade.receiveEntryIds);
            const assets = receives.length && sends.length ? `You receive ${receives.join(', ')}; you send ${sends.join(', ')}` : '';
            if (trade.fromTeamId === ai?.teamId) emit(`trade:${trade.tradeId}:offer`, ai, 'offer', trade.week, 'Trade request', assets, trade.tradeId);
            const kind = trade.status === 'accepted' ? 'accepted' : trade.status === 'rejected' ? 'rejected' : null;
            if (kind) emit(`trade:${trade.tradeId}:${kind}`, ai, kind, trade.respondedWeek ?? trade.week, `Trade ${kind}`, '', trade.tradeId);
            const delayedWeeks = trade.delayedWeeks || (trade.deferredUntilWeek ? [trade.deferredUntilWeek - 1] : []);
            for (const week of delayedWeeks) emit(`trade:${trade.tradeId}:delayed:${week}`, ai, 'delayed', week, `Trade held for Week ${week + 1}`, '', trade.tradeId);
        }
        for (const award of state.waiverResults || []) {
            if (!award.contenderTeamIds.includes(human.teamId)) continue;
            const rivals = award.winnerTeamId === human.teamId ? award.contenderTeamIds.filter(id => id !== human.teamId) : [award.winnerTeamId];
            for (const id of rivals) emit(`waiver:${award.week}:${award.identity}:${id}:${human.teamId}`, teams.find(team => team.teamId === id), award.winnerTeamId === human.teamId ? 'waiverLoss' : 'waiverWin', award.week, 'Contested waiver', award.name);
        }
        return [...new Map(messages.map(message => [message.id, message])).values()].sort((a, b) => b.week - a.week || b.id.localeCompare(a.id));
    }
    App.TimeLeagueRivals = { messagesFor, voices };
    if (typeof module !== 'undefined') module.exports = App.TimeLeagueRivals;
})(typeof window !== 'undefined' ? window : globalThis);
