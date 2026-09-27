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
        while (chosen.length < 25) {
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
    function draftPlayers(league, draft, picks, evidence) {
        if (!Array.isArray(picks) || !picks.length) return [];
        const seenPlayers = new Set(), seenPicks = new Set(), valid = [];
        const teams = positive(draft.settings?.teams) || league.rosters.length;
        for (const pick of picks) {
            const pid = string(pick?.player_id), pickNo = positive(pick?.pick_no), round = positive(pick?.round);
            if (!pid || !pickNo || !round || string(pick.draft_id) !== string(draft.draft_id) || seenPlayers.has(pid) || seenPicks.has(pickNo)) return [];
            seenPlayers.add(pid); seenPicks.add(pickNo);
            if (pick.metadata?.player_id != null && string(pick.metadata.player_id) !== pid) continue;
            if (![null, undefined, false, 0, '0', 'false'].includes(pick.is_keeper)) continue;
            if (Math.ceil(pickNo / teams) !== round) continue;
            const contribution = evidence.players.get(pid), participant = person(league, pick);
            const name = [pick.metadata?.first_name, pick.metadata?.last_name].filter(value => typeof value === 'string' && value.trim()).join(' ').trim();
            const position = string(pick.metadata?.position).toUpperCase();
            if (!name || !['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].includes(position) || !participant || !contribution || contribution.starts < 4) continue;
            valid.push({ pid, pickNo, round, name, position, participant, ...contribution, average: contribution.points / contribution.starts });
        }
        return valid;
    }
    const owner = player => player.participant.ownerName || `the roster receiving pick No. ${player.pickNo}`;
    const caveat = 'These are observed season starting-lineup points wherever the player was started, including after trades. Fantasy starts are lineup selections, not NFL games started. Bench production is unavailable. No injury cause, owner skill, ADP grade or retained return is inferred.';
    function storyFor(league, draft, evidence, sources, historical, type, title, body, players, detail) {
        const season = string(league.season);
        const labels = { value: 'The later-pick win', doover: 'Draft do-over', workload: 'The lineup gap', late: 'Late-round contributor' };
        return {
            id: `draft:${leagueId(league)}:${draft.draft_id}:${type}:${players.map(player => player.pid).join(':')}`,
            kind: 'feature', category: labels[type], featureType: type, feature: true,
            documentary: historical || evidence.complete, eventSeason: Number(season), season, leagueId: leagueId(league), week: evidence.cutoff,
            label: `${season} · ${labels[type].toUpperCase()}`, text: `${season}: ${title}`, body,
            related: [{ label: 'What the numbers mean', text: caveat }, { label: 'Why this comparison', text: detail }],
            participants: [...new Map(players.map(player => [player.participant.ownerId || player.participant.rosterId, player.participant])).values()],
            rosterIds: [...new Set(players.map(player => player.participant.rosterId))],
            evidence: { metric: 'starting-lineup points', startWeek: evidence.start, throughWeek: evidence.cutoff, position: players[0].position, draftId: string(draft.draft_id), players: players.map(player => ({ playerId: player.pid, name: player.name, pick: player.pickNo, points: Math.round(player.points * 100) / 100, starts: player.starts, average: Math.round(player.average * 100) / 100 })) },
            sources: uniqueSources(sources),
        };
    }
    function articles(league, draft, players, evidence, sources, historical) {
        const teams = positive(draft.settings?.teams) || league.rosters.length, pairs = [], stories = [];
        for (const early of players) for (const late of players) {
            const gap = late.points - early.points, rateGap = late.average - early.average;
            if (early.position === late.position && late.pickNo - early.pickNo >= teams && early.participant.rosterId !== late.participant.rosterId && gap >= 10) pairs.push({ early, late, gap, rateGap });
        }
        const comparable = pairs.filter(pair => Math.abs(pair.late.starts - pair.early.starts) <= 2 && Math.min(pair.late.starts, pair.early.starts) / Math.max(pair.late.starts, pair.early.starts) >= 0.75 && pair.rateGap >= 3)
            .sort((a, b) => b.rateGap - a.rateGap || b.gap - a.gap || a.late.pickNo - b.late.pickNo);
        const used = new Set(), scope = `Weeks ${evidence.start}–${evidence.cutoff}`;
        for (const pair of comparable) {
            if (stories.length >= 2) break;
            const { early, late, rateGap } = pair;
            if (used.has(late.pid) || used.has(early.pid)) continue;
            const type = stories.length ? 'doover' : 'value';
            const title = type === 'value' ? `${late.name} made the later pick look good` : `${early.name} or ${late.name}? A draft-room do-over`;
            const first = type === 'value'
                ? `${owner(late)} selected ${late.name} in Round ${late.round} (No. ${late.pickNo}). Over ${scope}, the ${late.position} averaged ${fmt(late.average)} points per fantasy start, against ${fmt(early.average)} for ${early.name}, taken ${late.pickNo - early.pickNo} picks earlier by ${owner(early)}.`
                : `${owner(early)} took ${early.name} at No. ${early.pickNo}; ${owner(late)} landed ${late.name} at No. ${late.pickNo}. Across ${scope}, the later ${late.position} pick averaged ${fmt(rateGap)} more points per fantasy start. Hindsight has pulled up a chair.`;
            const second = `${late.name}: ${fmt(late.points)} points in ${late.starts} fantasy starts. ${early.name}: ${fmt(early.points)} in ${early.starts}. Similar lineup exposure, more scoring from the later pick${type === 'value' ? '—a receipt worth saving.' : '. Let the draft-room debate begin.'}`;
            stories.push(storyFor(league, draft, evidence, sources, historical, type, title, `${first}\n\n${second}`, [late, early], 'Same draft and position; at least a round apart. Both have four or more verified fantasy starts, counts differ by at most two and the smaller count is at least 75% of the larger. The later pick leads by at least 3 points per start and 10 total starting-lineup points. These are different NFL weeks, not a head-to-head player simulation.'));
            used.add(late.pid); used.add(early.pid);
        }
        const workload = pairs.filter(pair => Math.abs(pair.late.starts - pair.early.starts) > 2 && pair.late.starts > pair.early.starts && !used.has(pair.late.pid) && !used.has(pair.early.pid)).sort((a, b) => b.gap - a.gap || a.late.pickNo - b.late.pickNo)[0];
        if (workload) {
            const { early, late, gap } = workload;
            stories.push(storyFor(league, draft, evidence, sources, historical, 'workload', `${late.name} and ${early.name}: mind the lineup gap`,
                `${owner(late)}’s Round ${late.round} selection ${late.name} supplied ${fmt(late.points)} lineup points in ${scope}; ${owner(early)}’s Round ${early.round} pick ${early.name} supplied ${fmt(early.points)}. The ${fmt(gap)}-point gap has a qualifier: ${late.starts} fantasy starts against ${early.starts}.\n\nPer fantasy start: ${fmt(late.average)} for ${late.name}, ${fmt(early.average)} for ${early.name}. The totals reflect different numbers of lineup appearances as well as scoring.`,
                [late, early], 'Same draft and position, at least one round apart, but more than two fantasy starts separate the players. This is deliberately a workload comparison, not a value award. The source does not explain why either player was started less often.'));
            used.add(late.pid); used.add(early.pid);
        }
        const rounds = positive(draft.settings?.rounds), lateCandidates = rounds ? players.filter(player => player.round > Math.ceil(rounds / 2) && player.starts >= Math.max(4, Math.ceil(evidence.weekCount / 2)) && !used.has(player.pid)).flatMap(player => {
            const peers = players.filter(peer => peer.position === player.position).map(peer => peer.average).sort((a, b) => a - b);
            const middle = Math.floor(peers.length / 2), median = peers.length % 2 ? peers[middle] : (peers[middle - 1] + peers[middle]) / 2;
            return peers.length >= 4 && player.average >= median + 2 ? [{ player, median, count: peers.length }] : [];
        }).sort((a, b) => (b.player.average - b.median) - (a.player.average - a.median) || b.player.round - a.player.round) : [];
        if (lateCandidates.length) {
            const { player, median, count } = lateCandidates[0];
            stories.push(storyFor(league, draft, evidence, sources, historical, 'late', `${player.name} brought something back from Round ${player.round}`,
                `${owner(player)} selected ${player.name} at No. ${player.pickNo}, in the second half of this ${rounds}-round draft. Across ${scope}, the ${player.position} supplied ${fmt(player.points)} lineup points in ${player.starts} fantasy starts. The late rounds had something to say.\n\nThat ${fmt(player.average)} average beat the ${fmt(median)} median for the ${count} drafted ${player.position}s with at least four verified fantasy starts. A useful contributor from a quieter part of the board.`,
                [player], 'A pick from the second half of this draft, used in at least half the checked weeks. Its average leads the median of at least four drafted same-position players with four verified fantasy starts by at least 2 points. This is a scoped contributor comparison, not an all-time steal ranking.'));
        }
        return stories;
    }
    function ownerNotebooks(records) {
        const owners = new Map();
        for (const record of records) for (const player of record.players) {
            const account = player.participant.ownerId;
            if (!account || !player.participant.ownerKnown) continue;
            if (!owners.has(account)) owners.set(account, { ownerId: account, ownerName: player.participant.ownerName, seasons: new Map() });
            const book = owners.get(account), season = string(record.league.season);
            if (!book.seasons.has(season)) book.seasons.set(season, { season, leagueId: leagueId(record.league), throughWeek: record.evidence.cutoff, teamName: player.participant.teamName, picks: [], sources: record.sources });
            book.seasons.get(season).picks.push({ name: player.name, playerId: player.pid, position: player.position, round: player.round, pick: player.pickNo, points: Math.round(player.points * 100) / 100, starts: player.starts, average: Math.round(player.average * 100) / 100 });
        }
        return [...owners.values()].map(book => ({ ...book, seasons: [...book.seasons.values()].sort((a, b) => Number(b.season) - Number(a.season)).map(season => ({ ...season, picks: season.picks.sort((a, b) => a.pick - b.pick) })) })).sort((a, b) => a.ownerName.localeCompare(b.ownerName));
    }
    function opinionFor(receipt, angle, title, paragraphs) {
        return { ...receipt, id: `${receipt.id}:opinion:${angle}`, opinion: true, desk: 'draft', category: 'Draft opinion', featureType: 'opinion', opinionAngle: angle,
            label: 'DRAFT DESK · OPINION', timingLabel: `${receipt.season} retrospective · Weeks ${receipt.evidence.startWeek}–${receipt.evidence.throughWeek}`,
            text: title, body: paragraphs.join('\n\n'),
            related: [{ label: 'The evidence behind this opinion', text: receipt.body }, ...(receipt.related || [])],
        };
    }
    function draftOpinions(records) {
        // Opinion is a separate editorial layer. Every claim below is grounded
        // in a qualified receipt; none broadens the underlying player sample.
        const candidates = [], repeated = new Map();
        for (const record of records) {
            for (const receipt of record.stories) {
                const [later, earlier] = receipt.evidence.players;
                if (receipt.featureType === 'value') candidates.push(opinionFor(receipt, 'price', `${later.name} is a reason to keep working the draft board`, [
                    `${later.name} was the better value here: same position, similar lineup opportunity, selected ${later.pick - earlier.pick} picks later. The expensive end of the board does not get to claim all the good decisions.`,
                    `In Weeks ${receipt.evidence.startWeek}–${receipt.evidence.throughWeek}, ${later.name} averaged ${fmt(later.average)} points over ${later.starts} fantasy starts, against ${fmt(earlier.average)} over ${earlier.starts} for ${earlier.name}. Those scores follow the player wherever started, including after trades.`,
                    'Keep a real shortlist after the early rounds. Hindsight gives this pick a deserved victory lap; carrying the same player up next year’s board requires a fresh argument.',
                ]));
                if (receipt.featureType === 'workload') candidates.push(opinionFor(receipt, 'workload', `Put the red pen down on ${earlier.name} for a moment`, [
                    `${earlier.name}’s smaller total makes an easy target. It also leaves out the most important number in this comparison: opportunities to score in a fantasy lineup. Put the failing grade on hold.`,
                    `${later.name} had ${later.starts} fantasy starts to ${earlier.name}’s ${earlier.starts} in Weeks ${receipt.evidence.startWeek}–${receipt.evidence.throughWeek}. Their averages were ${fmt(later.average)} and ${fmt(earlier.average)} points per start, wherever they were started. These results do not explain why the usage differed.`,
                    'Both production and opportunity belong in the verdict. Before declaring the earlier pick a disaster, explain that gap. A confident roast should survive a second look at the numbers.',
                ]));
                if (receipt.featureType === 'late') candidates.push(opinionFor(receipt, 'late', `The second half of the draft deserves a plan`, [
                    `The late rounds still deserve a plan. ${later.name} is a good reminder for anyone whose last few selections come with one eye on the dinner menu.`,
                    `Taken at No. ${later.pick}, ${later.name} averaged ${fmt(later.average)} points across ${later.starts} fantasy starts in Weeks ${receipt.evidence.startWeek}–${receipt.evidence.throughWeek}. That beat this draft’s same-position median by at least two points per start, wherever the player was used.`,
                    'Give the back half of the board its own shortlist. Draft prep that stops at the marquee names leaves an awfully large part of the night to chance.',
                ]));
            }
            const rounds = positive(record.draft.settings?.rounds), end = Math.min(18, (positive(record.league.settings?.playoff_week_start) || 19) - 1);
            if (!rounds || !record.evidence.complete || record.evidence.cutoff !== end) continue;
            for (const player of record.players) {
                if (!player.participant.ownerId || !player.participant.ownerKnown || player.round <= Math.ceil(rounds / 2) || player.starts < Math.max(4, Math.ceil(record.evidence.weekCount / 2))) continue;
                const peers = record.players.filter(peer => peer.position === player.position).map(peer => peer.average).sort((a, b) => a - b);
                const middle = Math.floor(peers.length / 2), median = peers.length % 2 ? peers[middle] : (peers[middle - 1] + peers[middle]) / 2;
                if (peers.length < 4 || player.average < median + 2) continue;
                const rows = repeated.get(player.participant.ownerId) || [];
                rows.push({ record, player, median, peers: peers.length }); repeated.set(player.participant.ownerId, rows);
            }
        }
        for (const rows of repeated.values()) {
            const bestBySeason = new Map();
            for (const row of rows) {
                const season = string(row.record.league.season), saved = bestBySeason.get(season);
                if (!saved || row.player.average - row.median > saved.player.average - saved.median) bestBySeason.set(season, row);
            }
            const selected = [...bestBySeason.values()].sort((a, b) => Number(b.record.league.season) - Number(a.record.league.season)).slice(0, 3);
            if (selected.length < 2) continue;
            const newest = selected[0], { record, player } = newest;
            const receipt = storyFor(record.league, record.draft, record.evidence, selected.flatMap(row => row.record.sources), true, 'late', '', '', [player], 'At least two fully checked completed regular seasons for one selecting account. In each season, a second-half pick made at least half of the checked lineups and beat its own season’s same-position median by at least 2 points per fantasy start. Each median includes at least four drafted players with four verified starts. Seasons are assessed separately under their original scoring; the examples do not describe every pick or prove a repeatable drafting edge.');
            const opinion = opinionFor(receipt, 'notebook', `${player.participant.ownerName} has more than one late-round receipt`, [
                `These ${selected.length} picks earn a place in ${player.participant.ownerName}’s draft notebook. Useful starters can emerge after the splashy names are gone, and the late rounds have delivered across multiple seasons here.`,
                selected.map(row => `${row.record.league.season}: ${row.player.name}, Round ${row.player.round} — ${fmt(row.player.average)} points per fantasy start in ${row.player.starts} starts, against the position median of ${fmt(row.median)}.`).join(' '),
                'Keep digging late. These results follow the players wherever started; the overall draft grade still has to account for the misses.',
            ]);
            opinion.eventSeasons = selected.map(row => string(row.record.league.season));
            opinion.timingLabel = `${opinion.eventSeasons.at(-1)}–${opinion.eventSeasons[0]} retrospective · Completed regular seasons`;
            opinion.related = receipt.related;
            opinion.participants = selected.map(row => row.player.participant);
            opinion.rosterIds = [...new Set(opinion.participants.map(person => person.rosterId))];
            opinion.evidence = { ...opinion.evidence, metric: 'separate season position comparisons', seasons: selected.map(row => ({ season: string(row.record.league.season), leagueId: leagueId(row.record.league), playerId: row.player.pid, name: row.player.name, pick: row.player.pickNo, round: row.player.round, starts: row.player.starts, average: Math.round(row.player.average * 100) / 100, median: Math.round(row.median * 100) / 100, comparisonPlayers: row.peers, startWeek: row.record.evidence.start, throughWeek: row.record.evidence.cutoff })) };
            candidates.push(opinion);
        }
        const priority = { notebook: 0, price: 1, workload: 2, late: 3 }, angles = new Set();
        return candidates.sort((a, b) => priority[a.opinionAngle] - priority[b.opinionAngle] || Number(b.season) - Number(a.season) || a.id.localeCompare(b.id)).filter(story => {
            if (angles.has(story.opinionAngle)) return false;
            angles.add(story.opinionAngle); return true;
        }).slice(0, 3);
    }
    async function load({ league, weeks = [], priorSeasons = [], throughWeek, signal, force = false, maxSeasons = 8, onProgress = () => {}, fetcher = (...args) => root.fetch(...args), now = Date.now } = {}) {
        aborted(signal);
        const methods = [
            'Value comparisons use the same draft and position, similar fantasy-start counts, and points per fantasy start. Lineup-gap stories explicitly separate different workloads; they are not judgments of owner skill.',
            'Only documented starters’ player scores count. Both players need four verified fantasy starts. Zero and negative scores count; missing scores do not. Bench points and commissioner adjustments to roster totals are not allocated to players.',
            'These are observed season totals, not post-draft return, an ADP grade or a career ranking. Keepers and auction drafts are excluded. No injury, benching or trade cause is inferred.',
            'The selected edition keeps its completed-week cutoff; linked prior seasons require every regular-season week. Up to eight loaded seasons open first, with older checked history available on request. No additional matchup history is downloaded.',
            'Draft Desk opinions are retrospective judgments tied to verified receipts. Cross-season notebooks compare each year within its own scoring and position group; selected successes are not a whole-draft grade or proof of owner skill.',
        ];
        const empty = { status: 'unavailable', message: '', stories: [], opinions: [], ownerHistories: [], sources: [], coverage: methods, checkedSeasons: [], progress: { checked: 0, total: 0, available: 0, remaining: 0 } };
        if (!leagueId(league) || !/^\d{4}$/.test(string(league?.season)) || (league.sport && league.sport !== 'nfl')) return { ...empty, message: 'Choose a Sleeper football league with loaded season results to open draft receipts.' };
        const all = seasonsFor(league, weeks, Array.isArray(priorSeasons) ? priorSeasons : []);
        const selected = all.slice(0, Math.min(25, positive(maxSeasons) || 8));
        const records = new Map(), outcomes = new Map();
        const snapshot = loading => {
            const checkedSeasons = selected.map(entry => outcomes.get(leagueId(entry.league))).filter(Boolean);
            const checked = [...records.values()].sort((a, b) => Number(b.league.season) - Number(a.league.season));
            const stories = checked.flatMap(record => record.stories), opinions = draftOpinions(checked), ownerHistories = ownerNotebooks(checked), failed = checkedSeasons.some(entry => entry.status === 'error');
            const useful = stories.length || ownerHistories.length;
            return { status: loading ? 'loading' : useful ? failed ? 'partial' : 'ready' : failed ? 'error' : 'unavailable',
                message: loading ? `Checking draft receipts: ${checkedSeasons.length} of ${selected.length} loaded seasons reviewed.` : useful ? failed ? 'Some draft records could not load. Verified receipts and owner notebooks remain available.' : '' : failed ? 'Some draft records could not be checked. Try again.' : 'No draft comparison has enough evidence yet. Four completed weeks and four verified fantasy starts are the minimum; loaded completed seasons can also supply receipts.',
                stories, opinions, ownerHistories, sources: uniqueSources(checked.flatMap(record => record.sources)), checkedSeasons,
                coverage: methods.concat(checkedSeasons.map(entry => `${entry.season}: ${entry.message}`)),
                progress: { checked: checkedSeasons.length, total: selected.length, available: all.length, remaining: all.length - selected.length },
            };
        };
        const emit = () => { aborted(signal); onProgress(copy(snapshot(true))); };
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
            while (cache.size > 60) cache.delete(cache.keys().next().value);
            return value;
        };
        let cursor = 0;
        async function worker() {
            while (cursor < selected.length) {
                aborted(signal);
                const entry = selected[cursor++], sourceLeague = entry.league, season = string(sourceLeague.season), historical = leagueId(sourceLeague) !== leagueId(league);
                const finish = (status, message) => { outcomes.set(leagueId(sourceLeague), { season, leagueId: leagueId(sourceLeague), status, message }); emit(); };
                const evidence = observed(entry, throughWeek, historical);
                if (evidence.message) { finish('unavailable', evidence.message); continue; }
                try {
                    const draftUrl = `${base}league/${leagueId(sourceLeague)}/drafts`;
                    const drafts = await json(draftUrl, `${season} drafts`);
                    const supported = drafts.filter(draft => id(draft?.draft_id) && string(draft.league_id) === leagueId(sourceLeague) && string(draft.season) === season && draft.status === 'complete' && draft.season_type === 'regular' && (!draft.sport || draft.sport === 'nfl') && ['snake', 'linear'].includes(draft.type));
                    const primary = id(sourceLeague.draft_id);
                    const matches = primary ? supported.filter(draft => string(draft.draft_id) === primary) : supported.length === 1 ? supported : [];
                    if (matches.length !== 1) { finish('unavailable', 'A single completed primary snake or linear draft could not be verified. Supplemental drafts and auction prices are not compared.'); continue; }
                    const draft = matches[0], picksUrl = `${base}draft/${draft.draft_id}/picks`;
                    const sources = [{ label: `${season} draft metadata`, url: draftUrl }, { label: `${season} draft picks and receiving rosters`, url: picksUrl }];
                    const picks = await json(picksUrl, `${season} draft picks`);
                    for (let week = evidence.start; week <= evidence.cutoff; week++) sources.push({ label: `${season} Week ${week} loaded lineup scores`, url: `${base}league/${leagueId(sourceLeague)}/matchups/${week}` });
                    const players = draftPlayers(sourceLeague, draft, picks, evidence);
                    const stories = articles(sourceLeague, draft, players, evidence, sources, historical);
                    records.set(leagueId(sourceLeague), { league: sourceLeague, draft, players, evidence, sources, stories });
                    finish('checked', `Checked Weeks ${evidence.start}–${evidence.cutoff}; ${players.length} picks have at least four verified fantasy starts. ${stories.length ? `${stories.length} distinct receipts qualified.` : 'No comparison met the story threshold; eligible picks remain in owner notebooks.'}`);
                } catch (error) {
                    aborted(signal); finish('error', error.message || 'Draft records could not load.');
                }
            }
        }
        emit();
        await Promise.all(Array.from({ length: Math.min(2, selected.length) }, worker));
        aborted(signal);
        return snapshot(false);
    }
    function matches(story, { search = '', ownerFilter = null, league, season = 'all', category = 'all' } = {}) {
        if (season !== 'all' && string(story.season) !== string(season) && !(story.eventSeasons || []).some(year => string(year) === string(season))) return false;
        if (category !== 'all' && story.featureType !== category) return false;
        if (ownerFilter) {
            const ownerId = string(ownerFilter.ownerId), rosterId = string(ownerFilter.rosterId);
            if (!(story.participants || []).some(person => ownerId ? string(person.ownerId) === ownerId : string(story.leagueId) === leagueId(league) && string(person.rosterId) === rosterId)) return false;
        }
        const text = [story.text, story.body, story.category, ...(story.participants || []).flatMap(person => [person.ownerName, person.teamName]), ...(story.related || []).map(item => item.text)].filter(Boolean).join(' ').toLocaleLowerCase();
        return string(search).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).every(term => text.includes(term));
    }
    root.WrWireDraftHistory = { load, matches };
})(typeof window !== 'undefined' ? window : globalThis);
