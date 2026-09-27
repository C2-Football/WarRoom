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
            add('cardiac-club', 'Cardiac Club', `${subject(cardiac.rid)} and the Cardiac Club`,
                `${nameFor(cardiac.rid)} have played ${cardiac.games.length} head-to-head games decided by five points or fewer through Week ${end}, going ${record(cardiac)} in those meetings. Comfortable margins appear to be an optional extra.\n\nThe latest installment: ${fmt(scores(latest.row))}–${fmt(scores(latest.opponent))} against ${nameFor(latest.opponent.roster_id)} in Week ${end}${latest.margin === 0 ? ', an exact tie' : `, a ${fmt(latest.margin)}-point margin`}.`,
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
            const consolation = Number(league.settings?.league_average_match) === 1 && scores(loser) > median ? ' The median game did supply a win; the head-to-head draw was the problem.' : '';
            add('wrong-opponent', 'Schedule therapy', `${subject(loser.roster_id)} vs. the schedule`,
                `Good news: the points showed up. Bad news: so did the wrong opponent. ${nameFor(loser.roster_id)} scored ${fmt(scores(loser))} in Week ${end}, better than ${beaten} of the other ${latest.rows.length - 1} teams, and still lost to ${nameFor(winner.roster_id)} (${fmt(scores(winner))}).\n\nA productive lineup met an even more productive one.${consolation}`,
                [loser.roster_id, winner.roster_id], source(league, `matchups/${end}`, `${season} Week ${end} results`),
                [{ label: 'The comparison', text: 'This compares actual scores within this completed week. It is not a simulated result, a forecast, or a claim that another lineup would have won.' }]);
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
                `In ${preceding.season}, ${entry.who.ownerName} ran ${quotedEnd(entry.before)} This season, the team is ${quotedEnd(entry.after)} The jersey has changed; the owner hasn’t.\n\n${standing ? `Through Week ${end}, the new name comes with a ${record(standing)} record${Number(league.settings?.league_average_match) === 1 ? ', including median games' : ''}. ` : ''}A rebrand gets a fresh introduction. The standings still remember every result.`,
                [entry.rid], [...source(preceding, 'users', `${preceding.season} team names`), ...source(preceding, 'rosters', `${preceding.season} owner accounts`), ...source(league, 'users', `${season} team names`), ...source(league, 'rosters', `${season} owner accounts`)],
                [{ label: 'Same owner, two seasons', text: `The name comparison uses the same verified owner account in ${preceding.season} and ${season}. It does not claim a first-ever rebrand or explain why the owner changed the name.` }]);
        }
        const named = (league.rosters || []).map(roster => ({ rid: roster.roster_id, name: explicitName(league, roster.roster_id) })).filter(entry => entry.name).sort((a, b) => str(a.rid).localeCompare(str(b.rid)));
        if (named.length >= 2) {
            const first = hash(key + ':names') % named.length, other = named.filter((entry, index) => index !== first && entry.name.toLocaleLowerCase() !== named[first].name.toLocaleLowerCase());
            if (other.length) {
                const pair = [named[first], other[hash(key + ':opponent') % other.length]];
                const describe = entry => person(entry.rid).ownerName ? `${person(entry.rid).ownerName}’s “${entry.name}”` : `“${entry.name}”`;
                add('name-game', 'Name Game', 'Name Game: who wore it better?',
                    `This week’s two names for the marquee: ${describe(pair[0])} and ${describe(pair[1])}. Neither earns a bonus point for the branding.\n\nWhich one gets your pick: the clever reference, the commitment to the bit, or just the one that makes you laugh? The group chat can take it from here.`,
                    pair.map(entry => entry.rid), source(league, 'users', `${season} team names`),
                    [{ label: 'A conversation starter', text: 'Two real team names selected on a weekly rotation. This feature makes no best-name ranking and does not report a vote or poll result.' }]);
            }
        }
        const ordered = features.slice().sort((a, b) => a.featureType.localeCompare(b.featureType));
        return { ...edition, features, weeklyFeature: ordered.length ? ordered[hash(key + ':feature') % ordered.length] : null };
    }
    root.WrWireFeatures = { enrich };
})(typeof window !== 'undefined' ? window : globalThis);
