// Public NFL reporting: preserve the provider's player columns and original
// scores. Summary requests are explicit; no news text or inferred injuries.
(function (root) {
    'use strict';
    const caches = new WeakMap();
    const num = value => value == null || typeof value === 'boolean' || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
    const text = value => typeof value === 'string' ? value.trim() : '';
    const abbr = value => ({ WSH: 'WAS', JAC: 'JAX', LA: 'LAR' }[String(value || '').toUpperCase()] || String(value || '').toUpperCase());
    const aborted = signal => { if (signal?.aborted) { const error = Error('Request canceled.'); error.name = 'AbortError'; throw error; } };
    const categories = { passing: 'Passing', rushing: 'Rushing', receiving: 'Receiving', fumbles: 'Fumbles', defensive: 'Defense', interceptions: 'Interceptions', kickReturns: 'Kick returns', puntReturns: 'Punt returns', kicking: 'Kicking', punting: 'Punting' };
    const endpoint = () => root.App?.NflContext?.endpoint?.() || '/api/nfl-scoreboard';
    async function request(query, { signal, force = false, fetcher = root.fetch, now = Date.now } = {}) {
        aborted(signal);
        if (typeof fetcher !== 'function') throw Error('NFL coverage is unavailable.');
        const url = query.startsWith('https://api.sleeper.com/stats/nfl/') ? query : endpoint() + (endpoint().includes('?') ? '&' : '?') + query;
        if (!caches.has(fetcher)) caches.set(fetcher, new Map());
        const cache = caches.get(fetcher), saved = cache.get(url);
        if (!force && saved && now() - saved.checkedAt < 60000) return saved;
        const controller = new root.AbortController();
        let timeout = false;
        const cancel = () => controller.abort();
        signal?.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(() => { timeout = true; controller.abort(); }, 18000);
        try {
            const response = await fetcher(url, { signal: controller.signal, credentials: 'omit', cache: 'no-store' });
            aborted(signal);
            if (!response.ok) throw Error(response.status === 429 ? 'NFL coverage is busy. Try again shortly.' : 'The latest NFL data could not load.');
            const data = await response.json();
            aborted(signal);
            if (!data || data.error) throw Error('The latest NFL data could not load.');
            const checkedAt = now(), reported = Date.parse(data._wire?.fetchedAt || '');
            const result = { data, checkedAt, updatedAt: Number.isFinite(reported) && reported <= checkedAt ? reported : null };
            cache.set(url, result);
            while (cache.size > 40) cache.delete(cache.keys().next().value);
            return result;
        } catch (error) {
            aborted(signal);
            if (timeout) throw Error('NFL coverage took too long to load. Try again.');
            throw error;
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
    }
    async function loadWeek({ phase, ...options }) {
        const season = String(phase?.season || ''), week = Number(phase?.week), type = Number(phase?.seasontype);
        if (!/^\d{4}$/.test(season) || !Number.isInteger(week) || week < 1 || week > 22 || ![1, 2, 3].includes(type)) throw Error('The current NFL week could not be verified.');
        const result = await request(`season=${season}&week=${week}&seasontype=${type}`, options);
        if (!Array.isArray(result.data.events)) throw Error('The NFL scoreboard could not be verified.');
        return { status: 'ready', games: root.App.NflContext.parseScores(result.data), checkedAt: result.checkedAt, updatedAt: result.updatedAt };
    }
    function parseSummary(data, game) {
        const event = String(game?.id || ''), competition = data?.header?.competitions?.[0];
        if (!/^\d{6,12}$/.test(event) || String(data?.header?.id) !== event || !competition) throw Error('Full player stats are unavailable from this feed. The scoring summary remains available.');
        const competitors = competition.competitors || [];
        const home = competitors.find(t => t.homeAway === 'home'), away = competitors.find(t => t.homeAway === 'away');
        if (!home || !away || abbr(home.team?.abbreviation) !== abbr(game.home) || abbr(away.team?.abbreviation) !== abbr(game.away)) throw Error('The returned box score does not match this game.');
        const validTeams = new Map(competitors.map(t => [String(t.team?.id || t.id), t]));
        const seenTeams = new Set();
        const teams = (data.boxscore?.players || []).filter(t => validTeams.has(String(t.team?.id))).map(t => {
            const id = String(t.team.id);
            if (seenTeams.has(id)) throw Error('The player box score contains duplicate teams.');
            seenTeams.add(id);
            const original = validTeams.get(id);
            const groups = (t.statistics || []).filter(s => categories[s.name] && Array.isArray(s.keys) && s.keys.length && new Set(s.keys).size === s.keys.length).map(s => ({
                id: s.name, label: categories[s.name], columns: s.keys.map((key, i) => ({ key, label: text(s.labels?.[i]) || key, description: text(s.descriptions?.[i]) || text(s.labels?.[i]) || key })),
                players: (s.athletes || []).filter(a => text(a.athlete?.displayName) && Array.isArray(a.stats)).map(a => ({ id: String(a.athlete.id || a.athlete.displayName), name: a.athlete.displayName,
                    values: s.keys.map((key, i) => a.stats[i] == null || String(a.stats[i]).trim() === '' ? null : String(a.stats[i])),
                    stats: Object.fromEntries(s.keys.map((key, i) => [key, a.stats[i] == null ? null : String(a.stats[i])])) })),
            }));
            return { id, name: original.team.displayName || original.team.abbreviation, abbr: abbr(original.team.abbreviation), groups };
        }).sort((a, b) => (a.abbr === abbr(game.away) ? -1 : b.abbr === abbr(game.away) ? 1 : 0));
        const status = competition.status?.type || {};
        const summaryGame = { id: event, home: abbr(home.team.abbreviation), away: abbr(away.team.abbreviation), homeName: home.team.displayName, awayName: away.team.displayName,
            homeScore: num(home.score), awayScore: num(away.score), completed: !!status.completed, state: status.state, shortDetail: status.shortDetail };
        const statNames = ['firstDowns', 'totalYards', 'netPassingYards', 'rushingYards', 'turnovers', 'thirdDownEff', 'fourthDownEff', 'possessionTime'];
        const teamStats = (data.boxscore?.teams || []).filter(t => validTeams.has(String(t.team?.id))).map(t => ({ abbr: abbr(validTeams.get(String(t.team.id)).team.abbreviation), stats: (t.statistics || []).filter(s => statNames.includes(s.name)).map(s => ({ key: s.name, label: text(s.label) || s.name, value: s.displayValue == null ? null : String(s.displayValue) })) }));
        return { eventId: event, game: summaryGame, teams, teamStats, statsSource: 'ESPN', status: teams.some(t => t.groups.some(g => g.players.length)) ? 'ready' : 'empty', source: `https://www.espn.com/nfl/boxscore/_/gameId/${event}` };
    }
    const sleeperColumns = {
        passing: [['pass_cmp', 'CMP', 'Completions'], ['pass_att', 'ATT', 'Pass attempts'], ['pass_yd', 'YDS', 'Passing yards', 'passingYards'], ['pass_td', 'TD', 'Passing touchdowns', 'passingTouchdowns'], ['pass_int', 'INT', 'Interceptions'], ['pass_sack', 'SACK', 'Times sacked']],
        rushing: [['rush_att', 'CAR', 'Carries', 'rushingAttempts'], ['rush_yd', 'YDS', 'Rushing yards', 'rushingYards'], ['rush_td', 'TD', 'Rushing touchdowns', 'rushingTouchdowns'], ['rush_lng', 'LONG', 'Longest rush']],
        receiving: [['rec', 'REC', 'Receptions', 'receptions'], ['rec_tgt', 'TGTS', 'Receiving targets', 'receivingTargets'], ['rec_yd', 'YDS', 'Receiving yards', 'receivingYards'], ['rec_td', 'TD', 'Receiving touchdowns', 'receivingTouchdowns'], ['rec_lng', 'LONG', 'Longest reception']],
        fumbles: [['fum', 'FUM', 'Fumbles'], ['fum_lost', 'LOST', 'Fumbles lost']],
        defensive: [['idp_tkl_solo', 'SOLO', 'Solo tackles'], ['idp_tkl_ast', 'AST', 'Assisted tackles'], ['idp_sack', 'SACK', 'Sacks'], ['idp_int', 'INT', 'Interceptions'], ['idp_pass_def', 'PD', 'Passes defended'], ['idp_def_td', 'TD', 'Defensive touchdowns']],
        kicking: [['fgm', 'FGM', 'Field goals made'], ['fga', 'FGA', 'Field goals attempted'], ['fgm_lng', 'LONG', 'Longest field goal'], ['xpm', 'XPM', 'Extra points made'], ['xpa', 'XPA', 'Extra points attempted']],
    };
    function parseSleeper(rows, game) {
        const year = String(game.season || ''), week = Number(game.week), phase = ({ 1: 'pre', 2: 'regular', 3: 'post' })[game.seasontype];
        if (!Array.isArray(rows) || !/^\d{4}$/.test(year) || !Number.isInteger(week) || !phase || !Number.isFinite(Date.parse(game.kickoff || ''))) throw Error('This game’s player-stat edition could not be verified.');
        const kickoff = new Date(game.kickoff), dates = new Set([kickoff.toISOString().slice(0, 10), new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(kickoff)]);
        const home = abbr(game.home), away = abbr(game.away);
        const matching = rows.filter(r => String(r.season) === year && Number(r.week) === week && r.season_type === phase && r.category === 'stat' && dates.has(r.date)
            && ((abbr(r.team) === home && abbr(r.opponent) === away) || (abbr(r.team) === away && abbr(r.opponent) === home)));
        const gameIds = new Set(matching.map(r => String(r.game_id || '')).filter(Boolean));
        if (gameIds.size !== 1 || matching.some(r => !r.game_id) || ![home, away].every(team => matching.some(r => abbr(r.team) === team))) throw Error('The player stats could not be matched to both teams and this game date.');
        const teams = [{ id: away, abbr: away, name: game.awayName || away }, { id: home, abbr: home, name: game.homeName || home }].map(team => {
            const unique = new Map();
            matching.filter(r => abbr(r.team) === team.abbr && /^\d+$/.test(String(r.player_id || '')) && r.player?.position !== 'DEF' && r.stats && (r.player?.first_name || r.player?.last_name)).forEach(r => {
                if (unique.has(String(r.player_id)) && JSON.stringify(unique.get(String(r.player_id)).stats) !== JSON.stringify(r.stats)) throw Error('Conflicting player stat rows could not be verified.');
                unique.set(String(r.player_id), r);
            });
            const groups = Object.entries(sleeperColumns).map(([id, columns]) => ({ id, label: categories[id], columns: columns.map(([key, label, description, canonical]) => ({ key: canonical || key, label, description })),
                players: [...unique.values()].filter(r => columns.some(([key]) => num(r.stats[key]) != null)).map(r => ({ id: String(r.player_id), name: [r.player.first_name, r.player.last_name].filter(Boolean).join(' '),
                    values: columns.map(([key]) => num(r.stats[key]) == null ? null : String(r.stats[key])), stats: Object.fromEntries(columns.map(([key, , , canonical]) => [canonical || key, num(r.stats[key]) == null ? null : String(r.stats[key])])) })).sort((a, b) => {
                        const rankKey = ({ passing: 'passingYards', rushing: 'rushingYards', receiving: 'receivingYards', fumbles: 'fum', defensive: 'idp_tkl_solo', kicking: 'fgm' })[id];
                        return (num(b.stats[rankKey]) || 0) - (num(a.stats[rankKey]) || 0) || a.name.localeCompare(b.name);
                    }),
            }));
            return { ...team, groups };
        });
        return { eventId: String(game.id), providerGameId: [...gameIds][0], game: { ...game }, teams, teamStats: [], statsSource: 'Sleeper',
            status: teams.some(t => t.groups.some(g => g.players.length)) ? 'ready' : 'empty', source: `https://api.sleeper.com/stats/nfl/${year}/${week}?season_type=${phase}` };
    }
    async function loadBoxScore({ game, ...options }) {
        if (!/^\d{6,12}$/.test(String(game?.id || ''))) throw Error('A verified game ID is needed to open player stats.');
        const phase = ({ 1: 'pre', 2: 'regular', 3: 'post' })[game.seasontype];
        if (/^\d{4}$/.test(String(game.season)) && Number.isInteger(Number(game.week)) && Number(game.week) > 0 && Number(game.week) <= 22 && phase) {
            try {
                const result = await request(`https://api.sleeper.com/stats/nfl/${game.season}/${Number(game.week)}?season_type=${phase}`, options);
                return { ...parseSleeper(result.data, game), checkedAt: result.checkedAt, updatedAt: null };
            } catch (error) { aborted(options.signal); /* A verified ESPN summary is the alternate source. */ }
        }
        const result = await request('event=' + game.id, options);
        return { ...parseSummary(result.data, game), checkedAt: result.checkedAt, updatedAt: result.updatedAt };
    }
    function quarterContext(game) {
        const home = game.homePeriods || [], away = game.awayPeriods || [];
        if (!game.completed || home.length < 4 || home.length !== away.length) return '';
        const valid = rows => rows.every((p, i) => p.period === i + 1 && num(p.value) != null && num(p.value) >= 0);
        if (!valid(home) || !valid(away) || home.reduce((n, p) => n + Number(p.value), 0) !== num(game.homeScore) || away.reduce((n, p) => n + Number(p.value), 0) !== num(game.awayScore) || game.homeScore === game.awayScore) return '';
        const winnerHome = Number(game.homeScore) > Number(game.awayScore), w = winnerHome ? home : away, l = winnerHome ? away : home;
        const name = winnerHome ? game.homeName || game.home : game.awayName || game.away;
        const sum = (rows, end) => rows.slice(0, end).reduce((n, p) => n + Number(p.value), 0);
        if (sum(w, 3) < sum(l, 3)) return `${name} erased a ${sum(l, 3) - sum(w, 3)}-point deficit after three quarters.`;
        if (sum(w, 2) < sum(l, 2)) return `${name} trailed ${sum(l, 2)}–${sum(w, 2)} at halftime, then outscored the opposition ${sum(w, w.length) - sum(w, 2)}–${sum(l, l.length) - sum(l, 2)} the rest of the way.`;
        const secondW = sum(w, w.length) - sum(w, 2), secondL = sum(l, l.length) - sum(l, 2);
        if (secondW - secondL >= 10) return `${name} outscored the opposition ${secondW}–${secondL} after halftime.`;
        const decisive = w.map((p, i) => ({ period: i + 1, own: Number(p.value), opp: Number(l[i].value) })).filter(p => p.period <= 4 && p.own >= 14 && p.own - p.opp >= 10).sort((a, b) => (b.own - b.opp) - (a.own - a.opp))[0];
        return decisive ? `A ${decisive.own}–${decisive.opp} ${['first', 'second', 'third', 'fourth'][decisive.period - 1]} quarter stands out on ${name}’s scoring line.` : '';
    }
    function performances(box) {
        const out = [];
        (box?.teams || []).forEach(team => team.groups.filter(g => ['passing', 'rushing', 'receiving'].includes(g.id)).forEach(group => group.players.forEach(player => {
            const s = player.stats, passing = group.id === 'passing', rushing = group.id === 'rushing';
            const yards = num(s[passing ? 'passingYards' : rushing ? 'rushingYards' : 'receivingYards']);
            if (yards == null) return;
            const touchdowns = num(s[passing ? 'passingTouchdowns' : rushing ? 'rushingTouchdowns' : 'receivingTouchdowns']);
            const catches = num(s.receptions), attempts = num(s.rushingAttempts), targets = num(s.receivingTargets);
            let line = passing ? `${player.name} threw for ${yards} yards` : rushing ? `${player.name} ran for ${yards} yards` : catches != null ? `${player.name} caught ${catches} pass${catches === 1 ? '' : 'es'} for ${yards} yards` : `${player.name} had ${yards} receiving yards`;
            if (touchdowns > 0) line += ` and ${touchdowns} touchdown${touchdowns === 1 ? '' : 's'}`;
            if (rushing && attempts != null) line += ` on ${attempts} carr${attempts === 1 ? 'y' : 'ies'}`;
            if (!passing && !rushing && targets != null) line += ` on ${targets} target${targets === 1 ? '' : 's'}`;
            out.push({ id: player.id, team: team.abbr, text: line + '.', weight: (touchdowns || 0) * 80 + yards / (passing ? 3 : 1) });
        })));
        return out.sort((a, b) => b.weight - a.weight);
    }
    function recap(game, box) {
        const h = num(game.homeScore), a = num(game.awayScore), final = game.completed && h != null && a != null;
        if (!final) return { headline: game.state === 'in' ? 'In progress' : '', body: '', spotlight: [] };
        const winnerHome = h > a, winner = winnerHome ? game.homeName || game.home : game.awayName || game.away, loser = winnerHome ? game.awayName || game.away : game.homeName || game.home;
        const headline = h === a ? `${game.away} and ${game.home} finish level at ${h}` : `${winner} ${Math.abs(h - a) <= 3 ? 'edge' : 'beat'} ${loser}, ${Math.max(h, a)}–${Math.min(h, a)}${/OT/i.test(game.shortDetail || '') ? ' in overtime' : ''}`;
        const compatible = box?.game?.completed && box.game.homeScore === h && box.game.awayScore === a;
        const candidates = compatible ? performances(box) : [];
        const seen = new Set();
        const spotlight = candidates.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; }).slice(0, 2).map(p => p.text);
        if (!spotlight.length) {
            const leader = (game.leaders || []).find(l => l.name && l.stats && l.category === 'Receiving') || (game.leaders || []).find(l => l.name && l.stats);
            if (leader) spotlight.push(`${leader.name}: ${leader.stats}${leader.team ? ` (${leader.team})` : ''}.`);
        }
        return { headline, body: quarterContext(game), spotlight };
    }
    root.WrWireNfl = { loadWeek, loadBoxScore, parseSummary, parseSleeper, recap };
})(typeof window !== 'undefined' ? window : globalThis);
