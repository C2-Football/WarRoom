/* global module */
// Conversations combine completed events with authored replies. Hidden bids and future scores never enter the chat.
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
        for (const message of normalizeMessages(state.rivalMessages, teams)) {
            if (message.fromTeamId !== recipientTeamId && message.toTeamId !== recipientTeamId) continue;
            // Authored chat is live correspondence. The gamecast spoiler gate only
            // applies to automatically derived events, never a manager's own words.
            const sender = teams.find(team => team.teamId === message.fromTeamId);
            messages.push({ ...message, name: sender.name, persona: sender.manager === 'ai' ? (voices[sender.aiPersona] || voices.steward).label : 'Manager', kind: 'chat', context: '' });
        }
        return [...new Map(messages.map(message => [message.id, message])).values()].sort((a, b) => b.week - a.week || (b.sequence || 0) - (a.sequence || 0) || b.id.localeCompare(a.id));
    }
    const TONES = ['neutral', 'friendly', 'competitive', 'dismissive'];
    const QUICK_REPLIES = [
        { tone: 'friendly', label: 'Friendly', text: 'Respect. Always a good battle with you.' },
        { tone: 'competitive', label: 'Talk trash', text: 'Hope your lineup can back up all that talk.' },
        { tone: 'dismissive', label: 'Dismissive', text: "Cool story. I have a lineup to set." },
    ];
    const replyVoices = {
        warlord: {
            friendly: ['Respect earned. I still intend to beat you.', 'Fair enough. Bring your strongest lineup next time.', 'Good competition. No easy weeks when we meet.'],
            competitive: ['Keep talking. You just moved to the top of my list.', 'That went straight on the bulletin board. Expect a fight for every pickup.', 'Now I want this matchup even more. No friendly prices at my trade desk.'],
            dismissive: ['Brush me off now. You will hear from me on game day.', 'Message received. I will make the next one harder to ignore.', 'Too busy for me? Better be building a dangerous lineup.'],
            neutral: ['I hear you. I am still watching the wire.', 'My desk is open. Make your next move count.', 'Noted. Let the next week do the talking.'],
        },
        archivist: {
            friendly: ['A civil exchange. Always welcome in the ledger.', 'Appreciated. Good managers make this league worth studying.', 'Mutual respect makes negotiations easier.'],
            competitive: ['Filed under bold predictions. I will revisit this after our next matchup.', 'An interesting claim. I have adjusted my negotiating position accordingly.', 'I keep receipts. This one has a prominent place in the archive.'],
            dismissive: ['A short reply. A surprisingly useful data point.', 'Noted. I will let the record speak for itself.', 'Archived. Brevity does not make the message disappear.'],
            neutral: ['Received and noted. Back to the research.', 'I am listening. If there is a deal, put the players on the table.', 'Another entry in the league record. We will see how it develops.'],
        },
        gambler: {
            friendly: ['Cheers! Good company makes the table better.', 'I like your style. Maybe we can make a deal worth taking.', 'All love until kickoff. Then the chips are in.'],
            competitive: ['You want action? Now you have it. I am raising the stakes.', 'That is a big bet for someone with your bench. Game on!', 'Oh, we are doing this? I might get a little louder on the waiver wire.'],
            dismissive: ['Leaving the table already? We just started playing!', 'Cold! Fine, I will save the fireworks for the next hand.', 'You can mute the table. You cannot mute the scoreboard.'],
            neutral: ['I am all ears. What is the next move?', 'Message landed. Always room for another twist in this league.', 'Interesting. I will keep a seat open at the table.'],
        },
        steward: {
            friendly: ['Appreciate it. A good rivalry can still be a friendly one.', 'Right back at you. Good competition makes us both better.', 'Thanks. Happy to keep the trade conversations open.'],
            competitive: ['A little extra motivation never hurts. See you on the field.', 'Alright, challenge accepted. I will bring my best.', 'I usually keep things quiet. You have made this matchup personal.'],
            dismissive: ['Fair enough. I have work to do too.', 'Understood. I will save my reply for game day.', 'No problem. A little extra incentive for our next meeting.'],
            neutral: ['Thanks for the message. My door is open.', 'I hear you. Plenty of season left to manage.', 'Let us keep the conversation going.'],
        },
    };
    const clampHeat = value => Math.max(-6, Math.min(6, value));
    function normalizeMessages(raw, teams) {
        if (!Array.isArray(raw)) return [];
        const ids = new Set();
        return raw.slice(0, 5000).filter(item => {
            if (!item || typeof item.id !== 'string' || !/^(chat|reply):[A-Za-z0-9_-]{8,80}$/.test(item.id) || ids.has(item.id)
                || !teams.some(t => t.teamId === item.fromTeamId) || !teams.some(t => t.teamId === item.toTeamId)
                || (item.id.startsWith('chat:') && !teams.some(t => t.teamId === item.fromTeamId && t.manager === 'human'))
                || (item.id.startsWith('reply:') && (!teams.some(t => t.teamId === item.fromTeamId && t.manager === 'ai') || !teams.some(t => t.teamId === item.toTeamId && t.manager === 'human')))
                || item.fromTeamId === item.toTeamId || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 500
                || !TONES.includes(item.tone) || !Number.isInteger(item.week) || item.week < 1 || item.week > 20
                || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))) return false;
            ids.add(item.id); return true;
        }).map((item, index) => ({ id: item.id, fromTeamId: item.fromTeamId, toTeamId: item.toTeamId,
            text: item.text, tone: item.tone, week: item.week, createdAt: item.createdAt, sequence: index + 1,
            ...(typeof item.replyToId === 'string' && item.replyToId.length <= 160 ? { replyToId: item.replyToId } : {}) }));
    }
    function normalizeRelationships(raw, teams) {
        if (!Array.isArray(raw)) return [];
        const ids = new Set();
        return raw.filter(item => {
            const key = `${item?.ownerTeamId}:${item?.otherTeamId}`;
            if (!item || ids.has(key) || !teams.some(t => t.teamId === item.ownerTeamId && t.manager === 'ai')
                || !teams.some(t => t.teamId === item.otherTeamId && t.manager === 'human')
                || !Number.isInteger(item.heat) || !Number.isInteger(item.updatedWeek) || item.updatedWeek < 1 || item.updatedWeek > 20) return false;
            ids.add(key); return true;
        }).map(item => ({ ownerTeamId: item.ownerTeamId, otherTeamId: item.otherTeamId, heat: clampHeat(item.heat), updatedWeek: item.updatedWeek }));
    }
    function relationshipFor(state, ownerTeamId, otherTeamId) {
        const saved = normalizeRelationships(state.rivalRelationships, state.teams || []).find(row => row.ownerTeamId === ownerTeamId && row.otherTeamId === otherTeamId);
        const old = saved?.heat || 0;
        const elapsed = Math.max(0, (state.currentWeek || 1) - (saved?.updatedWeek || 1));
        const heat = Math.sign(old) * Math.max(0, Math.abs(old) - elapsed);
        return { heat, label: heat <= -2 ? 'Friendly' : heat < 0 ? 'Warming up' : heat === 0 ? 'Even' : heat < 3 ? 'Competitive' : heat < 5 ? 'Fired up' : 'Rivalry',
            aggressionDelta: Math.max(0, heat) * 3, tradePremium: heat > 0 ? heat * 0.01 : heat / 300 };
    }
    function hottestRelationship(state, ownerTeamId) {
        return (state.teams || []).filter(team => team.manager === 'human').map(team => ({ ...relationshipFor(state, ownerTeamId, team.teamId), otherTeamId: team.teamId }))
            .sort((a, b) => b.heat - a.heat)[0] || { heat: 0, aggressionDelta: 0, tradePremium: 0, label: 'Even' };
    }
    function sendMessage(state, input, stamp) {
        const { teamId, toTeamId, tone = 'neutral', messageId, replyToId } = input;
        const sender = state.teams.find(team => team.teamId === teamId && team.manager === 'human');
        const recipient = state.teams.find(team => team.teamId === toTeamId);
        if (!sender || !recipient || sender.teamId === recipient.teamId) throw new Error('Choose another manager in your league.');
        if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 500) throw new Error('Write a message between 1 and 500 characters.');
        if (!TONES.includes(tone)) throw new Error('Choose a valid message tone.');
        if (typeof messageId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(messageId)) throw new Error('This message needs a valid send identifier.');
        if (typeof stamp !== 'string' || !Number.isFinite(Date.parse(stamp))) throw new Error('This message needs a valid timestamp.');
        const text = input.text.trim();
        const history = normalizeMessages(state.rivalMessages, state.teams);
        const existing = history.find(message => message.id === `chat:${messageId}`);
        if (existing) {
            if (existing.fromTeamId === teamId && existing.toTeamId === toTeamId && existing.text === text && existing.tone === tone && (existing.replyToId || '') === (replyToId || '')) return state;
            throw new Error('That message identifier was already used.');
        }
        if (history.length > 4998) throw new Error('This league has reached its conversation history limit.');
        const prior = replyToId ? messagesFor(state, teamId).find(message => message.id === replyToId
            && [message.fromTeamId, message.toTeamId].includes(toTeamId)) : null;
        if (replyToId && !prior) throw new Error('That message is not part of this conversation.');
        const week = Math.max(1, Math.min(20, state.currentWeek || 1));
        const message = { id: `chat:${messageId}`, fromTeamId: teamId, toTeamId, text, tone, week, createdAt: stamp, sequence: history.length + 1, ...(replyToId ? { replyToId } : {}) };
        let next = { ...state, rivalMessages: [...history, message] };
        if (recipient.manager !== 'ai') return next;
        const previous = relationshipFor(state, toTeamId, teamId);
        const heat = clampHeat(previous.heat + ({ friendly: -2, competitive: 2, dismissive: 1, neutral: 0 })[tone]);
        const relations = normalizeRelationships(state.rivalRelationships, state.teams).filter(row => row.ownerTeamId !== toTeamId || row.otherTeamId !== teamId);
        next = { ...next, rivalRelationships: [...relations, { ownerTeamId: toTeamId, otherTeamId: teamId, heat, updatedWeek: week }] };
        const voice = replyVoices[recipient.aiPersona] || replyVoices.steward;
        const lines = voice[tone];
        // Rotate within a persona/tone so rapid conversation does not repeat the
        // same acknowledgement. The same saved send always gets the same reply.
        let hash = 0;
        for (const char of `${state.seed}:${toTeamId}:${tone}`) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
        const count = history.filter(row => row.fromTeamId === teamId && row.toTeamId === toTeamId && row.tone === tone).length;
        const reply = { id: `reply:${messageId}`, fromTeamId: toTeamId, toTeamId: teamId, text: lines[(hash + count) % lines.length], tone: 'neutral', week, createdAt: stamp, sequence: history.length + 2, replyToId: message.id };
        return { ...next, rivalMessages: [...next.rivalMessages, reply] };
    }
    function threadsFor(state, teamId, options = {}) {
        const messages = messagesFor(state, teamId, options);
        return (state.teams || []).filter(team => team.teamId !== teamId).map(team => {
            const thread = messages.filter(message => message.fromTeamId === team.teamId || message.toTeamId === team.teamId);
            return { team, messages: thread, latest: thread[0] || null, relationship: team.manager === 'ai' ? relationshipFor(state, team.teamId, teamId) : null };
        }).sort((a, b) => (b.latest?.week || 0) - (a.latest?.week || 0) || (b.latest?.sequence || 0) - (a.latest?.sequence || 0) || a.team.name.localeCompare(b.team.name));
    }
    App.TimeLeagueRivals = { messagesFor, threadsFor, sendMessage, normalizeMessages, normalizeRelationships, relationshipFor, hottestRelationship, voices, QUICK_REPLIES, TONES };
    if (typeof module !== 'undefined') module.exports = App.TimeLeagueRivals;
})(typeof window !== 'undefined' ? window : globalThis);
