// League journalism from scored evidence. Owner identities, never roster slots,
// connect seasons. The archive is lazy, bounded, cancellable and scope-labelled.
(function (root) {
    'use strict';
    const cache = new Map();
    const id = value => String(value);
    const points = row => root.App.LeagueLiveScores.rosterPoints(row);
    const fmt = n => Number(n).toFixed(2);
    const round = n => Math.round(n * 100) / 100;
    const signature = league => JSON.stringify([
        Object.entries(league.scoring_settings || {}).sort(([a], [b]) => a.localeCompare(b)),
        (league.roster_positions || []).filter(p => p !== 'BN' && p !== 'IR').slice().sort(),
    ]);
    const bounds = league => ({ start: Math.max(1, Number(league.settings?.start_week) || 1), end: Math.min(18, (Number(league.settings?.playoff_week_start) || 19) - 1) });
    const isH2H = league => !root.App?.Chopped?.isChopped?.(league) && league?.type !== 'chopped' && league?.leagueSkin?.type !== 'chopped';
    const owner = (league, rid) => league?.rosters?.find(r => id(r.roster_id) === id(rid))?.owner_id || null;
    function oldName(league, rid) {
        const roster = league.rosters?.find(r => id(r.roster_id) === id(rid));
        const user = league.users?.find(u => u.user_id === roster?.owner_id);
        return user?.metadata?.team_name || user?.display_name || user?.username || `Team ${rid}`;
    }
    function inspect(rows, league) {
        if (!Array.isArray(rows) || !rows.length || rows.some(r => !r || r.roster_id == null || points(r) == null)) return null;
        const ids = new Set(rows.map(r => id(r.roster_id)));
        if (ids.size !== rows.length) return null;
        if (league?.rosters?.length && (rows.length !== league.rosters.length || league.rosters.some(r => !ids.has(id(r.roster_id))))) return null;
        const groups = new Map();
        rows.forEach(r => { if (r.matchup_id != null) { const k = id(r.matchup_id); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); } });
        if (isH2H(league) && [...groups.values()].some(g => g.length !== 2)) return null;
        return [...groups.values()].filter(g => g.length === 2);
    }
    async function loadArchive({ league, signal, force = false, onProgress = () => {}, fetcher = (...args) => root.fetch(...args), now = Date.now }) {
        const key = `${league.league_id || league.id}|${league.season}`;
        const cached = cache.get(key);
        if (!force && cached && now() - cached.at < (cached.complete ? 6 * 3600000 : 60000)) { onProgress(cached); return cached; }
        const seasons = [], seen = new Set([id(league.league_id || league.id)]);
        const json = async path => {
            if (signal?.aborted) throw new Error('aborted');
            const response = await fetcher('https://api.sleeper.app/v1/league/' + path, { signal });
            if (!response.ok) throw new Error('unavailable');
            return response.json();
        };
        let complete = false, reason = '';
        try {
            const current = await json(encodeURIComponent(league.league_id || league.id));
            if (!current || !Object.prototype.hasOwnProperty.call(current, 'previous_league_id')) throw new Error('unavailable');
            let previous = current.previous_league_id, year = Number(league.season);
            while (previous && id(previous) !== '0') {
                if (seen.has(id(previous)) || seasons.length >= 25) { reason = 'The linked history ends before the archive can be verified in full.'; break; }
                seen.add(id(previous));
                const path = encodeURIComponent(previous);
                const info = await json(path);
                if (!info || !Number.isFinite(Number(info.season)) || Number(info.season) >= year || !Object.prototype.hasOwnProperty.call(info, 'previous_league_id')) throw new Error('unavailable');
                const [rosters, users] = await Promise.all([json(path + '/rosters'), json(path + '/users')]);
                if (!Array.isArray(rosters) || !rosters.length || !Array.isArray(users)) throw new Error('unavailable');
                const historical = { ...info, league_id: id(previous), rosters, users };
                const range = bounds(historical);
                const result = await root.App.LeagueLiveTable.loadHistory({ league: historical, week: range.end + 1, signal, force, fetcher, now });
                const byWeek = new Map(result.priorWeeks.map(w => [Number(w.week), w.rows]));
                for (let w = range.start; w <= range.end; w++) if (!inspect(byWeek.get(w), historical)) throw new Error('unavailable');
                seasons.push({ league: historical, weeks: result.priorWeeks });
                year = Number(info.season); previous = info.previous_league_id;
                onProgress({ seasons: seasons.slice(), complete: false, reason: 'Loading earlier seasons…' });
            }
            complete = !previous || id(previous) === '0';
        } catch (_) {
            if (signal?.aborted) throw new Error('Archive loading was interrupted.');
            reason = 'Some linked seasons could not be verified. Records cover the loaded seasons only.';
        }
        const result = { seasons, complete, reason, at: now() };
        cache.set(key, result);
        return result;
    }
    const choose = (variants, week, rid) => variants[(Number(week) + (Number(rid) || 0)) % variants.length];
    const recordText = t => `${t.wins}–${t.losses}${t.ties ? '–' + t.ties : ''}`;
    function ranked(stats) {
        const rows = [...stats.values()].map(t => ({ ...t })).sort((a, b) => (b.wins + b.ties / 2) - (a.wins + a.ties / 2) || b.pf - a.pf || id(a.rid).localeCompare(id(b.rid)));
        rows.forEach((r, i) => { const prev = rows[i - 1]; r.rank = prev && prev.wins + prev.ties / 2 === r.wins + r.ties / 2 && round(prev.pf) === round(r.pf) ? prev.rank : i + 1; });
        return rows;
    }
    function build({ weeks = [], start = 1, end = 0, nameFor = rid => `Team ${rid}`, playerName = pid => `Player ${pid}`, headToHead = true, league = {}, priorSeasons = [], archiveComplete = false, board = null }) {
        const stories = [], records = [], games = [], stats = new Map(), runs = new Map(), scoreTotals = new Map();
        const season = String(league.season || '');
        const seasonSignature = signature(league);
        const previous = new Map(weeks.map(w => [Number(w.week), w.rows]));
        let high = null, marginRecord = null, completedThrough = start - 1;
        let archiveHigh = null, archiveMargin = null, historicalHigh = null;
        const historicalRecords = [];
        const archiveRecords = [], archiveMargins = [], careerWins = new Map();
        let rulesChanged = false;
        const comparableSeasons = [];
        const collectRecord = (value, holders, entry, current) => {
            if (current === null || value > current) holders.length = 0;
            if (current === null || value >= current) holders.push(entry);
            return current === null ? value : Math.max(current, value);
        };
        // Old names belong to their own season. Rivalries require actual owners.
        priorSeasons.slice().sort((a, b) => Number(a.league.season) - Number(b.league.season)).forEach(s => {
            const comparable = signature(s.league) === seasonSignature;
            rulesChanged ||= !comparable;
            if (comparable) comparableSeasons.push(String(s.league.season));
            for (const w of s.weeks) {
                const range = bounds(s.league);
                if (w.week < range.start || w.week > range.end) continue;
                const pairs = inspect(w.rows, s.league);
                if (!pairs) continue;
                w.rows.forEach(r => { historicalHigh = collectRecord(points(r), historicalRecords, { season: s.league.season, week: w.week, name: oldName(s.league, r.roster_id), points: points(r) }, historicalHigh); });
                if (comparable) w.rows.forEach(r => { archiveHigh = collectRecord(points(r), archiveRecords, { season: s.league.season, week: w.week, name: oldName(s.league, r.roster_id), points: points(r) }, archiveHigh); });
                if (!isH2H(s.league)) continue;
                pairs.forEach(([a, b]) => {
                    const oa = owner(s.league, a.roster_id), ob = owner(s.league, b.roster_id), gap = round(Math.abs(points(a) - points(b)));
                    const winner = points(a) > points(b) ? a : points(b) > points(a) ? b : null;
                    if (comparable && gap > 0) archiveMargin = collectRecord(gap, archiveMargins, { season: s.league.season, week: w.week, name: oldName(s.league, winner.roster_id), points: gap }, archiveMargin);
                    if (oa && ob && oa !== ob) games.push({ a: oa, b: ob, pa: points(a), pb: points(b), week: w.week, season: String(s.league.season) });
                    const winOwner = winner && owner(s.league, winner.roster_id);
                    if (winOwner) careerWins.set(winOwner, (careerWins.get(winOwner) || 0) + 1);
                });
            }
        });
        const priorHigh = archiveHigh;
        const series = (a, b) => games.filter(g => (g.a === a && g.b === b) || (g.a === b && g.b === a));
        let latestTable = [], previousTable = [];
        const seats = Number(league.settings?.playoff_teams) || 0;
        const lastReg = bounds(league).end;
        const simpleRace = headToHead && seats > 0 && Number(league.settings?.divisions || 0) < 2 && !league.settings?.playoff_seed_type;
        for (let week = start; week <= end; week++) {
            const rows = previous.get(week), pairs = inspect(rows, league);
            if (!pairs) break;
            completedThrough = week;
            const add = (kind, category, text, body, rosterIds = [], extra = {}) => {
                const story = { id: `${season}:${week}:${category}:${rosterIds.join(':')}:${stories.length}`, kind, category, week, season, label: `WK ${week} · ${category.toUpperCase()}`, text, body, rosterIds, ...extra };
                stories.push(story); return story;
            };
            rows.forEach(r => { if (!stats.has(id(r.roster_id))) stats.set(id(r.roster_id), { rid: r.roster_id, wins: 0, losses: 0, ties: 0, pf: 0 }); });
            previousTable = ranked(stats);
            const before = new Map(previousTable.map(t => [id(t.rid), t]));
            const sorted = rows.slice().sort((a, b) => points(b) - points(a)), best = points(sorted[0]);
            const top = sorted.filter(r => points(r) === best), winners = top.map(r => nameFor(r.roster_id)).join(' & ');
            if (high !== null && best >= high) add('record', 'Record book', `${winners} ${best > high ? 'rewrite' : 'match'} the season scoring mark`, `${fmt(best)} points ${best > high ? 'surpasses' : 'ties'} the previous high of ${fmt(high)}.`, top.map(r => r.roster_id), { weight: 85, metric: fmt(best), metricLabel: 'fantasy points' });
            if (priorSeasons.length > 0 && archiveHigh !== null && best > archiveHigh) add('record', 'History made', `${winners} raise the bar across the archive`, `${fmt(best)} points clears the previous archived high of ${fmt(archiveHigh)}. ${archiveComplete && !rulesChanged ? 'Every linked season has been checked.' : 'Compared with loaded seasons using the same scoring and starting positions.'}`, top.map(r => r.roster_id), { weight: 100, metric: fmt(best), metricLabel: 'new archive high' });
            if (high === null || best >= high) {
                if (high === null || best > high) records.length = 0;
                top.forEach(r => records.push({ week, rosterId: r.roster_id, points: best })); high = best;
            }
            rows.forEach(r => { historicalHigh = collectRecord(points(r), historicalRecords, { season, week, name: nameFor(r.roster_id), points: points(r) }, historicalHigh); });
            rows.forEach(r => { archiveHigh = collectRecord(points(r), archiveRecords, { season, week, name: nameFor(r.roster_id), points: points(r) }, archiveHigh); });
            add('story', 'Scoring crown', choose([`${winners} set the pace`, `${winners} take the weekly scoring crown`, `The week belongs to ${winners}`], week, top[0].roster_id), `${fmt(best)} points led the ${rows.length}-team field${top.length > 1 ? ' in a shared first place' : ''}. ${top.length === 1 && sorted[1] ? `${fmt(best - points(sorted[1]))} points clear of the next-best score.` : ''}`, top.map(r => r.roster_id), { weight: 45, metric: fmt(best), metricLabel: 'weekly high' });
            rows.forEach(r => {
                const rid = id(r.roster_id), old = scoreTotals.get(rid) || 0, total = round(old + points(r));
                scoreTotals.set(rid, total); stats.get(rid).pf = total;
                const milestone = Math.floor(total / 500) * 500;
                if (milestone >= 1000 && old < milestone) add('story', 'Milestone', `${nameFor(r.roster_id)} cross ${milestone.toLocaleString('en-US')} points`, `${fmt(total)} points scored through Week ${week}. This week's ${fmt(points(r))} pushed the season total over the line.`, [r.roster_id], { weight: 55, metric: milestone.toLocaleString('en-US'), metricLabel: 'season points passed' });
            });
            if (!headToHead) continue;
            const paired = new Set(), recaps = [];
            const margins = [];
            pairs.forEach(pair => {
                const [a, b] = pair.slice().sort((x, y) => points(y) - points(x));
                const ra = id(a.roster_id), rb = id(b.roster_id), oa = owner(league, a.roster_id), ob = owner(league, b.roster_id);
                paired.add(ra); paired.add(rb);
                const gap = round(points(a) - points(b)), runA = runs.get(ra) || 0, runB = runs.get(rb) || 0;
                const meetings = oa && ob ? series(oa, ob) : [];
                const last = meetings[meetings.length - 1];
                const revenge = gap > 0 && last && (last.a === oa ? last.pa < last.pb : last.pb < last.pa);
                margins.push({ a, b, gap });
                const starters = (a.starters || []).filter(pid => pid && id(pid) !== '0').map(pid => ({ pid, value: a.players_points?.[pid] })).filter(x => typeof x.value === 'number' && Number.isFinite(x.value)).sort((x, y) => y.value - x.value);
                const star = starters[0];
                const verb = gap <= 3 ? choose(['survive a thriller against', 'escape by a whisker against', 'edge past'], week, a.roster_id) : gap >= 40 ? choose(['leave no doubt against', 'run away from', 'roll past'], week, a.roster_id) : choose(['get past', 'take care of business against', 'outlast'], week, a.roster_id);
                const title = gap === 0 ? `${nameFor(a.roster_id)} and ${nameFor(b.roster_id)} finish level` : `${nameFor(a.roster_id)} ${verb} ${nameFor(b.roster_id)}`;
                const recap = add('recap', revenge ? 'Revenge game' : gap > 0 && gap <= 3 ? 'Down to the wire' : 'Game recap', title,
                    `${fmt(points(a))}–${fmt(points(b))}. ${gap === 0 ? 'A tie in the scored matchup.' : `The winning margin: ${fmt(gap)} points.`}${star && gap > 0 ? ` ${playerName(star.pid)} led the winning starters with ${fmt(star.value)}.` : ''}`,
                    [a.roster_id, b.roster_id], { weight: revenge ? 83 : gap > 0 && gap <= 3 ? 78 : 35, matchup: [{ name: nameFor(a.roster_id), score: points(a), rid: a.roster_id }, { name: nameFor(b.roster_id), score: points(b), rid: b.roster_id }], related: [] });
                recaps.push({ recap, a, b, gap });
                if (last) recap.related.push({ label: 'Last meeting', text: `${last.season} · Week ${last.week}: ${nameFor(a.roster_id)} ${fmt(last.a === oa ? last.pa : last.pb)}–${fmt(last.a === oa ? last.pb : last.pa)} ${nameFor(b.roster_id)}.` });
                if (revenge) recap.body += ` A little payback: ${nameFor(b.roster_id)} won their previous meeting.`;
                if (gap > 0 && runB >= 3) add('story', 'Streak snapped', `${nameFor(a.roster_id)} bring the streak to a halt`, `${nameFor(b.roster_id)} had won ${runB} straight head-to-head games. A ${fmt(gap)}-point defeat ends that run.`, [a.roster_id, b.roster_id], { weight: 88 });
                if (gap > 0 && runA <= -3) add('story', 'Back in business', `${nameFor(a.roster_id)} stop the slide`, `After ${Math.abs(runA)} straight head-to-head losses, a ${fmt(points(a))}-point week brings a win over ${nameFor(b.roster_id)}.`, [a.roster_id], { weight: 72 });
                [a, b].forEach(r => {
                    const rid = id(r.roster_id), win = gap > 0 && r === a, currentRun = runs.get(rid) || 0, t = stats.get(rid);
                    if (gap === 0) { t.ties++; runs.set(rid, 0); }
                    else { t[win ? 'wins' : 'losses']++; runs.set(rid, win ? Math.max(0, currentRun) + 1 : Math.min(0, currentRun) - 1); }
                    if (runs.get(rid) >= 3) add('story', 'On a roll', `${nameFor(r.roster_id)} make it ${runs.get(rid)} straight`, `${choose(['The run keeps growing.', 'Another week, another win.', 'Nobody has slowed this run yet.'], week, r.roster_id)} The latest head-to-head win came against ${nameFor(b.roster_id)}.`, [r.roster_id], { weight: 65, metric: String(runs.get(rid)), metricLabel: 'straight wins' });
                });
                if (gap > 0 && sorted.filter(r => points(r) > points(b)).length < Math.floor(rows.length / 2)) add('story', 'Hard luck', choose([`No justice for ${nameFor(b.roster_id)}`, `${nameFor(b.roster_id)} get the cruel draw`, `${nameFor(b.roster_id)} score big and still come up short`], week, b.roster_id), `${fmt(points(b))} points landed in the top half of the league, but ${nameFor(a.roster_id)} still handed them a loss. A strong week met the wrong opponent.`, [b.roster_id], { weight: 57 });
                if (oa && ob && oa !== ob) games.push({ a: oa, b: ob, pa: points(a), pb: points(b), week, season });
                if (gap > 0 && oa) {
                    const wins = (careerWins.get(oa) || 0) + 1; careerWins.set(oa, wins);
                    if ([10, 25, 50, 75, 100, 150, 200].includes(wins) && archiveComplete) add('story', 'Career milestone', `${nameFor(a.roster_id)} reach win No. ${wins}`, `${wins} regular-season head-to-head wins across this owner's linked league history. ${nameFor(b.roster_id)} were the opponent for the milestone.`, [a.roster_id], { weight: 90, metric: String(wins), metricLabel: 'career wins' });
                }
            });
            for (const rid of runs.keys()) if (!paired.has(rid)) runs.delete(rid);
            if (Number(league.settings?.league_average_match) === 1) {
                const scores = rows.map(points).sort((a, b) => a - b), mid = Math.floor(scores.length / 2), median = scores.length % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2;
                rows.forEach(r => stats.get(id(r.roster_id))[points(r) > median ? 'wins' : points(r) < median ? 'losses' : 'ties']++);
            }
            latestTable = ranked(stats);
            const after = new Map(latestTable.map(t => [id(t.rid), t]));
            recaps.forEach(({ recap, a, b }) => {
                const ta = after.get(id(a.roster_id)), tb = after.get(id(b.roster_id));
                recap.related.push({ label: 'What it means', text: `${nameFor(a.roster_id)} stand ${recordText(ta)}; ${nameFor(b.roster_id)} sit ${recordText(tb)}${Number(league.settings?.league_average_match) === 1 ? ', including median results' : ''}.` });
                if (week > start && simpleRace && seats < latestTable.length) {
                    [ta, tb].forEach(t => {
                        const was = before.get(id(t.rid));
                        const movedIn = was.rank > seats && t.rank <= seats, movedOut = was.rank <= seats && t.rank > seats;
                        if ((movedIn || movedOut) && !latestTable.some(other => other.rid !== t.rid && other.rank === t.rank)) recap.related.push({ label: 'Playoff race', text: `${nameFor(t.rid)} ${movedIn ? 'move into' : 'drop outside'} the top ${seats} in the record-and-points table, from No. ${was.rank} to No. ${t.rank}. This is a race snapshot, not a clinch or official seed.` });
                    });
                }
            });
            if (week > start && latestTable.length > 1 && latestTable[0].rank !== latestTable[1].rank && before.get(id(latestTable[0].rid))?.rank > 1) {
                const leader = latestTable[0];
                add('story', 'Power shift', `${nameFor(leader.rid)} take over the top of the table`, `${recordText(leader)} with ${fmt(leader.pf)} points for. They move from No. ${before.get(id(leader.rid)).rank} to No. 1 in the completed-results table; official seeding rules may differ.`, [leader.rid], { weight: 82 });
            }
            const biggest = margins.slice().sort((a, b) => b.gap - a.gap)[0];
            if (biggest && biggest.gap > 0) {
                if (marginRecord !== null && biggest.gap > marginRecord) add('record', 'Record book', `${nameFor(biggest.a.roster_id)} set the season's biggest winning margin`, `A ${fmt(biggest.gap)}-point victory over ${nameFor(biggest.b.roster_id)} beats the previous mark of ${fmt(marginRecord)}.`, [biggest.a.roster_id], { weight: 80, metric: fmt(biggest.gap), metricLabel: 'point margin' });
                marginRecord = Math.max(marginRecord || 0, biggest.gap);
                margins.filter(m => m.gap > 0).forEach(m => { archiveMargin = collectRecord(m.gap, archiveMargins, { season, week, name: nameFor(m.a.roster_id), points: m.gap }, archiveMargin); });
            }
            if (simpleRace && seats < latestTable.length && week >= Math.max(start + 1, lastReg - 5)) {
                const inside = latestTable[seats - 1], outside = latestTable[seats], remaining = Math.max(0, lastReg - week), separation = round((inside.wins + inside.ties / 2) - (outside.wins + outside.ties / 2));
                add('story', 'Playoff race', separation === 0 ? 'The cutline has no breathing room' : `${nameFor(inside.rid)} and ${nameFor(outside.rid)} frame the cutline`, `${nameFor(inside.rid)} (${recordText(inside)}) sit at No. ${inside.rank}; ${nameFor(outside.rid)} (${recordText(outside)}) at No. ${outside.rank}. ${separation === 0 ? 'Their records are level; compare points for and the league tiebreak rules.' : `${separation} result${separation === 1 ? '' : 's'} separate them.`} ${remaining} regular-season week${remaining === 1 ? '' : 's'} remain. Official seeding and tiebreak rules still apply.`, [inside.rid, outside.rid], { weight: 75 });
            }
        }
        // Upcoming rematches give Week 1 a story before any game is final.
        const previews = [], rivals = [];
        const nowRows = board?.rows || [], nowPairs = new Map();
        nowRows.forEach(r => { if (r.matchup_id != null) { const k = id(r.matchup_id); if (!nowPairs.has(k)) nowPairs.set(k, []); nowPairs.get(k).push(r); } });
        if (headToHead) nowPairs.forEach(pair => {
            if (pair.length !== 2) return;
            const [a, b] = pair, oa = owner(league, a.roster_id), ob = owner(league, b.roster_id);
            if (!oa || !ob || oa === ob) return;
            const meetings = series(oa, ob); if (!meetings.length) return;
            const winsA = meetings.filter(g => g.a === oa ? g.pa > g.pb : g.pb > g.pa).length;
            const winsB = meetings.filter(g => g.a === ob ? g.pa > g.pb : g.pb > g.pa).length;
            const ties = meetings.length - winsA - winsB, last = meetings[meetings.length - 1];
            const rival = { a: nameFor(a.roster_id), b: nameFor(b.roster_id), winsA, winsB, ties, meetings: meetings.length, rosterIds: [a.roster_id, b.roster_id] };
            rivals.push(rival);
            const lastMargin = Math.abs(last.pa - last.pb);
            const previewTitle = winsA === winsB ? `${rival.a} and ${rival.b}: break the deadlock`
                : lastMargin <= 3 ? `${rival.a} and ${rival.b} meet again after a thriller`
                : meetings.length === 1 ? `${winsA < winsB ? rival.a : rival.b} get another shot at ${winsA < winsB ? rival.b : rival.a}`
                : Math.abs(winsA - winsB) >= 3 ? `${winsA < winsB ? rival.a : rival.b} have a score to settle`
                : choose([`${rival.a} vs. ${rival.b}: the next chapter`, `${rival.a} and ${rival.b} renew their rivalry`, `Familiar opponents. Fresh stakes. ${rival.a} vs. ${rival.b}`], board.week, a.roster_id);
            if (Number(board.week) > completedThrough && Number(board.week) <= lastReg) previews.push({ id: `preview:${season}:${board.week}:${a.roster_id}`, kind: 'story', category: 'Rivalry watch', label: `WK ${board.week} · RIVALRY WATCH`, text: previewTitle, body: `${rival.a} ${winsA === winsB ? 'are level at' : winsA > winsB ? 'lead the recorded series' : 'trail the recorded series'} ${winsA}–${winsB}${ties ? '–' + ties : ''} across ${meetings.length} regular-season meeting${meetings.length === 1 ? '' : 's'}. Last time: ${fmt(last.a === oa ? last.pa : last.pb)}–${fmt(last.a === oa ? last.pb : last.pa)} in ${last.season}, Week ${last.week}.`, week: Number(board.week), season, rosterIds: rival.rosterIds, weight: 70, preview: true, metric: `${winsA}–${winsB}`, metricLabel: `recorded series · ${rival.a} / ${rival.b}` });
        });
        return { stories: stories.reverse(), previews, rivals, records, high, priorHigh, marginRecord, table: latestTable, completedThrough,
            archive: { historicalHigh, historicalRecords, allSeasons: [...new Set([...priorSeasons.map(s => String(s.league.season)), ...(completedThrough >= start ? [season] : [])])].sort(), high: archiveHigh, margin: archiveMargin, records: archiveRecords, margins: archiveMargins, complete: archiveComplete, rulesChanged, seasons: [...new Set([...comparableSeasons, ...(completedThrough >= start ? [season] : [])])].sort(), priorCount: priorSeasons.length } };
    }
    root.WrWireStories = { build, loadArchive, signature, inspect, bounds, oldName };
})(typeof window !== 'undefined' ? window : globalThis);
