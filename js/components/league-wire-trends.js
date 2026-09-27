function WrWireTrendsPanel({ league, throughWeek, players, search = '', teamFilter = 'all', accountScope = '' }) {
    const membership = JSON.stringify((league.rosters || []).map(roster => [String(roster.roster_id), (roster.players || []).map(String).sort()]).sort((a, b) => a[0].localeCompare(b[0])));
    const scope = `${accountScope}|${league.league_id || league.id}|${league.season}|${throughWeek}|${JSON.stringify(league.scoring_settings || {})}|${membership}`;
    const [entry, setEntry] = React.useState({ scope: '', status: 'loading' });
    const [revision, setRevision] = React.useState(0);
    const current = entry.scope === scope ? entry : { status: 'loading' };
    React.useEffect(() => {
        let alive = true;
        const controller = new window.AbortController();
        setEntry({ scope, status: 'loading' });
        const timeout = setTimeout(() => { controller.abort(); if (alive) setEntry({ scope, status: 'error', message: 'Recent stats took too long to load. Try again.' }); }, 20000);
        Promise.resolve().then(() => window.WrWireTrends.load({ league, throughWeek, players, getWeekStats: window.App?.SOS?.getWeekStats, calculate: window.calcFantasyPts, signal: controller.signal }))
            .then(data => { if (alive && !controller.signal.aborted) setEntry({ scope, status: data.reason ? 'unavailable' : 'ready', data }); })
            .catch(error => { if (alive && !controller.signal.aborted) setEntry({ scope, status: 'error', message: error.message || 'Recent statistics could not load.' }); })
            .finally(() => clearTimeout(timeout));
        return () => { alive = false; controller.abort(); clearTimeout(timeout); };
    }, [scope, revision, players]);
    const data = current.data;
    const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const rows = (data?.rows || []).filter(row => (teamFilter === 'all' || row.rosterIds.some(id => String(id) === String(teamFilter))) && terms.every(term => `${row.name} ${row.position} ${row.rosterIds.map(id => { const person = window.WrWireIdentity?.resolve(league, id); return `${person?.ownerName || ''} ${person?.teamName || ''}`; }).join(' ')}`.toLocaleLowerCase().includes(term)));
    const span = weeks => weeks?.length === 1 ? `Week ${weeks[0]}` : `Weeks ${weeks?.[0]}–${weeks?.at(-1)}`;
    const groups = [['Heating up', rows.filter(row => row.delta > 0)], ['Cooling off', rows.filter(row => row.delta < 0)]];
    return <section className="wr-wire-trends" aria-label="Recent player form"><header><span className="wr-wire-feature-kicker">THE FORM CHECK</span><h3>Who’s moving now?</h3><p>{league.season} · completed regular-season games · your league’s scoring</p><button type="button" disabled={current.status === 'loading'} onClick={() => setRevision(value => value + 1)}>{current.status === 'error' || current.status === 'unavailable' ? 'Retry recent stats' : current.status === 'loading' ? 'Checking recent stats…' : 'Check recent stats'}</button></header>
        {current.status === 'loading' && <p role="status">Comparing the latest completed weeks…</p>}
        {(current.message || data?.reason) && <p role="status">{current.message || data.reason}</p>}
        {current.status === 'ready' && <><p>{span(data.recentWeeks)} compared with {span(data.priorWeeks)}. {data.recentWeeks.length === 1 ? 'An early week-to-week check, not an established trend.' : 'A rolling comparison of recent production.'}</p>
            {!rows.length && <p>No players match this selection with a change of at least 2 fantasy points per game and enough recorded appearances in both windows.</p>}
            {groups.filter(([, list]) => list.length).map(([title, list]) => <section key={title}><h4>{title}</h4><div className="wr-wire-trend-grid">{list.slice(0, 6).map(row => <article key={row.pid}><span>{row.position}</span><h5>{row.name}</h5><strong>{row.delta > 0 ? '+' : ''}{row.delta.toFixed(2)} <small>fantasy PPG</small></strong><p>{row.recent.toFixed(2)} now · {row.prior.toFixed(2)} before</p><small>{row.recentGames} recent / {row.priorGames} earlier recorded game{row.priorGames === 1 ? '' : 's'}</small><details><summary>Weekly receipts</summary><ul>{row.observations.map(item => <li key={item.week}>Week {item.week}: {item.points.toFixed(2)} points</li>)}</ul></details></article>)}</div>{list.length > 6 && <p>{list.length - 6} more players have a {title.toLowerCase()} signal. Search a player or filter a team to narrow the list.</p>}</section>)}
            <details className="wr-journal-context"><summary>How form is measured</summary><p>Player statistics come from Sleeper’s weekly feed and use this league’s scoring rules, before manual commissioner adjustments. Bench and starting players are eligible; lineup choices do not change these totals. Missing games are excluded, never counted as zero. Archived editions cover the starters recorded in the loaded games. Each multiweek window needs at least two recorded games. A change in production does not establish an injury, role change, or future projection.</p></details>
        </>}
    </section>;
}
window.WrWireTrendsPanel = WrWireTrendsPanel;
