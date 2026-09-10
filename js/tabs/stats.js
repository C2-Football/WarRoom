// Full player-stat workspace. Analytics owns comparisons and strategy;
// this destination owns the searchable, complete underlying stat ledger.
function LeagueStatsTab({ currentLeague, myRoster, playersData, getOwnerName, getPlayerName }) {
    const engine = window.App.LeagueStats;
    const season = String(currentLeague?.season || new Date().getFullYear());
    const [selectedPid, setSelectedPid] = React.useState(null);
    const [gameLog, setGameLog] = React.useState({ key: '', status: 'idle', rows: [] });
    const [scope, setScope] = React.useState('season');
    const [week, setWeek] = React.useState(() => window.App?.LeagueLiveScores?.currentWeek(currentLeague) || 1);
    const [search, setSearch] = React.useState('');
    const [position, setPosition] = React.useState('');
    const [team, setTeam] = React.useState('');
    const [ownership, setOwnership] = React.useState('');
    const [owner, setOwner] = React.useState('');
    const [filtersOpen, setFiltersOpen] = React.useState(false);
    const [perGame, setPerGame] = React.useState(false);
    const [metricQuery, setMetricQuery] = React.useState('');
    const [metricGroup, setMetricGroup] = React.useState('');
    const [selected, setSelected] = React.useState(() => [...new Set(engine.PRESETS.general)].filter(key => key !== 'fantasyPoints'));
    const [sort, setSort] = React.useState({ key: 'fantasyPoints', direction: -1 });
    const [page, setPage] = React.useState(0);
    const [revision, setRevision] = React.useState(0);
    const [load, setLoad] = React.useState({ key: '', status: 'loading', data: null, error: null });
    const requestKey = `${season}|${scope === 'week' ? week : 'season'}`;
    React.useEffect(() => {
        let alive = true, pending = false;
        const fetchStats = (force) => {
            if (!alive || pending) return;
            pending = true;
            setLoad(previous => ({ key: requestKey, status: 'loading', data: previous.key === requestKey ? previous.data : null, error: null }));
            engine.load({ season, week: scope === 'week' ? week : null, force })
                .then(data => { if (alive) setLoad({ key: requestKey, status: 'ready', data, error: null }); })
                .catch(error => { if (alive) setLoad(previous => ({ ...previous, status: 'error', error })); })
                .finally(() => { pending = false; });
        };
        fetchStats(revision > 0);
        const currentSeason = String(window.S?.nflState?.season || new Date().getFullYear());
        const currentWeek = window.App?.LeagueLiveScores?.currentWeek(currentLeague) || 1;
        const isCurrent = season === currentSeason && (scope === 'season' || week === currentWeek);
        const refreshVisible = () => { if (isCurrent && document.visibilityState !== 'hidden') fetchStats(true); };
        const timer = isCurrent ? setInterval(refreshVisible, 60000) : null;
        if (isCurrent) document.addEventListener('visibilitychange', refreshVisible);
        return () => { alive = false; if (timer) clearInterval(timer); if (isCurrent) document.removeEventListener('visibilitychange', refreshVisible); };
    }, [requestKey, revision]);
    const data = load.key === requestKey ? load.data : null;
    const allRows = React.useMemo(() => engine.buildRows({ statsByPid: data?.statsByPid || {}, playersData, league: currentLeague }), [data, playersData, currentLeague]);
    const allMetrics = React.useMemo(() => engine.metrics(data?.statsByPid || {}), [data]);
    const metricByKey = React.useMemo(() => Object.fromEntries(allMetrics.map(metric => [metric.key, metric])), [allMetrics]);
    const detailPlayer = allRows.find(row => row.pid === selectedPid);
    React.useEffect(() => {
        if (!selectedPid || !engine.loadGameLog) return;
        let alive = true;
        const key = `${season}|${selectedPid}`;
        setGameLog({ key, status: 'loading', rows: [] });
        engine.loadGameLog({ pid: selectedPid, season, force: revision > 0, weeks: Array.from({ length: season === String(window.S?.nflState?.season || new Date().getFullYear()) ? (window.App?.LeagueLiveScores?.currentWeek(currentLeague) || 1) : 18 }, (_, index) => index + 1) })
            .then(rows => { if (alive) setGameLog({ key, status: 'ready', rows }); })
            .catch(() => { if (alive) setGameLog({ key, status: 'error', rows: [] }); });
        return () => { alive = false; };
    }, [selectedPid, season, data?.updatedAt]);
    const presetKeys = key => [...new Set(['gp', ...(engine.PRESETS?.[key] || [])])].filter(key => key !== 'fantasyPoints');
    const activePreset = Object.keys(engine.PRESETS || {}).find(key => presetKeys(key).join('|') === [...new Set(selected)].filter(key => key !== 'fantasyPoints').join('|')) || '';
    const columns = [...new Set(selected)].map(key => metricByKey[key]).filter(metric => metric && metric.key !== 'fantasyPoints');
    const metricOptions = engine.filterMetrics(allMetrics, { query: metricQuery, group: metricGroup || undefined }).filter(metric => metric.key !== 'fantasyPoints');
    const value = (row, key) => metricByKey[key] ? engine.value(row, metricByKey[key], { perGame }) : null;
    const format = (row, metric) => {
        const result = engine.value(row, metric, { perGame });
        if (result == null || !Number.isFinite(Number(result))) return '—';
        if (engine.format) return engine.format(result, metric, { perGame });
        if (metric.format === 'pct') return `${(Number(result) * 100).toFixed(1)}%`;
        return Number(result).toLocaleString(undefined, { maximumFractionDigits: metric.key === 'fantasyPoints' ? 2 : (perGame || metric.format === 'dec1' || metric.rate ? 2 : 1) });
    };
    const filtered = allRows.filter(row => {
        const text = `${row.name} ${row.team} ${row.position}`.toLowerCase();
        return (!search.trim() || text.includes(search.trim().toLowerCase())) && (!position || row.position === position)
            && (!team || row.team === team) && (!ownership || (ownership === 'rostered' ? row.rostered : !row.rostered))
            && (!owner || (row.ownerIds || []).some(id => String(id) === owner));
    }).sort((a, b) => {
        if (sort.key === 'name') return a.name.localeCompare(b.name) * sort.direction;
        const av = value(a, sort.key), bv = value(b, sort.key);
        if (av == null && bv == null) return a.name.localeCompare(b.name);
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av - bv) * sort.direction || a.name.localeCompare(b.name);
    });
    const pageSize = 50, pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    const safePage = Math.min(page, pageCount - 1);
    const pageRows = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);
    React.useEffect(() => { setPage(0); }, [search, position, team, ownership, owner, perGame, scope, week, sort.key, sort.direction, currentLeague?.league_id]);
    const changeSort = key => setSort(previous => ({ key, direction: previous.key === key ? -previous.direction : (key === 'name' ? 1 : -1) }));
    const toggleMetric = key => setSelected(previous => previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key]);
    const exportCsv = () => {
        const exportMetrics = [metricByKey.fantasyPoints, ...columns].filter(Boolean);
        const escape = item => {
            const raw = String(item ?? '');
            const safe = typeof item === 'string' && /^[\s]*[=+@-]/.test(raw) ? "'" + raw : raw;
            return `"${safe.replace(/"/g, '""')}"`;
        };
        const csv = [['Player', 'Position', 'NFL team', 'League owner', ...exportMetrics.map(metric => `${metric.label}${metric.format === 'pct' && !metric.label.includes('%') ? ' (%)' : ''}${perGame && !metric.rate && metric.key !== 'gp' ? ' / game' : ''}`)],
            ...filtered.map(row => [row.name, row.position, row.team, (row.ownerNames || []).join('; '), ...exportMetrics.map(metric => { const result = engine.value(row, metric, { perGame }); return result == null ? '' : metric.format === 'pct' ? result * 100 : result; })])]
            .map(row => row.map(escape).join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = `dynasty-hq-stats-${season}-${scope === 'week' ? `week-${week}` : 'season'}.csv`; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const sortHeader = (key, label, className, title) => <th key={key} className={className} scope="col" aria-sort={sort.key === key ? (sort.direction === 1 ? 'ascending' : 'descending') : 'none'}>
        <button type="button" title={title || label} onClick={() => changeSort(key)}>{label}{sort.key === key ? (sort.direction === 1 ? ' ↑' : ' ↓') : ''}</button>
    </th>;
    const updated = data?.updatedAt ? new Date(data.updatedAt) : null;
    const ownerOptions = (currentLeague?.rosters || []).map(roster => ({ id: String(roster.roster_id), name: getOwnerName?.(roster.roster_id) || `Team ${roster.roster_id}` }));
    return <section className="dhq-stats" aria-label="Player statistics">
        <style>{`
            .dhq-stats{padding:20px 24px;max-width:1500px;margin:0 auto;color:var(--white,#f5f2ea);font-family:var(--font-body,'DM Sans',sans-serif);--stats-bg:var(--off-black,#1b1b22);--stats-line:rgba(189,184,173,.15)}.dhq-stats *{box-sizing:border-box}.dhs-title{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px}.dhs-title h2{font:700 1.7rem var(--font-title,'Rajdhani',sans-serif);margin:0}.dhs-note{font-size:.75rem;color:var(--text-muted,#8d887e);line-height:1.6;margin:5px 0}.dhs-actions,.dhs-toolbar,.dhs-filters,.dhs-pagination{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.dhs-actions{justify-content:flex-end}.dhq-stats button,.dhq-stats select,.dhq-stats input[type=search]{font:inherit;font-size:.75rem;color:var(--white,#f5f2ea);background:var(--black,#121217);border:1px solid var(--stats-line);border-radius:6px;min-height:36px;padding:7px 10px}.dhq-stats button{cursor:pointer}.dhq-stats button:disabled{opacity:.45;cursor:default}.dhq-stats button:focus-visible,.dhq-stats input:focus-visible,.dhq-stats select:focus-visible,.dhq-stats summary:focus-visible{outline:2px solid var(--gold,#d4af37);outline-offset:2px}.dhs-toolbar{padding:12px 14px;background:var(--stats-bg);border:1px solid var(--stats-line);border-radius:10px 10px 0 0;justify-content:space-between}.dhs-toolbar label,.dhs-filters label{font-size:.6875rem;color:var(--silver,#bdb8ad);display:flex;align-items:center;gap:6px}.dhs-toolbar select{max-width:160px}.dhs-filters{padding:12px 14px;border:1px solid var(--stats-line);border-top:0;align-items:flex-end}.dhs-filters label{display:grid;gap:5px}.dhs-filters input{width:230px;max-width:100%}.dhs-filters select{max-width:180px}.dhs-columns{border:1px solid var(--stats-line);border-top:0;padding:12px 14px;background:var(--stats-bg)}.dhs-columns summary{cursor:pointer;font-size:.75rem;color:var(--gold,#d4af37)}.dhs-metric-grid{max-height:280px;overflow:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(205px,1fr));gap:5px;margin-top:10px}.dhs-metric-grid label{display:flex;align-items:center;gap:8px;font-size:.75rem;padding:7px;background:var(--black,#121217);border-radius:5px}.dhs-metric-grid input{accent-color:var(--gold,#d4af37)}.dhs-metric-grid small{display:block;color:var(--text-muted,#8d887e);font-size:.625rem}.dhs-count{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 0;font-size:.6875rem;color:var(--text-muted,#8d887e)}.dhs-table-scroll{max-height:68vh;overflow:auto;border:1px solid var(--stats-line);border-radius:8px;background:var(--stats-bg)}.dhq-stats table{border-collapse:separate;border-spacing:0;width:100%;font-size:.75rem}.dhq-stats th,.dhq-stats td{padding:11px 12px;border-bottom:1px solid var(--stats-line);text-align:right;white-space:nowrap;min-width:110px}.dhq-stats th{position:sticky;top:0;z-index:3;background:var(--stats-bg);color:var(--silver,#bdb8ad);font-weight:500}.dhq-stats th button{border:0;background:transparent;padding:0;min-height:25px;white-space:nowrap}.dhq-stats td{font-family:var(--font-mono,'JetBrains Mono',monospace);font-variant-numeric:tabular-nums}.dhq-stats .dhs-player{position:sticky;left:0;min-width:200px;width:200px;max-width:200px;text-align:left;background:var(--stats-bg);z-index:2;font-family:inherit;white-space:normal}.dhq-stats .dhs-points{position:sticky;left:200px;min-width:96px;width:96px;background:var(--stats-bg);z-index:2;border-right:1px solid rgba(212,175,55,.25);color:var(--gold,#d4af37)}.dhq-stats th.dhs-player,.dhq-stats th.dhs-points{z-index:5}.dhs-player button{border:0;background:transparent;padding:0;min-height:0;text-align:left;font-weight:600;line-height:1.45}.dhs-player small{display:block;font-size:.625rem;color:var(--text-muted,#8d887e);margin-top:4px;line-height:1.4}.dhq-stats tbody tr:hover td{background:var(--black,#121217)}.dhs-pagination{justify-content:space-between;margin-top:14px;font-size:.75rem;color:var(--silver,#bdb8ad)}.dhs-empty{padding:28px 16px;border:1px solid var(--stats-line);border-radius:8px;text-align:center}.dhs-alert{padding:10px 14px;color:var(--gold,#d4af37);font-size:.75rem;line-height:1.6}.dhs-subtle{color:var(--text-muted,#8d887e)}@media(max-width:600px){.dhq-stats{padding:12px}.dhs-filters label{flex:1 1 130px}.dhs-filters select,.dhs-filters input{width:100%;max-width:none}.dhq-stats .dhs-player{min-width:155px;width:155px;max-width:155px}.dhq-stats .dhs-points{left:155px;min-width:78px;width:78px}.dhq-stats th,.dhq-stats td{padding:10px 8px}.dhs-title h2{font-size:1.5rem}.dhs-toolbar{align-items:flex-start}.dhs-metric-grid{grid-template-columns:1fr}}
        `}</style>
        <style>{`
            .dhq-stats .dhs-filter-toggle{display:none}@media(max-width:600px){.dhq-stats .dhs-filter-toggle{display:block;width:100%;text-align:left;border-radius:0;border-top:0;color:var(--gold,#d4af37);padding:10px 14px}.dhs-filters:not(.is-open){display:none}.dhs-toolbar{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}.dhs-toolbar>.dhs-actions{grid-column:1/-1;justify-content:space-between}.dhs-toolbar>label{display:grid;gap:4px}.dhs-toolbar>label select{max-width:100%;width:100%}}
        `}</style>
        <header className="dhs-title"><div><h2>Stats</h2><p className="dhs-note">Every player. Every available stat. Scored for {currentLeague?.name || 'your league'}.</p></div>
            <div className="dhs-actions"><button type="button" disabled={load.status === 'loading'} onClick={() => setRevision(v => v + 1)}>{load.status === 'loading' ? 'Refreshing…' : 'Refresh'}</button><button type="button" onClick={exportCsv} disabled={!filtered.length || !data}>Export CSV</button></div>
        </header>
        <div className="dhs-toolbar"><div className="dhs-actions">
            <label>Season <strong>{season}</strong></label>
            <label>View <select value={scope} onChange={e => setScope(e.target.value)}><option value="season">Full season</option><option value="week">By week</option></select></label>
            {scope === 'week' && <label>Week <select value={week} onChange={e => setWeek(Number(e.target.value))}>{Array.from({ length: 18 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label>}
        </div><label>Stat view <select aria-label="Stat view preset" value={activePreset} onChange={e => { if (engine.PRESETS?.[e.target.value]) setSelected(presetKeys(e.target.value)); }}><option value="">Custom columns</option>{Object.keys(engine.PRESETS || {}).map(key => <option key={key} value={key}>{key.charAt(0).toUpperCase() + key.slice(1)}</option>)}</select></label><label>Display <select value={perGame ? 'game' : 'total'} onChange={e => setPerGame(e.target.value === 'game')}><option value="total">Totals</option><option value="game">Per game</option></select></label></div>
        <button type="button" className="dhs-filter-toggle" aria-expanded={filtersOpen} aria-controls="dhs-player-filters" onClick={() => setFiltersOpen(!filtersOpen)}>Filters{[search, position, team, ownership, owner].filter(Boolean).length ? ` · ${[search, position, team, ownership, owner].filter(Boolean).length} active` : ''} {filtersOpen ? '↑' : '↓'}</button>
        <div id="dhs-player-filters" className={`dhs-filters${filtersOpen ? ' is-open' : ''}`}>
            <label>Find a player<input type="search" placeholder="Search players, teams, positions" value={search} onChange={e => setSearch(e.target.value)} /></label>
            <label>Position<select value={position} onChange={e => setPosition(e.target.value)}><option value="">All positions</option>{[...new Set(allRows.map(row => row.position).filter(Boolean))].sort().map(pos => <option key={pos}>{pos}</option>)}</select></label>
            <label>NFL team<select value={team} onChange={e => setTeam(e.target.value)}><option value="">All NFL teams</option>{[...new Set(allRows.map(row => row.team).filter(Boolean))].sort().map(t => <option key={t}>{t}</option>)}</select></label>
            <label>Availability<select value={ownership} onChange={e => { setOwnership(e.target.value); if (e.target.value === 'free') setOwner(''); }}><option value="">All players</option><option value="rostered">Rostered</option><option value="free">Free agents</option></select></label>
            <label>League team<select value={owner} onChange={e => { setOwner(e.target.value); if (e.target.value) setOwnership('rostered'); }}><option value="">Every league team</option>{ownerOptions.map(o => <option key={o.id} value={o.id}>{o.name}{String(myRoster?.roster_id) === o.id ? ' · You' : ''}</option>)}</select></label>
            <button type="button" onClick={() => { setSearch(''); setPosition(''); setTeam(''); setOwnership(''); setOwner(''); }}>Reset filters</button>
        </div>
        <details className="dhs-columns"><summary>Choose stats · {columns.length + 1} columns selected</summary>
            <p className="dhs-note">Fantasy points stay pinned. Search every numeric stat supplied for this period; descriptive metrics and original fields are both available.</p>
            <div className="dhs-actions" style={{ justifyContent: 'flex-start' }}><input aria-label="Find a stat" type="search" placeholder="Find a stat, e.g. targets" value={metricQuery} onChange={e => setMetricQuery(e.target.value)} /><select aria-label="Stat category" value={metricGroup} onChange={e => setMetricGroup(e.target.value)}><option value="">All categories</option>{[...new Set(allMetrics.map(m => m.group).filter(Boolean))].sort().map(group => <option key={group} value={group}>{group.charAt(0).toUpperCase() + group.slice(1)}</option>)}</select>
                <button type="button" onClick={() => setSelected(previous => [...new Set([...previous, ...metricOptions.map(m => m.key)])])}>Add shown</button><button type="button" onClick={() => setSelected(['gp'])}>Clear extra stats</button></div>
            <div className="dhs-metric-grid">{metricOptions.map(metric => <label key={metric.key}><input type="checkbox" checked={selected.includes(metric.key)} onChange={() => toggleMetric(metric.key)} /><span>{metric.label}<small>{metric.key.startsWith('raw:') ? metric.key.slice(4) : metric.group}</small></span></label>)}</div>
            {!metricOptions.length && <p className="dhs-note">No stats match that search.</p>}
        </details>
        {detailPlayer && <aside className="dhs-columns" aria-label={`${detailPlayer.name} stats detail`}>
            <div className="dhs-title" style={{ marginBottom: 6 }}><div><strong>{detailPlayer.name}</strong><p className="dhs-note">{detailPlayer.position} · {detailPlayer.team || 'No NFL team'} · {season} regular season</p></div><div className="dhs-actions">{typeof window.WR?.openPlayerCard === 'function' && <button type="button" onClick={() => window.WR.openPlayerCard(detailPlayer.pid, { scoringSettings: currentLeague?.scoring_settings || {} })}>Full player card</button>}<button type="button" onClick={() => setSelectedPid(null)}>Close detail</button></div></div>
            <details><summary>All available stats · {scope === 'week' ? `Week ${week}` : 'Season'}</summary><div className="dhs-metric-grid">{allMetrics.filter(metric => engine.value(detailPlayer, metric, { perGame }) != null).map(metric => <div key={metric.key} style={{ padding: 8, fontSize: '.75rem' }}><span className="dhs-subtle">{metric.label}</span> <strong>{format(detailPlayer, metric)}</strong></div>)}</div></details>
            <p className="dhs-note">Weekly game log · Selected columns · Totals for each week</p>
            {gameLog.status === 'loading' ? <p className="dhs-note" role="status">Loading weekly stat lines…</p> : gameLog.status === 'error' ? <p className="dhs-alert">The game log could not load. Close and reopen this detail to retry.</p> : gameLog.key === `${season}|${selectedPid}` && <div className="dhs-table-scroll" style={{ maxHeight: 280 }} tabIndex={0} role="region" aria-label="Weekly player game log"><table><thead><tr><th scope="col">Week</th><th scope="col">Fantasy</th>{columns.map(metric => <th scope="col" key={metric.key}>{metric.label}</th>)}</tr></thead><tbody>{gameLog.rows.map(entry => {
                const row = entry.raw ? engine.buildRows({ statsByPid: { [selectedPid]: entry.raw }, playersData, league: currentLeague }).find(item => String(item.pid) === String(selectedPid)) : null;
                const display = metric => { const result = row ? engine.value(row, metric, { perGame: false }) : null; return engine.format ? engine.format(result, metric, { perGame: false }) : result ?? '—'; };
                return <tr key={entry.week}><td>{entry.week}{entry.error ? ' · Unavailable' : !entry.raw ? ' · No stats' : ''}</td><td>{metricByKey.fantasyPoints ? display(metricByKey.fantasyPoints) : '—'}</td>{columns.map(metric => <td key={metric.key}>{display(metric)}</td>)}</tr>;
            })}</tbody></table></div>}
        </aside>}
        <div className="dhs-count"><span>{filtered.length.toLocaleString()} players · {scope === 'week' ? `Week ${week}` : 'Season totals'}{perGame ? ' · Per game' : ''}</span><span>{updated && !Number.isNaN(updated.getTime()) ? `Updated ${updated.toLocaleString()}` : 'Sleeper stats'} · Calculated league scoring</span></div>
        {data && !Object.keys(data.statsByPid || {}).length && <p className="dhs-alert" role="status">No stats have been reported for this period. Players remain searchable; unavailable values show a dash.</p>}
        {load.status === 'error' && <div className="dhs-alert" role="status">{data ? 'Refresh failed. Showing the last successful stats for this period.' : 'Stats could not load. Refresh to try again.'}</div>}
        {!data && load.status === 'loading' ? <div className="dhs-empty" role="status">Loading player statistics…</div> : !filtered.length ? <div className="dhs-empty"><strong>{allRows.length ? 'No players match these filters.' : 'No player stats have been reported for this period.'}</strong><p className="dhs-note">{allRows.length ? 'Try another name, team, or position.' : 'Choose a different week or check back after games begin.'}</p></div> : <div className="dhs-table-scroll" tabIndex={0} role="region" aria-label="Player stats table, scroll horizontally for more columns"><table>
            <thead><tr>{sortHeader('name', 'Player', 'dhs-player')}{sortHeader('fantasyPoints', perGame ? 'FP / G' : 'Fantasy', 'dhs-points', 'Calculated fantasy points under this league’s scoring settings')}{columns.map(metric => sortHeader(metric.key, metric.label, '', `${metric.label}${perGame && !metric.rate && metric.key !== 'gp' ? ' per game' : ''}`))}</tr></thead>
            <tbody>{pageRows.map(row => <tr key={row.pid}><td className="dhs-player"><button type="button" onClick={() => { setSelectedPid(row.pid); window.WR?.openPlayerCard?.(row.pid, { scoringSettings: currentLeague?.scoring_settings || {} }); }}>{getPlayerName?.(row.pid) || row.name}</button><button type="button" style={{ display: 'block', fontSize: '.625rem', color: 'var(--gold,#d4af37)', marginTop: 3 }} onClick={() => setSelectedPid(row.pid)}>Stats & game log</button><small>{row.position || '—'} · {row.team || 'No NFL team'} · {(row.ownerNames || []).join(', ') || 'Free agent'}</small></td><td className="dhs-points">{metricByKey.fantasyPoints ? format(row, metricByKey.fantasyPoints) : '—'}</td>{columns.map(metric => <td key={metric.key}>{format(row, metric)}</td>)}</tr>)}</tbody>
        </table></div>}
        {filtered.length > 0 && <div className="dhs-pagination"><span>{safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, filtered.length)} of {filtered.length.toLocaleString()} players</span><div className="dhs-actions"><button type="button" disabled={safePage === 0} onClick={() => setPage(Math.max(0, safePage - 1))}>Previous</button><span>Page {safePage + 1} of {pageCount}</span><button type="button" disabled={safePage + 1 >= pageCount} onClick={() => setPage(safePage + 1)}>Next</button></div></div>}
        <p className="dhs-note" style={{ marginTop: 14 }}>A dash means unavailable, never zero. Per-game totals require a reported games-played count; rates stay rates. Provider raw rates are shown as supplied; use derived rates for ratios calculated from totals. Fantasy points use your league’s scoring rules and may differ from commissioner-adjusted matchup totals. NFL teams and league ownership reflect the current player and roster data. Current-season stats refresh every minute while visible. Select a player for their full player card.</p>
    </section>;
}
window.LeagueStatsTab = LeagueStatsTab;
