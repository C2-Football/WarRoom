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
    // Extra authored lines keep every manager's voice recognizable over a full season.
    const replyExtras = {
        warlord: {
            friendly: ['You compete hard. I can respect that without going easy on you.', 'Good rivals keep me sharp. Keep bringing it.', 'We can shake hands and still fight for every point.'],
            competitive: ['You just gave my next roster move a little more urgency.', 'I hope you have a backup plan for all that confidence.', 'Save that message. One of us will enjoy reading it later.'],
            dismissive: ['Dismiss the message. Do not dismiss the matchup.', 'Fine. I would rather take points than your time.', 'That attitude makes the next win worth a little more.'],
            neutral: ['Give me a reason to move a player and I will listen.', 'The roster is never finished. I am looking for the next edge.', 'I have heard you. Time to turn the talk into a move.'],
        },
        archivist: {
            friendly: ['A thoughtful opponent is worth keeping in the archive.', 'Thank you. We can disagree on value and still deal fairly.', 'Good faith makes the numbers easier to discuss.'],
            competitive: ['A prediction without supporting evidence. I have kept a copy.', 'The ledger has room for your confidence and the eventual result.', 'I will be quite interested in the follow-up to that claim.'],
            dismissive: ['No further notes, then. The result can supply the footnote.', 'A minimal response. I will not mistake it for an empty argument.', 'I have recorded the reply exactly as short as you intended.'],
            neutral: ['There is usually more in the record than the headline suggests.', 'I will compare that with the rest of my notes.', 'If you want my attention, a concrete offer is a useful start.'],
        },
        gambler: {
            friendly: ['A good table needs a rival who can take a joke.', 'Cheers. I can like you and still want your best player.', 'That is the spirit. Good company, questionable odds, great league.'],
            competitive: ['I was trying to behave. You are making that difficult.', 'Careful. I have a bench full of bad ideas and plenty of confidence.', 'All that talk and no chips on the table yet?'],
            dismissive: ['A fold by text? Interesting strategy.', 'Fine, keep the poker face. I will keep making moves.', 'The quiet players are always the ones I watch.'],
            neutral: ['I am weighing a few wild options. Yours can join the pile.', 'Always another hand to play in this league.', 'Give me something interesting and I might take the swing.'],
        },
        steward: {
            friendly: ['I would rather have a good rival than an easy week.', 'Thanks. A little respect goes a long way around the league.', 'Glad we can keep it competitive without closing the door.'],
            competitive: ['You have made your point. Now I need my lineup to make mine.', 'Fair challenge. I will spend a little more time on this matchup.', 'I can be patient without being an easy opponent.'],
            dismissive: ['We can leave the conversation there for now.', 'Alright. I will keep the next message useful.', 'No hard feelings. The competition can do the talking.'],
            neutral: ['I am keeping the roster balanced and the options open.', 'A useful suggestion is always welcome at my desk.', 'Let me know what you have in mind. I can listen.'],
        },
        broker: {
            friendly: ['You are the kind of manager I will take a call from.', 'Good rapport does not guarantee a deal, but it helps.', 'We might disagree on the price. I still like doing business with you.'],
            competitive: ['You are negotiating with attitude now. I can do that too.', 'I would save some of that energy for the next bidding round.', 'Your confidence is free. My players are not.'],
            dismissive: ['Straight to voicemail. I know that move.', 'I will keep the call sheet short next time.', 'No response needed. There is another desk on the line.'],
            neutral: ['Everything has a price. I am interested in hearing yours.', 'I can work with specifics. What exactly are you offering?', 'We do not need a long meeting to make a useful move.'],
        },
        scout: {
            friendly: ['You notice things other managers miss. I respect that.', 'Good rivals make me scout the whole roster, not just the starters.', 'I am happy to compare notes when the timing is right.'],
            competitive: ['That confidence is going next to the film clips.', 'I will find the weak spot behind the big statement.', 'Now I have a little more reason to get the next pickup right.'],
            dismissive: ['The report can wait. The search will not.', 'I will take the quiet time and keep scouting.', 'Fair enough. I prefer a useful find to a long argument.'],
            neutral: ['I am looking a little deeper than the first page of names.', 'Somewhere in the archive is my next answer.', 'If you have spotted something, I am listening.'],
        },
        tactician: {
            friendly: ['A good opponent deserves a proper plan. You have one.', 'Respect received. The next matchup still gets my best preparation.', 'We might find a move that makes both lineups more complete.'],
            competitive: ['That changes the priority of our next meeting.', 'A strong claim. I will prepare for the version of you that can prove it.', 'The plan now includes a little extra motivation.'],
            dismissive: ['No wasted words, then. Back to the lineup.', 'I can work with silence. The next move is what matters.', 'Understood. There is no need to argue before kickoff.'],
            neutral: ['I am checking the fit before I commit to a move.', 'Every open slot is a problem with an answer somewhere.', 'Make the roster case and I will consider it.'],
        },
        grinder: {
            friendly: ['Good to hear from a manager who keeps showing up.', 'A little respect. A lot of work. That suits me.', 'Same here. No need to make this harder than it is.'],
            competitive: ['You can have the last word. I want the next win.', 'That is fine. I will be at work while you are talking.', 'No speech from me. Just another reason to get the lineup right.'],
            dismissive: ['Alright. There is work waiting anyway.', 'I can keep it short too. See you out there.', 'Fair enough. I am not here to win the conversation.'],
            neutral: ['Another small improvement is usually worth looking for.', 'I am keeping the dependable points and doing the next job.', 'Tell me the useful part. I will listen.'],
        },
        showman: {
            friendly: ['That is a quote I would put on the league poster.', 'Good energy! We could make this rivalry a main event.', 'Respect from a worthy co-star. I will take it.'],
            competitive: ['Someone get a camera. This matchup just found its trailer.', 'Big words. I hope the performance lives up to the promotion.', 'You are asking for an encore you might not enjoy.'],
            dismissive: ['No review? I was hoping for at least one star.', 'The silent treatment is terrible for the ratings.', 'Alright, the next announcement will need to be impossible to miss.'],
            neutral: ['I am listening. There is always room for a good plot twist.', 'A quiet message before a big move, perhaps?', 'Give me a reason to call the press desk.'],
        },
        contrarian: {
            friendly: ['We agree on good competition, at least.', 'A reasonable message. I will resist the urge to disagree.', 'Respect does not require identical draft boards.'],
            competitive: ['I enjoy a theory that is easy to test on Sunday.', 'The confidence is impressive. The evidence is still pending.', 'I am comfortable being the obstacle to your prediction.'],
            dismissive: ['An interesting choice to say so little with so much attitude.', 'You can leave the argument there. I probably will not.', 'No consensus reached. I can live with that.'],
            neutral: ['I am considering the angle nobody seems to mention.', 'An interesting point. I may reach a different conclusion.', 'Let us separate the useful idea from the popular one.'],
        },
        alchemist: {
            friendly: ['Good chemistry between rivals. That can lead to useful trades.', 'Respect is a decent ingredient for this league.', 'We might find a combination that surprises both of us.'],
            competitive: ['That added just enough heat to change the experiment.', 'I have a few volatile ideas for our next matchup.', 'You are going to make me try something interesting, are you not?'],
            dismissive: ['A cool reaction. I will adjust the mix.', 'We can leave the conversation to settle for now.', 'Fine. The roster experiment gets the rest of my attention.'],
            neutral: ['I am looking for pieces that work better together.', 'There is usually another combination worth trying.', 'That could be useful. Let me think about the fit.'],
        },
        sentinel: {
            friendly: ['Dependable competition. That is worth a little respect.', 'Good to hear. The trade line remains open.', 'I appreciate a rival who takes the whole lineup seriously.'],
            competitive: ['Then every position gets a second inspection before kickoff.', 'That is noted. I will not leave you an easy opening.', 'I do not need to get louder to make this difficult for you.'],
            dismissive: ['Understood. I have a lineup to secure.', 'No need for more words. I will hold my position.', 'Fine. We can let the result settle the conversation.'],
            neutral: ['I am covering the weak spots before I chase another luxury.', 'A secure lineup leaves room to consider a sensible offer.', 'I am watching the whole roster, right down to the last slot.'],
        },
    };
    for (const [persona, tones] of Object.entries(replyExtras)) {
        for (const [tone, lines] of Object.entries(tones)) replyVoices[persona][tone].push(...lines);
    }
    const contextOpeners = {
        warlord: { game: 'That matchup is still on my mind.', trade: 'About that deal:', waiver: 'That claim was worth fighting for.', playoffs: 'A playoff result is one you remember.' },
        archivist: { game: 'I have reviewed that result.', trade: 'On the trade terms:', waiver: 'The claim is settled in the ledger.', playoffs: 'That playoff chapter is part of the record now.' },
        gambler: { game: 'That was quite a hand we played.', trade: 'Back to the trade table:', waiver: 'That waiver race had some stakes.', playoffs: 'That playoff hand had everything riding on it.' },
        steward: { game: 'That was a worthwhile matchup.', trade: 'About our trade conversation:', waiver: 'That was a useful player to chase.', playoffs: 'It takes a good season to get to that stage.' },
        broker: { game: 'We got a result out of that meeting.', trade: 'On the business between our desks:', waiver: 'That player came off the market quickly.', playoffs: 'The playoff result is a big one for the books.' },
        scout: { game: 'There was plenty to learn from that matchup.', trade: 'About the players in that deal:', waiver: 'We clearly found the same name on the wire.', playoffs: 'That playoff result deserves another look at the film.' },
        tactician: { game: 'I have been thinking through that matchup.', trade: 'Back to the roster fit in that offer:', waiver: 'That claim was part of the lineup plan.', playoffs: 'The bracket made that matchup count.' },
        grinder: { game: 'That week took some work.', trade: 'About that swap:', waiver: 'That pickup was worth the effort.', playoffs: 'A lot of weeks of work went into that playoff game.' },
        showman: { game: 'That matchup gave us a story.', trade: 'About our potential blockbuster:', waiver: 'That signing got my attention.', playoffs: 'That was a result on the big stage.' },
        contrarian: { game: 'The scoreboard gave us something to debate.', trade: 'About the value on each side of that deal:', waiver: 'Apparently we agreed on that waiver target.', playoffs: 'That playoff result settles at least one argument.' },
        alchemist: { game: 'That matchup tested the mix.', trade: 'About those roster ingredients:', waiver: 'That player would change a lineup’s chemistry.', playoffs: 'That playoff game was a proper test of the formula.' },
        sentinel: { game: 'That matchup tested every position.', trade: 'About the cover in that trade:', waiver: 'That claim mattered to the depth chart.', playoffs: 'That playoff result came down to holding the lineup together.' },
    };
    const contextOf = message => !message || message.kind === 'chat' ? null
        : ['titleWon', 'titleLost', 'eliminated', 'knockedOut'].includes(message.kind) ? 'playoffs'
            : ['offer', 'accepted', 'rejected', 'delayed'].includes(message.kind) ? 'trade'
                : ['waiverWin', 'waiverLoss'].includes(message.kind) ? 'waiver'
                    : ['win', 'loss', 'tie'].includes(message.kind) ? 'game' : null;
    const hashOf = key => {
        let value = 0;
        for (const char of key) value = ((value * 31) + char.charCodeAt(0)) >>> 0;
        return value;
    };
    const quickPools = {
        friendly: ['Respect. Always a good battle with you.', 'Good competition makes this league better. Keep bringing it.', 'I like a rivalry where we can still make a fair deal.', 'Good luck with your next move. See you at kickoff.', 'All respect from my side. Let’s keep the conversation open.', 'You keep me paying attention. That is a good thing.'],
        competitive: ['Hope your lineup can back up all that talk.', 'Save this conversation. One of us is going to enjoy it later.', 'Your bench better have a backup plan for all that confidence.', 'Keep talking. I am giving our next matchup some extra attention.', 'I am coming for the win, the pickup, and the bragging rights.', 'Let’s settle this on the scoreboard. I like my chances.'],
        dismissive: ['Cool story. I have a lineup to set.', 'Noted. Back to my roster.', 'I will save the conversation for after the next result.', 'You can have the last word. I have other moves to make.', 'I hear you. That is about all the attention this gets today.', 'Message received. I am moving on.'],
    };
    const quickContexts = {
        game: { friendly: 'Good game. Always a battle when our teams meet.', competitive: 'I am keeping that scoreboard in mind for our next meeting.', dismissive: 'That game is in the books. I have moved on.' },
        trade: { friendly: 'Let’s keep talking. I am interested in a deal that helps both rosters.', competitive: 'If you want my players, bring an offer that earns my attention.', dismissive: 'The trade desk can wait. I have a lineup to set.' },
        waiver: { friendly: 'That was a good waiver race. Plenty of season left.', competitive: 'The next contested pickup is going to be even more interesting.', dismissive: 'One claim. I am already looking at the next option.' },
        playoffs: { friendly: 'Respect for the season you put together. That was a big matchup.', competitive: 'That playoff result is going to make this rivalry interesting.', dismissive: 'The bracket has the result. I do not need the commentary.' },
    };
    function quickRepliesFor(state, teamId, otherTeamId, options = {}) {
        const thread = messagesFor(state, teamId, options).filter(row => row.fromTeamId === otherTeamId || row.toTeamId === otherTeamId);
        const latest = thread.find(row => row.toTeamId === teamId);
        const context = contextOf(latest);
        const sent = thread.filter(row => row.kind === 'chat' && row.fromTeamId === teamId);
        return QUICK_REPLIES.map(reply => {
            const pool = [...(quickContexts[context]?.[reply.tone] ? [quickContexts[context][reply.tone]] : []), ...quickPools[reply.tone]];
            const recent = new Set(sent.filter(row => row.tone === reply.tone).slice(0, pool.length - 1).map(row => row.text));
            const fresh = pool.filter(line => !recent.has(line));
            const choices = fresh.length ? fresh : pool;
            const offset = Math.max(0, Number.isInteger(options.variant) ? options.variant : 0);
            return { ...reply, text: choices[(hashOf(`${state.seed}:${teamId}:${otherTeamId}:${reply.tone}:${latest?.id || ''}`) + offset) % choices.length] };
        });
    }
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
        return { heat, label: heat <= -5 ? 'Friend' : heat <= -2 ? 'Friendly' : heat < 0 ? 'Warming up' : heat === 0 ? 'Neutral' : heat < 3 ? 'Competitive' : heat < 5 ? 'Fired up' : 'Hot rival',
            aggressionDelta: Math.max(0, heat) * 3, tradePremium: heat > 0 ? heat * 0.01 : heat / 300 };
    }
    function hottestRelationship(state, ownerTeamId) {
        return (state.teams || []).filter(team => team.manager === 'human').map(team => ({ ...relationshipFor(state, ownerTeamId, team.teamId), otherTeamId: team.teamId }))
            .sort((a, b) => b.heat - a.heat)[0] || { heat: 0, aggressionDelta: 0, tradePremium: 0, label: 'Neutral' };
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
        const progressionWeek = Math.max(1, Math.min(20, state.currentWeek || 1));
        // Scoring saves advance the internal week before the owner advances the
        // postgame gate. Keep the conversation with the final being discussed.
        const week = Math.max(1, progressionWeek - (state.weekStage === 'postgame' ? 1 : 0));
        const message = { id: `chat:${messageId}`, fromTeamId: teamId, toTeamId, text, tone, week, createdAt: stamp, sequence: history.length + 1, ...(replyToId ? { replyToId } : {}) };
        let next = { ...state, rivalMessages: [...history, message] };
        if (recipient.manager !== 'ai') return next;
        const previous = relationshipFor(state, toTeamId, teamId);
        const heat = clampHeat(previous.heat + ({ friendly: -2, competitive: 2, dismissive: 1, neutral: 0 })[tone]);
        const relations = normalizeRelationships(state.rivalRelationships, state.teams).filter(row => row.ownerTeamId !== toTeamId || row.otherTeamId !== teamId);
        next = { ...next, rivalRelationships: [...relations, { ownerTeamId: toTeamId, otherTeamId: teamId, heat, updatedWeek: progressionWeek }] };
        const voice = replyVoices[recipient.aiPersona] || replyVoices.steward;
        const context = contextOf(prior);
        const opener = context && (contextOpeners[recipient.aiPersona] || contextOpeners.steward)[context];
        const lines = voice[tone];
        const pool = opener ? [...lines, ...lines.map(line => `${opener} ${line}`)] : lines;
        // Only this pair's prior replies influence variety. Exhaust fresh lines
        // before repeating; retries return above without advancing the selection.
        const recent = history.filter(row => row.fromTeamId === toTeamId && row.toTeamId === teamId).slice(-(pool.length - 1));
        const seen = new Set(recent.map(row => row.text));
        const fresh = pool.filter(line => !seen.has(line));
        const choices = fresh.length ? fresh : pool;
        const index = hashOf(`${state.seed}:${teamId}:${toTeamId}:${tone}:${messageId}`) % choices.length;
        const reply = { id: `reply:${messageId}`, fromTeamId: toTeamId, toTeamId: teamId, text: choices[index], tone: 'neutral', week, createdAt: stamp, sequence: history.length + 2, replyToId: message.id };
        return { ...next, rivalMessages: [...next.rivalMessages, reply] };
    }
    function threadsFor(state, teamId, options = {}) {
        const messages = messagesFor(state, teamId, options);
        return (state.teams || []).filter(team => team.teamId !== teamId).map(team => {
            const thread = messages.filter(message => message.fromTeamId === team.teamId || message.toTeamId === team.teamId);
            return { team, messages: thread, latest: thread[0] || null, relationship: team.manager === 'ai' ? relationshipFor(state, team.teamId, teamId) : null };
        }).sort((a, b) => (b.latest?.week || 0) - (a.latest?.week || 0) || (b.latest?.sequence || 0) - (a.latest?.sequence || 0) || a.team.name.localeCompare(b.team.name));
    }
    App.TimeLeagueRivals = { messagesFor, threadsFor, sendMessage, normalizeMessages, normalizeRelationships, relationshipFor, hottestRelationship, voices, QUICK_REPLIES, quickRepliesFor, TONES };
    if (typeof module !== 'undefined') module.exports = App.TimeLeagueRivals;
})(typeof window !== 'undefined' ? window : globalThis);
