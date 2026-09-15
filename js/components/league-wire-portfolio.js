function WrAllLeaguesWire({ leagues = [], accountId = '', onClose, onOpenLeague }) {
    const dialog = React.useRef(null);
    const opener = React.useRef(document.activeElement);
    const [entries, setEntries] = React.useState({});
    const [leagueFilter, setLeagueFilter] = React.useState('all');
    const [topic, setTopic] = React.useState('all');
    const [revision, setRevision] = React.useState(0);
    const [limit, setLimit] = React.useState(18);
    const eligible = leagues.filter(l => window.App.LeagueLiveScores.supported(l));
    const scope = accountId + '|' + eligible.map(l => (l.league_id || l.id) + ':' + l.season).sort().join(',');
    React.useEffect(() => { dialog.current?.showModal(); return () => { window.requestAnimationFrame(() => { const target = opener.current?.isConnected ? opener.current : document.querySelector('.wr-wire-brand, .wr-wire-mobile-launch, .wr-all-wire-launch'); target?.focus?.(); }); }; }, []);
    React.useEffect(() => {
        setEntries({}); setLimit(18); setLeagueFilter('all');
        const controller = new window.AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        let alive = true;
        window.WrWirePortfolio.load({ leagues: eligible, accountId, signal: controller.signal, force: revision > 0,
            onUpdate: entry => { if (alive) setEntries(old => ({ ...old, [entry.league.league_id || entry.league.id]: entry })); },
        }).catch(() => {}).finally(() => {
            clearTimeout(timeout);
            if (alive) setEntries(old => Object.fromEntries(eligible.map(l => { const id = l.league_id || l.id, entry = old[id]; return [id, entry && entry.status !== 'loading' ? entry : { ...(entry || { league: l, stories: [] }), status: 'partial', error: 'Loading paused. Refresh to finish the remaining history.' }]; })));
        });
        return () => { alive = false; controller.abort(); clearTimeout(timeout); };
    }, [scope, revision]);
    const current = eligible.map(l => entries[l.league_id || l.id]).filter(Boolean);
    const stories = window.WrWirePortfolio.headlines(current, topic, leagueFilter);
    const ready = current.filter(e => e.status !== 'loading').length;
    const changeTopic = value => { setTopic(value); setLimit(18); };
    return <dialog ref={dialog} className="wr-journal wr-wire-portfolio" aria-labelledby="wr-all-wire-title" onCancel={onClose} onClose={onClose}>
        <header className="wr-journal-bar"><h2 id="wr-all-wire-title">The Wire<span>.</span></h2><span>All your leagues. One edition.</span><button type="button" onClick={onClose} aria-label="Close all-league Wire">Close ×</button></header>
        <nav className="wr-journal-nav" aria-label="All-league Wire sections">{[['all', 'Front page'], ['recaps', 'Recaps'], ['records', 'Records'], ['history', 'History']].map(([value, text]) => <button key={value} type="button" aria-pressed={topic === value} onClick={() => changeTopic(value)}>{text}</button>)}</nav>
        <div className="wr-journal-paper">
            <header className="wr-journal-masthead"><div><span>YOUR WHOLE LEAGUE WORLD</span><h3>{topic === 'all' ? 'Across your leagues' : topic[0].toUpperCase() + topic.slice(1)}</h3></div><p role="status">{ready} of {eligible.length} leagues loaded</p></header>
            <div className="wr-all-wire-controls"><label>League<select aria-label="Filter Wire by league" value={leagueFilter} onChange={e => { setLeagueFilter(e.target.value); setLimit(18); }}><option value="all">All my leagues</option>{eligible.map(l => <option key={l.id || l.league_id} value={l.id || l.league_id}>{l.name}</option>)}</select></label><button type="button" onClick={() => setRevision(n => n + 1)}>Refresh current news ↻</button></div>
            <div className="wr-all-wire-progress">{eligible.map(l => { const e = entries[l.id || l.league_id]; return <details key={l.id || l.league_id}><summary>{l.name}<span>{!e || e.status === 'loading' ? e?.currentReady ? 'News ready · adding history' : 'Loading…' : e.status === 'ready' ? e.reusedSeasons ? `Ready · ${e.reusedSeasons} cached season${e.reusedSeasons === 1 ? '' : 's'}` : 'Ready' : 'Partial coverage'}</span></summary><p>{e?.error || (e ? `${e.priorSeasons || 0} earlier seasons available${e.reusedSeasons ? ` · ${e.reusedSeasons} reused from cache` : ''}. Completed scores through Week ${e.completedThrough || 0}.` : 'Waiting for a newsroom slot…')}</p><button type="button" onClick={() => onOpenLeague(l)}>Open league →</button></details>; })}</div>
            {!eligible.length && <p className="wr-journal-notice">Connect a Sleeper league to read its Wire coverage.</p>}
            {leagues.length > eligible.length && <p className="wr-journal-footnote">This edition covers connected Sleeper leagues. Other platforms are not included.</p>}
            <main className="wr-all-wire-stories">{stories.slice(0, limit).map((s, i) => <article key={`${s.league.id || s.league.league_id}:${s.id || s.text}`} className={'wr-all-wire-story' + (i === 0 ? ' is-lead' : '')}>
                <div className="wr-journal-kicker"><span>{s.league.name} · {s.league.season}</span></div><p className="wr-all-wire-label">{s.label}</p><h3>{s.text}</h3><p>{s.body}</p>
                {(s.related?.length > 0 || s.sources?.length > 0) && <details className="wr-journal-context"><summary>Story context & sources</summary>{s.related?.map((r, n) => <p key={n}><strong>{r.label}: </strong>{r.text}</p>)}{s.sources?.map((src, n) => <p key={n}>{src.workbook ? `${src.workbook} · ${src.sheet}!${src.range}` : <a href={src.url} target="_blank" rel="noreferrer">{src.label}</a>}</p>)}</details>}
                <button type="button" onClick={() => onOpenLeague(s.league)}>Open {s.league.name} →</button>
            </article>)}</main>
            {!stories.length && <p className="wr-journal-notice">{ready < eligible.length ? 'Gathering your headlines… Each league appears as its news arrives.' : 'No stories in this section yet. Try the front page or another league.'}</p>}
            {stories.length > limit && <button className="wr-all-wire-more" type="button" onClick={() => setLimit(n => n + 18)}>More stories · {stories.length - limit} remaining</button>}
            <footer className="wr-journal-footer"><strong>FROM EVERY LEAGUE YOU CALL HOME.</strong><p>Scores and rivalries stay within their own league. Completed older seasons are saved on this device and reused across visits. Current news is a snapshot; refresh to update it. Use a league’s Sources & coverage → Recheck older seasons for historical corrections.</p></footer>
        </div>
    </dialog>;
}
window.WrAllLeaguesWire = WrAllLeaguesWire;
