// Small identity bylines and an optional, lazy draft-history desk.
function WrWirePeople({ participants = [] }) {
    const people = [...new Map(participants.filter(p => p?.ownerName).map(p => [p.ownerId || p.ownerName + ':' + p.teamName, p])).values()];
    if (!people.length) return null;
    return <ul className="wr-wire-people" aria-label="Owners and teams">{people.map((p, i) => <li key={p.ownerId || i}><strong>{p.ownerName}</strong>{p.teamName && p.teamName !== p.ownerName && <span>{p.teamSeason ? p.teamSeason + ' · ' : ''}{p.teamName}</span>}</li>)}</ul>;
}

function WrWireDraftEvidenceKey(league, weeks, priorSeasons) {
    const entry = (source, rows) => [source?.league_id || source?.id, source?.season, source?.status, source?.draft_id, source?.previous_league_id, source?.settings?.start_week, source?.settings?.playoff_week_start,
        (source?.rosters || []).map(row => [row.roster_id, row.owner_id]), (source?.users || []).map(user => [user.user_id, user.display_name, user.username, user.metadata?.team_name]),
        (rows || []).map(week => [week.week, (week.rows || []).map(row => [row.roster_id, row.points, row.custom_points, row.starters, row.players_points])])];
    return JSON.stringify([entry(league, weeks), priorSeasons.map(prior => entry(prior.league, prior.weeks))]);
}
function WrWireDraftReceipts({ league, weeks = [], priorSeasons = [], throughWeek = 0, accountScope = '', search = '', ownerFilter = null, opinionOnly = false }) {
    const owner = window.App?.AccountStorage?.owner?.() || accountScope;
    const scope = `${owner}|${league?.league_id || league?.id}|${league?.season}|${throughWeek}`;
    const inputKey = WrWireDraftEvidenceKey(league, weeks, priorSeasons);
    const [requested, setRequested] = React.useState('');
    const [revision, setRevision] = React.useState(0);
    const [range, setRange] = React.useState({ scope: '', count: 8 });
    const [filters, setFilters] = React.useState({ scope: '', season: 'all', category: 'all', owner: 'all', limit: 6 });
    const [entry, setEntry] = React.useState({ scope: '', status: 'idle' });
    const refreshRevision = React.useRef(0);
    const current = entry.scope === scope ? entry : { status: 'idle' };
    const selected = filters.scope === scope ? filters : { season: 'all', category: 'all', owner: 'all', limit: 6 };
    const maxSeasons = range.scope === scope ? range.count : 8;
    const updateFilter = (key, value) => setFilters({ ...selected, scope, [key]: value, limit: 6 });
    React.useEffect(() => {
        if (requested !== scope) return undefined;
        let alive = true;
        const force = revision > refreshRevision.current && revision > 1;
        refreshRevision.current = revision;
        const controller = new window.AbortController();
        const stillCurrent = () => alive && !controller.signal.aborted && (window.App?.AccountStorage?.owner?.() || accountScope) === owner;
        setEntry(previous => ({ ...(previous.scope === scope ? previous : {}), scope, status: 'loading', message: 'Checking the loaded seasons’ draft records…' }));
        const fail = message => setEntry(previous => previous.scope === scope && (previous.stories?.length || previous.opinions?.length || previous.ownerHistories?.length)
            ? { ...previous, status: 'partial', stale: true, message: message + (opinionOnly ? ' Previously checked columns remain below.' : ' Previously checked receipts remain below.') }
            : { scope, status: 'error', message });
        const timeout = setTimeout(() => {
            controller.abort();
            if (alive && (window.App?.AccountStorage?.owner?.() || accountScope) === owner) fail('The draft archive took too long to load. Try again.');
        }, 30000);
        Promise.resolve().then(() => window.WrWireDraftHistory.load({ league, weeks, priorSeasons, throughWeek, signal: controller.signal, force, maxSeasons,
            onProgress: data => { if (stillCurrent()) setEntry(previous => {
                const next = { ...data, scope };
                if (previous.scope === scope) for (const key of ['stories', 'opinions', 'ownerHistories']) {
                    if (!data[key]?.length && previous[key]?.length) { next[key] = previous[key]; next.stale = true; }
                }
                return next;
            }); },
        })).then(data => {
            if (!stillCurrent()) return;
            if (data.status === 'error') fail(data.message || 'The draft archive could not refresh.');
            else setEntry({ ...data, scope });
        }).catch(error => {
            if (stillCurrent()) fail(error.message || 'The draft archive could not load. Try again.');
        }).finally(() => clearTimeout(timeout));
        return () => { alive = false; controller.abort(); clearTimeout(timeout); };
    }, [requested, scope, revision, maxSeasons, inputKey]);
    if (!window.WrWireDraftHistory) return null;
    const open = () => { setRequested(scope); setRevision(n => n + 1); };
    const activeOwner = ownerFilter || (selected.owner === 'all' ? null : { ownerId: selected.owner });
    const visible = ((opinionOnly ? current.opinions : current.stories) || []).filter(story => window.WrWireDraftHistory.matches(story, { search, ownerFilter: activeOwner, league, season: selected.season, category: opinionOnly ? 'all' : selected.category }));
    const notebook = !opinionOnly && activeOwner?.ownerId ? (current.ownerHistories || []).find(book => String(book.ownerId) === String(activeOwner.ownerId)) : null;
    const notebookSeasons = (notebook?.seasons || []).filter(season => selected.season === 'all' || selected.season === String(season.season)).map(season => ({ ...season, picks: season.picks.filter(pick => String(search).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).every(term => [notebook.ownerName, season.teamName, season.season, pick.name, pick.position].join(' ').toLocaleLowerCase().includes(term))) })).filter(season => season.picks.length);
    const loaded = current.status !== 'idle', loading = current.status === 'loading';
    const seasons = [...new Set((current.checkedSeasons || []).filter(item => item.status === 'checked').map(item => String(item.season)))].sort((a, b) => Number(b) - Number(a));
    const filtered = !!String(search).trim() || !!activeOwner || selected.season !== 'all' || !opinionOnly && selected.category !== 'all';
    return <section className="wr-wire-draft-receipts" aria-label={opinionOnly ? 'Draft opinions' : 'Draft receipts'}>
        <header><span className="wr-wire-feature-kicker">{opinionOnly ? 'THE ANALYST · OPINION' : 'HINDSIGHT HAS ENTERED THE CHAT'}</span><h3>{opinionOnly ? 'The draft verdict' : 'Draft receipts'}</h3><p>{opinionOnly ? 'Who justified the pick, who lasted too long, and where the numbers deserve a second look.' : 'The picks that paid off and the ones worth another look, measured by points in actual fantasy starting lineups. Each story names its season and weeks.'}</p></header>
        <div className="wr-wire-draft-actions"><button type="button" onClick={open} disabled={loading}>{opinionOnly ? loading ? 'Reading the drafts…' : !loaded ? 'Ask the draft desk →' : 'Refresh draft opinions' : loading ? 'Checking receipts…' : !loaded ? 'Open draft receipts →' : 'Refresh draft receipts'}</button>
        {loaded && current.progress?.remaining > 0 && <button type="button" disabled={loading} onClick={() => setRange({ scope, count: Math.min(25, maxSeasons + 8) })}>Check {Math.min(8, current.progress.remaining)} older loaded seasons →</button>}</div>
        {current.message && <p role={current.status === 'error' ? 'alert' : 'status'} className="wr-journal-footnote">{current.message}</p>}
        {current.stale && loading && <p className="wr-journal-footnote">Previously checked {opinionOnly ? 'columns' : 'receipts'} are shown while this update finishes.</p>}
        {loaded && <div className="wr-wire-draft-controls">
            <label>{opinionOnly ? 'Opinion season' : 'Receipt season'}<select aria-label={opinionOnly ? 'Draft opinion season' : 'Draft receipt season'} value={selected.season} onChange={event => updateFilter('season', event.target.value)}><option value="all">All checked seasons</option>{seasons.map(season => <option key={season} value={season}>{season}</option>)}</select></label>
            {!ownerFilter && <label>{opinionOnly ? 'Owner' : 'Owner notebook'}<select aria-label={opinionOnly ? 'Draft opinion owner' : 'Draft receipt owner'} value={selected.owner} onChange={event => updateFilter('owner', event.target.value)}><option value="all">Whole league</option>{(current.ownerHistories || []).map(book => <option key={book.ownerId} value={book.ownerId}>{book.ownerName} · {book.seasons.length} checked {book.seasons.length === 1 ? 'draft' : 'drafts'}</option>)}</select></label>}
            {!opinionOnly && <label>Receipt type<select aria-label="Draft receipt type" value={selected.category} onChange={event => updateFilter('category', event.target.value)}>{[['all', 'All receipts'], ['value', 'Later-pick wins'], ['doover', 'Draft do-overs'], ['late', 'Late-round contributors'], ['workload', 'Lineup gaps']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
        </div>}
        {seasons.length > 0 && <p className="wr-wire-draft-scope">Checked seasons: {seasons.join(', ')}. {visible.length} {opinionOnly ? visible.length === 1 ? 'column' : 'columns' : visible.length === 1 ? 'receipt' : 'receipts'}{filtered ? ' matching this view' : ''}.{current.progress?.remaining > 0 ? ` ${current.progress.remaining} older loaded seasons remain available.` : ''}</p>}
        {visible.slice(0, selected.limit).map(story => <article key={story.id} className="wr-wire-feature-story"><p className="wr-wire-feature-kicker">{story.label || 'DRAFT RECEIPTS'}</p><h4>{story.text}</h4>{opinionOnly && <p className="wr-wire-opinion-byline">The Wire’s analyst{story.timingLabel ? ` · ${story.timingLabel}` : ''}</p>}<WrWirePeople participants={story.participants} />{window.WrWireReading.paragraphs(story.body).map((paragraph, i) => <p key={i}>{paragraph}</p>)}{(story.sources?.length > 0 || story.related?.length > 0) && <details className="wr-journal-context"><summary>The receipts</summary>{story.related?.map((item, i) => <div key={'note-' + i}><strong>{item.label}</strong><p>{item.text}</p></div>)}{(story.sources || []).map((source, i) => <p key={i}><a href={source.url} target="_blank" rel="noreferrer">{source.label || 'Draft source'}</a></p>)}</details>}</article>)}
        {visible.length > selected.limit && <button type="button" onClick={() => setFilters({ ...selected, scope, limit: selected.limit + 6 })}>More {opinionOnly ? 'columns' : 'receipts'} · {visible.length - selected.limit} remaining</button>}
        {loaded && !loading && !visible.length && current.status !== 'error' && <p className="wr-journal-footnote">{opinionOnly ? filtered ? 'No draft columns match these filters in the checked seasons.' : 'The checked drafts do not yet support a strong editorial take.' : filtered ? 'No receipts match these filters in the checked seasons.' : current.ownerHistories?.length ? 'No comparison met the story threshold. Choose an owner to explore their verified picks.' : 'More completed lineup evidence is needed before publishing a receipt.'}</p>}
        {notebook && <section className="wr-wire-owner-notebook" aria-label={`${notebook.ownerName} draft notebook`}><h4>{notebook.ownerName}’s draft notebook</h4><p>The same owner, across {notebook.seasons.length} checked {notebook.seasons.length === 1 ? 'draft' : 'drafts'}. Each season keeps its own scoring rules; picks with fewer than four verified fantasy starts are omitted.</p>
            {!notebookSeasons.length && <p>No verified picks match this view.</p>}
            {notebookSeasons.map((season, index) => <details key={season.leagueId} open={index === 0}><summary>{season.season} · {season.teamName} · {season.picks.length} {season.picks.length === 1 ? 'pick' : 'picks'}</summary><div className="wr-wire-draft-table" tabIndex={0} role="region" aria-label={`${season.season} draft picks; scroll for all columns`}><table><caption>{season.season} scoring · through Week {season.throughWeek} · fantasy starting lineups</caption><thead><tr><th>Pick</th><th>Player</th><th>Points</th><th>Starts</th><th>Pts/start</th></tr></thead><tbody>{season.picks.map(pick => <tr key={pick.playerId}><td>{pick.pick}</td><th scope="row">{pick.name}<small>{pick.position} · Round {pick.round}</small></th><td>{pick.points.toFixed(2)}</td><td>{pick.starts}</td><td>{pick.average.toFixed(2)}</td></tr>)}</tbody></table></div><details className="wr-journal-context"><summary>Notebook sources</summary>{season.sources.map(source => <p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.label}</a></p>)}</details></details>)}
        </section>}
        {current.coverage?.length > 0 && <details className="wr-journal-context"><summary>Coverage & comparison rules</summary>{current.coverage.map((item, i) => <p key={i}>{item}</p>)}</details>}
    </section>;
}
window.WrWirePeople = WrWirePeople;
window.WrWireDraftReceipts = WrWireDraftReceipts;
