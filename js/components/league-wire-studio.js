// Optional, evidence-backed graphics. This dialog opens only on an explicit action.
function WrWireStudio({ league, story = null, seasons = [], race = null, initialTab, onClose }) {
    const dialog = React.useRef(null);
    const panel = React.useRef(null);
    const opener = React.useRef(document.activeElement);
    const closeRef = React.useRef(onClose);
    closeRef.current = onClose;
    const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');
    const id = value => 'wr-studio-' + uid + '-' + value;
    const keyFor = item => String(item?.league_id || item?.id || '') + ':' + String(item?.season || '');
    const model = story?.broadcast?.kind === 'comparison' && story.broadcast.teams?.length === 2 ? story.broadcast : null;
    const choices = [...new Map([...(model?.playoffSeasons || []).map(l => ({ ...l, name: league?.name })), league, ...seasons.map(s => s.league || s)].filter(Boolean).map(l => [keyFor(l), l])).values()].sort((a, b) => Number(b.season) - Number(a.season));
    const tabs = [...(model ? [['comparison', 'Comparison']] : []), ['bracket', 'Bracket'], ['path', 'Playoff path'], ...(race ? [['race', 'Race']] : [])];
    const fallbackTab = model ? 'comparison' : story?.documentary ? 'path' : race ? 'race' : 'bracket';
    const [tab, setTab] = React.useState(tabs.some(t => t[0] === initialTab) ? initialTab : fallbackTab);
    const activeTab = tabs.some(t => t[0] === tab) ? tab : fallbackTab;
    const initialLeague = story?.documentary && choices.find(l => String(l.season) === String(story.eventSeason)) || league;
    const unavailableStorySeason = story?.documentary && story.eventSeason && !choices.some(l => String(l.season) === String(story.eventSeason));
    const [selectedKey, setSelectedKey] = React.useState(keyFor(initialLeague));
    const selectedLeague = choices.find(l => keyFor(l) === selectedKey) || league;
    const selectedScope = keyFor(selectedLeague);
    const [entry, setEntry] = React.useState({ key: '', status: 'idle', data: null });
    const [revision, setRevision] = React.useState(0);
    const cache = React.useRef(new Map());
    const forceKey = React.useRef(null);
    const needsPlayoffs = activeTab === 'bracket' || activeTab === 'path';
    const current = entry.key === selectedScope ? entry : { status: 'loading', data: null };
    const retry = () => { forceKey.current = selectedScope; setRevision(n => n + 1); };
    React.useEffect(() => { panel.current?.scrollTo?.({ top: 0 }); }, [activeTab, selectedScope]);

    React.useEffect(() => {
        dialog.current?.showModal();
        return () => window.requestAnimationFrame(() => { if (opener.current?.isConnected) opener.current.focus(); });
    }, []);
    React.useEffect(() => {
        if (!needsPlayoffs) return undefined;
        let alive = true, timedOut = false;
        const controller = new window.AbortController();
        const saved = cache.current.get(selectedScope) || null;
        const force = forceKey.current === selectedScope;
        forceKey.current = null;
        if (saved && !force) { setEntry({ key: selectedScope, status: saved.status, data: saved }); return undefined; }
        setEntry({ key: selectedScope, status: 'loading', data: saved });
        const timeout = setTimeout(() => {
            timedOut = true; controller.abort();
            if (alive) setEntry({ key: selectedScope, status: 'error', data: saved, message: 'The playoff picture took too long to load. Try again.' });
        }, 30000);
        Promise.resolve().then(() => {
            if (!window.WrWirePlayoffs?.load) throw Error('Playoff coverage is unavailable. Try again.');
            return window.WrWirePlayoffs.load({ league: selectedLeague, signal: controller.signal, force });
        }).then(result => {
            if (!alive || controller.signal.aborted) return;
            if (!result || result.status === 'error') throw Error(result?.message || 'The playoff picture could not load. Try again.');
            if (result.league && keyFor(result.league) !== selectedScope) throw Error('This playoff edition could not be verified. Try again.');
            cache.current.set(selectedScope, result);
            setEntry({ key: selectedScope, status: result.status, data: result });
        }).catch(error => {
            if (alive && !timedOut && error?.name !== 'AbortError') setEntry({ key: selectedScope, status: 'error', data: saved, message: error.message || 'The playoff picture could not load. Try again.' });
        }).finally(() => clearTimeout(timeout));
        return () => { alive = false; controller.abort(); clearTimeout(timeout); };
    }, [selectedScope, needsPlayoffs, revision]);

    const close = event => { event?.stopPropagation(); event?.preventDefault(); closeRef.current?.(); };
    const keyTabs = event => {
        const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!direction && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        const index = tabs.findIndex(t => t[0] === activeTab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + direction + tabs.length) % tabs.length;
        setTab(tabs[next][0]);
        event.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus();
    };
    const data = current.data;
    return <dialog ref={dialog} className="wr-wire-studio" aria-labelledby={id('title')} onCancel={close} onClose={close}>
        <header className="wr-studio-mast"><div><h2 id={id('title')}>The Wire<span>.</span> <small>Studio</small></h2><p>{league?.name || 'Your league'}</p></div><button type="button" onClick={close} aria-label="Close Wire Studio">Close ×</button></header>
        <nav className="wr-studio-tabs" style={{ '--studio-tabs': tabs.length }} role="tablist" aria-label="Wire Studio views" onKeyDown={keyTabs}>{tabs.map(([value, label]) => <button type="button" key={value} role="tab" id={id(value + '-tab')} aria-controls={id('panel')} aria-selected={activeTab === value} tabIndex={activeTab === value ? 0 : -1} onClick={() => setTab(value)}>{label}</button>)}</nav>
        <section ref={panel} className="wr-studio-panel" id={id('panel')} role="tabpanel" aria-labelledby={id(activeTab + '-tab')} tabIndex={0}>
            {needsPlayoffs && <><div className="wr-studio-editions"><label>Season<select aria-label="Playoff season" value={selectedScope} onChange={event => setSelectedKey(event.target.value)}>{choices.map(l => <option key={keyFor(l)} value={keyFor(l)}>{l.season} · {l.name || 'League'}</option>)}</select></label><button type="button" onClick={retry} disabled={current.status === 'loading'} aria-label="Refresh playoffs" title="Refresh playoffs">↻</button></div>{unavailableStorySeason && <p className="wr-studio-notice">This story covers {story.eventSeason}, whose playoff bracket is not available in the loaded seasons. The selector above identifies the separate edition shown here.</p>}</>}
            {activeTab === 'comparison' && model && <WrWireStudioComparison key={story?.id || model.headline} model={model} />}
            {activeTab === 'race' && race && <WrWireStudioRace race={race} season={league?.season} />}
            {needsPlayoffs && <>
                {current.status === 'loading' && <p role="status" className="wr-studio-notice">{data ? 'Refreshing this playoff edition…' : 'Loading the verified playoff picture…'}</p>}
                {current.status === 'error' && <div role="alert" className="wr-studio-notice"><p>{current.message}</p>{data && <p>Showing the last available edition for this season.</p>}<button type="button" onClick={retry}>Try again</button></div>}
                {data && <><div className={'wr-studio-edition-status' + (data.provisional ? ' is-provisional' : '')}><strong>{data.provisional ? 'Provisional field' : `${data.season || selectedLeague?.season} postseason`}</strong><span>{data.provisional ? 'Places and byes can change' : 'Official bracket'}</span></div>
                    {data.message && (!data.provisional || !data.message.startsWith('If the season ended today:')) && <p className="wr-studio-notice">{data.message}</p>}
                    {activeTab === 'bracket' ? <WrWireStudioBracket key={selectedScope} data={data} ownerFirst={Number(data.season) < Number(window.S?.nflState?.season || league?.season)} /> : <WrWireStudioPath key={selectedScope} data={data} ownerFirst={Number(data.season) < Number(window.S?.nflState?.season || league?.season)} />}
                    <WrWireStudioSources notes={[...(data.notes || []), ...(data.message ? [data.message] : []), ...(data.checkedAt ? ['Checked ' + new Date(data.checkedAt).toLocaleString()] : [])]} sources={data.sources} />
                </>}
            </>}
        </section>
    </dialog>;
}

function WrWireStudioSources({ notes = [], sources = [] }) {
    const unique = [...new Map(sources.map(s => [s.url || JSON.stringify(s), s])).values()];
    const context = [...new Set(notes.map(note => typeof note === 'string' ? note : note.text || note.label).filter(Boolean))];
    return context.length || unique.length ? <details className="wr-studio-sources"><summary>Data & context</summary>{context.map((note, i) => <p key={'note-' + i}>{note}</p>)}{unique.map((source, i) => <p key={'source-' + i}>{source.url && /^https?:\/\//.test(source.url) ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.label || 'View source'}</a> : source.workbook ? source.workbook + ' · ' + source.sheet + '!' + source.range : source.label || source.text}</p>)}</details> : null;
}

function WrWireStudioComparison({ model }) {
    const series = model.series || [];
    const [seriesId, setSeriesId] = React.useState(series[0]?.id || '');
    const chosen = series.find(s => s.id === seriesId) || series[0];
    const meetings = chosen?.meetings || [];
    const [meetingId, setMeetingId] = React.useState('');
    const meeting = meetings.find(m => m.id === meetingId) || meetings[meetings.length - 1];
    const score = value => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
    const ownerFirst = !!model.ownerFirst && chosen?.id !== 'result';
    const primaryName = team => ownerFirst ? team.ownerName || team.name : team.teamName || team.name;
    const secondaryName = team => ownerFirst ? team.teamName : team.ownerName;
    const hasWins = chosen?.wins?.length === 2 && chosen.wins.every(n => typeof n === 'number' && Number.isFinite(n));
    const points = meeting?.points || [];
    const hasTrack = points.length === 2 && points.every(p => typeof p === 'number' && Number.isFinite(p) && p >= 0) && points[0] + points[1] > 0;
    return <article className="wr-studio-comparison">
        <div className="wr-studio-eyebrow">{model.eyebrow || 'Matchup profile'} · {model.season}</div><h3>{model.headline}</h3>
        {series.length > 1 && <label className="wr-studio-select">Compare<select aria-label="Comparison scope" value={chosen.id} onChange={event => { setSeriesId(event.target.value); setMeetingId(''); }}>{series.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>}
        {chosen && <p className="wr-studio-scope">{chosen.label}{chosen.scope ? ' · ' + chosen.scope : ''}</p>}
        <div className="wr-studio-versus">{model.teams.map((team, i) => <React.Fragment key={team.ownerId || team.name || i}>{i === 1 && <div className="wr-studio-series">{hasWins ? <><strong>{chosen.wins[0]}<span>–</span>{chosen.wins[1]}</strong><small>{chosen.ties ? chosen.ties + ' tied meeting' + (chosen.ties === 1 ? '' : 's') : 'Wins in this comparison'}</small></> : <strong className="wr-studio-vs">vs.</strong>}</div>}<div className="wr-studio-person"><span className="wr-studio-identity" aria-hidden="true" /><strong>{primaryName(team)}</strong>{secondaryName(team) && secondaryName(team) !== primaryName(team) && <small><span>{ownerFirst ? model.season + ' team' : 'Owner'}</span>{secondaryName(team)}</small>}</div></React.Fragment>)}</div>
        {model.teams.some(t => t.record != null || t.average != null) && <><p className="wr-studio-now-label">{model.season}{model.throughWeek ? ' · Through Week ' + model.throughWeek : ''}{model.recordScope ? ' · ' + model.recordScope : ''}</p><div className="wr-studio-now">{model.teams.map((team, i) => <div key={i}><strong>{team.record ?? '—'}</strong><small>{team.h2hRecord != null ? 'Season H2H: ' + team.h2hRecord : 'Season record'}</small>{team.average != null && <small>{score(team.average)} points per week</small>}</div>)}</div></>}
        {model.trajectory?.weeks?.length > 0 && <WrWireStudioTrajectory model={model} />}
        {meeting && <div className="wr-studio-replay"><div className="wr-studio-replay-heading"><h4>{meetings.length > 1 ? 'Revisit the meetings' : 'The recorded result'}</h4>{meetings.length > 1 && <label>Meeting<select aria-label="Recorded meeting" value={meeting.id} onChange={event => setMeetingId(event.target.value)}>{meetings.map(m => <option key={m.id} value={m.id}>{m.label || [m.season, m.week ? 'Week ' + m.week : ''].filter(Boolean).join(' · ')}</option>)}</select></label>}</div>
            {meetings.length > 1 && <ol className="wr-studio-meeting-timeline" aria-label="Meeting timeline">{meetings.map(m => {
                const complete = m.points?.length === 2 && m.points.every(value => typeof value === 'number' && Number.isFinite(value));
                const winner = m.winnerIndex === 0 || m.winnerIndex === 1 ? m.winnerIndex : complete && m.points[0] !== m.points[1] ? m.points[0] > m.points[1] ? 0 : 1 : null;
                const winnerName = winner == null ? '' : m.ownerNames?.[winner] || m.names?.[winner] || primaryName(model.teams[winner]);
                const tied = complete && m.points[0] === m.points[1];
                const resultLabel = tied ? winner != null ? `${winnerName} · recorded winner` : 'Tied' : winner != null ? `${winnerName} won` : 'Result unavailable';
                const timelineScore = complete ? (winner === 1 && !tied ? [m.points[1], m.points[0]] : m.points).map(score).join('–') : 'Score unavailable';
                return <li key={m.id}><button type="button" aria-pressed={meeting.id === m.id} onClick={() => setMeetingId(m.id)}><span>{m.label || [m.season, m.week ? 'Week ' + m.week : ''].filter(Boolean).join(' · ')}</span><strong>{resultLabel}</strong><small>{tied && winner != null ? 'Tied · ' : ''}{timelineScore}</small></button></li>;
            })}</ol>}
            <div className="wr-studio-result" aria-live="polite"><p>{meeting.label || [meeting.season, meeting.week ? 'Week ' + meeting.week : ''].filter(Boolean).join(' · ')}</p><div className="wr-studio-result-teams">{model.teams.map((team, i) => <div key={i}><small>{meeting.ownerNames?.[i] || meeting.names?.[i] || team.name}</small>{meeting.teamNames?.[i] && meeting.teamNames[i] !== (meeting.ownerNames?.[i] || meeting.names?.[i]) && <small>{meeting.season} · {meeting.teamNames[i]}</small>}<strong>{score(points[i])}</strong></div>)}</div><small>Fantasy points</small>{hasTrack && <div className="wr-studio-result-track" aria-hidden="true"><span style={{ width: (points[0] / (points[0] + points[1]) * 100) + '%' }} /><span /></div>}{meeting.caption && <p className="wr-studio-caption">{meeting.caption}</p>}</div>
        </div>}
        {!meeting && <p className="wr-studio-notice">This comparison uses current form. No verified past meeting is included.</p>}
        <WrWireStudioSources notes={model.notes} sources={[...(model.sources || []), ...(meeting?.sources || [])]} />
    </article>;
}

function WrWireStudioTrajectory({ model }) {
    const trajectory = model.trajectory, weeks = trajectory.weeks || [];
    const [selectedWeek, setSelectedWeek] = React.useState(null);
    const selected = weeks.find(entry => entry.week === selectedWeek) || weeks[weeks.length - 1];
    if (!selected) return null;
    const valid = value => typeof value === 'number' && Number.isFinite(value);
    const values = weeks.flatMap(entry => entry.teams.map(team => team.points)).filter(valid);
    const low = Math.min(0, ...values), high = Math.max(1, ...values);
    const x = i => 48 + i * 542 / Math.max(1, weeks.length - 1), y = value => 164 - (value - low) * 140 / (high - low);
    const name = team => model.ownerFirst ? team.ownerName || team.name : team.teamName || team.name;
    return <section className="wr-studio-trajectory"><h4>The season, week by week</h4><p className="wr-studio-scope">{trajectory.season} · Completed weeks {trajectory.startWeek}–{trajectory.throughWeek} · {trajectory.recordScope}</p>
        <svg viewBox="0 0 620 195" role="img" aria-label="Weekly fantasy points for the two teams"><title>Weekly fantasy points through Week {trajectory.throughWeek}</title><line x1="48" x2="590" y1={y(0)} y2={y(0)} className="wr-studio-chart-axis" /><text x="3" y="26">{high.toFixed(0)}</text><text x="3" y="168">{low.toFixed(0)}</text>{model.teams.map((team, index) => <g key={index} className={'wr-studio-chart-team-' + index}>{weeks.every(entry => valid(entry.teams[index]?.points)) && <polyline fill="none" points={weeks.map((entry, i) => `${x(i)},${y(entry.teams[index].points)}`).join(' ')} />}{weeks.map((entry, i) => valid(entry.teams[index]?.points) && <circle key={entry.week} cx={x(i)} cy={y(entry.teams[index].points)} r={entry.week === selected.week ? 5 : 3}><title>{name(team)} · Week {entry.week}: {entry.teams[index].points.toFixed(2)}</title></circle>)}</g>)}{weeks.map((entry, i) => <text key={entry.week} x={x(i)} y="187" textAnchor="middle">{entry.week}</text>)}</svg>
        <div className="wr-studio-chart-legend">{model.teams.map((team, i) => <span key={i} className={'wr-studio-chart-team-' + i}>{name(team)}</span>)}</div>
        <div className="wr-studio-week-picks" aria-label="Inspect a completed week">{weeks.map(entry => <button type="button" key={entry.week} aria-pressed={entry.week === selected.week} onClick={() => setSelectedWeek(entry.week)}>Week {entry.week}</button>)}</div>
        <div className="wr-studio-trajectory-detail" aria-live="polite"><h4>After Week {selected.week}</h4>{model.teams.map((team, i) => <div key={i}><strong>{name(team)}</strong><span>{valid(selected.teams[i]?.points) ? selected.teams[i].points.toFixed(2) : '—'} pts</span><small>{selected.teams[i]?.record || 'Record unavailable'}{selected.teams[i]?.h2hRecord ? ' · H2H ' + selected.teams[i].h2hRecord : ''}</small></div>)}</div>
        <WrWireStudioSources notes={trajectory.notes} sources={selected.sources} />
    </section>;
}

function WrWireStudioTeamName({ team, ownerFirst = false }) {
    const primary = ownerFirst ? team?.ownerName || team?.name : team?.name;
    const secondary = ownerFirst ? team?.name : team?.ownerName;
    return <>{primary || 'Opponent to be decided'}{secondary && secondary !== primary && <span className="wr-studio-team-owner">{secondary}</span>}</>;
}

function WrWireStudioBracket({ data, ownerFirst = false }) {
    const rounds = data.rounds || [];
    const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');
    const [roundIndex, setRoundIndex] = React.useState(0);
    const [showAll, setShowAll] = React.useState(false);
    const [activeGame, setActiveGame] = React.useState(null);
    const index = Math.min(roundIndex, Math.max(0, rounds.length - 1));
    const anchor = gameId => `wr-studio-game-${uid}-${gameId}`;
    const follow = gameId => {
        const next = rounds.findIndex(round => round.games?.some(game => String(game.id) === String(gameId)));
        if (next < 0) return;
        setRoundIndex(next); setActiveGame({ id: String(gameId) });
    };
    React.useEffect(() => {
        if (!activeGame) return;
        const target = document.getElementById?.(anchor(activeGame.id));
        target?.focus({ preventScroll: true }); target?.scrollIntoView?.({ block: 'nearest' });
    }, [activeGame, index, showAll]);
    const format = points => typeof points === 'number' && Number.isFinite(points) ? points.toFixed(2) : '—';
    const routineNotes = new Set(['A current-field matchup; playoff qualification and this assignment are not final.', 'A provisional field; later-round participants have not been decided.', 'Waiting for the previous round or an official matchup assignment.']);
    const shortRound = label => label === 'Championship' ? 'Final' : label;
    return <div className="wr-studio-bracket">
        <div className="wr-studio-view-heading"><h3>The playoff bracket</h3>{rounds.length > 1 && <button className="wr-studio-all-rounds" type="button" aria-pressed={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? 'One round' : 'All rounds'}</button>}</div>
        {!rounds.length && <p>No verified playoff matchups are available for this season yet.</p>}
        {rounds.length > 1 && <nav className="wr-studio-round-nav" aria-label="Bracket rounds">{rounds.map((round, i) => <button key={round.id || i} type="button" aria-pressed={!showAll && index === i} onClick={() => { setRoundIndex(i); setShowAll(false); setActiveGame(null); }}><span>{shortRound(round.label)}</span><small>{round.weeks?.length ? 'Wk ' + round.weeks.join('–') : 'Timing unverified'}</small></button>)}</nav>}
        <div className={'wr-studio-rounds' + (showAll ? ' is-overview' : ' is-focused')}>{rounds.map((round, i) => <section key={round.id || i} className="wr-studio-round" hidden={!showAll && index !== i} aria-label={round.label}>
            <header><h4>{round.label}</h4><small>{round.weeks?.length ? 'Week ' + round.weeks.join('–') : 'Week unverified'}</small></header>
            {round.byes?.length > 0 && <div className="wr-studio-byes"><strong>{data.provisional ? 'Current byes' : 'First-round byes'}<small>{data.provisional ? 'Would enter ' : 'Through to '}{rounds[i + 1]?.label || 'the next round'}</small></strong><div>{round.byes.map(team => <span key={team.id}><WrWireStudioTeamName team={team} ownerFirst={ownerFirst} /></span>)}</div></div>}
            <div className="wr-studio-round-games">{(round.games || []).map((game, n) => <article key={game.id || n} id={anchor(game.id)} tabIndex={-1} className={'wr-studio-bracket-game' + (activeGame?.id === String(game.id) ? ' is-selected' : '')} aria-label={`${round.label} game ${game.id || n + 1}`}>
                <header className="wr-studio-game-heading"><span>Game {game.id || n + 1}</span>{!data.provisional && <span>{game.status === 'final' ? 'Final' : game.status === 'scheduled' ? 'Scheduled' : 'Awaiting verification'}</span>}</header>
                {(game.teams || []).map((team, side) => {
                    const source = game.fromGames?.find(item => item.side === side);
                    const winner = !data.provisional && team.id != null && String(team.id) === String(game.winnerId);
                    return <div className={'wr-studio-bracket-team' + (winner ? ' is-winner' : '')} key={team.id || 'side-' + side}>
                        <span>{team.id == null && source ? <button className="wr-studio-feeder" type="button" onClick={() => follow(source.id)}>Winner of Game {source.id} <span aria-hidden="true">↗</span></button> : <WrWireStudioTeamName team={team} ownerFirst={ownerFirst} />}{winner && <small>Advanced</small>}</span>
                        {!data.provisional && <strong>{format(team.points)}</strong>}
                    </div>;
                })}
                {game.note && !routineNotes.has(game.note) && <p className="wr-studio-game-note">{game.note}</p>}
                {game.nextGames?.length > 0 && <footer className="wr-studio-bracket-links">{game.nextGames.map((next, j) => <button key={next.id + ':' + j} type="button" onClick={() => follow(next.id)}>Winner → {shortRound(next.label)} <span>Game {next.id} ↗</span></button>)}</footer>}
                {!data.provisional && game.fromGames?.length > 0 && <details className="wr-studio-game-origins"><summary>Earlier games</summary>{game.fromGames.map((source, j) => <button key={source.id + ':' + j} type="button" onClick={() => follow(source.id)}>{source.label} · Game {source.id}</button>)}</details>}
            </article>)}</div>
        </section>)}</div>
    </div>;
}

function WrWireStudioPath({ data, ownerFirst = false }) {
    const paths = data.paths || [];
    const [teamId, setTeamId] = React.useState('');
    const path = paths.find(p => String(p.team.id) === teamId) || paths[0];
    const [roundIndex, setRoundIndex] = React.useState(null);
    const rounds = path?.rounds || [];
    const latestKnown = rounds.reduce((latest, r, i) => r.conditional ? latest : i, 0);
    const index = roundIndex != null && roundIndex < rounds.length ? roundIndex : latestKnown;
    const round = rounds[index];
    const score = value => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
    const primary = team => ownerFirst ? team?.ownerName || team?.name : team?.name;
    const allGames = (data.rounds || []).flatMap(r => r.games || []);
    const game = round && allGames.find(g => String(g.id) === String(round.gameId));
    const previousGameId = rounds[index - 1]?.gameId;
    const incoming = game?.fromGames?.find(source => String(source.id) === String(previousGameId));
    const otherSide = incoming ? 1 - incoming.side : -1;
    const possibleTeam = otherSide >= 0 ? game.teams?.[otherSide] : null;
    const possibleSource = game?.fromGames?.find(source => source.side === otherSide);
    const next = rounds[index + 1];
    return <div className="wr-studio-path"><h3>The road to the title</h3>{path ? <>
        <label className="wr-studio-select">Follow a team<select aria-label="Playoff path team" value={String(path.team.id)} onChange={event => { setTeamId(event.target.value); setRoundIndex(null); }}>{paths.map(p => <option key={p.team.id} value={String(p.team.id)}>{[primary(p.team), ownerFirst ? p.team.name : p.team.ownerName].filter((name, i, all) => name && all.indexOf(name) === i).join(' · ')}</option>)}</select></label>
        {!data.provisional && path.champion && <p className="wr-studio-champion">{data.season} champion · {primary(path.team)}</p>}
        {rounds.length > 1 && <nav className="wr-studio-path-stops" aria-label="Playoff rounds">{rounds.map((r, i) => <button type="button" key={i} aria-pressed={index === i} onClick={() => setRoundIndex(i)}><span className="wr-studio-dot" aria-hidden="true">{i + 1}</span><strong>{r.label === 'Championship' ? 'Final' : r.label}</strong><small>{r.weeks?.length ? 'Wk ' + r.weeks.join('–') : 'Timing unverified'}{r.bye ? ' · Bye' : r.conditional ? ' · If advancing' : ''}</small></button>)}</nav>}
        {round ? <div className="wr-studio-path-result" aria-live="polite">
            <header className="wr-studio-path-result-heading"><h4>{round.label}</h4><span>{round.weeks?.length ? 'Week ' + round.weeks.join('–') : 'Week unverified'}</span></header>
            {round.conditional ? <><p className="wr-studio-path-condition">If {primary(path.team)} advances</p><div className="wr-studio-path-opponent"><small>Possible next opponent</small><strong>{possibleTeam?.id != null ? primary(possibleTeam) : possibleSource ? 'Winner of Game ' + possibleSource.id : 'Opponent to be decided'}</strong></div><p className="wr-studio-path-caption">This round depends on advancing. No opponent is confirmed.</p></>
                : round.bye ? <><div className="wr-studio-path-opponent"><small>{data.provisional ? 'Current position' : 'First round'}</small><strong>{data.provisional ? 'Bye in this snapshot' : 'First-round bye'}</strong><span>{next ? `Next: ${next.label}${next.weeks?.length ? ' · Week ' + next.weeks.join('–') : ''}` : 'No matchup this round'}</span></div></>
                    : <><span className="wr-studio-status">{data.provisional ? 'Matchup in the current field' : round.status === 'final' ? 'Final' : round.status === 'scheduled' ? 'Scheduled' : 'Awaiting verification'}</span><div className="wr-studio-path-score"><span><WrWireStudioTeamName team={path.team} ownerFirst={ownerFirst} /></span>{!data.provisional && <strong>{score(round.points?.[0])}</strong>}</div><div className="wr-studio-path-score"><span>{typeof round.opponent === 'string' ? round.opponent : <WrWireStudioTeamName team={round.opponent} ownerFirst={ownerFirst} />}</span>{!data.provisional && <strong>{score(round.points?.[1])}</strong>}</div>{!data.provisional && round.caption && <p className="wr-studio-path-caption">{round.caption}</p>}</>}
            {next && <button className="wr-studio-path-next" type="button" onClick={() => setRoundIndex(index + 1)}>{round.bye ? 'Next round' : data.provisional || round.status !== 'final' ? 'If advancing' : 'Next round'} → {next.label}</button>}
        </div> : <p>No verified rounds are available for this team yet.</p>}
    </> : <p>No verified playoff paths are available for this season yet.</p>}</div>;
}

function WrWireStudioRace({ race, season }) {
    const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');
    const rows = [...(race.rows || [])];
    const recordOrder = rows.length > 0 && rows.every(row => [row.wins, row.losses, row.ties].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0));
    if (recordOrder) rows.sort((a, b) => (b.wins + b.ties / 2) - (a.wins + a.ties / 2) || String(a.name || a.id).localeCompare(String(b.name || b.id)));
    const scope = [season, race.throughWeek, race.futureDecisions, rows.map(row => String(row.id)).sort().join(',')].join(':');
    const [tools, setTools] = React.useState({ scope: '', open: false, teamId: '', wins: 0, focus: 0 });
    const state = tools.scope === scope ? tools : { scope, open: false, teamId: '', wins: 0, focus: 0 };
    const selected = rows.find(row => String(row.id) === state.teamId) || rows[0];
    const future = race.futureDecisions;
    const futureKnown = typeof future === 'number' && Number.isInteger(future) && future >= 0;
    const chosenWins = futureKnown && Number.isInteger(state.wins) ? Math.max(0, Math.min(state.wins, future)) : 0;
    const scenario = state.open && selected && futureKnown && window.WrWirePlayoffs?.scenario?.({ race, teamId: selected.id, wins: chosenWins });
    const detailId = 'wr-studio-race-detail-' + uid;
    const teamId = id => 'wr-studio-race-team-' + uid + '-' + rows.findIndex(row => String(row.id) === String(id));
    const openTeam = id => setTools({ ...state, scope, open: true, teamId: String(id), wins: 0, focus: state.focus + 1 });
    const closeTools = () => {
        setTools({ ...state, scope, open: false });
        window.requestAnimationFrame(() => document.getElementById?.(teamId(selected?.id))?.focus());
    };
    React.useEffect(() => {
        if (!state.open) return;
        window.requestAnimationFrame(() => {
            const panel = document.getElementById?.(detailId);
            panel?.focus({ preventScroll: true });
            panel?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
        });
    }, [state.open, state.focus, detailId]);
    const statuses = new Set(['Clinched', 'Eliminated', 'In the race']);
    const showStatus = race.supported && rows.some(row => statuses.has(row.status));
    const weeksKnown = typeof race.remainingWeeks === 'number' && Number.isInteger(race.remainingWeeks) && race.remainingWeeks >= 0;
    const median = race.decisionsPerWeek === 2;
    const context = [...(race.reason ? [race.reason] : []), ...(race.notes || []), ...(recordOrder ? ['Rows are ordered by wins plus half a tie, with equal records listed alphabetically. This is not official playoff seeding.'] : [])];
    return <div className="wr-studio-race">
        <header className="wr-studio-race-heading"><h3>The playoff race</h3><div className="wr-studio-eyebrow">{season} · {race.throughWeek > 0 ? 'Through Week ' + race.throughWeek : 'Awaiting completed results'}</div></header>
        {rows.length > 0 ? <>
            <div className="wr-studio-race-summary">
                {race.slots > 0 && <div><strong>{race.slots}</strong><span>playoff {race.slots === 1 ? 'place' : 'places'}</span></div>}
                {weeksKnown && <div><strong>{race.remainingWeeks}</strong><span>regular-season {race.remainingWeeks === 1 ? 'week' : 'weeks'} left</span></div>}
            </div>
            <p className="wr-studio-race-context">{median ? `Head-to-head + median results.${futureKnown ? ` ${future} decisions left, two per week.` : ''}` : 'Head-to-head results.'}</p>
            {!race.supported && <p className="wr-studio-race-caveat">League division or seeding rules decide the field.</p>}
            <table className="wr-studio-race-table">
                <caption><div><span>{recordOrder ? 'Record order' : 'Team records'} · not playoff seeds</span><span>Select a team ↗</span></div></caption>
                <thead><tr><th scope="col">Team</th><th scope="col">Record</th>{showStatus && <th scope="col">Race</th>}</tr></thead>
                <tbody>{rows.map(row => <tr key={row.id} className={state.open && String(selected?.id) === String(row.id) ? 'is-selected' : ''}>
                    <th scope="row"><button id={teamId(row.id)} type="button" className="wr-studio-race-team" aria-label={`Explore ${row.name || row.ownerName || 'team'}’s finish`} aria-expanded={state.open && String(selected?.id) === String(row.id)} aria-controls={detailId} onClick={() => openTeam(row.id)}><span className="wr-studio-race-team-name">{row.name || row.ownerName || 'Team'}</span>{row.ownerName && row.ownerName !== row.name && <span className="wr-studio-team-owner">{row.ownerName}</span>}</button></th>
                    <td className="wr-studio-race-record">{row.record || '—'}</td>
                    {showStatus && <td className="wr-studio-race-status">{statuses.has(row.status) && <span className={row.status === 'Clinched' ? 'is-clinched' : row.status === 'Eliminated' ? 'is-eliminated' : 'is-open'}>{row.status === 'In the race' ? 'In race' : row.status}</span>}</td>}
                </tr>)}</tbody>
            </table>
            {!state.open && <button type="button" className="wr-studio-race-explore" aria-expanded={false} aria-controls={detailId} onClick={() => openTeam(selected.id)}>Explore a team’s finish</button>}
            {state.open && selected && <section id={detailId} className="wr-studio-scenario" tabIndex={-1} aria-label="Selected team finish">
                <div className="wr-studio-scenario-heading"><h4>Explore a finish</h4><button type="button" onClick={closeTools}>Close details</button></div>
                <label>Team<select aria-label="Race scenario team" value={String(selected.id)} onChange={event => openTeam(event.target.value)}>{rows.map(row => <option key={row.id} value={String(row.id)}>{row.name}{row.ownerName && row.ownerName !== row.name ? ' · ' + row.ownerName : ''}</option>)}</select></label>
                <div className="wr-studio-race-team-detail"><strong>{selected.record || '—'} now</strong>{typeof selected.minWins === 'number' && typeof selected.maxWins === 'number' && Number.isFinite(selected.minWins) && Number.isFinite(selected.maxWins) && <span>Possible final wins: {selected.minWins === selected.maxWins ? selected.minWins : selected.minWins + '–' + selected.maxWins}. This is a range, not a forecast.</span>}{selected.needed && <p>{selected.needed}</p>}</div>
                {scenario ? <>
                    <label className="wr-studio-scenario-slider">Additional wins{median ? ' · head-to-head + median' : ''}<input aria-label="Additional wins" type="range" min="0" max={future} step="1" value={chosenWins} disabled={future === 0} onChange={event => setTools({ ...state, scope, wins: Number(event.target.value) })} /><span>{chosenWins} wins from {future} remaining {median ? 'head-to-head + median decisions' : 'games'}</span></label>
                    <div className="wr-studio-scenario-result" aria-live="polite"><strong>{scenario.finalRecord}</strong><span>Final record in this scenario</span><h4>{scenario.standing}</h4>{scenario.bestBound != null && <p>Record-based finish bounds: No. {scenario.bestBound}–{scenario.worstBound}</p>}<p>{scenario.explanation}</p><small>{scenario.notes?.[0]}</small></div>
                    <WrWireStudioSources notes={scenario.notes?.slice(1)} />
                </> : <p className="wr-studio-scope">A finish scenario needs a verified remaining schedule and complete records.</p>}
            </section>}
        </> : <p className="wr-studio-notice">{race.reason || 'Complete regular-season results are needed before showing the playoff race.'}</p>}
        <WrWireStudioSources notes={context} />
    </div>;
}

window.WrWireStudio = WrWireStudio;
