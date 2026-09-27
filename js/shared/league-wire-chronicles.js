// Documentary history supplements scored coverage without changing its totals.
(function (root) {
    'use strict';
    const str = value => String(value);
    const score = value => Number(value).toFixed(2);
    function select(league) {
        const ids = [league?.league_id || league?.id, league?.previous_league_id].filter(Boolean).map(str);
        const matches = Object.values(root.WrWireChroniclesData || {}).filter(book => ids.some(id => book.leagueIds.includes(id)));
        return matches.length === 1 ? matches[0] : null;
    }
    const citation = source => source.workbook ? `${source.workbook} · ${source.sheet}!${source.range}` : source.label;
    function enrich(edition, { league, board = null, start = 1, end = 0, nameFor = rid => `Team ${rid}`, priorSeasons = [], currentForm = [], previousTable = [] }) {
        const book = select(league);
        if (!book) return edition;
        const year = Number(league.season);
        // End-of-season honors have no reliable week/date. Only later-season
        // retrospectives may use them, even when a past edition says "all".
        const eligible = book.facts.filter(f => f.classification !== 'unresolved' && Number(f.season) < year);
        const owners = new Map((league.rosters || []).filter(r => r.owner_id).map(r => [str(r.owner_id), r.roster_id]));
        const rosterIds = facts => [...new Set(facts.flatMap(f => f.owners || []).filter(Boolean).map(str).filter(id => owners.has(id)).map(id => owners.get(id)))];
        const finals = eligible.filter(f => f.type === 'final').sort((a, b) => b.season - a.season);
        const person = rid => {
            const known = root.WrWireIdentity?.resolve(league, rid, { priorSeasons, teamName: nameFor(rid) });
            const account = league.rosters?.find(r => str(r.roster_id) === str(rid))?.owner_id;
            const fact = finals.find(f => f.owners?.some(owner => owner && str(owner) === str(account)));
            const documented = fact && (str(fact.owners[0]) === str(account) ? fact.winner : fact.loser);
            return { ownerId: account || null, ownerName: known?.ownerName || documented || null, ownerKnown: !!(known?.ownerName || documented), teamName: nameFor(rid), rosterId: rid, season: str(league.season) };
        };
        const historicalPeople = (facts, eventSeason) => {
            const historical = priorSeasons.find(s => Number(s.league.season) === eventSeason && select(s.league) === book)?.league;
            return [...new Set(facts.flatMap(f => f.owners || []).filter(Boolean).map(str))].map(account => {
                const roster = historical?.rosters?.find(r => str(r.owner_id) === account);
                const known = roster ? root.WrWireIdentity?.resolve(historical, roster.roster_id, { priorSeasons: priorSeasons.filter(s => Number(s.league.season) < eventSeason) }) : root.WrWireIdentity?.forOwner(league, account, { priorSeasons });
                const fact = facts.find(f => f.type === 'final' && f.owners?.some(owner => owner && str(owner) === account));
                const documented = fact && (str(fact.owners[0]) === account ? fact.winner : fact.loser);
                const ownerName = known?.ownerName || documented || null;
                return { ownerId: account, ownerName, ownerKnown: !!ownerName, teamName: roster ? known?.teamName || root.WrWireStories?.oldName(historical, roster.roster_id) || null : null, rosterId: roster?.roster_id || null, season: str(eventSeason) };
            });
        };
        const stories = [];
        const story = (facts, category, text, body, weight = 45) => {
            const eventSeason = Math.max(...facts.map(f => f.season));
            const sources = [...new Map(facts.flatMap(f => f.sources).map(s => [JSON.stringify(s), s])).values()];
            const item = { id: 'chronicle:' + facts.map(f => f.id).join(':'), kind: 'story', category,
                text, body, season: str(league.season), eventSeason, week: end, documentary: true, classification: facts.length > 1 ? 'derived' : facts[0].classification,
                label: `${eventSeason} · ${category.toUpperCase()}`, rosterIds: rosterIds(facts), participants: historicalPeople(facts, eventSeason), weight, sources,
                related: facts.filter(f => f.reconciliation === 'score-correction').map(f => ({ label: `${f.season} source reconciliation`, text: `The workbook recorded ${f.original}. The score shown here uses Sleeper's checked title-game result. Original-era scoring; these playoff results are separate from regular-season records.` })) };
            facts.filter(f => f.reconciliation === 'award-snapshot-differs').forEach(f => item.related.push({ label: 'Scoring comparison', text: `The award entry is preserved as written. Sleeper's checked ${f.season} ${f.observed.week ? `Week ${f.observed.week} high` : `regular-season total through Week ${f.observed.throughWeek}`} is ${score(f.observed.value)} for ${f.observed.holder}. These are original-era points; the snapshot difference does not establish a new record.` }));
            stories.push(item);
            return item;
        };
        const withEvidence = (item, facts) => {
            item.sources = [...new Map([...item.sources, ...facts.flatMap(f => f.sources)].map(source => [JSON.stringify(source), source])).values()];
            if (facts.length) item.classification = 'derived';
            return item;
        };
        const hasScore = f => Array.isArray(f.scores) && f.scores.length === 2 && f.scores.every(value => typeof value === 'number' && Number.isFinite(value));
        finals.forEach(f => {
            const earlierTitles = finals.filter(p => p.season < f.season && f.owners[0] && p.owners[0] === f.owners[0]);
            const earlierFinal = finals.find(p => p.season === f.season - 1 && f.owners[0] && p.owners[1] === f.owners[0]);
            const result = f.loser ? `${f.winner} defeated ${f.loser}${hasScore(f) ? ` ${score(f.scores[0])}–${score(f.scores[1])}` : ''} in the ${f.season} championship.` : `The league history lists ${f.winner} as the ${f.season} champion.`;
            const detail = earlierFinal ? `A year earlier, ${f.winner} had lost the final to ${earlierFinal.winner}. This time, the title was theirs.`
                : earlierTitles.length ? `That brought ${f.winner} to ${earlierTitles.length + 1} titles in the documented archive through ${f.season}, after ${earlierTitles.map(p => p.season).sort().join(' and ')}.`
                : hasScore(f) && f.scores[0] > f.scores[1] ? `${score(f.scores[0] - f.scores[1])} points separated champion and runner-up.` : '';
            const item = withEvidence(story([f], 'Championship history', `Looking back: ${f.winner}’s ${f.season} title`, result + (detail ? `\n\n${detail}` : '')), earlierFinal ? [earlierFinal] : earlierTitles);
            item.lookbackEligible = !!detail;
            if (!f.loser) item.related.push({ label: 'Archive coverage', text: 'The opponent and final score were not recorded.' });
            if (f.reconciliation === 'sleeper-supplement') item.related.push({ label: 'Archive coverage', text: 'This final fills a gap in the supplied chronicles using Sleeper’s checked championship bracket.' });
            const earlier = finals.find(p => p.season === f.season - 1 && f.owners[0] && p.owners[0] === f.owners[0]);
            if (earlier) {
                const repeatOpponent = earlier.owners[1] && earlier.owners[1] === f.owners[1];
                const opening = repeatOpponent ? `${f.loser} reached the final in ${earlier.season} and again in ${f.season}. Both titles went to ${f.winner}.`
                    : earlier.loser && f.loser ? `${f.winner} beat ${earlier.loser} for the ${earlier.season} title, then ${f.loser} for the ${f.season} title.` : `${f.winner} won consecutive titles in ${earlier.season} and ${f.season}.`;
                const scores = [earlier, f].filter(hasScore).map(final => `${final.season}: ${score(final.scores[0])}–${score(final.scores[1])}${final.loser ? ` over ${final.loser}` : ''}`).join('; ');
                story([earlier, f], 'Dynasty watch', `Looking back: ${f.winner}’s ${earlier.season}–${f.season} back-to-back titles`, opening + (scores ? `\n\nThe winning scores: ${scores}.` : ''), 58);
            }
        });
        const players = new Map();
        eligible.filter(f => f.type === 'legacy').forEach(f => { if (!players.has(f.player)) players.set(f.player, []); players.get(f.player).push(f); });
        players.forEach((facts, player) => {
            const years = [...new Set(facts.map(f => Number(f.season)))].sort((a, b) => a - b);
            if (years.length < 2) return;
            const linkedTitles = finals.filter(final => facts.some(f => Number(f.season) === Number(final.season) && final.owners[0] && f.owners.includes(final.owners[0]))).sort((a, b) => a.season - b.season);
            const managers = new Set(linkedTitles.map(f => f.owners[0]));
            const context = managers.size >= 2 ? `That includes championship teams managed by ${linkedTitles.map(f => `${f.winner} in ${f.season}`).join(' and ')}.`
                : linkedTitles.length >= 2 ? `Those appearances include ${linkedTitles[0].winner}’s ${linkedTitles.map(f => f.season).join(' and ')} championship teams.` : '';
            const item = withEvidence(story(facts, 'Player legacy', `Looking back: ${player} on ${years.length} championship teams`,
                `${player} was part of the league’s championship teams in ${years.join(', ')}.` + (context ? `\n\n${context}` : ''), 42), linkedTitles);
            item.lookbackEligible = !!context;
            item.related.push({ label: 'About these appearances', text: 'The Hall of Fame documents championship-team appearances, not current roster membership, starting-lineup use or individual championship-game production.' });
        });
        eligible.filter(f => f.type === 'award').forEach(f => {
            const previous = eligible.find(p => p.type === 'award' && p.award === f.award && Number(p.season) === Number(f.season) - 1 && f.owners[0] && p.owners[0] === f.owners[0]);
            const repeat = previous ? `\n\nThe honor stayed with the same owner: ${previous.holder} also earned it in ${previous.season}.` : '';
            const item = withEvidence(story([f], 'League honors', `${f.season} ${f.award.toLowerCase()}: ${f.holder}`,
                `${f.holder} earned ${f.award.toLowerCase()} for ${f.season}${f.stat != null ? `: ${f.stat}` : ''}.${repeat}`, 38), previous ? [previous] : []);
            item.lookbackEligible = !!previous;
            item.related.push({ label: 'Original-era scoring', text: 'Award statistics retain that season’s scoring rules; they are not a comparison with today’s scoring.' });
        });
        // A title pedigree supplies context, not a standing invitation to publish.
        // Require a new completed-result development and choose one per edition.
        if (edition.completedThrough === end && edition.table.length && end >= start && currentForm.length) {
            const candidates = [];
            const record = team => `${team.wins}–${team.losses}${team.ties ? `–${team.ties}` : ''}`;
            owners.forEach((rid, account) => {
                const team = edition.table.find(t => str(t.rid) === str(rid));
                const form = currentForm.find(t => str(t.rid) === str(rid));
                const was = previousTable.find(t => str(t.rid) === str(rid));
                const titles = finals.filter(f => f.owners?.[0] && str(f.owners[0]) === account);
                if (!team || !form || !titles.length) return;
                const latest = titles[0], who = person(rid), name = who.ownerName || latest.winner, teamName = String(nameFor(rid)).trim();
                const years = [...new Set(titles.map(f => Number(f.season)))].sort((a, b) => b - a);
                let streak = 0;
                while (years.includes(year - 1 - streak)) streak++;
                let headline, development, detail, weight;
                if (end > start && team.rank === 1 && was?.rank > 1 && edition.table.filter(t => t.rank === 1).length === 1) {
                    headline = `${name} moves into first place`; development = 'new-leader'; weight = 76;
                    detail = `The team moves from No. ${was.rank} to No. 1 in The Wire’s standings.`;
                } else if (form.run === 1 && form.previousRun <= -3) {
                    headline = `${name} ends a ${Math.abs(form.previousRun)}-game slide`; development = 'skid-ended'; weight = 74;
                    detail = `That ends ${Math.abs(form.previousRun)} straight head-to-head losses.`;
                } else if (form.run === -1 && form.previousRun >= 3) {
                    headline = `${name}’s ${form.previousRun}-game winning run ends`; development = 'run-ended'; weight = 73;
                    detail = `The head-to-head winning streak ends at ${form.previousRun}.`;
                } else if (form.run === 3) {
                    headline = `Three straight wins for ${name}`; development = 'third-win'; weight = 72;
                    detail = 'That makes three straight head-to-head wins.';
                } else if (form.run === -3) {
                    headline = `${name} goes three games without a win`; development = 'third-loss'; weight = 70;
                    detail = 'That makes three straight head-to-head losses.';
                } else if (end === start && streak) {
                    const outcome = form.points > form.opponentPoints ? 'a win' : form.points < form.opponentPoints ? 'a loss' : 'a tie';
                    headline = `${name} opens the title defense with ${outcome}`; development = 'defense-opener'; weight = 64;
                    detail = streak > 1 ? `The pursuit of ${streak + 1} consecutive titles is underway.` : 'The back-to-back bid is underway.';
                } else return;
                const result = form.points > form.opponentPoints ? `beat ${nameFor(form.opponentId)}, ${score(form.points)}–${score(form.opponentPoints)}`
                    : form.points < form.opponentPoints ? `lost to ${nameFor(form.opponentId)}, ${score(form.points)}–${score(form.opponentPoints)}` : `tied ${nameFor(form.opponentId)} at ${score(form.points)}`;
                const now = `${teamName} ${result}. ${detail} Through Week ${end}, ${name} is ${record(team)}${Number(league.settings?.league_average_match) === 1 ? ', including median results' : ''}.`;
                const history = streak ? `${name} won the ${latest.season} title${streak > 1 ? ` after winning ${years.slice(1, streak).join(' and ')}` : ''}.`
                    : `${name}’s last documented title came in ${latest.season}${years.length > 1 ? `, after titles in ${years.slice(1).join(' and ')}` : ''}.`;
                candidates.push({ rid, titles, headline, body: `${now}\n\n${history}`, weight, development });
            });
            const lead = candidates.sort((a, b) => b.weight - a.weight || str(a.rid).localeCompare(str(b.rid)))[0];
            if (lead) {
                const item = story(lead.titles, 'Title watch', lead.headline, lead.body, lead.weight);
                item.id = `title-watch:${year}:${end}:${lead.rid}`;
                item.documentary = false; item.contextual = true; item.development = lead.development;
                item.label = `WK ${end} · TITLE WATCH`; item.rosterIds = [lead.rid]; item.participants = [person(lead.rid)];
                item.related.push({ label: 'History & current form', text: `Historical titles are documented results from the listed seasons. The ${year} record is through Week ${end}${Number(league.settings?.league_average_match) === 1 ? ', including median games' : ''}. Streaks count head-to-head games only. The Wire’s standings use record, then points scored; they are not official playoff seeds or a championship forecast.` });
            }
        }
        const rematchFacts = ids => {
            if (ids.length !== 2) return [];
            const a = league.rosters?.find(r => str(r.roster_id) === str(ids[0]))?.owner_id;
            const b = league.rosters?.find(r => str(r.roster_id) === str(ids[1]))?.owner_id;
            if (!a || !b || a === b) return [];
            return finals.filter(f => f.owners.length === 2 && f.owners.includes(a) && f.owners.includes(b));
        };
        const context = facts => facts.map(f => `${f.winner} beat ${f.loser}${f.scores ? `, ${score(f.scores[0])}–${score(f.scores[1])},` : ''} in the ${f.season} final.`).join('\n\n');
        const titleScope = { label: 'About this history', text: 'These championship results are separate from the regular-season series. Names and scores reflect the season in which each final was played.' };
        const decorate = item => {
            if (item.kind !== 'recap' && !item.preview) return item;
            const facts = rematchFacts(item.rosterIds || []);
            return !facts.length ? item : { ...item, related: [...(item.related || []), { label: 'Championship history', text: context(facts) }, titleScope], sources: [...(item.sources || []), ...facts.flatMap(f => f.sources)] };
        };
        const previews = edition.previews.map(decorate);
        const groups = new Map();
        (board?.rows || []).forEach(r => { if (r.matchup_id == null) return; const key = str(r.matchup_id); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); });
        if (root.WrWireStories && Number(board?.week) > edition.completedThrough && Number(board?.week) <= root.WrWireStories.bounds(league).end) groups.forEach(pair => {
            if (pair.length !== 2) return;
            const ids = pair.map(r => r.roster_id), facts = rematchFacts(ids);
            if (!facts.length) return;
            // One matchup gets one story. Add championship context to an
            // existing current-form or followed-rivalry preview instead of
            // publishing the same pair a second time under an archive hook.
            const existing = previews.find(item => item.rosterIds?.length === 2 && ids.every(id => item.rosterIds.some(rid => str(rid) === str(id))));
            if (existing) {
                existing.category = 'Rivalry watch'; existing.label = `WK ${Number(board.week)} · CHAMPIONSHIP REMATCH`;
                existing.weight = Math.max(existing.weight || 0, 79);
                if (existing.formThrough == null && !existing.followedRivalry) {
                    existing.text = `${person(ids[0]).ownerName || nameFor(ids[0])} vs. ${person(ids[1]).ownerName || nameFor(ids[1])}: a title-game rematch`;
                    existing.body += `\n\n${context(facts.slice(0, 1))}`;
                }
                return;
            }
            // A title rematch is meaningful even before regular-season history
            // has loaded; it never increments the existing rivalry win count.
            previews.push({ id: `title-rematch:${league.league_id}:${board.week}:${ids.join(':')}`, kind: 'story', category: 'Rivalry watch', label: 'CHAMPIONSHIP REMATCH',
                text: `${person(ids[0]).ownerName || nameFor(ids[0])} vs. ${person(ids[1]).ownerName || nameFor(ids[1])}: a title-game rematch`,
                body: `The matchup returns in Week ${Number(board.week)}.\n\n${context(facts.slice(0, 1))}`,
                related: [...(facts.length > 1 ? [{ label: 'Earlier title meetings', text: context(facts.slice(1)) }] : []), titleScope],
                season: str(year), week: Number(board.week), rosterIds: ids, preview: true, weight: 79, sources: facts.flatMap(f => f.sources) });
        });
        const records = eligible.filter(f => f.type === 'award' && ['WEEKLY HIGH SCORE', 'SEASON POINTS LEADER'].includes(f.award));
        return { ...edition, stories: edition.stories.map(decorate).concat(stories), previews,
            chronicle: { name: book.name, coverage: book.coverage, finals, records, sources: [...new Set(eligible.flatMap(f => f.sources).map(citation))], excluded: book.excluded } };
    }
    root.WrWireChronicles = { select, enrich };
})(typeof window !== 'undefined' ? window : globalThis);
