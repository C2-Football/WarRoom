// A standings snapshot reconstructed from completed matchup weeks. Official
// records are display-only: their posting time must never decide the baseline.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
    const id = v => String(v);
    const points = r => num(r?.custom_points) ?? num(r?.points);
    const result = (a, b) => a > b ? 'W' : a < b ? 'L' : 'T';
    function add(row, outcome) {
        row[outcome === 'W' ? 'wins' : outcome === 'L' ? 'losses' : 'ties']++;
    }
    function rank(rows) {
        // Remove addition noise before PF breaks record ties (e.g. 0.1 + 0.2).
        rows.forEach(r => { r.pointsFor = Math.round(r.pointsFor * 1e6) / 1e6; if (r.pointsAgainst != null) r.pointsAgainst = Math.round(r.pointsAgainst * 1e6) / 1e6; });
        const sorted = rows.slice().sort((a,b) => b.wins-a.wins || a.losses-b.losses || b.pointsFor-a.pointsFor || id(a.rosterId).localeCompare(id(b.rosterId)));
        const played = sorted.some(r => r.wins+r.losses+r.ties > 0);
        sorted.forEach((r,i) => {
            const prev = sorted[i-1];
            r.rank = !played ? null : prev && prev.wins === r.wins && prev.losses === r.losses && prev.pointsFor === r.pointsFor ? prev.rank : i+1;
            r.streak = r.form.length ? (() => { const last=r.form[r.form.length-1]; let n=0; for(let j=r.form.length-1;j>=0 && r.form[j]===last;j--) n++; return last+n; })() : null;
        });
        return sorted;
    }
    function compute(options) {
        const {league, standings = [], board, priorWeeks = [], started = false, startedRosterIds, currentWeek} = options || {};
        const week = Number(options?.week ?? board?.week);
        const rosters = league?.rosters || [];
        const source = rosters.length ? rosters : standings.map(r => ({roster_id:r.rosterId}));
        const officialRows = rank(source.map(roster => {
            const meta = standings.find(r => id(r.rosterId) === id(roster.roster_id)) || {};
            const s = roster.settings || {};
            return {...meta, rosterId:roster.roster_id, wins:num(s.wins) ?? num(meta.wins) ?? 0, losses:num(s.losses) ?? num(meta.losses) ?? 0, ties:num(s.ties) ?? num(meta.ties) ?? 0,
                pointsFor:num(s.fpts) !== null ? s.fpts+(num(s.fpts_decimal) ?? 0)/100 : num(meta.pointsFor) ?? 0,
                pointsAgainst:num(s.fpts_against) !== null ? s.fpts_against+(num(s.fpts_against_decimal) ?? 0)/100 : num(meta.pointsAgainst),
                form:[],currentResult:null,currentPoints:null,opponentPoints:null,opponentRosterId:null,medianResult:null,rankChange:null,baselineRank:null};
        }));
        const fallback = message => ({rows:officialRows,officialRows,baselineRows:[],week,status:'official',message,complete:false,median:null});
        const provider = String(league?.platform || league?.provider || '').toLowerCase();
        if (!league || league._mfl || league._mflLeagueId || league._espn || league._yahoo || (provider && provider !== 'sleeper') || App.Chopped?.isChopped?.(league) || options?.isChopped || league?.type === 'chopped' || league?.leagueSkin?.type === 'chopped') return fallback('Live standings are unavailable for this league format.');
        const start = Number(league.settings?.start_week) || 1;
        const playoff = Number(league.settings?.playoff_week_start) || 19;
        if (!Number.isInteger(week) || week < start || week > 18 || week >= playoff) return fallback('Official standings · outside the regular-season schedule.');
        const medianEnabled = Number(league.settings?.league_average_match) === 1;
        const rows = officialRows.map(r => ({...r,wins:0,losses:0,ties:0,pointsFor:0,pointsAgainst:0,form:[]}));
        const byId = new Map(rows.map(r => [id(r.rosterId),r]));
        if (byId.size !== rows.length || !rows.length) return fallback('The league roster list is unavailable.');
        const history = new Map(Array.isArray(priorWeeks) ? priorWeeks.map(w => [Number(w.week),w.rows]) : Object.entries(priorWeeks).map(([w,v]) => [Number(w),v]));
        function inspect(raw) {
            if (!Array.isArray(raw)) return null;
            const seen = new Set(), groups = new Map();
            for (const r of raw) {
                if (!r || !byId.has(id(r.roster_id)) || seen.has(id(r.roster_id))) return null;
                seen.add(id(r.roster_id));
                const key = r.matchup_id == null ? 'bye:'+r.roster_id : 'match:'+r.matchup_id;
                if (!groups.has(key)) groups.set(key,[]);
                groups.get(key).push(r);
            }
            if (seen.size !== rows.length || [...groups.values()].some(g => g.length > 2 || (g.length === 1 && g[0].matchup_id != null))) return null;
            return [...groups.values()];
        }
        function apply(groups, historical) {
            const startSet = startedRosterIds == null ? null : new Set(Array.from(startedRosterIds,id));
            let applied = false, pending = false;
            const all = groups.flat();
            const active = g => historical || (startSet ? g.some(r => startSet.has(id(r.roster_id))) : started);
            groups.forEach(g => {
                const valid = g.every(r => points(r) !== null), begun = active(g);
                if (!historical) g.forEach(r => {
                    const target=byId.get(id(r.roster_id)), opponent=g.find(x => x!==r);
                    target.currentPoints=points(r); target.opponentPoints=opponent ? points(opponent) : null; target.opponentRosterId=opponent?.roster_id ?? null;
                });
                if (!valid || !begun) { if (begun && !valid) pending=true; return; }
                applied=true;
                g.forEach(r => {
                    const target=byId.get(id(r.roster_id)), opponent=g.find(x => x!==r);
                    target.pointsFor+=points(r);
                    if (opponent) {
                        const outcome=result(points(r),points(opponent));
                        target.pointsAgainst+=points(opponent); add(target,outcome); target.form.push(outcome);
                        if (!historical) target.currentResult=outcome;
                    }
                });
            });
            let median=null;
            if (medianEnabled) {
                // The league-wide median needs every score, including bye teams.
                if (all.every(r => points(r)!==null) && groups.every(active)) {
                    const scores=all.map(points).sort((a,b)=>a-b), middle=Math.floor(scores.length/2);
                    median=scores.length%2 ? scores[middle] : (scores[middle-1]+scores[middle])/2;
                    all.forEach(r => {const target=byId.get(id(r.roster_id)), outcome=result(points(r),median); add(target,outcome); if(!historical) target.medianResult=outcome;});
                } else if (applied) pending=true;
            }
            return {applied,pending,median};
        }
        for (let w=start;w<week;w++) {
            const groups=inspect(history.get(w));
            if (!groups || groups.flat().some(r => points(r)===null)) return fallback('Complete scores before Week '+week+' are needed to calculate live standings.');
            apply(groups,true);
        }
        const baselineRows=rank(rows.map(r=>({...r,form:r.form.slice()})));
        const baselineRanks=new Map(baselineRows.map(r=>[id(r.rosterId),r.rank]));
        rows.forEach(r=>{r.baselineRank=baselineRanks.get(id(r.rosterId));});
        const groups=inspect(board?.rows ?? board?.groups?.flatMap(g=>g.teams));
        let state={applied:false,pending:false,median:null};
        const future=Number.isFinite(Number(currentWeek)) && week>Number(currentWeek);
        if (groups && !future && (board?.week == null || Number(board.week) === week)) state=apply(groups,false);
        else if (!future && (started || startedRosterIds?.length)) state.pending=true;
        const sorted=rank(rows);
        sorted.forEach(r=>{r.rankChange=r.rank!==null && r.baselineRank!==null ? r.baselineRank-r.rank : null;});
        const status=state.pending ? 'partial' : state.applied ? 'live' : 'baseline';
        return {rows:sorted,baselineRows,officialRows,week,status,median:state.median,complete:!state.pending,
            message:status==='partial' ? 'Some scores are unavailable or have not started; standings are provisional.' : status==='live' ? 'If the current scores hold · movement since entering Week '+week : 'Standings entering Week '+week};
    }
    // NFL weeks cross calendar weeks. Anchor the automatic phone board to the
    // current schedule's Sunday in football's Eastern time, not the device zone.
    function overviewWindow({ league, nflState = {}, week, currentWeek, games = [], now = Date.now() } = {}) {
        const season = Number(league?.season), liveSeason = Number(nflState.season);
        const phase = String(nflState.season_type || '').toLowerCase();
        const start = Number(league?.settings?.start_week) || 1;
        const playoff = Number(league?.settings?.playoff_week_start) || 19;
        if (!Number.isFinite(now) || !season || season !== liveSeason || ['pre', 'post', 'off'].includes(phase)
            || !Number.isInteger(week) || week !== currentWeek || week < start || week > 18 || week >= playoff) return false;
        const day = value => {
            if (value == null || value === '') return null;
            const date = new Date(value);
            if (!Number.isFinite(date.getTime())) return null;
            const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
            const read = name => Number(parts.find(part => part.type === name)?.value);
            const ordinal = Date.UTC(read('year'), read('month') - 1, read('day'));
            return { ordinal, weekday: new Date(ordinal).getUTCDay() };
        };
        const today = day(now);
        if (!today) return false;
        const scheduled = games.filter(game => !/CANCEL|POSTPONED/i.test(game.statusName || '')).map(game => day(game.kickoff)).filter(Boolean);
        const sundays = scheduled.filter(date => date.weekday === 0).map(date => date.ordinal);
        // A rare Saturday-only slate still opens on the following Sunday.
        const anchors = sundays.length ? sundays : scheduled.map(date => date.ordinal + (date.weekday <= 2 ? -date.weekday : 7 - date.weekday) * 86400000);
        if (anchors.length) {
            const sunday = Math.min(...anchors);
            return today.ordinal >= sunday && today.ordinal < sunday + 7 * 86400000;
        }
        // Schedule unavailable: keep the promised Sunday/Monday entry point,
        // without retaining a stale week indefinitely after the feed rolls over.
        return today.weekday === 0 || today.weekday === 1;
    }
    // Default provider rules: https://support.sleeper.com/en/articles/2203518-how-do-playoff-teams-get-determined
    // Qualification is separate from the live-score ledger. Standard Sleeper
    // seeding uses record percentage, PF, then higher PA; division winners take
    // the first seeds. A stable roster ID orders unresolved ties for display
    // only, and must never decide who is inside the field.
    function playoffPicture({ league, rows = [], baselineRows = [] } = {}) {
        const settings = league?.settings || {};
        const rowId = row => row?.rosterId ?? row?.roster_id;
        const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
        const record = row => {
            const values = [row?.wins, row?.losses, row?.ties ?? 0];
            if (!values.every(value => Number.isInteger(value) && value >= 0)) return null;
            const [wins, losses, ties] = values;
            return { credits: 2 * wins + ties, games: wins + losses + ties };
        };
        const compareRecord = (left, right) => {
            const a = record(left), b = record(right);
            return b.credits * (a.games || 1) - a.credits * (b.games || 1);
        };
        const stable = (left, right) => String(rowId(left)).localeCompare(String(rowId(right)));
        // Build whole tie groups before PA ordering. If any PA is missing, the
        // whole equal-record/PF group remains unresolved, avoiding a non-
        // transitive comparator that treats A = missing = B but A != B.
        const ordered = source => {
            const sorted = source.slice().sort((a, b) => compareRecord(a, b) || stable(a, b));
            const groups = [];
            for (let index = 0; index < sorted.length;) {
                let end = index + 1;
                while (end < sorted.length && compareRecord(sorted[index], sorted[end]) === 0) end++;
                const sameRecord = sorted.slice(index, end);
                if (sameRecord.some(row => numeric(row.pointsFor) === null)) groups.push(sameRecord.sort(stable));
                else {
                    sameRecord.sort((a, b) => b.pointsFor - a.pointsFor || stable(a, b));
                    for (let cursor = 0; cursor < sameRecord.length;) {
                        let stop = cursor + 1;
                        while (stop < sameRecord.length && sameRecord[cursor].pointsFor === sameRecord[stop].pointsFor) stop++;
                        const samePoints = sameRecord.slice(cursor, stop);
                        if (samePoints.some(row => numeric(row.pointsAgainst) === null)) groups.push(samePoints.sort(stable));
                        else {
                            samePoints.sort((a, b) => b.pointsAgainst - a.pointsAgainst || stable(a, b));
                            for (let pa = 0; pa < samePoints.length;) {
                                let next = pa + 1;
                                while (next < samePoints.length && samePoints[pa].pointsAgainst === samePoints[next].pointsAgainst) next++;
                                groups.push(samePoints.slice(pa, next));
                                pa = next;
                            }
                        }
                        cursor = stop;
                    }
                }
                index = end;
            }
            return groups;
        };
        const declarations = Number(settings.divisions || 0);
        const leagueRosters = league?.rosters || [];
        const rosterIds = leagueRosters.map(roster => roster?.roster_id);
        const rosterMap = new Map(leagueRosters.map(roster => [String(roster?.roster_id), roster]));
        const coversLeague = !leagueRosters.length || (rosterIds.every(rosterId => rosterId != null)
            && new Set(rosterIds.map(String)).size === rosterIds.length && rows.length === rosterIds.length
            && rows.every(row => rosterMap.has(String(rowId(row)))));
        const divisionOf = row => {
            const roster = rosterMap.get(String(rowId(row))), value = roster?.settings?.division;
            if (value == null || (typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Object.prototype.hasOwnProperty.call(roster.settings, 'division')) return null;
            const key = Number(value);
            return Number.isInteger(key) && key >= 0 ? String(key) : null;
        };
        const divisionKeys = [...new Set(rows.map(divisionOf).filter(key => key !== null))].sort((a, b) => Number(a) - Number(b));
        const hasDivisions = Number.isInteger(declarations) && declarations >= 2 && rows.length > 0
            && rows.every(row => divisionOf(row) !== null) && divisionKeys.length === declarations;
        const nameForDivision = key => league?.metadata?.['division_' + key + '_name'] || league?.metadata?.['division_' + key] || 'Division ' + key;
        const rankGroups = (groups, offset = 0) => {
            let position = offset;
            const played = groups.flat().some(row => record(row)?.games > 0);
            return groups.flatMap(group => {
                const displayRank = played ? position + 1 : null;
                position += group.length;
                return group.map(row => ({ ...row, displayRank }));
            });
        };
        const clone = row => ({ ...row, displayRank: null, displayBaselineRank: null, playoffState: null });
        const completeRecords = source => source.every(row => rowId(row) != null && record(row))
            && new Set(source.map(row => String(rowId(row)))).size === source.length;
        const baselineValid = baselineRows.length === rows.length && completeRecords(rows) && completeRecords(baselineRows)
            && rows.every(row => baselineRows.some(before => String(rowId(before)) === String(rowId(row))));
        const validRank = value => Number.isInteger(value) && value > 0 ? value : null;
        const no = note => {
            const current = completeRecords(rows) ? rankGroups(ordered(rows)) : [];
            const ranks = new Map(current.map(row => [String(rowId(row)), row.displayRank]));
            const before = baselineValid ? rankGroups(ordered(baselineRows)) : [];
            const beforeRanks = new Map(before.map(row => [String(rowId(row)), row.displayRank]));
            return { mode: 'none', slots: null, hasDivisions, note, leagueRows: rows.map(row => ({ ...clone(row),
                displayRank: validRank(row.rank) ?? ranks.get(String(rowId(row))) ?? null,
                displayBaselineRank: validRank(row.baselineRank) ?? beforeRanks.get(String(rowId(row))) ?? null })),
            divisions: hasDivisions ? divisionKeys.map(key => {
                const local = rows.filter(row => divisionOf(row) === key);
                const prior = baselineValid ? rankGroups(ordered(baselineRows.filter(row => divisionOf(row) === key))) : [];
                const previous = new Map(prior.map(row => [String(rowId(row)), row.displayRank]));
                return { key, name: nameForDivision(key), rows: (completeRecords(local) ? rankGroups(ordered(local)) : local.map(clone))
                    .map(row => ({ ...row, displayBaselineRank: previous.get(String(rowId(row))) ?? null, playoffState: null })) };
            }) : [], cutlineLabel: '' };
        };
        const provider = String(league?.platform || league?.provider || '').toLowerCase();
        if (!league || league._mfl || league._mflLeagueId || league._espn || league._yahoo || (provider && provider !== 'sleeper')
            || /^(mfl|espn|yahoo|manual|demo)_/.test(String(league?.league_id || league?.id || ''))
            || App.Chopped?.isChopped?.(league) || league.type === 'chopped' || league.leagueSkin?.type === 'chopped') return no('A standard playoff cutline is unavailable for this league format.');
        const slots = Number(settings.playoff_teams);
        // Explicitly disabled playoffs can leave an old field size behind.
        // A known noncompetitive field needs no verification warning.
        if (settings.playoff_week_start === 0 || (settings.playoff_teams != null && slots === 0)) return no('');
        if (!coversLeague) return no('Every league team needs a complete record before showing the playoff cutline.');
        if (rows.length > 0 && slots === rows.length) return no('All teams qualify.');
        if (settings.playoff_teams == null || !Number.isInteger(slots) || slots < 1 || slots >= rows.length) return no('A competitive playoff field has not been verified.');
        if (!completeRecords(rows)) return no('Complete team records are needed to show the playoff cutline.');
        const override = league.bracket_overrides_id;
        let mode = settings.playoff_seed_type === 0 && (override == null || String(override) === '0') ? 'standard' : 'record';
        const notes = [];
        if (mode === 'record') notes.push('Custom or unverified seeding rules may change the playoff field.');
        if (declarations > 0 && !hasDivisions) {
            mode = 'record';
            notes.push('Division data is incomplete; division rules may change the playoff field.');
        }
        if (hasDivisions && slots < divisionKeys.length) {
            mode = 'record';
            notes.push('There are fewer playoff places than divisions; division qualification rules need verification.');
        }
        const seedGroups = source => {
            const groups = ordered(source);
            if (!hasDivisions) return { groups, winners: new Set() };
            const winners = [];
            for (const key of divisionKeys) {
                const first = ordered(source.filter(row => divisionOf(row) === key))[0];
                if (!first || first.length !== 1) return null;
                winners.push(first[0]);
            }
            const winnerIds = new Set(winners.map(row => String(rowId(row))));
            return { groups: ordered(winners).concat(ordered(source.filter(row => !winnerIds.has(String(rowId(row)))))), winners: winnerIds };
        };
        let seeding = mode === 'standard' ? seedGroups(rows) : null;
        if (mode === 'standard' && !seeding) {
            mode = 'record';
            notes.push('A division lead is tied on the available tiebreaks; division rules may change the playoff field.');
        }
        if (mode === 'record' && hasDivisions && !notes.some(note => /[Dd]ivision/.test(note))) notes.push('Division rules may change the playoff field.');
        const groups = mode === 'standard' ? seeding.groups : ordered(rows);
        const ranked = rankGroups(groups);
        const states = new Map();
        let position = 0;
        groups.forEach(group => {
            const tied = position < slots && position + group.length > slots;
            group.forEach(row => states.set(String(rowId(row)), tied ? 'tied' : position < slots
                ? mode === 'standard' && hasDivisions ? seeding.winners.has(String(rowId(row))) ? 'division' : 'wildcard' : 'field'
                : 'outside'));
            position += group.length;
        });
        let baselineRanked = [];
        if (baselineValid) {
            const before = mode === 'standard' ? seedGroups(baselineRows) : { groups: ordered(baselineRows) };
            if (before) baselineRanked = rankGroups(before.groups);
        }
        const baselineRanks = new Map(baselineRanked.map(row => [String(rowId(row)), row.displayRank]));
        const complete = (row, displayBaselineRank) => ({ ...row, displayBaselineRank: displayBaselineRank ?? null, playoffState: states.get(String(rowId(row))) ?? null });
        const leagueRows = ranked.map(row => complete(row, baselineRanks.get(String(rowId(row)))));
        const divisions = hasDivisions ? divisionKeys.map(key => {
            const before = baselineValid ? rankGroups(ordered(baselineRows.filter(row => divisionOf(row) === key))) : [];
            const beforeRanks = new Map(before.map(row => [String(rowId(row)), row.displayRank]));
            return { key, name: nameForDivision(key), rows: rankGroups(ordered(rows.filter(row => divisionOf(row) === key)))
                .map(row => complete(row, beforeRanks.get(String(rowId(row))))) };
        }) : [];
        return { mode, slots, hasDivisions, note: notes.join(' '), leagueRows, divisions,
            cutlineLabel: mode === 'standard' ? 'Playoff cutline' : 'Top ' + slots + ' by record' };
    }
    App.LeagueLiveStandings={compute,overviewWindow,playoffPicture};
})(typeof window !== 'undefined' ? window : globalThis);
