/* global module */
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
    // These are authored characters. Their preferences shape real decisions;
    // memories below are derived only from events that actually happened.
    const PROFILES = {
        warlord: { goal: 'Control the strongest starting lineup', fear: 'Losing while useful resources sit unused', principle: 'An advantage is something to press.', tell: 'Pays for an immediate starter; grows impatient near the cutoff.', voice: 'Short, decisive sentences; respects a rival who follows through.', pressure: 'The window is closing. I will spend to strengthen the lineup now.', secure: 'We have room to breathe. I am protecting the weapons that got us here.', reflection: 'I remember who stood in my way, and who kept their word.' },
        archivist: { goal: 'Make the best decision the evidence supports', fear: 'Mistaking one extraordinary week for a pattern', principle: 'A record is more useful than a reputation.', tell: 'Waits for evidence; a late deficit lowers the price of certainty.', voice: 'Measured and specific; distinguishes an observation from a forecast.', pressure: 'The remaining weeks change the calculation. A useful upgrade cannot wait for perfect evidence.', secure: 'Our position gives us time to protect depth and check the sample.', reflection: 'I keep the terms of our previous dealings in the record.' },
        gambler: { goal: 'Turn uncertainty into a winning edge', fear: 'Finishing quietly with a perfectly safe losing roster', principle: 'A chance matters only if you are willing to take it.', tell: 'Chases a wide range of outcomes when behind; protects some winnings when ahead.', voice: 'Wry card-table confidence; admits that a bet can lose.', pressure: 'A safe finish outside the field buys me nothing. I am looking for upside.', secure: 'We are ahead. I can keep a little in reserve without folding the whole hand.', reflection: 'I remember the hands we chose to play together.' },
        steward: { goal: 'Keep a complete team competitive all season', fear: 'Solving one problem by creating two more', principle: 'Every starter needs someone who can cover them.', tell: 'Values balance and reserves; spends when a clear need becomes urgent.', voice: 'Calm, considerate and firm about roster obligations.', pressure: 'We need help soon. I can move depth, but I will still protect the rest of the lineup.', secure: 'There is no need to undo a balanced roster. I am keeping our cover intact.', reflection: 'A fair exchange makes the next conversation easier.' },
        broker: { goal: 'Find the exchange that other managers have missed', fear: 'Letting a useful deal die while everyone waits', principle: 'The best price is attached to a reason both sides can explain.', tell: 'Keeps negotiations moving; adapts the package to the other manager’s need.', voice: 'Conversational and commercial; concrete offers rather than empty promises.', pressure: 'My deadline is the standings. I can be flexible if the deal helps this week.', secure: 'I can wait for a better fit. There is no reason to trade just to announce a deal.', reflection: 'The way we handled the last negotiation matters to the next one.' },
        scout: { goal: 'Recognize a player’s improvement before everyone else', fear: 'Giving up on a useful player before the evidence arrives', principle: 'Watch what changed, not just the biggest number.', tell: 'Values emerging production and uncertainty; seeks upside when the race tightens.', voice: 'Curious and observational; names the evidence behind a hunch.', pressure: 'We need a player whose next stretch can change the picture. I am willing to back a developing sample.', secure: 'We can give a promising player time without leaving the starters exposed.', reflection: 'I keep track of the players we chose to trust.' },
        tactician: { goal: 'Solve the exact problem in the lineup', fear: 'Paying for strength in a position that does not help', principle: 'A useful piece has a place to play.', tell: 'Chases scarce slots; urgency makes immediate fit worth more than spare value.', voice: 'Direct, structured and focused on the next practical move.', pressure: 'There is less time to carry a weakness. I am buying help for the position that changes our lineup.', secure: 'The starting structure works. The next move should protect it.', reflection: 'I remember whether a deal solved the problem we discussed.' },
        grinder: { goal: 'Accumulate dependable production', fear: 'Trading repeated small advantages for one dramatic story', principle: 'The ordinary useful week is still useful.', tell: 'Prefers consistency even when chasing; increases spending before increasing risk.', voice: 'Plainspoken, patient and unimpressed by hype.', pressure: 'We need points now. I will spend more for steady work before I gamble on a headline.', secure: 'Keep doing the work. There is no prize for making the busiest transaction list.', reflection: 'Good dealings count. I do not forget a fair return.' },
        showman: { goal: 'Build a team that wins and is remembered', fear: 'Being irrelevant when the important games arrive', principle: 'A bold move still has to earn its place on the field.', tell: 'Likes visible upgrades; a threatened playoff run makes the bids louder.', voice: 'Expressive and theatrical, with humor when a boast goes wrong.', pressure: 'The audience will not remember a cautious exit. I am looking for a move that gives us a real chance.', secure: 'We have earned the spotlight. I am not dismantling the cast for a cheap headline.', reflection: 'Some negotiations deserve a sequel. Others deserve a better script.' },
        contrarian: { goal: 'Buy useful production without paying for consensus', fear: 'Paying a reputation premium for ordinary returns', principle: 'An unpopular price can still be the right one.', tell: 'Seeks overlooked value; urgency changes the deadline, not the need for value.', voice: 'Dry and skeptical; challenges the assumption rather than insulting the manager.', pressure: 'Everyone knows we need wins. That does not make every asking price sensible.', secure: 'Being ahead lets me pass on the fashionable overpay.', reflection: 'I remember which of our disagreements the results actually settled.' },
        alchemist: { goal: 'Assemble pieces that improve one another’s roster fit', fear: 'Keeping a stale combination because it is familiar', principle: 'Change the mix when the evidence says it can work better.', tell: 'Welcomes upside and reshuffling, especially when the current plan is failing.', voice: 'Inventive and energetic; treats a failed experiment as something to learn from.', pressure: 'The present mix is running out of time. I am ready to change it if the new pieces fit.', secure: 'A working combination needs protection as much as invention.', reflection: 'Every exchange tells us something about how we build a team.' },
        sentinel: { goal: 'Keep every required position protected', fear: 'Entering a decisive week with an avoidable hole', principle: 'A reserve is useful when it keeps the whole team standing.', tell: 'Protects depth and budget; spends decisively to remove a real vulnerability.', voice: 'Restrained and watchful; gives clear conditions and keeps them.', pressure: 'The margin is thin. I will commit reserves where they remove an immediate weakness.', secure: 'We have built a good position. I am guarding the depth behind it.', reflection: 'Trust is built by following through when it matters.' },
    };
    const profileFor = team => ({ id: PROFILES[team?.aiPersona] ? team.aiPersona : 'steward', ...(PROFILES[team?.aiPersona] || PROFILES.steward) });
    function forTeam(state, teamOrId, throughWeek = Infinity) {
        const id = typeof teamOrId === 'string' ? teamOrId : teamOrId?.teamId;
        const regular = state.settings?.regularSeasonWeeks || 12;
        const cutoff = Math.min(throughWeek, Math.max(0, (state.currentWeek || 1) - 1));
        const weeks = (state.finalizedWeeks || []).filter(row => row.week <= cutoff && row.week <= regular);
        const safe = { ...state, finalizedWeeks: weeks.map(row => ({ ...row, results: row.results || [], matchups: row.matchups || [] })) };
        const table = App.TimeLeagueEngine?.computeStandings?.(safe) || [];
        const own = table.find(row => row.teamId === id), rank = table.findIndex(row => row.teamId === id) + 1;
        const completed = Math.max(0, ...weeks.map(row => row.week));
        const remaining = Math.max(0, regular - completed), field = Math.max(1, Math.min(table.length || 1, state.settings?.playoffTeams || 1));
        const edge = rank <= field ? table[field] : table[field - 1];
        const margin = own && edge ? own.wins - edge.wins : 0;
        let status = 'building', label = 'Learning the field', urgency = .2;
        let reason = 'Early results are still building the picture.';
        if (own && completed >= 3) {
            const catchers = table.filter(row => row.teamId !== id && row.wins + remaining >= own.wins).length;
            const unreachable = table.filter(row => row.teamId !== id && row.wins > own.wins + remaining).length;
            if (!remaining) {
                status = rank <= field ? 'playoffs' : 'eliminated';
                label = rank <= field ? (state.settings.playoffTeams ? 'Playoff push' : 'Leading the final table') : 'Playing for pride';
                urgency = rank <= field ? .95 : .3;
                reason = rank <= field ? `The regular-season field is set; seed ${rank}.` : 'The regular-season field is set. The remaining results still matter.';
            } else if (unreachable >= field) {
                status = 'eliminated'; label = 'Playing for pride'; urgency = .3;
                reason = 'The remaining schedule cannot close the gap to the field. This team will keep competing.';
            } else if (catchers < field) {
                status = 'secured'; label = 'Place secured'; urgency = .25;
                reason = `The win cushion secures a place with ${remaining} regular-season weeks left. Depth and seeding matter.`;
            } else if (rank > field) {
                status = 'chasing'; label = 'Chasing the cutoff'; urgency = clamp(.4 + .5 * completed / regular, .4, .95);
                reason = `${Math.abs(margin)} ${Math.abs(margin) === 1 ? 'win' : 'wins'} behind the current cutoff; ${remaining} regular-season weeks left.`;
            } else if (margin <= 1) {
                status = 'bubble'; label = 'Protecting a narrow lead'; urgency = .35 + .5 * completed / regular;
                reason = `${margin} ${margin === 1 ? 'win' : 'wins'} ahead of the first team outside; ${remaining} regular-season weeks left.`;
            } else {
                status = 'contender'; label = 'Building a contender'; urgency = .3;
                reason = `${margin} wins ahead of the first team outside; ${remaining} regular-season weeks left. The place is not secured yet.`;
            }
        }
        const finalWeek = Math.max(0, ...(state.finalizedWeeks || []).map(row => row.week));
        if (state.phase === 'complete' && finalWeek > 0 && cutoff >= finalWeek) {
            status = state.championTeamId === id ? 'champion' : 'complete'; urgency = 0;
            label = status === 'champion' ? 'Season champion' : 'Season complete';
            reason = 'The final result is in. This season has no remaining games to buy an upgrade for.';
        }
        const tense = ['chasing', 'bubble', 'playoffs'].includes(status);
        return { status, label, reason, rank: own ? rank : null, completedWeeks: completed, remainingWeeks: remaining, cutoffMargin: margin,
            urgency, aggressionDelta: tense ? Math.round(urgency * 22) : status === 'secured' ? -8 : 0,
            patienceDelta: tense ? -Math.round(urgency * 24) : status === 'secured' ? 8 : 0,
            riskDelta: tense ? Math.round(urgency * 18) : status === 'secured' ? -12 : 0,
            spendMultiplier: tense ? 1 + urgency * .8 : status === 'secured' ? .75 : 1,
            depthWeight: ['secured', 'contender'].includes(status) ? .3 : tense ? .12 : .2,
            tradeThresholdDelta: tense ? -urgency * .04 : status === 'secured' ? .025 : 0 };
    }
    function memoryFor(state, teamId, otherId, throughWeek = Infinity) {
        const cutoff = Math.min(throughWeek, state.currentWeek || 1);
        const trades = (state.trades || []).filter(t => [t.fromTeamId, t.toTeamId].includes(teamId) && [t.fromTeamId, t.toTeamId].includes(otherId)
            && t.status !== 'pending' && (t.respondedWeek ?? t.week) <= cutoff);
        const trade = trades.slice().sort((a, b) => (b.respondedWeek ?? b.week) - (a.respondedWeek ?? a.week))[0];
        const matchup = (state.finalizedWeeks || []).filter(w => w.week < (state.currentWeek || 1) && w.week <= cutoff).slice().reverse()
            .flatMap(w => (w.matchups || []).filter(m => [m.home, m.away].includes(teamId) && [m.home, m.away].includes(otherId)).map(m => ({ ...m, week: w.week })))[0];
        if (trade && (!matchup || (trade.respondedWeek ?? trade.week) >= matchup.week)) return { kind: 'trade', week: trade.respondedWeek ?? trade.week,
            text: trade.status === 'accepted' ? `We completed a trade in Week ${trade.respondedWeek ?? trade.week}. I remember that we found terms.` : `Our Week ${trade.respondedWeek ?? trade.week} offer did not become a deal. We can discuss a different fit.` };
        if (matchup) return { kind: 'game', week: matchup.week, text: matchup.winner === teamId ? `I won our Week ${matchup.week} meeting. That is a result, not a promise about the next one.`
            : matchup.winner === otherId ? `You won our Week ${matchup.week} meeting. I remember the result.` : `Our Week ${matchup.week} meeting finished level.` };
        return null;
    }
    function stanceLine(state, team, throughWeek) {
        const profile = profileFor(team), strategy = forTeam(state, team, throughWeek);
        return ['champion', 'complete'].includes(strategy.status) ? profile.reflection : ['chasing', 'bubble', 'playoffs'].includes(strategy.status) ? profile.pressure
            : ['contender', 'secured'].includes(strategy.status) ? profile.secure
                : strategy.status === 'eliminated' ? 'The title route has closed. I still intend to field a competitive team.' : profile.principle;
    }
    const api = { PROFILES, profileFor, forTeam, memoryFor, stanceLine };
    App.TimeLeagueStrategy = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
