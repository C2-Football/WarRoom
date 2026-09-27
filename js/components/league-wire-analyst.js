// A text-only opinion desk: the take is visible, the evidence is one click away.
function WrWireOpinionCard({ story, leagueName = '', compact = false }) {
    const reading = window.WrWireReading;
    return <article className="wr-wire-opinion-card">
        <p className="wr-wire-opinion-kicker">{story.label || 'THE ANALYST · OPINION'}{leagueName && <span>{leagueName}</span>}</p>
        <h4>{story.text}</h4>
        <p className="wr-wire-opinion-byline">The Wire’s analyst{story.timingLabel ? ` · ${story.timingLabel}` : ''}</p>
        {window.WrWirePeople && <window.WrWirePeople participants={story.participants} />}
        {compact ? <><p>{reading.deck(story)}</p><details className="wr-journal-read"><summary>Read the column →</summary>{reading.paragraphs(story.body).map((paragraph, i) => <p key={i}>{paragraph}</p>)}</details></> : reading.paragraphs(story.body).map((paragraph, i) => <p key={i}>{paragraph}</p>)}
        {(story.sources?.length > 0 || story.related?.length > 0) && <details className="wr-journal-context"><summary>The numbers and sources</summary>{story.related?.map((item, i) => <div key={'note-' + i}><strong>{item.label}</strong>{reading.paragraphs(item.text).map((paragraph, n) => <p key={n}>{paragraph}</p>)}</div>)}{story.sources?.filter(source => /^https?:\/\//.test(source.url || '')).map((source, i) => <p key={'source-' + i}><a href={source.url} target="_blank" rel="noreferrer">{source.label || 'View source'}</a></p>)}</details>}
    </article>;
}

function WrWireAnalystDesk({ analysis = {}, league, search = '', ownerFilter = null, scope = '', draft = null }) {
    const [selection, setSelection] = React.useState({ scope: '', desk: 'all', limit: 4 });
    const selected = selection.scope === scope ? selection : { desk: 'all', limit: 4 };
    const reading = window.WrWireReading;
    const stories = (analysis.stories || []).filter(story => {
        const ownerMatches = !ownerFilter || !story.rosterIds?.length || (ownerFilter.ownerId
            ? story.participants?.some(person => person.ownerId && String(person.ownerId) === String(ownerFilter.ownerId))
            : String(story.season) === String(league.season) && story.rosterIds.some(id => String(id) === String(ownerFilter.rosterId)));
        return ownerMatches && reading.matches(story, search) && (selected.desk === 'all' || story.desk === selected.desk);
    });
    const desks = [['all', 'All takes'], ['scoring', 'Scoring'], ['format', 'League format'], ['rosters', 'Rosters'], ['form', 'Season form'], ...(draft ? [['draft', 'Drafts']] : [])];
    return <section className="wr-wire-analyst" aria-label={`${league.name || 'League'} opinion desk`}>
        <header><span className="wr-wire-opinion-kicker">THE ANALYST · OPINION</span><h3>A league worth arguing about.</h3><p>A closer look at the rules, rosters and decisions shaping your league.</p></header>
        <nav className="wr-wire-opinion-filters" aria-label="Opinion subjects">{desks.map(([value, label]) => <button type="button" key={value} aria-pressed={selected.desk === value} onClick={() => setSelection({ scope, desk: value, limit: 4 })}>{label}</button>)}</nav>
        {ownerFilter && <p className="wr-wire-opinion-note">Columns about this owner, plus league-wide rules that affect every team.</p>}
        {stories.slice(0, selected.limit).map(story => <WrWireOpinionCard key={story.id} story={story} />)}
        {stories.length > selected.limit && <button className="wr-wire-opinion-more" type="button" onClick={() => setSelection({ ...selected, scope, limit: selected.limit + 4 })}>More opinions · {stories.length - selected.limit} remaining</button>}
        {!stories.length && selected.desk !== 'draft' && <p className="wr-wire-opinion-note">{search.trim() || ownerFilter ? 'No columns match this view. Try another subject or clear the filters.' : 'No column here yet. We need a fuller picture before weighing in.'}</p>}
        {['all', 'draft'].includes(selected.desk) && draft}
        {analysis.coverage?.length > 0 && <details className="wr-journal-context"><summary>The analyst’s notebook</summary>{analysis.coverage.map((note, i) => <p key={i}>{note}</p>)}</details>}
    </section>;
}
window.WrWireOpinionCard = WrWireOpinionCard;
window.WrWireAnalystDesk = WrWireAnalystDesk;
