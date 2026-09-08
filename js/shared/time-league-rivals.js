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
    Object.assign(voices, {
        broker: {
            label: 'The Broker', win: ['Closed the week in the black. My desk is still open.', 'A win on the field and room for another deal. Good week.'], loss: ['You won this one. I am already shopping for the upgrade.', 'That loss tells me where to invest next.'], tie: ['We broke even. I prefer a clearer return.'],
            eliminated: ['My ticket to the next round is confirmed. Yours was a tough account to close.'], knockedOut: ['My season is closed. You negotiated that one on the field.'], offer: ['I have an offer with your name on it. Let us talk price.'], accepted: ['Closed. Two signatures, two rosters, one deal.'], rejected: ['We are too far apart on the price. The desk stays open.'], delayed: ['I will keep the paperwork for next week.'], waiverWin: ['{player} is off the market. I got the deal done.'], waiverLoss: ['You acquired {player} before I could. Nice business.'], titleWon: ['The biggest deal of the season is closed: the championship is mine.'], titleLost: ['You own the trophy. Nobody can negotiate that result away. Congratulations.'],
        },
        scout: {
            label: 'The Scout', win: ['That is why I keep digging through the film.', 'A few good finds made the difference this week.'], loss: ['You found the edge I missed. Back to the film.', 'I am putting that matchup under the microscope. Well played.'], tie: ['The reports did not separate us this week.'],
            eliminated: ['The scouting paid off. I am moving on, but you made me work.'], knockedOut: ['You found enough to end my run. Good luck finishing it.'], offer: ['I spotted a player on your bench who could change my lineup.'], accepted: ['That was the player circled in my notes. Deal done.'], rejected: ['My scouting report says to keep looking.'], delayed: ['One more week of scouting, then we revisit it.'], waiverWin: ['I had {player} circled before the claims opened. Glad I got there.'], waiverLoss: ['You found {player} too. I need a deeper shortlist.'], titleWon: ['Every late night with the film led here. Championship secured.'], titleLost: ['Your roster was the best find of the season. Congratulations, champion.'],
        },
        tactician: {
            label: 'The Tactician', win: ['The lineup did its job. On to the next matchup.', 'The plan held. Every starting spot mattered.'], loss: ['You broke the plan. I have adjustments to make.', 'A problem to solve before our next meeting. Good result for you.'], tie: ['Neither plan created enough separation.'],
            eliminated: ['The bracket opens up from here. Your season made this a difficult assignment.'], knockedOut: ['Your plan worked when it mattered. Mine ends here.'], offer: ['This fills a specific hole on each side. The fit is the point.'], accepted: ['That completes the next part of the plan. Agreed.'], rejected: ['That creates more holes than it fills.'], delayed: ['I will reassess the lineup before next week.'], waiverWin: ['{player} fills the spot I needed. One less weakness.'], waiverLoss: ['You secured {player}. Time for the alternate plan.'], titleWon: ['The final plan held. The championship is ours.'], titleLost: ['You executed in the final. A championship well earned.'],
        },
        grinder: {
            label: 'The Grinder', win: ['A useful week of work. Back at it tomorrow.', 'Nothing flashy. Just enough points in the right places.'], loss: ['You got me. Keep working, fix the lineup, go again.', 'No excuses. I need a better week.'], tie: ['Even after all that work. Next week, then.'],
            eliminated: ['One more week to work. You pushed me all season.'], knockedOut: ['That is my season. You put the work in and earned it.'], offer: ['A solid piece each way. No big speech from me.'], accepted: ['Reliable help. That will do.'], rejected: ['I will stick with the points I can count on.'], delayed: ['Fine by me. Plenty to work on until then.'], waiverWin: ['{player} gives me another dependable option.'], waiverLoss: ['You got {player}. I will keep working down the list.'], titleWon: ['Week after week, the work added up. We are champions.'], titleLost: ['You finished the job. Respect, champion.'],
        },
        showman: {
            label: 'The Showman', win: ['Someone save that scoreboard. It belongs on a poster.', 'Now THAT was an entrance. What a week!'], loss: ['The scoreboard needs a rewrite. I will be back for the sequel.', 'You stole my spotlight this week. Enjoy the encore.'], tie: ['A cliffhanger? The crowd deserves a winner.'],
            eliminated: ['The show goes on for me. That was a proper playoff clash.'], knockedOut: ['You ended my season on the big stage. Make the final a good show.'], offer: ['This trade could steal the headlines. Tell me you see it.'], accepted: ['Blockbuster confirmed. Roll the announcement!'], rejected: ['That is not a headline deal. Bring me something bigger.'], delayed: ['You are making the audience wait! Next week it is.'], waiverWin: ['Welcome to the spotlight, {player}. I won that race.'], waiverLoss: ['You signed {player}? That was supposed to be MY announcement!'], titleWon: ['Cue the lights. Raise the trophy. Your champion has arrived!'], titleLost: ['The spotlight is yours, champion. That was one incredible finale.'],
        },
        contrarian: {
            label: 'The Contrarian', win: ['Funny what happens when you stop following the crowd.', 'The unfashionable lineup had a rather good week.'], loss: ['You won. I am not too stubborn to read the scoreboard.', 'My alternative theory did not survive this week.'], tie: ['The consensus can make of that what it likes.'],
            eliminated: ['An unexpected route through the bracket, perhaps. I am still here.'], knockedOut: ['You disproved my championship theory. Fair enough.'], offer: ['Forget the famous season for a moment. Look at the whole player.'], accepted: ['I like the side of this deal nobody is talking about.'], rejected: ['That price depends on a reputation I am not buying.'], delayed: ['Another week might change the popular opinion.'], waiverWin: ['{player} was the value I wanted. The crowd can keep its rankings.'], waiverLoss: ['We agreed on {player}, apparently. You got there first.'], titleWon: ['An unconventional champion is still a champion. I will take the trophy.'], titleLost: ['No contrary opinion today. You are the champion. Well done.'],
        },
        alchemist: {
            label: 'The Alchemist', win: ['The pieces finally sparked. That was the combination I wanted.', 'A little roster chemistry goes a long way.'], loss: ['That mixture needs work. I have another combination in mind.', 'You found the winning formula this week. Back to the bench for me.'], tie: ['Perfectly balanced. Not quite the reaction I was chasing.'],
            eliminated: ['The experiment survives another round. Yours was a difficult formula to crack.'], knockedOut: ['My championship experiment ends here. Yours is still alive.'], offer: ['Move these pieces around and we might both find a spark.'], accepted: ['That changes the mix. Let us see what it creates.'], rejected: ['Those ingredients do not work for my lineup.'], delayed: ['Let it sit for a week. We may see a different reaction.'], waiverWin: ['{player} is the new ingredient. Let us see what happens.'], waiverLoss: ['You took {player}. I need a different catalyst.'], titleWon: ['The final combination worked. The trophy is the result.'], titleLost: ['Your formula won the championship. A result worth admiring.'],
        },
        sentinel: {
            label: 'The Sentinel', win: ['Every position held up. That is how I like to win.', 'A complete lineup. A good result. No need to chase more.'], loss: ['You found a gap. I will close it before we meet again.', 'The lineup gave ground this week. Time to reinforce it.'], tie: ['We held each other level. Neither side gave enough away.'],
            eliminated: ['My lineup held through the playoff test. Respect for the season you built.'], knockedOut: ['You broke through when it mattered. Good luck with the next round.'], offer: ['This gives each lineup a little more protection.'], accepted: ['That strengthens a weak spot. Approved.'], rejected: ['I will not trade away my cover for that.'], delayed: ['I can hold my position until next week.'], waiverWin: ['{player} secures another spot. That was worth the claim.'], waiverLoss: ['You took {player}. I will reinforce somewhere else.'], titleWon: ['The lineup held to the last whistle. Championship secured.'], titleLost: ['You earned the title from the first slot to the last. Congratulations.'],
        },
    });
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
    Object.assign(replyVoices, {
        broker: {
            friendly: ['Good relationships make good deals. Call me anytime.', 'Appreciated. There is always room at my trade desk.', 'Respect. Let us keep the lines open.'],
            competitive: ['A bold negotiating tactic. My asking price just moved.', 'You want a bidding war? I know how to close those.', 'I will remember that when you need a player from me.'],
            dismissive: ['I will take that as a request for a shorter pitch.', 'No meeting today, then. The market keeps moving.', 'Understood. I have other calls to make.'],
            neutral: ['I am listening. What is on the table?', 'Message received. My desk is open.', 'Let me know if there is a deal behind the message.'],
        },
        scout: {
            friendly: ['I like trading notes with someone who does the homework.', 'Respect. You keep making me look a little harder.', 'Good competition gives me more film to study.'],
            competitive: ['I have added that quote to the scouting report.', 'You talk a good game. I am looking for the weakness behind it.', 'Challenge logged. I will leave no bench spot unexamined.'],
            dismissive: ['I will keep the next report short.', 'Fair enough. More time to search the archive.', 'You can skip the report. The matchup still gets played.'],
            neutral: ['Got it. Back to the tape.', 'I am listening. Always interested in another angle.', 'Noted. I have a few names to keep an eye on.'],
        },
        tactician: {
            friendly: ['Respect makes a good rivalry easier to plan around.', 'Likewise. A worthy opponent keeps the plan sharp.', 'Good to hear. There is room for a useful trade here.'],
            competitive: ['That gives the next matchup a little more priority.', 'Challenge accepted. I will account for it in the plan.', 'I prefer solving problems on the scoreboard. You are next.'],
            dismissive: ['No further discussion needed. Back to preparation.', 'Understood. I will let the lineup answer.', 'A short message leaves more time for adjustments.'],
            neutral: ['Received. I will factor that in.', 'What do you need from the trade desk?', 'I am listening. Keep it specific.'],
        },
        grinder: {
            friendly: ['Same to you. Good managers make the work worthwhile.', 'Appreciate that. See you next week.', 'Respect. Keep putting a good team out there.'],
            competitive: ['Talk is easy. I will keep doing the work.', 'Alright. That is a little extra motivation.', 'Put it on the board. I will be ready.'],
            dismissive: ['Fair. I have a lineup to work on too.', 'No worries. Back to it.', 'Enough said. We will settle it next week.'],
            neutral: ['Got it. Back to work.', 'I hear you. Anything else?', 'Understood. We keep moving.'],
        },
        showman: {
            friendly: ['Now that is the energy this league needs!', 'Respect! Good rivals make a better show.', 'We should save the friendly chat for our championship interviews.'],
            competitive: ['Oh, that is going in the trailer for our next matchup!', 'You want the spotlight? Come take it from me.', 'I hope the scoreboard is ready for this much confidence.'],
            dismissive: ['Tough crowd! I will work on my next entrance.', 'You can skip the interview. You cannot skip the game.', 'Fine, save the applause until after kickoff.'],
            neutral: ['The mic is on. What have you got?', 'I am listening. Give me a good story.', 'Message received. Stay tuned for the next move.'],
        },
        contrarian: {
            friendly: ['Unexpectedly civil. I approve.', 'Respect. We do not need to agree on every player.', 'A good rivalry leaves room for a different view.'],
            competitive: ['An impressive amount of certainty. Let us test it.', 'I look forward to becoming the exception to your prediction.', 'That is the popular view in your locker room, I assume.'],
            dismissive: ['A concise argument. Still not a convincing one.', 'You are entitled to that silence.', 'I will file that under unresolved differences.'],
            neutral: ['An angle worth considering.', 'I am listening. Preferably to something unexpected.', 'Noted. I may see it differently.'],
        },
        alchemist: {
            friendly: ['Good energy. That helps the chemistry around here.', 'Respect. Our trades could make an interesting combination.', 'A friendly rivalry is an experiment I can get behind.'],
            competitive: ['That is a useful spark. Let us see what it starts.', 'You just added heat to the experiment.', 'I have a few reactions in mind for our next matchup.'],
            dismissive: ['No reaction? I will try a different approach.', 'Understood. Back to the roster lab.', 'We can let that one settle.'],
            neutral: ['Interesting. Let me turn that over.', 'Message received. Always room for a new combination.', 'I am listening. What piece are you thinking about?'],
        },
        sentinel: {
            friendly: ['Respect. A dependable rival is good for the league.', 'Appreciated. I will keep the trade line open.', 'Good to hear. See you at kickoff.'],
            competitive: ['Then I will make sure every position is covered.', 'You have my attention. The lineup will be ready.', 'That is one more reason to hold my ground next week.'],
            dismissive: ['Understood. I have positions to secure.', 'No reply needed. The team comes first.', 'I will hold that thought until our next matchup.'],
            neutral: ['Message received. Keeping watch on the wire.', 'I hear you. Anything my roster can help with?', 'Noted. I will keep the lineup ready.'],
        },
    });
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
