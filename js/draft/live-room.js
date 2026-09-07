// Shared desktop / phone team tracker for the real draft mirror.
// Reads the same pick ledger as the board; no picks or league data are written.
(function() {
    const COLORS = { QB: '#f28dac', RB: '#63d3b1', WR: '#74bdf0', TE: '#efc271', K: '#bea4f3', DEF: '#aeb8cb' };
    const number = value => Number(value || 0).toLocaleString();
    const pro = () => typeof window.wrIsPro !== 'function' || window.wrIsPro();
    const gradeColor = letter => /^A/.test(letter) ? 'var(--good, #63d3b1)' : /^B/.test(letter) ? 'var(--gold)' : 'var(--silver)';
    const useRoom = state => React.useMemo(() => window.DraftCC.liveRoomEngine.buildLiveRoom(state), [state]);
    const CSS = `
        .live-room-workspace{display:flex;flex-direction:column;min-width:0;min-height:0;gap:10px}
        .live-room-workspace>.mock-panel{flex:1;min-height:0}
        .live-room-pane:not([hidden]){display:flex;flex-direction:column;flex:1;min-width:0;min-height:0}.live-room-pane>*{flex:1;min-height:0}
        .live-room-tabs{display:flex;gap:6px;flex-wrap:wrap}
        .live-room-tabs button,.live-room button,.live-room select{font-family:inherit;cursor:pointer}
        .live-room-tabs button,.live-room-control{min-height:44px;padding:8px 12px;border:1px solid var(--ov-6,rgba(255,255,255,.12));border-radius:8px;background:var(--surf-solid,#10161e);color:var(--silver);font-size:.76rem;font-weight:700}
        .live-room-tabs button[aria-pressed=true],.live-room-control[aria-pressed=true]{color:var(--gold);border-color:var(--gold);background:var(--acc-fill1,rgba(212,175,55,.07))}
        .live-room-tabs button:focus-visible,.live-room button:focus-visible,.live-room select:focus-visible,.live-room-pulse button:focus-visible{outline:2px solid var(--gold);outline-offset:3px}
        .live-room-pulse{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:11px 14px;margin-bottom:12px;background:var(--ov-2,rgba(255,255,255,.025));border:1px solid var(--acc-line1,rgba(212,175,55,.2));border-radius:10px;color:var(--silver);font-size:.76rem;line-height:1.5}
        .live-room-pulse strong{color:var(--white);margin-right:8px}.live-room-pulse p{margin:0}.live-room-pulse small{display:block;color:var(--silver)}
        .live-room-pulse button{min-height:44px;padding:8px 12px;border:1px solid var(--acc-line2,rgba(212,175,55,.35));border-radius:8px;background:transparent;color:var(--gold);font:700 .75rem var(--font-body,'DM Sans',sans-serif);cursor:pointer}
        .live-room{color:var(--white);background:var(--surf-solid,#10161e);border:1px solid var(--acc-line1,rgba(212,175,55,.2));border-radius:12px;font-family:var(--font-body,'DM Sans',sans-serif);min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}
        .live-room-head{padding:15px 16px 12px;border-bottom:1px solid var(--ov-5,rgba(255,255,255,.08))}
        .live-room-title{display:flex;align-items:center;justify-content:space-between;gap:8px}.live-room h3{font:700 1.2rem var(--font-display,Rajdhani,sans-serif);margin:0;letter-spacing:.04em}.live-room h4{font-size:.82rem;margin:0 0 10px}.live-room-head p{color:var(--silver);font-size:.72rem;line-height:1.5;margin:5px 0 0}
        .live-room-count{font-size:.7rem;color:var(--gold);white-space:nowrap}.live-room-tools{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}.live-room-control:disabled{opacity:.45;cursor:default}
        .live-room-scroll{overflow-y:auto;overscroll-behavior:contain;padding:12px;min-height:0;flex:1;scrollbar-gutter:stable}
        .live-room-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:9px}
        .live-room-team{width:100%;text-align:left;color:var(--white);background:var(--ov-2,rgba(255,255,255,.025));border:1px solid var(--ov-5,rgba(255,255,255,.08));border-radius:9px;padding:12px;min-width:0;transition:border-color .15s,background .15s}
        .live-room-team:hover{background:var(--acc-fill1,rgba(212,175,55,.07));border-color:var(--acc-line2,rgba(212,175,55,.35))}.live-room-team.is-clock{border-color:var(--gold);box-shadow:inset 3px 0 var(--gold)}
        .live-room-team-title{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.live-room-team-title strong{font-size:.86rem;line-height:1.4;overflow-wrap:anywhere}.live-room-grade{font:800 1.15rem var(--font-display,Rajdhani,sans-serif);white-space:nowrap}
        .live-room-team small{display:block;color:var(--silver);font-size:.7rem;line-height:1.5;margin-top:5px}.live-room-tag{display:inline-block;margin-bottom:5px;font-size:.61rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--gold)}
        .live-room-positions{display:flex;gap:5px;flex-wrap:wrap;margin:10px 0 8px}.live-room-position{color:var(--pos);font-size:.7rem;border:1px solid color-mix(in srgb,var(--pos) 30%,transparent);border-radius:5px;padding:3px 6px;background:color-mix(in srgb,var(--pos) 7%,transparent);white-space:nowrap}
        .live-room-last{border-top:1px solid var(--ov-4,rgba(255,255,255,.06));padding-top:8px;overflow-wrap:anywhere}.live-room-muted{color:var(--silver);font-size:.74rem;line-height:1.6}.live-room-empty{padding:20px 8px;text-align:center;color:var(--silver);font-size:.8rem;line-height:1.6}
        .live-room-detail-top{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-bottom:14px}.live-room-detail-top select{flex:1;min-width:0;max-width:100%}.live-room-detail-top select option{background:var(--surf-solid,#10161e)}
        .live-room-detail-title{font:700 1.45rem var(--font-display,Rajdhani,sans-serif);margin:0 0 4px;overflow-wrap:anywhere}.live-room-story{font-size:.8rem;line-height:1.6;color:var(--silver);margin:0 0 12px}
        .live-room-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(105px,1fr));gap:7px;margin:12px 0}.live-room-metric{border:1px solid var(--ov-5,rgba(255,255,255,.08));border-radius:8px;padding:10px}.live-room-metric small{display:block;font-size:.62rem;color:var(--silver);text-transform:uppercase;letter-spacing:.04em}.live-room-metric strong{display:block;font:700 1.18rem var(--font-display,Rajdhani,sans-serif);margin:4px 0}.live-room-metric span{font-size:.68rem;color:var(--silver)}
        .live-room-needs{padding:12px;background:var(--ov-2,rgba(255,255,255,.025));border-radius:8px;margin:12px 0}.live-room-needs p{margin:5px 0;font-size:.74rem;color:var(--silver);line-height:1.5}.live-room-needs strong{color:var(--gold)}
        .live-room-picks{width:100%;border-collapse:collapse;font-size:.75rem;table-layout:fixed}.live-room-picks th{font-size:.61rem;text-transform:uppercase;color:var(--silver);text-align:left;padding:9px 5px;border-bottom:1px solid var(--ov-6,rgba(255,255,255,.12))}.live-room-picks th:first-child{width:49px}.live-room-picks th:last-child{width:60px;text-align:right}.live-room-picks td{padding:5px;border-bottom:1px solid var(--ov-4,rgba(255,255,255,.06));overflow-wrap:anywhere}.live-room-picks td:last-child{text-align:right;color:var(--silver)}.live-room-player{color:var(--white);background:none;border:0;padding:7px 0;min-height:44px;text-align:left;font-weight:700;line-height:1.4;width:100%}.live-room-player:disabled{cursor:default}.live-room-player small{display:block;font-size:.65rem;font-weight:400;color:var(--silver);margin-top:3px}
        .live-room-method{font-size:.66rem;color:var(--silver);line-height:1.6;margin:12px 0 0;padding-top:10px;border-top:1px solid var(--ov-4,rgba(255,255,255,.06))}
        @media(max-width:1000px){.live-room-workspace .live-room{max-height:760px}.live-room-workspace .mock-panel{min-height:500px}}
        @media(max-width:767px){.live-room-head{padding:12px}.live-room-scroll{padding:9px}.live-room-team{padding:12px}.live-room-grid{grid-template-columns:1fr}.live-room-pulse{padding:10px;font-size:.73rem}.live-room-pulse button{width:100%}.live-room-tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.live-room-tools>.live-room-control{min-width:0;white-space:nowrap}.live-room-tools>select{grid-column:1/-1;width:100%}.live-room-detail-top>.live-room-control{padding:8px}.live-room-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
    `;

    function LiveRoomStyles() { return <style>{CSS}</style>; }

    function Positions({ team }) {
        return <div className="live-room-positions" aria-label="Players drafted by position">
            {team.positionBuild.map(row => <span className="live-room-position" key={row.pos} style={{ '--pos': COLORS[row.pos] || 'var(--silver)' }}>{row.pos} <b>{row.count}</b></span>)}
            {!team.positionBuild.length && <span className="live-room-muted">No players drafted yet</span>}
        </div>;
    }

    function nextText(team, room) {
        if (room.isComplete) return 'Draft complete';
        if (room.isAuction) return 'Auction · ' + team.pickCount + ' players won';
        if (team.isOnClock) return 'On the clock · ' + team.nextPick?.pickLabel;
        if (!team.nextPick) return team.remainingPicks == null ? 'Pick order unavailable' : 'No picks remaining';
        return 'Next ' + team.nextPick.pickLabel + ' · ' + team.picksAway + ' pick' + (team.picksAway === 1 ? '' : 's') + ' away';
    }

    function needsText(team) {
        if (!team.needsKnown) return 'Roster needs unavailable';
        const needs = team.needs.filter(n => n.status === 'open');
        if (!team.startingLineup.known && !team.needs.length) return 'No pre-draft needs recorded';
        return needs.length ? 'Needs ' + needs.map(n => n.pos).join(' · ') : (team.startingLineup.known ? 'Starting slots covered' : 'Drafted into every tracked need');
    }

    function LiveRoomPulse({ state, onOpen }) {
        const room = useRoom(state);
        const before = room.teams.filter(t => !t.isUser && t.picksBeforeUser > 0).sort((a, b) => a.picksAway - b.picksAway);
        const beforeText = room.isComplete ? 'Every team’s final class is ready to review.'
            : room.isAuction ? 'Follow every team’s roster as players sell.'
            : !state.pickOrder?.length ? 'Waiting for the draft order.'
            : state.userRosterId == null ? 'Follow every team’s next selection.'
            : room.nextUserPick?.picksAway === 0 ? (room.onClockRosterId ? 'You’re on the clock.' : 'You have the next scheduled pick.')
            : room.nextUserPick ? before.length + ' team' + (before.length === 1 ? '' : 's') + ' before you: ' + before.slice(0, 3).map(t => t.teamName).join(', ') + (before.length > 3 ? ' +' + (before.length - 3) + ' more' : '')
            : 'Your picks are complete. Follow the rest of the room.';
        return <><LiveRoomStyles /><section className="live-room-pulse" aria-label="Around the league">
            <div><p><strong>Around the league</strong>{room.pulse.summary}</p><small>{beforeText}</small></div>
            {onOpen && <button type="button" onClick={onOpen}>Team tracker · {room.teams.length} teams →</button>}
        </section></>;
    }

    function TeamDetail({ team, room, onBack, onSelect, following, onFollow }) {
        const showGrades = pro() && !room.isAuction;
        const average = team.value.averageDelta;
        return <>
            <div className="live-room-detail-top">
                <button type="button" className="live-room-control" onClick={onBack}>← All teams</button>
                <select className="live-room-control" aria-label="Team to inspect" value={team.rosterId} onChange={e => onSelect(e.target.value)}>{room.teams.map(t => <option key={t.rosterId} value={t.rosterId}>{t.teamName}{t.isUser ? ' (You)' : ''}</option>)}</select>
                {!room.isComplete && !room.isAuction && <button type="button" className="live-room-control" aria-pressed={following} onClick={onFollow}>Follow clock</button>}
            </div>
            <h2 className="live-room-detail-title">{team.teamName}{team.isUser ? ' · You' : ''}</h2>
            <p className="live-room-story">{nextText(team, room)}<br />{team.story}</p>
            <div className="live-room-metrics">
                <div className="live-room-metric"><small>Players drafted</small><strong>{team.pickCount}</strong><span>{room.isAuction ? 'Auction selections' : team.remainingPicks == null ? 'Pick order unavailable' : team.remainingPicks + ' picks remaining'}</span></div>
                <div className="live-room-metric"><small>Lineup coverage</small><strong>{team.startingLineup.known ? team.startingLineup.filled + '/' + team.startingLineup.total : '—'}</strong><span>{team.startingLineup.known ? 'starting slots filled' : room.isRookie ? 'Rookie additions' : 'Lineup settings unavailable'}</span></div>
                {showGrades && <div className="live-room-metric"><small>Draft grade</small><strong style={{ color: gradeColor(team.grade.letter) }}>{team.grade.letter}</strong><span>{team.grade.available ? (room.isComplete ? 'Final class' : 'So far · provisional') : team.pickCount ? 'Value data incomplete' : 'Awaiting first pick'}</span></div>}
                {showGrades && <div className="live-room-metric"><small>Board value / pick</small><strong>{average == null ? '—' : (average > 0 ? '+' : '') + average.toFixed(1)}</strong><span>{average == null ? 'Ranking unavailable' : 'places vs DHQ board'}</span></div>}
            </div>
            <Positions team={team} />
            <div className="live-room-needs"><h4>{team.needsBasis}</h4>
                {!team.needsKnown ? <p>Needs will appear when roster and lineup information is available.</p>
                    : team.needs.length ? team.needs.map(n => <p key={n.pos}><strong>{n.pos}</strong> · {n.label}</p>)
                        : <p>{team.startingLineup.known ? 'All starting slots are covered. Additional picks build depth.' : 'No pre-draft needs were recorded.'}</p>}
                {team.startingLineup.known && team.startingLineup.openSlots.length > 0 && <p>Still open: {team.startingLineup.openSlots.join(', ')}</p>}
            </div>
            <h4>Draft class · latest first</h4>
            {!team.picks.length ? <div className="live-room-empty">{team.teamName} hasn’t selected a player yet.</div> : <table className="live-room-picks"><thead><tr><th>Pick</th><th>Player</th><th>DHQ</th></tr></thead><tbody>
                {team.picks.slice().reverse().map(p => <tr key={p.overall + ':' + p.pid}><td>{p.pickLabel}</td><td><button type="button" className="live-room-player" disabled={!p.pid || typeof window.openPlayerModal !== 'function'} onClick={() => window.openPlayerModal(p.pid)}>{p.name}<small><span style={{ color: COLORS[p.pos] }}>{p.pos}</span>{p.team ? ' · ' + p.team : ''}{showGrades && p.valueDelta != null ? ' · ' + (p.valueDelta > 0 ? '+' : '') + p.valueDelta + ' vs board' : ''}</small></button></td><td>{p.dhq > 0 ? number(p.dhq) : '—'}</td></tr>)}
            </tbody></table>}
            {showGrades && <p className="live-room-method">{team.grade.basis}{team.grade.available ? '' : ' · ' + team.grade.reason} Positive board value means selected later than the common DHQ rank; negative means earlier. {team.value.rankedPicks}/{team.pickCount} picks ranked. {room.isComplete ? '' : 'Grades can change as the draft continues.'}</p>}
        </>;
    }

    function LiveRoomPanel({ state }) {
        const room = useRoom(state);
        const [selectedId, setSelectedId] = React.useState(null);
        const [following, setFollowing] = React.useState(false);
        const [filter, setFilter] = React.useState('all');
        const [sort, setSort] = React.useState('next');
        const scrollRef = React.useRef(null);
        const effectiveFilter = room.nextUserPick && !room.isComplete && !room.isAuction ? filter : 'all';
        React.useEffect(() => {
            if (following && room.onClockRosterId) setSelectedId(room.onClockRosterId);
        }, [following, room.onClockRosterId]);
        const selected = room.teamsById[following ? room.onClockRosterId : selectedId] || room.teamsById[selectedId] || null;
        const select = id => { setFollowing(false); setSelectedId(String(id)); if (scrollRef.current) scrollRef.current.scrollTop = 0; };
        const teams = room.teams.filter(t => effectiveFilter !== 'before' || (!t.isUser && t.picksBeforeUser > 0)).slice().sort((a, b) => {
            if (sort === 'value' && pro() && !room.isAuction) return (b.value.averageDelta ?? -Infinity) - (a.value.averageDelta ?? -Infinity) || a.teamName.localeCompare(b.teamName);
            if (sort === 'picks') return b.pickCount - a.pickCount || a.teamName.localeCompare(b.teamName);
            return (a.picksAway ?? Infinity) - (b.picksAway ?? Infinity) || a.teamName.localeCompare(b.teamName);
        });
        return <section className="live-room" aria-label="Live team tracker">
            <LiveRoomStyles />
            <div className="live-room-head"><div className="live-room-title"><h3>Team tracker</h3><span className="live-room-count">{room.totalPicks > 0 ? room.pickCount + '/' + room.totalPicks + ' picks' : room.pickCount + ' picks synced'}</span></div>
                <p>{room.isComplete ? 'The full picture of every team’s draft.' : 'Every roster taking shape. Select a team to inspect its entire draft.'}</p>
                {!room.isComplete && (state.liveSync?.stale || ['error', 'stale', 'offline'].includes(state.liveSync?.status)) && <p role="status" style={{ color: 'var(--warn, #efc271)' }}>Sync interrupted · showing the last received picks. Updates resume when the connection recovers.</p>}
                {!selected && <div className="live-room-tools">
                    <button type="button" className="live-room-control" aria-pressed={effectiveFilter === 'all'} onClick={() => setFilter('all')}>All teams</button>
                    {!room.isAuction && !room.isComplete && <button type="button" className="live-room-control" aria-pressed={effectiveFilter === 'before'} onClick={() => setFilter('before')} disabled={!room.nextUserPick}>Before my pick</button>}
                    <select className="live-room-control" aria-label="Sort teams" value={sort === 'value' && (!pro() || room.isAuction) ? 'next' : sort} onChange={e => setSort(e.target.value)}><option value="next">{room.isAuction || room.isComplete ? 'Team name' : 'Next to pick'}</option><option value="picks">Most picks</option>{pro() && !room.isAuction && <option value="value">Best board value</option>}</select>
                </div>}
            </div>
            <div className="live-room-scroll" ref={scrollRef}>
                {selected ? <TeamDetail team={selected} room={room} onBack={() => { setSelectedId(null); setFollowing(false); }} onSelect={select} following={following} onFollow={() => { setSelectedId(selected.rosterId); setFollowing(!following); }} />
                    : <div className="live-room-grid">{teams.map(team => <button type="button" className={'live-room-team' + (team.isOnClock ? ' is-clock' : '')} key={team.rosterId} onClick={() => select(team.rosterId)} aria-label={'Inspect ' + team.teamName + ' draft'}>
                        {(team.isOnClock || team.isUser || team.picksBeforeUser > 0) && <span className="live-room-tag">{team.isOnClock ? 'On the clock' : team.isUser ? 'Your team' : 'Picks before you'}</span>}
                        <div className="live-room-team-title"><strong>{team.teamName}</strong>{pro() && !room.isAuction && <span className="live-room-grade" style={{ color: gradeColor(team.grade.letter) }} title={team.grade.available ? 'Draft grade so far' : team.grade.reason}>{team.grade.letter}</span>}</div>
                        <small>{team.pickCount} drafted · {nextText(team, room)}</small>
                        <Positions team={team} />
                        <small>{needsText(team)}</small>
                        <small className="live-room-last">{team.lastPick ? 'Last: ' + team.lastPick.name + ' · ' + team.lastPick.pickLabel : 'Waiting for first selection'} <span aria-hidden="true">→</span></small>
                    </button>)}{!teams.length && <div className="live-room-empty">{effectiveFilter === 'before' ? (room.nextUserPick?.picksAway === 0 ? (room.onClockRosterId ? 'You’re on the clock. No teams pick before you.' : 'You have the next scheduled pick. No teams pick before you.') : 'No teams pick before your next selection.') : 'Team information is loading. The tracker will fill as the draft syncs.'}</div>}</div>}
            </div>
        </section>;
    }

    window.DraftCC.LiveRoomStyles = LiveRoomStyles;
    window.DraftCC.LiveRoomPulse = LiveRoomPulse;
    window.DraftCC.LiveRoomPanel = LiveRoomPanel;
})();
