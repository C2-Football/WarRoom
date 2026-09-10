// Command Center's weekly Sleeper scoreboard. Scores are provider snapshots,
// never inferred game completion or recomputed from a league's current roster.
function LeagueLiveScoreboard({ currentLeague, myRoster, playersData, getOwnerName, getPlayerName, setActiveTab }) {
    const service = window.App.LeagueLiveScores;
    const leagueId = currentLeague?.league_id || currentLeague?.id || '';
    const defaultWeek = service.currentWeek(currentLeague);
    const [selection, setSelection] = React.useState(null);
    const [expanded, setExpanded] = React.useState(false);
    const week = selection?.leagueId === leagueId ? selection.week : defaultWeek;
    const board = service.useScores({ league: currentLeague, week });
    const [nfl, setNfl] = React.useState({ key: '', games: [] });
    const nflKey = `${currentLeague?.season || ''}|${week}`;
    React.useEffect(() => {
        const context = window.App?.NflContext;
        if (!context?.loadScores || !/^\d{4}$/.test(String(currentLeague?.season || ''))) return;
        let alive = true, fetching = false;
        const refresh = async () => {
            if (!alive || fetching || document.visibilityState === 'hidden') return;
            fetching = true;
            try {
                const games = await context.loadScores(week, currentLeague.season, 2);
                if (alive) setNfl({ key: nflKey, games: games || [] });
            } catch (_) {
                if (alive) setNfl({ key: nflKey, games: [] });
            } finally { fetching = false; }
        };
        refresh();
        const timer = setInterval(refresh, 60000);
        document.addEventListener('visibilitychange', refresh);
        return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
    }, [nflKey]);
    const nflGames = nfl.key === nflKey ? nfl.games.slice().sort((a, b) => (new Date(a.kickoff).getTime() || 0) - (new Date(b.kickoff).getTime() || 0)) : [];
    const chopped = !!window.App?.Chopped?.isChopped?.(currentLeague);
    const own = row => myRoster?.roster_id != null && String(row.roster_id) === String(myRoster.roster_id);
    const rosterFor = row => (currentLeague?.rosters || []).find(r => String(r.roster_id) === String(row.roster_id));
    const ownerName = row => {
        const roster = rosterFor(row);
        const user = (currentLeague?.users || []).find(u => u.user_id === roster?.owner_id);
        return getOwnerName?.(row.roster_id) || user?.metadata?.team_name || user?.display_name || `Team ${row.roster_id}`;
    };
    const points = value => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(2);
    const teamPoints = row => service.rosterPoints(row);
    const groups = (board.groups || []).slice().sort((a, b) => Number(b.teams.some(own)) - Number(a.teams.some(own)));
    const ladder = (board.rows || []).filter(row => {
        const roster = rosterFor(row);
        return !roster || !window.App?.Chopped?.isAliveInWeek || window.App.Chopped.isAliveInWeek(roster, week);
    }).sort((a, b) => (teamPoints(b) ?? -Infinity) - (teamPoints(a) ?? -Infinity));
    const updated = board.updatedAt ? new Date(board.updatedAt) : null;
    const loading = ['loading', 'idle', 'refreshing'].includes(board.status);
    const hasRows = (board.rows || []).length > 0;
    const visibleLadder = expanded ? ladder : ladder.slice().sort((a, b) => Number(own(b)) - Number(own(a)));
    const boardId = `lls-board-${leagueId}`;
    const starters = row => <div className="lls-starters">
        <div className="lls-starter-head"><span>{ownerName(row)}</span><span>Actual</span></div>
        {(row.starters || []).length ? row.starters.map((pid, index) => {
            const empty = !pid || String(pid) === '0';
            const player = playersData?.[pid];
            return <div className="lls-starter" key={`${pid}-${index}`}>
                <span>{empty ? 'Empty starter slot' : (getPlayerName?.(pid) || player?.full_name || `Player ${pid}`)}
                    {!empty && player?.position && <small> {player.position}{player.team ? ` · ${player.team}` : ''}</small>}
                </span>
                <strong>{empty ? '—' : points(service.playerPoints(row, pid))}</strong>
            </div>;
        }) : <p className="lls-note">Starter details have not been reported.</p>}
    </div>;
    const team = row => <div className={`lls-team${own(row) ? ' lls-own' : ''}`} key={row.roster_id}>
        <span className="lls-team-name">{ownerName(row)}{own(row) && <small>YOU</small>}</span>
        <strong className="lls-score">{points(teamPoints(row))}</strong>
    </div>;
    const matchupTeams = rows => rows.slice().sort((a, b) => Number(own(b)) - Number(own(a)));
    const matchupHeader = rows => {
        const [left, right] = matchupTeams(rows);
        return <div className="lls-versus">
            {[left, right].map((row, index) => <React.Fragment key={row.roster_id}>
                {index === 1 && <span className="lls-vs" aria-hidden="true">VS</span>}
                <div className={`lls-side${index ? ' lls-side-right' : ''}${own(row) ? ' lls-own' : ''}`}>
                    <span className="lls-owner" title={ownerName(row)}>{ownerName(row)}</span>
                    <span className="lls-side-label">{own(row) ? 'YOUR TEAM' : 'TOTAL POINTS'}</span>
                    <strong className="lls-score">{points(teamPoints(row))}</strong>
                </div>
            </React.Fragment>)}
        </div>;
    };
    const matchupStarters = rows => {
        const [left, right] = matchupTeams(rows);
        const leftPids = left.starters || [], rightPids = right.starters || [];
        const count = Math.max(leftPids.length, rightPids.length);
        const slots = (currentLeague?.roster_positions || []).filter(slot => !['BN', 'BENCH', 'IR', 'RESERVE', 'TAXI'].includes(String(slot).toUpperCase()));
        const slotLabels = { SUPER_FLEX: 'SFLX', REC_FLEX: 'W/T', WRRB_FLEX: 'W/R', IDP_FLEX: 'IDP' };
        const playerCell = (row, pids, index, side) => {
            const pid = pids[index], reported = index < pids.length;
            const empty = !pid || String(pid) === '0';
            const player = !empty && playersData?.[pid];
            const name = !reported ? 'Not reported' : empty ? 'Empty slot' : (getPlayerName?.(pid) || player?.full_name || `Player ${pid}`);
            const actual = reported && !empty ? service.playerPoints(row, pid) : null;
            const person = <div role="cell" className={`lls-player lls-player-${side}`} title={name}><strong>{name}</strong><small>{player ? [player.position, player.team].filter(Boolean).join(' · ') : '—'}</small></div>;
            const score = <strong role="cell" className="lls-player-points">{points(actual)}</strong>;
            return side === 'left' ? <>{person}{score}</> : <>{score}{person}</>;
        };
        if (!count) return <p className="lls-note">Starter details have not been reported.</p>;
        return <div className="lls-comparison" role="table" aria-label={`${ownerName(left)} versus ${ownerName(right)} starter scores`}>
            <div className="lls-comparison-row lls-comparison-head" role="row">
                <span role="columnheader">{ownerName(left)}</span><span role="columnheader">PTS</span><span role="columnheader">SLOT</span><span role="columnheader">PTS</span><span role="columnheader">{ownerName(right)}</span>
            </div>
            {Array.from({ length: count }, (_, index) => <div className="lls-comparison-row" role="row" key={index}>
                {playerCell(left, leftPids, index, 'left')}
                <span role="cell" className="lls-slot" title={slots[index] || 'Starter slot'}>{slotLabels[slots[index]] || slots[index] || index + 1}</span>
                {playerCell(right, rightPids, index, 'right')}
            </div>)}
        </div>;
    };
    return <section className={`lls${expanded ? ' lls-expanded' : ' lls-compact'}`} aria-label="League scoreboard">
        <style>{`
            .lls{border:1px solid rgba(212,175,55,.2);border-radius:10px;background:var(--off-black,#1b1b22);padding:12px 14px;color:var(--white,#f5f2ea);margin-bottom:14px}
            .lls-header,.lls-controls{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.lls h3{margin:0;font-family:var(--font-title,'Rajdhani',sans-serif);font-size:1.5rem}.lls-note{font-size:.75rem;line-height:1.6;color:var(--text-muted,#8d887e);margin:6px 0 12px}.lls-controls label{font-size:.75rem;color:var(--silver,#bdb8ad)}
            .lls button,.lls select{border:1px solid rgba(212,175,55,.25);border-radius:6px;background:var(--black,#121217);color:var(--white,#f5f2ea);min-height:36px;padding:6px 10px;font:inherit;font-size:.75rem}.lls button{cursor:pointer}.lls button:disabled{opacity:.55;cursor:wait}.lls button:focus-visible,.lls select:focus-visible,.lls summary:focus-visible{outline:2px solid var(--gold,#d4af37);outline-offset:3px}
            .lls-grid{display:grid;align-items:start;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:12px}.lls-card{border:1px solid rgba(189,184,173,.15);border-radius:8px;background:var(--black,#121217);padding:14px;min-width:0}.lls-card-own{border-color:rgba(212,175,55,.55)}.lls-team{display:flex;gap:12px;justify-content:space-between;align-items:center;padding:8px 0}.lls-team-name{min-width:0;overflow-wrap:anywhere;font-size:.875rem}.lls-team-name small{display:inline-block;margin-left:7px;font-size:.5625rem;letter-spacing:.08em;color:var(--gold,#d4af37)}.lls-score{font-family:var(--font-mono,monospace);font-variant-numeric:tabular-nums;font-size:1.35rem;white-space:nowrap}.lls-own .lls-score{color:var(--gold,#d4af37)}
            .lls summary{cursor:pointer;font-size:.75rem;color:var(--silver,#bdb8ad);padding:10px 0 0;border-top:1px solid rgba(189,184,173,.12);margin-top:8px}.lls-starters{margin-top:12px}.lls-starter-head,.lls-starter{display:flex;justify-content:space-between;gap:12px;padding:7px 0;font-size:.75rem}.lls-starter-head{color:var(--gold,#d4af37);border-bottom:1px solid rgba(189,184,173,.12)}.lls-starter>span{min-width:0;overflow-wrap:anywhere}.lls-starter small{color:var(--text-muted,#8d887e);font-size:.625rem}.lls-starter strong{font-family:var(--font-mono,monospace);font-variant-numeric:tabular-nums;white-space:nowrap}.lls-rank{font-size:.625rem;color:var(--text-muted,#8d887e);text-transform:uppercase;letter-spacing:.08em}.lls-error{color:var(--gold,#d4af37)}.lls-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:12px}.lls-footer p{margin:0;flex:1;min-width:180px}@media(max-width:480px){.lls{padding:14px}.lls-controls{width:100%}.lls-score{font-size:1.15rem}}
        `}</style>
        <style>{`
            .lls-versus{display:grid;grid-template-columns:minmax(0,1fr) 26px minmax(0,1fr);gap:8px;align-items:stretch}.lls-side{display:grid;grid-template-rows:1fr auto auto;min-width:0;gap:3px}.lls-side-right{text-align:right}.lls-owner{font-size:.82rem;font-weight:600;overflow-wrap:anywhere;line-height:1.4}.lls-side-label{font-size:.53rem;letter-spacing:.06em;color:var(--text-muted,#8d887e)}.lls-own .lls-side-label{color:var(--gold,#d4af37)}.lls-side .lls-score{font-size:1.55rem;margin-top:2px}.lls-vs{align-self:center;text-align:center;color:var(--text-muted,#8d887e);font-size:.6rem;font-weight:600}
            .lls-expanded .lls-matchups{grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr))}.lls-expanded .lls-pair:has(details[open]){grid-column:1/-1}.lls-expanded .lls-pair:has(details[open]) .lls-versus{padding:3px 4px 10px}.lls-compact .lls-matchups>.lls-pair{flex-basis:270px}.lls-compact .lls-owner{font-size:.7rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lls-compact .lls-side .lls-score{font-size:1.12rem}.lls-compact .lls-side-label{font-size:.48rem}
            .lls-comparison{margin-top:14px}.lls-comparison-row{display:grid;grid-template-columns:minmax(0,1fr) 58px 50px 58px minmax(0,1fr);gap:8px;align-items:center;padding:10px 4px;border-top:1px solid rgba(189,184,173,.1)}.lls-comparison-row:nth-child(even){background:rgba(255,255,255,.018)}.lls-comparison-head{font-size:.62rem;color:var(--text-muted,#8d887e);padding-top:8px;padding-bottom:8px}.lls-comparison-head>span{overflow-wrap:anywhere}.lls-comparison-head>span:not(:first-child):not(:last-child){text-align:center}.lls-comparison-head>span:last-child{text-align:right}.lls-player{min-width:0;display:flex;flex-direction:column;gap:4px}.lls-player strong{font-size:.8rem;line-height:1.35;overflow-wrap:anywhere}.lls-player small{font-size:.62rem;color:var(--text-muted,#8d887e)}.lls-player-right{text-align:right}.lls-player-points{text-align:center;font-family:var(--font-mono,monospace);font-variant-numeric:tabular-nums;font-size:.87rem}.lls-slot{justify-self:center;max-width:100%;box-sizing:border-box;padding:4px;font-size:.58rem;font-weight:600;text-align:center;color:var(--gold,#d4af37);background:rgba(212,175,55,.09);border-radius:4px;overflow-wrap:anywhere}
            @media(max-width:540px){.lls-comparison-row{grid-template-columns:minmax(0,1fr) 39px 34px 39px minmax(0,1fr);gap:4px;padding:9px 0}.lls-player strong{font-size:.69rem}.lls-player-points{font-size:.69rem}.lls-player small{font-size:.55rem}.lls-comparison-head{font-size:.54rem}.lls-slot{font-size:.5rem;padding:3px}.lls-side .lls-score{font-size:1.3rem}}
        `}</style>
        <style>{`
            .lls h3{font-size:1.05rem}.lls-header{margin-bottom:10px}.lls-controls{gap:8px}.lls button,.lls select{min-height:30px;padding:4px 8px;font-size:.7rem}.lls-heading{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.lls-heading .lls-note{margin:0;font-size:.68rem}
            .lls-compact .lls-matchups{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x proximity;padding-bottom:4px;scrollbar-width:thin}.lls-compact .lls-matchups>.lls-card{flex:0 0 218px;scroll-snap-align:start;padding:8px 10px;box-sizing:border-box}.lls-compact .lls-team{padding:3px 0;gap:8px}.lls-compact .lls-team-name{font-size:.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lls-compact .lls-score{font-size:1rem}.lls-compact .lls-card .lls-note{margin:4px 0 0;font-size:.65rem}.lls-compact .lls-footer{margin-top:7px}.lls-compact .lls-footer .lls-note{font-size:.65rem}.lls-compact .lls-footer button{border:0;background:transparent;padding:2px 0;min-height:24px}
            .lls-matchups:focus-visible{outline:2px solid var(--gold,#d4af37);outline-offset:3px}@media(max-width:480px){.lls{padding:10px}.lls-controls{width:auto}.lls-header{gap:8px}.lls-heading{width:100%}.lls-compact .lls-matchups>.lls-card{flex-basis:230px}}
        `}</style>
        <div className="lls-header">
            <div className="lls-heading"><h3>{chopped ? 'Weekly scoring race' : 'Around the league'}</h3><span className="lls-note">{currentLeague?.season} · Actual points</span></div>
            <div className="lls-controls">
                <label>Week <select aria-label="Scoreboard week" value={week} onChange={event => setSelection({ leagueId, week: Number(event.target.value) })}>
                    {Array.from({ length: 18 }, (_, i) => i + 1).map(w => <option key={w} value={w}>{w}</option>)}
                </select></label>
                <button type="button" disabled={loading || board.supported === false} onClick={() => board.refresh?.()}>{loading ? 'Updating…' : 'Refresh scores'}</button>
                {hasRows && <button type="button" aria-expanded={expanded} aria-controls={boardId} onClick={() => setExpanded(!expanded)}>{expanded ? 'Collapse' : `All ${chopped ? ladder.length + ' teams' : groups.length + ' matchups'} ↓`}</button>}
            </div>
        </div>
        <div role="status" aria-live="polite">
            {board.supported === false ? <p className="lls-note">Live scores are available for connected Sleeper leagues.</p>
                : board.error || board.status === 'error' ? <p className="lls-note lls-error">{hasRows ? 'Scores could not refresh. Showing the last successful update.' : 'Scores are temporarily unavailable. Try refreshing.'}</p>
                : loading && !hasRows ? <p className="lls-note">Loading this week’s league scores…</p>
                : !hasRows ? <p className="lls-note">Sleeper has not reported matchups for this week yet.</p> : null}
        </div>
        {hasRows && <div id={boardId} className="lls-grid lls-matchups" tabIndex={expanded ? undefined : 0} role="region" aria-label={chopped ? 'Weekly team scores' : 'Weekly matchups'}>
            {chopped ? visibleLadder.map(row => <article className={`lls-card${own(row) ? ' lls-card-own' : ''}`} key={row.roster_id}>
                <div className="lls-rank">{teamPoints(row) == null ? 'Awaiting score' : `Position ${ladder.findIndex(r => teamPoints(r) === teamPoints(row)) + 1}`}</div>
                {team(row)}{expanded && <details><summary>Starter scores</summary>{starters(row)}</details>}
            </article>) : groups.map((group, i) => <article className={`lls-card${group.teams.length === 2 ? ' lls-pair' : ''}${group.teams.some(own) ? ' lls-card-own' : ''}`} key={`${group.matchupId ?? 'unpaired'}-${i}`}>
                {group.teams.length === 2 ? matchupHeader(group.teams) : group.teams.map(team)}
                {group.teams.length === 1 && <p className="lls-note">No opponent reported this week.</p>}
                {expanded && <details><summary>{group.teams.length === 2 ? 'Matchup breakdown' : 'Starter scores'}</summary>{group.teams.length === 2 ? matchupStarters(group.teams) : group.teams.map(row => <div key={row.roster_id}>{starters(row)}</div>)}</details>}
            </article>)}
        </div>}
        {expanded && nflGames.length > 0 && <details style={{ marginTop: 16 }}>
            <summary>NFL game scores · Week {week}</summary>
            <p className="lls-note">NFL scoreboard · Refreshes every minute. Kickoff times are shown in your local time.</p>
            <div className="lls-grid">{nflGames.map((game, index) => {
                const state = window.App.NflContext.gameStatus?.(game) || 'unknown';
                const kickoff = game.kickoff ? new Date(game.kickoff) : null;
                const detail = state === 'final' ? 'Final' : game.shortDetail || (state === 'live' ? 'In progress' : 'Status unavailable');
                return <div className="lls-card" key={`${game.away}-${game.home}-${index}`}>
                    <div className="lls-rank">{detail}{state === 'upcoming' && kickoff && !Number.isNaN(kickoff.getTime()) ? ` · ${kickoff.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}</div>
                    <div className="lls-team"><span>{game.away}</span><strong>{state === 'upcoming' ? '—' : game.awayScore ?? '—'}</strong></div>
                    <div className="lls-team"><span>{game.home}</span><strong>{state === 'upcoming' ? '—' : game.homeScore ?? '—'}</strong></div>
                </div>;
            })}</div>
        </details>}
        <div className="lls-footer">
            <p className="lls-note">{updated && !Number.isNaN(updated.getTime()) ? `Updated ${updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ` : ''}{expanded ? 'Sleeper scores refresh every 30 seconds while visible. Scoring may be delayed or corrected. A dash means no score was reported.' : 'Sleeper · Refreshes every 30s'}{expanded && chopped ? ' Positions are provisional; eliminations follow league results.' : ''}</p>
            {setActiveTab && <button type="button" onClick={() => setActiveTab('lineup')}>My Game Plan →</button>}
        </div>
    </section>;
}
window.LeagueLiveScoreboard = LeagueLiveScoreboard;
