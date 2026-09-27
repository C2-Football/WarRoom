// Small identity bylines and an optional, lazy draft-history desk.
function WrWirePeople({ participants = [] }) {
    const people = [...new Map(participants.filter(p => p?.ownerName).map(p => [p.ownerId || p.ownerName + ':' + p.teamName, p])).values()];
    if (!people.length) return null;
    return <ul className="wr-wire-people" aria-label="Owners and teams">{people.map((p, i) => <li key={p.ownerId || i}><strong>{p.ownerName}</strong>{p.teamName && p.teamName !== p.ownerName && <span>{p.teamSeason ? p.teamSeason + ' · ' : ''}{p.teamName}</span>}</li>)}</ul>;
}

function WrWireDraftReceipts({ league, weeks = [], priorSeasons = [], throughWeek = 0, accountScope = '' }) {
    const owner = window.App?.AccountStorage?.owner?.() || accountScope;
    const scope = `${owner}|${league?.league_id || league?.id}|${league?.season}|${throughWeek}`;
    const [requested, setRequested] = React.useState('');
    const [revision, setRevision] = React.useState(0);
    const [entry, setEntry] = React.useState({ scope: '', status: 'idle' });
    const current = entry.scope === scope ? entry : { status: 'idle' };
    React.useEffect(() => {
        if (requested !== scope) return undefined;
        let alive = true;
        const controller = new window.AbortController();
        const stillCurrent = () => alive && !controller.signal.aborted && (window.App?.AccountStorage?.owner?.() || accountScope) === owner;
        setEntry({ scope, status: 'loading' });
        const timeout = setTimeout(() => {
            controller.abort();
            if (alive) setEntry({ scope, status: 'error', message: 'The draft archive took too long to load. Try again.' });
        }, 30000);
        Promise.resolve().then(() => window.WrWireDraftHistory.load({ league, weeks, priorSeasons, throughWeek, signal: controller.signal, force: revision > 1 })).then(data => {
            if (stillCurrent()) setEntry({ ...data, scope });
        }).catch(error => {
            if (stillCurrent()) setEntry({ scope, status: 'error', message: error.message || 'The draft archive could not load. Try again.' });
        }).finally(() => clearTimeout(timeout));
        return () => { alive = false; controller.abort(); clearTimeout(timeout); };
    }, [requested, scope, revision]);
    if (!window.WrWireDraftHistory) return null;
    const open = () => { setRequested(scope); setRevision(n => n + 1); };
    return <section className="wr-wire-draft-receipts" aria-label="Draft receipts">
        <header><span className="wr-wire-feature-kicker">HINDSIGHT HAS ENTERED THE CHAT</span><h3>Draft receipts</h3><p>The value finds and the ones that got away. Same-position picks, verified starting-lineup points, and the receipts to back it up.</p></header>
        <button type="button" onClick={open} disabled={current.status === 'loading'}>{current.status === 'loading' ? 'Opening the draft archive…' : current.status === 'idle' ? 'Open draft receipts →' : 'Refresh draft receipts'}</button>
        {current.status === 'loading' && <p role="status">Checking the loaded seasons’ draft records…</p>}
        {current.message && <p role={current.status === 'error' ? 'alert' : undefined} className="wr-journal-footnote">{current.message}</p>}
        {(current.stories || []).map(story => <article key={story.id} className="wr-wire-feature-story"><p className="wr-wire-feature-kicker">{story.label || 'DRAFT RECEIPTS'}</p><h4>{story.text}</h4><WrWirePeople participants={story.participants} />{window.WrWireReading.paragraphs(story.body).map((paragraph, i) => <p key={i}>{paragraph}</p>)}{(story.sources?.length > 0 || story.related?.length > 0) && <details className="wr-journal-context"><summary>The receipts</summary>{story.related?.map((item, i) => <div key={'note-' + i}><strong>{item.label}</strong><p>{item.text}</p></div>)}{(story.sources || []).map((source, i) => <p key={i}><a href={source.url} target="_blank" rel="noreferrer">{source.label || 'Draft source'}</a></p>)}</details>}</article>)}
        {current.coverage && <details className="wr-journal-context"><summary>How these comparisons work</summary>{(Array.isArray(current.coverage) ? current.coverage : [current.coverage]).map((item, i) => <p key={i}>{typeof item === 'string' ? item : item.message || item.label || ''}</p>)}</details>}
    </section>;
}
window.WrWirePeople = WrWirePeople;
window.WrWireDraftReceipts = WrWireDraftReceipts;
