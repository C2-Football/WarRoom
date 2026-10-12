// Compact, league-scored observations for an expanded roster player.
(function (root) {
    'use strict';
    const h = React.createElement;
    const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
    const fmt = (value, digits) => finite(value) === null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: digits ?? 1, minimumFractionDigits: digits ?? 0 });
    const position = value => root.App?.LeagueStats?.normalizePosition(value) || String(value || '').toUpperCase();
    const first = (raw, keys) => {
        for (const key of keys) { const value = finite(raw?.[key]); if (value !== null) return value; }
        return null;
    };
    const metric = (label, title, ...keys) => ({ label, title, value: raw => first(raw, keys) });
    const isMflLeague = league => ['mfl'].includes(String(league?._source || league?._platform || league?.platform || '').toLowerCase()) || /^mfl_/i.test(String(league?.league_id || league?.id || ''));
    const scoringKey = scoring => JSON.stringify(Object.entries(scoring || {}).sort(([a], [b]) => a.localeCompare(b)));
    function nativeScore(raw, scoring, season, week) {
        const actual = raw?._mflScoring;
        return actual && actual.scoringKey === scoringKey(scoring) && String(actual.season) === String(season)
            && (week == null ? actual.week == null : Number(actual.week) === Number(week)) ? actual : null;
    }
    function statsClient(engine, league, playersData, pid, player) {
        if (!isMflLeague(league) || typeof root.MFL?.loadPlayerStats !== 'function') return engine;
        // The MFL adapter uses this snapshot to map native IDs. Do not let a
        // later league load change the crosswalk while requests are in flight.
        const players = Object.fromEntries(Object.entries({ ...(playersData || {}), [pid]: player }).map(([id, value]) => [id, { _mfl_id: value?._mfl_id || /^mfl_(\d+)$/.exec(id)?.[1] }]));
        const client = {
            load: opts => root.MFL.loadPlayerStats(league, { season: opts.season, week: opts.week ?? null, players, force: opts.force }),
            async loadGameLog(opts) {
                const weeks = [...new Set(opts.weeks.map(Number))].sort((a, b) => a - b), rows = new Array(weeks.length);
                let next = 0;
                await Promise.all(Array.from({ length: Math.min(3, weeks.length) }, async () => {
                    while (next < weeks.length) {
                        const index = next++, week = weeks[index];
                        try {
                            const result = await client.load({ season: opts.season, week, force: opts.force });
                            rows[index] = { week, raw: result.statsByPid[String(opts.pid)] || null, error: result.error || null };
                        } catch (error) { rows[index] = { week, raw: null, error: error?.message || 'Could not load' }; }
                    }
                }));
                return rows;
            }
        };
        return client;
    }
    function columns(pos) {
        switch (position(pos)) {
            case 'QB': return [metric('PYD', 'Passing yards', 'pass_yd'), metric('PTD', 'Passing touchdowns', 'pass_td'), metric('INT', 'Interceptions thrown', 'pass_int'), metric('RYD', 'Rushing yards', 'rush_yd')];
            case 'RB': return [metric('CAR', 'Rushing attempts', 'rush_att'), metric('RYD', 'Rushing yards', 'rush_yd'), metric('REC', 'Receptions', 'rec'), metric('RTD', 'Rushing touchdowns', 'rush_td')];
            case 'WR': case 'TE': return [metric('TGT', 'Targets', 'rec_tgt', 'tgt'), metric('REC', 'Receptions', 'rec'), metric('YDS', 'Receiving yards', 'rec_yd'), metric('TD', 'Receiving touchdowns', 'rec_td')];
            case 'K': return [metric('FG', 'Field goals made', 'fgm'), metric('ATT', 'Field goal attempts', 'fga'), metric('XP', 'Extra points made', 'xpm')];
            case 'DEF': return [metric('SCK', 'Sacks', 'sack'), metric('INT', 'Interceptions', 'int'), metric('PA', 'Points allowed', 'pts_allow'), metric('FR', 'Fumbles recovered', 'fum_rec')];
            default: return [
                { label: 'TKL', title: 'Total tackles', value: raw => {
                    const total = first(raw, ['idp_tkl', 'tkl']);
                    if (total !== null) return total;
                    const solo = first(raw, ['idp_tkl_solo', 'tkl_solo']), assisted = first(raw, ['idp_tkl_ast', 'tkl_ast']);
                    return solo !== null && assisted !== null ? solo + assisted : null;
                } },
                metric('SCK', 'Sacks', 'idp_sack', 'sack'), metric('INT', 'Interceptions', 'idp_int', 'int'), metric('TFL', 'Tackles for loss', 'idp_tkl_loss', 'tkl_loss')
            ];
        }
    }
    function seasonYears(player, latest, initial) {
        const rookie = Number(player?.rookie_year);
        const experience = Math.max(0, Math.min(29, Number(player?.years_exp) || 0));
        const start = Number.isInteger(rookie) && rookie >= latest - 29 && rookie <= latest ? rookie : latest - experience;
        const years = Array.from({ length: latest - start + 1 }, (_, i) => latest - i);
        if (!years.includes(initial)) years.push(initial);
        return years.sort((a, b) => b - a);
    }
    function weeksForSeason(season, latest, state) {
        const count = Number(season) < latest ? 18 : Number(season) > latest ? 0 : Math.min(18, Math.max(0, Number(state?.week) || 0));
        return Array.from({ length: count }, (_, i) => i + 1);
    }
    async function loadCareer(engine, pid, years, force) {
        const rows = new Array(years.length);
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(3, years.length) }, async () => {
            while (next < years.length) {
                const index = next++, season = years[index];
                try {
                    const result = await engine.load({ season, force });
                    rows[index] = { season, raw: result.statsByPid[String(pid)] || null, error: result.error || null };
                } catch (error) { rows[index] = { season, raw: null, error: error?.message || 'Could not load' }; }
            }
        }));
        return rows;
    }
    function RosterPlayerStats({ pid, pos, player, playersData, currentLeague = {}, leagueType, phone }) {
        player = player || playersData?.[pid] || {};
        const engine = root.App?.LeagueStats;
        const latest = Number(root.S?.nflState?.season) || new Date().getFullYear();
        const initial = Number(currentLeague.season) || latest;
        const mfl = isMflLeague(currentLeague);
        const type = leagueType || root.App?.LeagueSkin?.build?.({ league: currentLeague })?.type;
        const defaultMode = ['redraft', 'chopped'].includes(type) ? 'weekly' : 'season';
        const context = [pid, currentLeague.league_id || currentLeague.id || '', initial, type].join('|');
        const [selection, setSelection] = React.useState({ context, mode: defaultMode, season: initial });
        const selected = selection.context === context ? selection : { context, mode: defaultMode, season: initial };
        const { mode, season } = selected;
        const [revision, setRevision] = React.useState(0);
        const [load, setLoad] = React.useState({ key: '', status: 'loading', rows: [] });
        const [expanded, setExpanded] = React.useState(null);
        const years = seasonYears(player, latest, initial);
        const requestKey = [context, mode, season, scoringKey(currentLeague.scoring_settings), mfl ? 'mfl' : 'nfl'].join('|');
        const update = values => { setSelection({ ...selected, ...values }); setExpanded(null); };
        React.useEffect(() => {
            let alive = true;
            setExpanded(null);
            setLoad({ key: requestKey, status: 'loading', rows: [] });
            async function run() {
                const client = statsClient(engine, currentLeague, playersData, pid, player);
                if (!client?.load || !client?.loadGameLog) throw new Error('Stats are unavailable.');
                if (mode === 'weekly') return client.loadGameLog({ pid, season, weeks: weeksForSeason(season, latest, root.S?.nflState), force: revision > 0 });
                if (mode === 'career') return loadCareer(client, pid, years.filter(year => year <= season && year <= latest), revision > 0);
                if (season > latest) return [];
                const result = await client.load({ season, force: revision > 0 });
                return [{ season, raw: result.statsByPid[String(pid)] || null, error: result.error || null }];
            }
            run().then(rows => { if (alive) setLoad({ key: requestKey, status: 'ready', rows }); }).catch(() => { if (alive) setLoad({ key: requestKey, status: 'error', rows: [] }); });
            return () => { alive = false; };
        }, [engine, requestKey, revision, latest, root.S?.nflState?.week, root.MFL?.loadPlayerStats]);
        const p = position(pos || player.position);
        const scoring = currentLeague.scoring_settings;
        const points = (raw, year, week) => mfl ? finite(nativeScore(raw, scoring, year, week)?.points) : raw && engine?.score ? engine.score(raw, scoring, p) : null;
        const average = (raw, year, fpts, gp) => mfl ? finite(nativeScore(raw, scoring, year, null)?.average) : gp > 0 && finite(fpts) !== null ? fpts / gp : null;
        const cols = columns(p);
        const additional = detailMetrics(p).filter(col => !cols.some(visible => visible.title === col.title));
        const rows = load.key === requestKey ? load.rows : [];
        const retry = () => setRevision(value => value + 1);
        const statCells = raw => cols.map(col => h('td', { key: col.label, title: col.title }, fmt(col.value(raw))));
        const details = (raw, key, span) => expanded !== key ? null : h('tr', { key: key + '-detail', className: 'wr-player-stats-detail' }, h('td', { colSpan: span },
            h('dl', null, detailMetrics(p).map(col => h('div', { key: col.title }, h('dt', null, col.title), h('dd', null, fmt(col.value(raw))))))));
        let content;
        if (load.key !== requestKey || load.status === 'loading') content = h('p', { role: 'status', className: 'wr-player-stats-message' }, 'Loading stats…');
        else if (load.status === 'error') content = h('p', { role: 'alert', className: 'wr-player-stats-message' }, 'Stats could not load. ', h('button', { onClick: retry }, 'Retry'));
        else if (!rows.length) content = h('p', { className: 'wr-player-stats-message' }, 'No regular-season stats available yet.');
        else if (mode === 'season') {
            const raw = rows[0].raw, fpts = points(raw, season, null), gp = finite(raw?.gp);
            content = raw ? h(React.Fragment, null,
                h('dl', { className: 'wr-player-stats-summary' }, [
                    ['FPTS', fmt(fpts, 1)], ['PPG', fmt(average(raw, season, fpts, gp), 1)], ['GP', fmt(gp)]
                ].map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, value)))),
                h('table', null, h('thead', null, h('tr', null, cols.map(col => h('th', { key: col.label, scope: 'col', title: col.title }, col.label)))), h('tbody', null, h('tr', null, ...statCells(raw)))),
                additional.length ? h('details', { className: 'wr-player-season-detail' }, h('summary', null, 'More stats'), h('dl', null, additional.map(col => h('div', { key: col.title }, h('dt', null, col.title), h('dd', null, fmt(col.value(raw))))))) : null)
                : h('p', { className: 'wr-player-stats-message' }, 'No stats reported for this season.');
        } else if (mode === 'career') {
            content = h('table', null,
                h('thead', null, h('tr', null, ['Year', 'GP', 'PPG', 'FPTS'].map(label => h('th', { key: label, scope: 'col' }, label)))),
                h('tbody', null, rows.map(row => {
                    const key = 'y' + row.season, gp = finite(row.raw?.gp), fpts = points(row.raw, row.season, null);
                    return h(React.Fragment, { key }, h('tr', null,
                        h('th', { scope: 'row' }, h('button', { onClick: () => setExpanded(expanded === key ? null : key), 'aria-expanded': expanded === key, 'aria-label': row.season + ' stat line' }, row.season)),
                        h('td', null, fmt(gp)), h('td', null, fmt(average(row.raw, row.season, fpts, gp), 1)), h('td', { className: 'wr-player-fpts' }, fmt(fpts, 1))), details(row.raw, key, 4));
                })));
        } else {
            content = h('table', null,
                h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Wk'), h('th', { scope: 'col' }, 'FPTS'), ...cols.map(col => h('th', { key: col.label, scope: 'col', title: col.title }, col.label)))),
                h('tbody', null, rows.slice().sort((a, b) => b.week - a.week).map(row => {
                    const key = 'w' + row.week;
                    return h(React.Fragment, { key }, h('tr', null,
                        h('th', { scope: 'row' }, h('button', { onClick: () => setExpanded(expanded === key ? null : key), 'aria-expanded': expanded === key, 'aria-label': 'Week ' + row.week + ' stat line' }, row.week)),
                        h('td', { className: 'wr-player-fpts' }, fmt(points(row.raw, season, row.week), 1)),
                        ...(row.raw ? statCells(row.raw) : [h('td', { key: 'status', colSpan: cols.length, className: 'wr-player-week-status' }, row.error ? 'Could not load' : 'No stats reported')])
                    ), details(row.raw, key, cols.length + 2));
                })));
        }
        const incomplete = rows.some(row => row.error);
        return h('section', { className: 'wr-player-stats' + (phone ? ' is-phone' : ''), 'aria-label': 'Player NFL stats' },
            h('div', { className: 'wr-player-stats-top' }, h('h4', null, 'NFL stats'), h('select', { value: season, 'aria-label': 'Roster player stats season', onChange: event => update({ season: Number(event.target.value) }) }, years.map(year => h('option', { key: year, value: year }, year)))),
            h('div', { className: 'wr-player-stats-tabs', role: 'group', 'aria-label': 'Player stats view' }, ['weekly', 'season', 'career'].map(view => h('button', { key: view, 'aria-pressed': mode === view, onClick: () => update({ mode: view }) }, view[0].toUpperCase() + view.slice(1)))),
            content,
            incomplete ? h('p', { role: 'alert', className: 'wr-player-stats-message' }, 'Some stats could not load. ', h('button', { onClick: retry }, 'Retry')) : null,
            h('p', { className: 'wr-player-stats-note' }, (mode === 'career' ? 'Through ' + season : season) + (mfl ? ' · MFL scoring' : ' · League scoring') + ' · — unavailable'));
    }
    function detailMetrics(pos) {
        if (pos === 'QB') return [metric('ATT', 'Pass attempts', 'pass_att'), metric('CMP', 'Completions', 'pass_cmp'), metric('CAR', 'Carries', 'rush_att'), metric('RTD', 'Rush touchdowns', 'rush_td'), metric('FL', 'Fumbles lost', 'fum_lost')];
        if (['RB', 'WR', 'TE'].includes(pos)) return [metric('TGT', 'Targets', 'rec_tgt', 'tgt'), metric('REC', 'Receptions', 'rec'), metric('YDS', 'Receiving yards', 'rec_yd'), metric('TD', 'Receiving touchdowns', 'rec_td'), metric('CAR', 'Carries', 'rush_att'), metric('RYD', 'Rushing yards', 'rush_yd'), metric('RTD', 'Rush touchdowns', 'rush_td'), metric('FL', 'Fumbles lost', 'fum_lost')];
        return columns(pos);
    }
    root.RosterPlayerStats = RosterPlayerStats;
    root.RosterPlayerStatsData = { columns, seasonYears, weeksForSeason, loadCareer, statsClient, nativeScore };
})(window);
