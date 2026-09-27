// A small lighter-side desk, with every punchline attached to real league facts.
(function (root) {
    'use strict';
    const str = value => String(value);
    const fmt = value => Number(value).toFixed(2);
    const quotedEnd = value => `“${value}”${/[.!?]$/.test(value) ? '' : '.'}`;
    const hash = value => { let result = 0; for (const char of str(value)) result = (result * 31 + char.charCodeAt(0)) >>> 0; return result; };
    const unique = values => [...new Map(values.map(value => [JSON.stringify(value), value])).values()];
    const record = team => `${team.wins}–${team.losses}${team.ties ? `–${team.ties}` : ''}`;
    const source = (league, suffix, label) => league.league_id || league.id ? [{ label, url: `https://api.sleeper.app/v1/league/${encodeURIComponent(league.league_id || league.id)}/${suffix}` }] : [];
    // Opinions describe visible wording, never the owner's motives or a vote.
    function reviewName(name) {
        const words = name.match(/[\p{L}\p{N}’']+/gu) || [], letters = name.replace(/[^a-z]/gi, '');
        const content = words.filter(word => !/^(the|a|an|of|and|for|to|in)$/i.test(word));
        const opening = content.find((word, index) => content.slice(index + 1).some(other => word[0].toLowerCase() === other[0].toLowerCase()));
        if (/maxxing$/i.test(name) && name.length > 9) return { rank: 6, award: 'Best commitment to a suffix', line: `“${name}” suggests that merely being “${name.slice(0, -7)}” was not ambitious enough. The excess is the joke, and it works.` };
        if (/sundae/i.test(name) && /pop[- ]?tart/i.test(name)) return { rank: 6, award: 'Best breakfast-dessert crossover', line: `“${name}” sounds like a breakfast decision that got out of hand. The specificity is what makes it funny.` };
        if (letters.length >= 8 && letters === letters.toUpperCase()) return { rank: 6, award: 'Best entrance', line: `“${name}” has the capitals of a stadium announcement. It is hard to read quietly, which is most of the appeal.` };
        if (/\?$/.test(name)) return { rank: 5, award: 'Best cliffhanger', line: `The question mark does a lot of work in “${name}” It sounds like something the league could spend a season answering.` };
        if (opening && content.length >= 2) {
            const echoes = content.filter(word => word[0].toLowerCase() === opening[0].toLowerCase()).slice(0, 3);
            return { rank: 5, award: 'Best ring to it', line: `“${name}” benefits from the repeated ${opening[0].toUpperCase()} sound in “${echoes.join(' ')}”. It sticks without needing an explanation.` };
        }
        const office = words.find(word => /^(department|bureau|committee|inc|llc|corporation)$/i.test(word));
        if (office) return { rank: 5, award: 'Best front office', line: `“${name}” makes fantasy football sound as though it requires official paperwork. “${office}” is amusingly serious for an operation that cannot control what happens on Sunday.` };
        if (words.length >= 7) return { rank: 2, award: 'Most commitment to the bit', roast: true, line: `“${name}” takes ${words.length} words to get there. There is a team name in here, but a shorter version would land faster.` };
        if (/^(my\s+)?(fantasy\s+)?(football\s+)?team(?:\s+\d+)?$/i.test(name)) return { rank: 1, award: 'Still in preseason', roast: true, line: `“${name}” is accurate. The same could be said of a folder label. A little more personality would help.` };
        if (/^[a-z]+\d{3,}$/i.test(name)) return { rank: 1, award: 'A name awaiting its jersey', roast: true, line: `The digits in “${name}” make it read like an account handle. It identifies a team without saying much about it.` };
        if (words.length <= 3 && words.length > 0) return { rank: 3, award: 'Best economy of words', line: `“${name}” is clean and brief: ${words.length === 1 ? 'one word' : `${words.length} words`}, no extra explanation. That restraint works in its favor.` };
        return { rank: 2, award: 'A name with room to talk', line: `“${name}” has ${words.length} words competing for attention. Its strongest phrase would have more room to stand out in a shorter name.` };
    }
    function linkedHistory(league, priorSeasons) {
        const linked = [], seen = new Set([str(league.league_id || league.id)]);
        let cursor = league;
        while (cursor?.previous_league_id && linked.length < 25) {
            const matches = priorSeasons.filter(entry => str(entry.league?.league_id || entry.league?.id) === str(cursor.previous_league_id) && Number(entry.league.season) < Number(cursor.season));
            if (matches.length !== 1 || seen.has(str(cursor.previous_league_id))) break;
            cursor = matches[0].league; seen.add(str(cursor.league_id || cursor.id)); linked.push(cursor);
        }
        return linked;
    }
    function enrich(edition, { league, weeks = [], start = 1, end = 0, priorSeasons = [], nameFor = rid => `Team ${rid}`, headToHead = true }) {
        const journal = root.WrWireStories, scorer = root.App?.LeagueLiveScores;
        const empty = { ...edition, features: [], weeklyFeature: null };
        if (!journal || !scorer || !headToHead || root.App?.Chopped?.isChopped?.(league) || league.type === 'chopped' || league.leagueSkin?.type === 'chopped' || end < start || end > journal.bounds(league).end || edition.completedThrough !== end) return empty;
        const byWeek = new Map(weeks.map(w => [Number(w.week), w.rows])), verified = [];
        for (let week = start; week <= end; week++) {
            const rows = byWeek.get(week), pairs = journal.inspect(rows, league);
            if (!pairs) return empty;
            verified.push({ week, rows, pairs });
        }
        const features = [], season = str(league.season), key = `${league.league_id || league.id}:${season}:${end}`;
        const people = new Map();
        const person = rid => {
            if (!people.has(str(rid))) people.set(str(rid), { ...(root.WrWireIdentity?.resolve(league, rid, { priorSeasons, teamName: nameFor(rid) }) || { ownerId: league.rosters?.find(r => str(r.roster_id) === str(rid))?.owner_id || null, ownerName: null, ownerKnown: false, teamName: nameFor(rid) }), rosterId: rid, season });
            return people.get(str(rid));
        };
        const subject = rid => person(rid).ownerName || nameFor(rid);
        const add = (type, category, text, body, ids, sources, related = []) => {
            features.push({ id: `feature:${season}:${end}:${type}:${ids.join(':')}`, kind: 'story', category, feature: true, featureType: type,
                week: end, season, label: `WK ${end} · ${category.toUpperCase()}`, text, body, rosterIds: ids, participants: ids.map(person), weight: 30, sources: unique(sources), related });
        };
        const scores = row => scorer.rosterPoints(row);
        const close = new Map();
        for (const entry of verified) entry.pairs.forEach(pair => {
            const margin = Math.round(Math.abs(scores(pair[0]) - scores(pair[1])) * 100) / 100;
            if (margin > 5) return;
            pair.forEach((row, index) => {
                const id = str(row.roster_id);
                if (!close.has(id)) close.set(id, { rid: row.roster_id, games: [], wins: 0, losses: 0, ties: 0 });
                const candidate = close.get(id), opponent = pair[1 - index], difference = scores(row) - scores(opponent);
                candidate[difference > 0 ? 'wins' : difference < 0 ? 'losses' : 'ties']++;
                candidate.games.push({ week: entry.week, row, opponent, margin });
            });
        });
        const cardiac = [...close.values()].filter(t => t.games.length >= 2 && t.games[t.games.length - 1].week === end)
            .sort((a, b) => b.games.length - a.games.length || str(a.rid).localeCompare(str(b.rid)))[0];
        if (cardiac) {
            const latest = cardiac.games[cardiac.games.length - 1];
            add('cardiac-club', 'Cardiac Club', `Another close finish for ${subject(cardiac.rid)}`,
                `${nameFor(cardiac.rid)} and ${nameFor(latest.opponent.roster_id)} finished ${fmt(scores(latest.row))}–${fmt(scores(latest.opponent))} in Week ${end}${latest.margin === 0 ? ', an exact tie' : `, a ${fmt(latest.margin)}-point margin`}.\n\nThat makes ${cardiac.games.length} head-to-head games decided by five points or fewer through Week ${end}, with a ${record(cardiac)} record for ${nameFor(cardiac.rid)} in those meetings. There has not been much room to relax.`,
                [cardiac.rid, latest.opponent.roster_id], cardiac.games.flatMap(game => source(league, `matchups/${game.week}`, `${season} Week ${game.week} results`)),
                [{ label: 'The membership rule', text: 'At least two completed head-to-head games with a margin of five points or fewer, including the edition’s latest week. Median results are separate.' }]);
        }
        const latest = verified[verified.length - 1];
        const toughDraws = latest.pairs.flatMap(pair => {
            if (scores(pair[0]) === scores(pair[1])) return [];
            const loser = scores(pair[0]) < scores(pair[1]) ? pair[0] : pair[1], winner = loser === pair[0] ? pair[1] : pair[0];
            const beaten = latest.rows.filter(row => row.roster_id !== loser.roster_id && scores(row) < scores(loser)).length;
            return beaten >= Math.ceil((latest.rows.length - 1) / 2) ? [{ loser, winner, beaten }] : [];
        }).sort((a, b) => scores(b.loser) - scores(a.loser) || str(a.loser.roster_id).localeCompare(str(b.loser.roster_id)));
        if (toughDraws.length) {
            const { loser, winner, beaten } = toughDraws[0], totals = latest.rows.map(scores).sort((a, b) => a - b), mid = Math.floor(totals.length / 2);
            const median = totals.length % 2 ? totals[mid] : (totals[mid - 1] + totals[mid]) / 2;
            const consolation = Number(league.settings?.league_average_match) === 1 && scores(loser) > median ? ' There was some consolation: a win in the separate median game.' : '';
            add('wrong-opponent', 'Schedule therapy', `${subject(loser.roster_id)} had the points, but the wrong opponent`,
                `${nameFor(loser.roster_id)} scored ${fmt(scores(loser))} in Week ${end}, better than ${beaten} of the other ${latest.rows.length - 1} teams. It still ended in a loss to ${nameFor(winner.roster_id)}, who put up ${fmt(scores(winner))}.\n\nThe matchup left little reward for a strong scoring week.${consolation}`,
                [loser.roster_id, winner.roster_id], source(league, `matchups/${end}`, `${season} Week ${end} results`),
                [{ label: 'The comparison', text: 'This compares actual scores within this completed week. It is not a simulated result, a forecast, or a claim that another lineup would have won.' }]);
        }
        if (verified.length >= 2) {
            const previous = verified[verified.length - 2];
            const rebounds = latest.pairs.flatMap(pair => {
                const winner = scores(pair[0]) > scores(pair[1]) ? pair[0] : scores(pair[1]) > scores(pair[0]) ? pair[1] : null;
                if (!winner) return [];
                const old = previous.pairs.find(game => game.some(row => str(row.roster_id) === str(winner.roster_id)));
                const own = old?.find(row => str(row.roster_id) === str(winner.roster_id)), rival = old?.find(row => str(row.roster_id) !== str(winner.roster_id));
                if (!own || scores(own) >= scores(rival) || scores(winner) - scores(own) < 25) return [];
                return [{ winner, own, gain: scores(winner) - scores(own) }];
            }).sort((a, b) => b.gain - a.gain || str(a.winner.roster_id).localeCompare(str(b.winner.roster_id)));
            if (rebounds.length) {
                const entry = rebounds[0];
                add('bounce-back', 'The bounce-back', `${subject(entry.winner.roster_id)} answers a loss with ${fmt(scores(entry.winner))} points`,
                    `${nameFor(entry.winner.roster_id)} followed last week’s ${fmt(scores(entry.own))} points and a loss with ${fmt(scores(entry.winner))} and a head-to-head win in Week ${end}.\n\nAn extra ${fmt(entry.gain)} points is a fairly convincing way to change the subject.`,
                    [entry.winner.roster_id], [previous, latest].flatMap(entry => source(league, `matchups/${entry.week}`, `${season} Week ${entry.week} results`)));
            }
        }
        const explicitName = (sourceLeague, rid) => {
            const roster = sourceLeague.rosters?.find(r => str(r.roster_id) === str(rid));
            const user = sourceLeague.users?.find(u => str(u.user_id) === str(roster?.owner_id));
            return typeof user?.metadata?.team_name === 'string' ? user.metadata.team_name.trim() : '';
        };
        const book = root.WrWireChronicles?.select(league);
        const precedingCandidates = priorSeasons.filter(s => Number(s.league?.season) === Number(season) - 1 &&
            (str(s.league.league_id || s.league.id) === str(league.previous_league_id) || book && root.WrWireChronicles?.select(s.league) === book));
        const preceding = precedingCandidates.length === 1 ? precedingCandidates[0].league : null;
        const makeovers = preceding ? (league.rosters || []).flatMap(roster => {
            const who = person(roster.roster_id), matching = (preceding.rosters || []).filter(r => r.owner_id && str(r.owner_id) === str(who.ownerId));
            if (!who.ownerId || !who.ownerKnown || matching.length !== 1 || (league.rosters || []).filter(r => str(r.owner_id) === str(who.ownerId)).length !== 1) return [];
            const before = explicitName(preceding, matching[0].roster_id), after = explicitName(league, roster.roster_id);
            return before && after && before.toLocaleLowerCase() !== after.toLocaleLowerCase() ? [{ rid: roster.roster_id, who, before, after }] : [];
        }).sort((a, b) => str(a.who.ownerId).localeCompare(str(b.who.ownerId))) : [];
        if (makeovers.length) {
            const entry = makeovers[hash(key + ':makeover') % makeovers.length], standing = edition.table?.find(t => str(t.rid) === str(entry.rid));
            add('new-threads', 'New threads', `${entry.who.ownerName}: new name, same owner`,
                `In ${preceding.season}, ${entry.who.ownerName} ran ${quotedEnd(entry.before)} This season, the team is ${quotedEnd(entry.after)}\n\n${standing ? `Through Week ${end}, the record under the new name is ${record(standing)}${Number(league.settings?.league_average_match) === 1 ? ', including median games' : ''}.` : 'The two names belong to the same owner in consecutive seasons.'}`,
                [entry.rid], [...source(preceding, 'users', `${preceding.season} team names`), ...source(preceding, 'rosters', `${preceding.season} owner accounts`), ...source(league, 'users', `${season} team names`), ...source(league, 'rosters', `${season} owner accounts`)],
                [{ label: 'Same owner, two seasons', text: `The name comparison uses the same verified owner account in ${preceding.season} and ${season}. It does not claim a first-ever rebrand or explain why the owner changed the name.` }]);
        }
        const named = (league.rosters || []).map(roster => ({ rid: roster.roster_id, name: explicitName(league, roster.roster_id) })).filter(entry => entry.name).sort((a, b) => str(a.rid).localeCompare(str(b.rid)));
        const reviewed = named.map(entry => ({ ...entry, review: reviewName(entry.name) })).sort((a, b) => b.review.rank - a.review.rank || a.name.localeCompare(b.name));
        if (new Set(named.map(entry => entry.name.toLocaleLowerCase())).size >= 2) {
            const contenders = reviewed.filter(entry => entry.review.rank >= reviewed[0].review.rank - 1 && !entry.review.roast);
            const pick = contenders.length ? contenders[(end - start) % contenders.length] : reviewed[0];
            const roast = reviewed.filter(entry => entry.review.roast && entry.name !== pick.name)[0];
            const runner = roast || reviewed.find(entry => entry.name.toLocaleLowerCase() !== pick.name.toLocaleLowerCase());
            add('name-game', 'Name desk · opinion', `${pick.review.award}: “${pick.name}”`,
                `${person(pick.rid).ownerName ? `${person(pick.rid).ownerName} gets our pick this week. ` : 'Our pick this week: '}${pick.review.line}\n\n${roast ? 'One that could use an edit' : 'Also worth a mention'}: ${runner.review.line}`,
                [pick.rid, runner.rid], source(league, 'users', `${season} team names`),
                [{ label: 'An editorial opinion', text: 'The Wire is reviewing the wording of real team names. These are playful opinions, not an official award, a league vote, or a judgment of the owners.' }]);
        }
        const nameHistories = (league.rosters || []).flatMap(roster => {
            const who = person(roster.roster_id);
            if (!who.ownerId || !who.ownerKnown) return [];
            const names = [league, ...linkedHistory(league, priorSeasons)].flatMap(prior => {
                const matches = (prior.rosters || []).filter(row => str(row.owner_id) === str(who.ownerId));
                const name = matches.length === 1 ? explicitName(prior, matches[0].roster_id) : '';
                return name ? [{ name, season: str(prior.season), league: prior, review: reviewName(name) }] : [];
            });
            const distinct = [...new Map(names.slice().reverse().map(entry => [entry.name.toLocaleLowerCase(), entry])).values()].sort((a, b) => Number(a.season) - Number(b.season));
            return distinct.length >= 3 ? [{ rid: roster.roster_id, who, names: distinct }] : [];
        }).sort((a, b) => str(a.who.ownerId).localeCompare(str(b.who.ownerId)));
        if (nameHistories.length) {
            const entry = nameHistories[(end - start) % nameHistories.length], names = entry.names.slice(-4);
            const favorite = names.slice().sort((a, b) => b.review.rank - a.review.rank || Number(b.season) - Number(a.season))[0];
            add('name-archive', 'Name archive · opinion', `${names.length} names from ${entry.who.ownerName}’s past`,
                `${entry.who.ownerName} has gone from ${names.map(item => `“${item.name}” (${item.season})`).join(' to ')}.\n\nOur favorite of these names: ${favorite.review.line}`,
                [entry.rid], names.flatMap(item => [...source(item.league, 'users', `${item.season} team names`), ...source(item.league, 'rosters', `${item.season} owner accounts`)]),
                [{ label: 'The name archive', text: 'Names come from loaded linked seasons for the same owner account. The favorite is The Wire’s editorial opinion, not a vote or an all-time name ranking. Each year labels a recorded name, not the exact date it changed.' }]);
        }
        const ordered = features.slice().sort((a, b) => a.featureType.localeCompare(b.featureType));
        return { ...edition, features, weeklyFeature: ordered.length ? ordered[hash(key + ':feature') % ordered.length] : null };
    }
    root.WrWireFeatures = { enrich };
})(typeof window !== 'undefined' ? window : globalThis);
