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
    function enrich(edition, { league, board = null, end = 0, nameFor = rid => `Team ${rid}` }) {
        const book = select(league);
        if (!book) return edition;
        const year = Number(league.season);
        // End-of-season honors have no reliable week/date. Only later-season
        // retrospectives may use them, even when a past edition says "all".
        const eligible = book.facts.filter(f => f.classification !== 'unresolved' && Number(f.season) < year);
        const owners = new Map((league.rosters || []).filter(r => r.owner_id).map(r => [str(r.owner_id), r.roster_id]));
        const rosterIds = facts => [...new Set(facts.flatMap(f => f.owners || []).filter(Boolean).map(str).filter(id => owners.has(id)).map(id => owners.get(id)))];
        const finals = eligible.filter(f => f.type === 'final').sort((a, b) => b.season - a.season);
        const stories = [];
        const story = (facts, category, text, body, weight = 45) => {
            const eventSeason = Math.max(...facts.map(f => f.season));
            const sources = [...new Map(facts.flatMap(f => f.sources).map(s => [JSON.stringify(s), s])).values()];
            const item = { id: 'chronicle:' + facts.map(f => f.id).join(':'), kind: 'story', category,
                text, body, season: str(league.season), eventSeason, week: end, documentary: true, classification: facts.length > 1 ? 'derived' : facts[0].classification,
                label: `${eventSeason} · ${category.toUpperCase()}`, rosterIds: rosterIds(facts), weight, sources,
                related: facts.filter(f => f.reconciliation === 'score-correction').map(f => ({ label: `${f.season} source reconciliation`, text: `The workbook recorded ${f.original}. The score shown here uses Sleeper's checked title-game result. Original-era scoring; these playoff results are separate from regular-season records.` })) };
            facts.filter(f => f.reconciliation === 'award-snapshot-differs').forEach(f => item.related.push({ label: 'Scoring comparison', text: `The award entry is preserved as written. Sleeper's checked ${f.season} ${f.observed.week ? `Week ${f.observed.week} high` : `regular-season total through Week ${f.observed.throughWeek}`} is ${score(f.observed.value)} for ${f.observed.holder}. These are original-era points; the snapshot difference does not establish a new record.` }));
            stories.push(item);
            return item;
        };
        finals.forEach(f => {
            story([f], 'Championship history', `${f.season}: ${f.winner} wins the title`,
                f.loser ? `${f.winner} defeated ${f.loser}${f.scores ? ` ${score(f.scores[0])}–${score(f.scores[1])}` : ''} in the ${f.season} championship. ${f.reconciliation === 'sleeper-supplement' ? 'This title game fills a gap in the supplied chronicles using Sleeper’s championship bracket.' : 'A chapter from the league’s championship archive.'}` : `The league history lists ${f.winner} as the ${f.season} champion. The opponent and final score were not recorded.`);
            const earlier = finals.find(p => p.season === f.season - 1 && p.owners[0] && p.owners[0] === f.owners[0]);
            if (earlier) story([earlier, f], 'Dynasty watch', `${f.winner}’s back-to-back titles`,
                `${earlier.season} and ${f.season}: two consecutive titles, ${earlier.loser === f.loser ? `both against ${f.loser}` : `beating ${earlier.loser} and ${f.loser}`}.` + (earlier.owners[1] && earlier.owners[1] === f.owners[1] ? ' The same opponent reached both finals: a championship rematch in consecutive seasons.' : ''), 58);
        });
        const players = new Map();
        eligible.filter(f => f.type === 'legacy').forEach(f => { if (!players.has(f.player)) players.set(f.player, []); players.get(f.player).push(f); });
        players.forEach((facts, player) => {
            if (facts.length < 2) return;
            story(facts, 'Player legacy', `${player}: a familiar name on championship teams`,
                `The Hall of Fame lists ${player} on title-winning teams in ${facts.map(f => f.season).sort().join(', ')}. These are championship-team appearances, not a claim about a current roster or starting position.`, 42);
        });
        eligible.filter(f => f.type === 'award').forEach(f => story([f], 'League honors', `${f.season} ${f.award.toLowerCase()}: ${f.holder}`,
            `The chronicles awarded ${f.holder} ${f.award.toLowerCase()} for ${f.season}${f.stat != null ? `: ${f.stat}` : ''}. Statistics retain that season’s scoring rules.`, 38));
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
            // A title rematch is meaningful even before regular-season history
            // has loaded; it never increments the existing rivalry win count.
            previews.push({ id: `title-rematch:${league.league_id}:${board.week}:${ids.join(':')}`, kind: 'story', category: 'Rivalry watch', label: 'CHAMPIONSHIP REMATCH',
                text: `${nameFor(ids[0])} vs. ${nameFor(ids[1])}: a title-game rematch`,
                body: `${context(facts.slice(0, 1))} The matchup returns in Week ${Number(board.week)}.`,
                related: [...(facts.length > 1 ? [{ label: 'Earlier title meetings', text: context(facts.slice(1)) }] : []), titleScope],
                season: str(year), week: Number(board.week), rosterIds: ids, preview: true, weight: 79, sources: facts.flatMap(f => f.sources) });
        });
        const records = eligible.filter(f => f.type === 'award' && ['WEEKLY HIGH SCORE', 'SEASON POINTS LEADER'].includes(f.award));
        return { ...edition, stories: edition.stories.map(decorate).concat(stories), previews,
            chronicle: { name: book.name, coverage: book.coverage, finals, records, sources: [...new Set(eligible.flatMap(f => f.sources).map(citation))], excluded: book.excluded } };
    }
    root.WrWireChronicles = { select, enrich };
})(typeof window !== 'undefined' ? window : globalThis);
