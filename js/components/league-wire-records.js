function WrWireRecordBook({ book, league, search = '', ownerFilter = null }) {
    const cards = window.WrWireRecords.filter(book, { search, ownerFilter, season: league.season });
    return <section className="wr-wire-record-book" aria-label={league.name + ' record book'}>
        <header><span className="wr-wire-feature-kicker">THE MARKS TO BEAT</span><h3>{league.name} record book</h3><p>Standing records from completed regular-season games{book?.throughWeek ? `, through Week ${book.throughWeek} of ${league.season}` : ''}.</p></header>
        <div className="wr-wire-record-grid">{cards.map(card => <article className="wr-journal-record" key={card.id}>
            <span>{card.title}</span><strong>{card.value.toFixed(2)}</strong><small>{card.id === 'archive-margin' ? 'point margin' : 'fantasy points'} · {card.scope}</small>
            <ul>{card.holders.map((holder, i) => <li key={i}><b>{holder.ownerName || holder.name || holder.teamName || 'Recorded holder'}</b>{holder.teamName && holder.teamName !== (holder.ownerName || holder.name) && <span>{holder.teamName}</span>}<small>{holder.season} · Week {holder.week}</small>{holder.sourceUrl && <details><summary>Score receipt</summary><a href={holder.sourceUrl} target="_blank" rel="noreferrer">View the recorded matchup ↗</a></details>}</li>)}</ul>
        </article>)}</div>
        {!cards.length && <p>{book?.cards?.length ? 'No record holders match this selection. Clear the search or choose every owner to see the league’s marks.' : 'Records appear after the first verified completed week. Earlier seasons will join the book as the archive loads.'}</p>}
        <details className="wr-journal-context"><summary>Record coverage</summary><p>{book?.complete ? 'The connected Sleeper history chain has been checked.' : 'This book covers the loaded seasons; earlier history may still be missing.'} {(book?.seasons || []).join(', ')}.</p><p>{book?.rulesChanged ? 'Scoring or starting positions changed. Comparable records use matching rules; the cross-era high keeps each season’s original scoring.' : 'Point records use matching scoring and starting positions.'} Playoffs and documented pre-Sleeper awards are separate.</p></details>
    </section>;
}
window.WrWireRecordBook = WrWireRecordBook;
