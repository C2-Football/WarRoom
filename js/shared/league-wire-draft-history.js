// Optional draft retrospectives use already-loaded lineup evidence. Never fetch
// more matchup weeks, invent bench production, or infer a drafter from a slot.
(function (root) {
    'use strict';
    const base = 'https://api.sleeper.app/v1/';
    const cache = new Map();
    const string = value => value == null ? '' : String(value);
    const id = value => /^(?:[1-9]\d*)$/.test(string(value)) ? string(value) : null;
    const positive = value => id(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
    const finite = value => typeof value === 'number' && Number.isFinite(value);
    const copy = value => JSON.parse(JSON.stringify(value));
    const aborted = signal => { if (signal?.aborted) { const error = Error('Draft loading was interrupted.'); error.name = 'AbortError'; throw error; } };
    const leagueId = league => id(league?.league_id || league?.id);
    const fmt = value => value.toFixed(2);
    const uniqueSources = sources => [...new Map(sources.map(source => [source.url, source])).values()];
    function seasonsFor(league, weeks, priorSeasons) {
        const chosen = [{ league, weeks }], seen = new Set([leagueId(league)]);
        let cursor = league;
        while (chosen.length < 3) {
            const previous = id(cursor?.previous_league_id);
            const matches = priorSeasons.filter(entry => leagueId(entry?.league) === previous && Number(entry.league.season) < Number(cursor.season));
            if (!previous || seen.has(previous) || matches.length !== 1) break;
            chosen.push(matches[0]); seen.add(previous); cursor = matches[0].league;
        }
        return chosen;
    }
    function observed(entry, throughWeek, historical) {
        const { league, weeks } = entry;
        const start = positive(league.settings?.start_week) || 1;
        const playoff = positive(league.settings?.playoff_week_start);
        const end = playoff ? Math.min(18, playoff - 1) : 18;
        const complete = league.status === 'complete';
        const cutoff = historical ? end : Math.min(end, positive(throughWeek) || 0);
        const no = message => ({ message });
        if (historical && !complete) return no('The archived season is not marked complete.');
        if (cutoff - start + 1 < 4) return no('At least four completed regular-season weeks are needed before comparing draft contributions.');
        if (!Array.isArray(league.rosters) || league.rosters.length < 2) return no('Season-specific roster ownership is not available.');
        const rosterIds = league.rosters.map(roster => id(roster.roster_id));
        if (rosterIds.some(rid => !rid) || new Set(rosterIds).size !== rosterIds.length) return no('The season’s roster assignments are ambiguous.');
        const players = new Map(), missing = new Set();
        for (let week = start; week <= cutoff; week++) {
            const matches = (Array.isArray(weeks) ? weeks : []).filter(entry => Number(entry?.week) === week);
            if (matches.length !== 1 || !Array.isArray(matches[0].rows)) return no(`The loaded regular-season results are incomplete at Week ${week}.`);
            const rows = matches[0].rows, seenRosters = new Set(), seenPlayers = new Set();
            if (rows.length !== rosterIds.length) return no(`Week ${week} does not contain every roster.`);
            for (const row of rows) {
                const rid = id(row?.roster_id), total = row?.custom_points == null ? row?.points : row.custom_points;
                if (!rosterIds.includes(rid) || seenRosters.has(rid) || !finite(total) || !Array.isArray(row.starters)) return no(`Week ${week} does not have verified lineup results for every roster.`);
                seenRosters.add(rid);
                for (const raw of row.starters) {
                    const pid = string(raw);
                    if (!pid || pid === '0') continue;
                    // A player appearing twice or with a missing point value is
                    // unavailable for this comparison, never a zero-point bust.
                    if (seenPlayers.has(pid) || !finite(row.players_points?.[pid])) { missing.add(pid); continue; }
                    seenPlayers.add(pid);
                    const saved = players.get(pid) || { points: 0, starts: 0 };
                    saved.points += row.players_points[pid]; saved.starts++;
                    players.set(pid, saved);
                }
            }
        }
        missing.forEach(pid => players.delete(pid));
        return { players, start, cutoff, complete, weekCount: cutoff - start + 1 };
    }
    function person(league, pick) {
        const rid = id(pick.roster_id), rosters = league.rosters.filter(roster => id(roster.roster_id) === rid);
        if (rosters.length !== 1) return null;
        const roster = rosters[0], ownerId = string(roster.owner_id) || null;
        // A changed owner or delegated pick cannot be silently credited to the
        // current holder of that roster. Draft-slot ownership is never consulted.
        if (pick.picked_by && string(pick.picked_by) !== ownerId) return null;
        const user = (league.users || []).find(user => string(user.user_id) === ownerId);
        const identity = root.WrWireIdentity?.resolve(league, rid) || {
            ownerId, ownerName: user?.display_name || user?.username || null,
            teamName: user?.metadata?.team_name || user?.display_name || user?.username || `Team ${rid}`,
            ownerKnown: !!(user?.display_name || user?.username),
        };
        // Without a selecting account, the receiving roster is documented but
        // its draft-day owner is not. Keep the roster; withhold personal credit.
        return { ...identity, ...(!pick.picked_by ? { ownerId: null, ownerName: null, ownerKnown: false } : {}), rosterId: rid, teamSeason: string(league.season) };
    }
    function compare(league, draft, picks, evidence) {
        if (!Array.isArray(picks) || !picks.length) return null;
        const seenPlayers = new Set(), seenPicks = new Set(), valid = [];
        const teams = positive(draft.settings?.teams) || league.rosters.length;
        for (const pick of picks) {
            const pid = string(pick?.player_id), pickNo = positive(pick?.pick_no), round = positive(pick?.round);
            if (!pid || !pickNo || !round || string(pick.draft_id) !== string(draft.draft_id) || seenPlayers.has(pid) || seenPicks.has(pickNo)) return null;
            seenPlayers.add(pid); seenPicks.add(pickNo);
            if (pick.metadata?.player_id != null && string(pick.metadata.player_id) !== pid) continue;
            if (![null, undefined, false, 0, '0', 'false'].includes(pick.is_keeper)) continue;
            if (Math.ceil(pickNo / teams) !== round) continue;
            const contribution = evidence.players.get(pid), participant = person(league, pick);
            const name = [pick.metadata?.first_name, pick.metadata?.last_name].filter(value => typeof value === 'string' && value.trim()).join(' ').trim();
            const position = string(pick.metadata?.position).toUpperCase();
            if (!name || !['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].includes(position) || !participant || !contribution || contribution.starts < 4) continue;
            valid.push({ pid, pickNo, round, name, position, participant, ...contribution });
        }
        const pairs = [];
        for (const early of valid) for (const late of valid) {
            const gap = late.points - early.points;
            if (early.position === late.position && late.pickNo - early.pickNo >= teams && early.participant.rosterId !== late.participant.rosterId && gap >= 10) pairs.push({ early, late, gap });
        }
        return pairs.sort((a, b) => b.gap - a.gap || b.late.pickNo - a.late.pickNo || a.early.pickNo - b.early.pickNo)[0] || null;
    }
    function article(league, draft, pair, evidence, sources, historical) {
        const { early, late, gap } = pair, season = string(league.season);
        const scope = `Weeks ${evidence.start}–${evidence.cutoff}`;
        const owner = player => player.participant.ownerName || `the roster receiving pick No. ${player.pickNo}`;
        const doOver = Number(season) % 2 === 1;
        const title = doOver ? `${season} draft do-over: ${late.name} supplied more starting-lineup points` : `${season} draft receipts: ${late.name}, later pick, more starting-lineup points`;
        const lead = `${owner(late)} selected ${late.name} in Round ${late.round} (No. ${late.pickNo}). Across ${scope}, the ${late.position} logged ${fmt(late.points)} starting-lineup points in ${late.starts} verified fantasy starts around the league.`;
        const comparison = `${early.name}, taken ${late.pickNo - early.pickNo} picks earlier by ${owner(early)}, logged ${fmt(early.points)} in ${early.starts} fantasy starts over the same weeks. That leaves the later selection ${fmt(gap)} points ahead on this measure. ${doOver ? 'A little ammunition for the next draft-room debate.' : 'A later-round receipt worth keeping.'}`;
        const caveat = 'These are observed season starting-lineup totals, wherever each player was started, including after a trade. They are not total player production or points retained by the drafting owner. Bench decisions and availability affect the comparison; the numbers alone do not explain why.';
        return {
            id: `draft:${leagueId(league)}:${draft.draft_id}:${early.pid}:${late.pid}`,
            kind: 'feature', category: doOver ? 'Draft do-over' : 'Draft receipts', feature: true,
            documentary: historical || evidence.complete, eventSeason: Number(season), season, week: evidence.cutoff,
            label: `${season} · ${doOver ? 'DRAFT DO-OVER' : 'DRAFT RECEIPTS'} · STARTING-LINEUP POINTS`,
            text: title, body: `${lead}\n\n${comparison}`, related: [{ label: 'What the numbers mean', text: caveat }],
            participants: [late.participant, early.participant], rosterIds: [late.participant.rosterId, early.participant.rosterId],
            metric: fmt(gap), metricLabel: 'more starting-lineup points',
            evidence: { metric: 'starting-lineup points', startWeek: evidence.start, throughWeek: evidence.cutoff, position: late.position, draftId: string(draft.draft_id), players: [late, early].map(player => ({ playerId: player.pid, pick: player.pickNo, points: player.points, starts: player.starts })) },
            sources: uniqueSources(sources),
        };
    }
    async function load({ league, weeks = [], priorSeasons = [], throughWeek, signal, force = false, fetcher = (...args) => root.fetch(...args), now = Date.now } = {}) {
        aborted(signal);
        const result = { status: 'unavailable', message: '', stories: [], sources: [], coverage: [
            'Comparisons use the same draft, position, league scoring and completed regular-season weeks. Both players need at least four verified fantasy starts; the later pick must be at least a round later and lead by at least 10 starting-lineup points.',
            'Only documented starters’ player scores count. Zero and negative scores count; missing scores do not. Bench production and commissioner adjustments to roster totals are not allocated to players.',
            'These are observed season totals, not a post-draft return, an ADP grade or a career ranking. Keepers and auction drafts are excluded. No explanation for injuries, benching or later trades is inferred.',
            'Only this edition and up to two already-loaded, linked prior seasons are checked. The selected edition keeps its completed-week cutoff; linked prior seasons require every regular-season week. No additional matchup history is downloaded.',
        ] };
        if (!leagueId(league) || !/^\d{4}$/.test(string(league?.season)) || (league.sport && league.sport !== 'nfl')) return { ...result, message: 'Choose a Sleeper football league with loaded season results to open draft receipts.' };
        let failed = false;
        const json = async (url, label) => {
            aborted(signal);
            const saved = cache.get(url), time = now();
            if (!force && saved && time >= saved.at && time - saved.at < 3600000) return copy(saved.value);
            const response = await fetcher(url, { signal, cache: 'no-store' });
            aborted(signal);
            if (!response.ok) throw Error(`${label} could not load.`);
            const value = await response.json(); aborted(signal);
            if (!Array.isArray(value)) throw Error(`${label} returned an unrecognized response.`);
            cache.set(url, { at: now(), value: copy(value) });
            while (cache.size > 24) cache.delete(cache.keys().next().value);
            return value;
        };
        for (const entry of seasonsFor(league, weeks, Array.isArray(priorSeasons) ? priorSeasons : [])) {
            aborted(signal);
            const sourceLeague = entry.league, season = string(sourceLeague.season), historical = leagueId(sourceLeague) !== leagueId(league);
            const evidence = observed(entry, throughWeek, historical);
            if (evidence.message) { result.coverage.push(`${season}: ${evidence.message}`); continue; }
            try {
                const draftUrl = `${base}league/${leagueId(sourceLeague)}/drafts`;
                const drafts = await json(draftUrl, `${season} drafts`);
                const supported = drafts.filter(draft => id(draft?.draft_id) && string(draft.league_id) === leagueId(sourceLeague) && string(draft.season) === season && draft.status === 'complete' && draft.season_type === 'regular' && (!draft.sport || draft.sport === 'nfl') && ['snake', 'linear'].includes(draft.type));
                const primary = id(sourceLeague.draft_id);
                const matches = primary ? supported.filter(draft => string(draft.draft_id) === primary) : supported.length === 1 ? supported : [];
                if (matches.length !== 1) { result.coverage.push(`${season}: A single completed primary snake or linear draft could not be verified; supplemental drafts and auction prices are not compared.`); continue; }
                const draft = matches[0], picksUrl = `${base}draft/${draft.draft_id}/picks`;
                const sources = [{ label: `${season} draft metadata`, url: draftUrl }, { label: `${season} draft picks and receiving rosters`, url: picksUrl }];
                const picks = await json(picksUrl, `${season} draft picks`);
                for (let week = evidence.start; week <= evidence.cutoff; week++) sources.push({ label: `${season} Week ${week} loaded lineup scores`, url: `${base}league/${leagueId(sourceLeague)}/matchups/${week}` });
                result.sources.push(...sources);
                const pair = compare(sourceLeague, draft, picks, evidence);
                result.coverage.push(`${season}: Checked Weeks ${evidence.start}–${evidence.cutoff}; ${pair ? 'a same-position comparison met the evidence threshold.' : 'no same-position comparison met the evidence threshold, so no verdict is published.'}`);
                if (pair) result.stories.push(article(sourceLeague, draft, pair, evidence, sources, historical));
            } catch (error) {
                aborted(signal); failed = true;
                result.coverage.push(`${season}: ${error.message || 'Draft records could not load.'}`);
            }
        }
        aborted(signal);
        result.sources = uniqueSources(result.sources);
        result.status = result.stories.length ? failed ? 'partial' : 'ready' : failed ? 'error' : 'unavailable';
        result.message = result.stories.length ? failed ? 'Some draft records could not load. Verified comparisons from the other checked seasons are available.' : '' : failed ? 'The available draft records could not be fully checked. Try again.' : 'No draft comparison has enough verified evidence yet. Four completed weeks and four verified fantasy starts per player are the minimum; loaded completed seasons can also supply receipts.';
        return result;
    }
    root.WrWireDraftHistory = { load };
})(typeof window !== 'undefined' ? window : globalThis);
