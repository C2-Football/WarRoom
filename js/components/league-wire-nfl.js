// The NFL desk keeps full player boxes behind an explicit reader action.
function WrNflGame({ game }) {
    const [open, setOpen] = React.useState(false);
    const [revision, setRevision] = React.useState(0);
    const [entry, setEntry] = React.useState({ key: '', status: 'idle', data: null });
    const key = [game.season, game.seasontype, game.week, game.id, game.away, game.home].join('|');
    const current = entry.key === key ? entry : { status: 'idle', data: null };
    const panelId = 'wr-nfl-box-' + React.useId().replace(/[^a-zA-Z0-9_-]/g, '');
    React.useEffect(() => {
        if (!open) return undefined;
        const controller = new window.AbortController();
        let alive = true;
        setEntry(old => ({ key, status: 'loading', data: old.key === key ? old.data : null }));
        Promise.resolve().then(() => window.WrWireNfl.loadBoxScore({ game, signal: controller.signal, force: revision > 0 }))
            .then(data => { if (alive && !controller.signal.aborted) setEntry({ key, status: data.status, data }); })
            .catch(error => { if (alive && error?.name !== 'AbortError') setEntry(old => ({ key, status: 'error', data: old.key === key ? old.data : null, message: error.message || 'Full player stats could not load. Try again.' })); });
        return () => { alive = false; controller.abort(); };
    }, [open, key, revision]);
    const scored = game.completed || game.state === 'in';
    const final = game.completed && game.homeScore != null && game.awayScore != null;
    const recap = window.WrWireNfl.recap(game, current.data);
    const date = new Date(game.kickoff);
    const kickoff = /POSTPONED|CANCEL|SUSPEND|DELAY/i.test(game.statusName || '') ? game.shortDetail || 'Schedule update' : game.kickoff && Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : game.shortDetail || 'Kickoff to be announced';
    const teams = [{ name: game.awayName || game.away, abbr: game.away, score: game.awayScore, periods: game.awayPeriods || [] }, { name: game.homeName || game.home, abbr: game.home, score: game.homeScore, periods: game.homePeriods || [] }];
    const periods = [...new Set(teams.flatMap(t => t.periods.map(p => p.period)))].sort((a, b) => a - b);
    return <article className={'wr-nfl-game' + (game.state === 'in' ? ' is-live' : '') + (open ? ' is-expanded' : '')}>
        <div className="wr-nfl-status">{game.completed ? game.shortDetail || 'Final' : game.state === 'in' ? game.shortDetail || 'Live' : kickoff}</div>
        <h4 className="wr-nfl-game-title">{game.awayName || game.away} at {game.homeName || game.home}</h4>
        <div className="wr-nfl-teams">{teams.map((team, i) => <div key={team.abbr} className={final && team.score > teams[1 - i].score ? 'is-winner' : ''}><span>{team.name}</span><strong>{scored ? team.score ?? '—' : '—'}</strong></div>)}</div>
        {final && <div className="wr-nfl-story"><p className="wr-nfl-recap"><strong>{recap.headline}.</strong>{recap.body && <> {recap.body}</>}</p>{recap.spotlight.map((line, i) => <p key={i}>{line}</p>)}</div>}
        {!scored && game.broadcasts?.length > 0 && <p className="wr-nfl-broadcast">{game.broadcasts.join(' · ')}</p>}
        {scored && <><button type="button" className="wr-nfl-open-box" aria-expanded={open} aria-controls={panelId} aria-label={`Box score: ${game.away} at ${game.home}`} onClick={() => setOpen(value => !value)}>{open ? 'Close box score' : 'Open box score'} <span aria-hidden="true">{open ? '−' : '+'}</span></button>
            {open && <div className="wr-nfl-box wr-nfl-full-box" id={panelId}>
                {periods.length ? <div className="wr-nfl-table-scroll" role="region" aria-label={`${game.away} at ${game.home} scoring by quarter`} tabIndex={0}><table><caption>Scoring by quarter</caption><thead><tr><th scope="col">Team</th>{periods.map(p => <th scope="col" key={p}>{p <= 4 ? p : p === 5 ? 'OT' : `${p - 4}OT`}</th>)}<th scope="col">Total</th></tr></thead><tbody>{teams.map(t => <tr key={t.abbr}><th scope="row">{t.abbr}</th>{periods.map(p => <td key={p}>{t.periods.find(row => row.period === p)?.value ?? '—'}</td>)}<td>{t.score ?? '—'}</td></tr>)}</tbody></table></div> : <p>Quarter-by-quarter scoring isn’t available yet.</p>}
                <div className="wr-nfl-box-status"><h5>Player box score</h5><button type="button" disabled={current.status === 'loading'} onClick={() => setRevision(n => n + 1)}>{current.status === 'loading' ? 'Loading…' : 'Refresh stats'}</button></div>
                {current.status === 'loading' && <p role="status">{current.data ? 'Refreshing player stats…' : 'Loading player stats…'}</p>}
                {current.status === 'error' && <div role="status" className="wr-nfl-notice"><p>{current.message}</p>{current.data && <p>Showing the last available player box for this game.</p>}<button type="button" onClick={() => setRevision(n => n + 1)}>Try again</button></div>}
                {current.data && <WrNflPlayerBox key={key} data={current.data} />}
                {game.boxScoreUrl && <a href={game.boxScoreUrl} target="_blank" rel="noopener noreferrer">Full game on ESPN ↗</a>}
            </div>}
        </>}
    </article>;
}

function WrNflPlayerBox({ data }) {
    const [teamId, setTeamId] = React.useState('');
    const [groupId, setGroupId] = React.useState('passing');
    const teams = data.teams || [], team = teams.find(t => t.id === teamId) || teams[0];
    const groups = team?.groups || [], group = groups.find(g => g.id === groupId) || groups[0];
    const statKeys = [...new Set((data.teamStats || []).flatMap(t => t.stats.map(s => s.key)))];
    const stamp = data.updatedAt || data.checkedAt;
    return <div className="wr-nfl-player-box">
        <p className="wr-nfl-freshness">Player statistics: {data.statsSource || 'ESPN'}{stamp && <> · {data.updatedAt ? 'Fetched ' : 'Checked '}{new Date(stamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</>}{!data.game.completed ? ' · Game in progress; totals may change' : ' · Official corrections may change totals'}</p>
        {data.status === 'empty' ? <p>Player stats have not been published for this game yet.</p> : <>
            <div className="wr-nfl-box-filters"><label>Team<select aria-label="Box score team" value={team?.id || ''} onChange={e => setTeamId(e.target.value)}>{teams.map(t => <option value={t.id} key={t.id}>{t.name}</option>)}</select></label><label>Stats<select aria-label="Box score category" value={group?.id || ''} onChange={e => setGroupId(e.target.value)}>{groups.map(g => <option value={g.id} key={g.id}>{g.label}</option>)}</select></label></div>
            {group?.players.length ? <div className="wr-nfl-table-scroll" role="region" aria-label={`${team.name} ${group.label.toLowerCase()} player stats`} tabIndex={0}><table><caption>{team.name} · {group.label}</caption><thead><tr><th scope="col">Player</th>{group.columns.map(c => <th scope="col" key={c.key}><abbr title={c.description}>{c.label}</abbr></th>)}</tr></thead><tbody>{group.players.map(p => <tr key={p.id}><th scope="row">{p.name}</th>{p.values.map((value, i) => <td key={group.columns[i].key}>{value ?? '—'}</td>)}</tr>)}</tbody></table></div> : <p>No {group?.label?.toLowerCase() || 'player'} entries were reported for this team.</p>}
            <p className="wr-nfl-box-note">NFL statistics, without a league scoring conversion. A dash means the stat was not provided.</p>
        </>}
        {statKeys.length > 0 && <details className="wr-nfl-team-stats"><summary>Team comparison</summary><div className="wr-nfl-table-scroll" role="region" aria-label="NFL team statistics" tabIndex={0}><table><caption>Team statistics</caption><thead><tr><th scope="col">Stat</th>{data.teamStats.map(t => <th scope="col" key={t.abbr}>{t.abbr}</th>)}</tr></thead><tbody>{statKeys.map(key => <tr key={key}><th scope="row">{data.teamStats.flatMap(t => t.stats).find(s => s.key === key)?.label}</th>{data.teamStats.map(t => <td key={t.abbr}>{t.stats.find(s => s.key === key)?.value ?? '—'}</td>)}</tr>)}</tbody></table></div></details>}
    </div>;
}

function WrNflDesk({ desk, leaders = [], onRefresh }) {
    const phaseLabel = phase => phase ? `${phase.season || ''} · ${phase.seasontype === 1 ? 'Preseason' : phase.seasontype === 3 ? 'Postseason' : 'Week'} ${phase.week}` : 'Current NFL week';
    const weekSection = (title, phase, data, previous = false) => <section className={'wr-nfl-week ' + (previous ? 'wr-nfl-previous' : 'wr-nfl-current')} aria-label={title} tabIndex={-1}>
        <header><h3>{title}</h3><span>{phaseLabel(phase)}</span></header>
        {(data.updatedAt || data.checkedAt) && <p className="wr-nfl-freshness">{data.updatedAt ? 'Scores fetched ' : 'Feed checked '}{new Date(data.updatedAt || data.checkedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{data.status === 'error' ? ' · Update unavailable' : ''}</p>}
        {data.status === 'loading' && <p role="status">Loading NFL games…</p>}
        {data.status === 'error' && <p className="wr-nfl-notice" role="status">{data.games.length ? 'Showing the last available scores. The latest update couldn’t load.' : 'These NFL games couldn’t load.'} We’ll try again shortly.</p>}
        {data.status === 'ready' && !data.games.length && <p>{previous && !phase ? 'No earlier games in this phase yet. Results will appear after the opening week.' : 'No games are listed for this week.'}</p>}
        {data.games.length > 0 && <div className="wr-nfl-games">{data.games.slice().sort((a, b) => Number(b.state === 'in') - Number(a.state === 'in') || (Date.parse(a.kickoff) || 0) - (Date.parse(b.kickoff) || 0)).map(game => <WrNflGame key={[phase?.season, phase?.week, game.id || game.away + game.home].join(':')} game={{ ...game, season: phase?.season, week: phase?.week, seasontype: phase?.seasontype }} />)}</div>}
    </section>;
    const jump = (event, selector) => { const section = event.currentTarget.closest('.wr-nfl-desk')?.querySelector(selector); section?.focus({ preventScroll: true }); section?.scrollIntoView({ block: 'start' }); };
    return <div className="wr-nfl-desk"><header className="wr-nfl-heading"><span>AROUND THE NFL</span><h3>The week in football</h3><p>This week’s matchups. Last week’s stories. The numbers behind both.</p></header>
        <nav className="wr-nfl-jump" aria-label="NFL weeks"><button type="button" onClick={e => jump(e, '.wr-nfl-current')}>This week</button><button type="button" onClick={e => jump(e, '.wr-nfl-previous')}>Last week’s results ↓</button>{onRefresh && <button type="button" onClick={onRefresh}>Refresh NFL scores</button>}</nav>
        {weekSection('This week', desk.phase, desk.current)}{weekSection('Last week’s results', desk.previousPhase, desk.previous, true)}
        {leaders.length > 0 && <section className="wr-nfl-week"><header><h3>Player spotlight</h3></header><ul className="wr-nfl-leaders">{leaders.map((leader, i) => <li key={i}><span>{leader.label}</span><strong>{leader.text}</strong></li>)}</ul></section>}
        <p className="wr-nfl-credit">Scores and game leaders: ESPN. Player boxes identify their source. Kickoff times use your local time zone. Reported totals can be delayed or corrected.</p>
    </div>;
}
window.WrNflDesk = WrNflDesk;
window.WrNflGame = WrNflGame;
window.WrNflPlayerBox = WrNflPlayerBox;
