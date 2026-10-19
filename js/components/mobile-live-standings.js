// Overview's compact read of the existing standings engine. Never reconstruct
// records here: provider/engine rows remain the source of truth.
(function (root) {
    'use strict';
    const h = React.createElement;
    const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
    const validRank = value => Number.isInteger(value) && value > 0 ? value : null;
    const sameId = (left, right) => left != null && right != null && String(left) === String(right);
    const points = value => finite(value) === null ? '—' : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const record = team => {
        const wins = finite(team.wins), losses = finite(team.losses), ties = finite(team.ties);
        if (wins === null || losses === null || wins < 0 || losses < 0 || (ties !== null && ties < 0)) return '—';
        return [wins, losses, ...(ties !== null && ties > 0 ? [ties] : [])].join('–');
    };
    const result = value => ({ W: 'Leading', L: 'Trailing', T: 'Tied', WIN: 'Leading', LOSS: 'Trailing', TIE: 'Tied', LEADING: 'Leading', TRAILING: 'Trailing', TIED: 'Tied' })[String(value || '').toUpperCase()] || null;
    const completedResult = value => typeof value === 'string' && /^[WLT]$/.test(value) ? value : null;
    // The live row also includes this week's provisional result. Only its
    // pre-week clone can supply string form; dated official form must precede
    // the displayed week. Byes and league-median outcomes are not extra games.
    function lastFive(team, baselineRows, week) {
        const baseline = baselineRows.find(row => sameId(row.rosterId, team.rosterId));
        if (Array.isArray(baseline?.form)) return baseline.form.filter(completedResult).slice(-5);
        if (!Number.isInteger(week) || week < 1 || week > 18 || !Array.isArray(team.form)) return [];
        return team.form.filter(game => game && Number.isInteger(game.week) && game.week > 0 && game.week < week && completedResult(game.result))
            .slice().sort((left, right) => left.week - right.week).slice(-5).map(game => game.result);
    }
    const formResultLabel = value => ({ W: 'Win', L: 'Loss', T: 'Tie' })[value];
    function MobileLiveStandings({ teams = [], baselineRows = [], myRosterId, week, status = 'baseline', stale = false, updatedAt = null, onOpenLeague, onOpenTeam, onRefresh }) {
        const live = status === 'live', official = status === 'official', loading = status === 'loading';
        const rows = teams.length ? teams : baselineRows;
        const validWeek = Number.isInteger(week) && week > 0 && week <= 18;
        const weekLabel = validWeek ? 'Week ' + week : 'This week';
        const nameFor = team => team.teamName || team.displayName || (team.rosterId == null ? 'Team unavailable' : 'Team ' + team.rosterId);
        const timestamp = finite(updatedAt) !== null && updatedAt > 0 ? new Date(updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
        const stateLabel = live ? (stale ? 'Last available · Provisional' : 'As it stands · Provisional') : official ? 'Official standings' : loading ? 'Updating standings…' : 'Entering ' + weekLabel.toLowerCase() + ' · Live results pending';
        const refreshLabel = loading ? 'Updating standings' : 'Refresh standings';
        return h('section', { className: 'mc-live-standings', 'aria-label': (official ? 'Standings' : 'Live standings') + (validWeek ? ', ' + weekLabel : ''), 'data-standings-status': status },
            h('div', { className: 'mc-live-standings-heading' },
                h('div', null, h('span', { className: 'mc-live-standings-eyebrow' }, weekLabel), h('h2', null, official ? 'Standings' : 'Live standings')),
                typeof onRefresh === 'function' ? h('button', { type: 'button', className: 'mc-live-standings-refresh', onClick: onRefresh, disabled: loading, 'aria-label': refreshLabel, title: refreshLabel },
                    h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
                        h('path', { d: 'M20 7v5h-5M4 17v-5h5' }), h('path', { d: 'M6.1 7a7 7 0 0 1 11.55-1.7L20 8M4 16l2.35 2.7A7 7 0 0 0 17.9 17' }))) : null),
            h('p', { className: 'mc-live-standings-state' + (stale ? ' is-stale' : ''), role: 'status' },
                live && !stale ? h('span', { className: 'mc-live-standings-dot', 'aria-hidden': true }) : null,
                stateLabel,
                stale ? h('span', { className: 'mc-live-standings-freshness' }, timestamp ? 'Last successful update ' + timestamp : 'Showing last available standings') : timestamp ? h('span', { className: 'mc-live-standings-freshness' }, 'Updated ' + timestamp) : null),
            rows.length ? h('table', { className: 'mc-live-standings-table' },
                h('caption', { className: 'mc-live-standings-sr' }, live ? 'Provisional records if this week ended at the current scores. All teams.' : official || loading ? 'Reported league records. All teams.' : 'Records entering this week. All teams.'),
                h('colgroup', null, h('col', { className: 'mc-live-standings-rank-col' }), h('col'), h('col', { className: 'mc-live-standings-record-col' }), h('col', { className: 'mc-live-standings-points-col' })),
                h('thead', null, h('tr', null, h('th', { scope: 'col', 'aria-label': 'Rank' }, '#'), h('th', { scope: 'col' }, 'Team'), h('th', { scope: 'col', title: live ? 'Provisional record as it stands' : 'Record' }, 'Record'), h('th', { scope: 'col', title: weekLabel + ' actual points' }, validWeek ? 'W' + week : 'Week'))),
                h('tbody', null, rows.map((team, index) => {
                    const own = sameId(team.rosterId, myRosterId), rank = validRank(team.rank);
                    const before = validRank(team.baselineRank) ?? validRank(baselineRows.find(row => sameId(row.rosterId, team.rosterId))?.rank);
                    const movement = live && rank !== null && before !== null ? before - rank : null;
                    const outcome = live ? result(team.currentResult) : null;
                    const form = lastFive(team, baselineRows, week);
                    const formLabel = form.length ? 'Last ' + form.length + ' completed head-to-head games, oldest to newest: ' + form.map(formResultLabel).join(', ') : 'Last 5 completed head-to-head games: form unavailable';
                    const name = nameFor(team), shownRecord = record(team), shownPoints = points(team.currentPoints);
                    const canOpen = typeof onOpenTeam === 'function' && team.rosterId != null;
                    const open = canOpen ? () => onOpenTeam(team.rosterId, team) : undefined;
                    return h('tr', { key: team.rosterId ?? index, className: (own ? 'is-own ' : '') + (canOpen ? 'is-tappable' : ''), onClick: open },
                        h('td', { className: 'mc-live-standings-rank' }, rank ?? '—'),
                        h('td', { className: 'mc-live-standings-team' },
                            canOpen ? h('button', { type: 'button', className: 'mc-live-standings-team-link', title: name, 'aria-label': name + (own ? ', your team' : '') + ', team profile', onClick: event => { event.stopPropagation(); open(); } }, name) : h('strong', { title: name }, name),
                            h('span', { className: 'mc-live-standings-team-meta' }, own ? h('span', { className: 'mc-live-standings-you' }, 'You') : null,
                                movement ? h('span', { className: 'mc-live-standings-movement', 'data-direction': movement > 0 ? 'up' : 'down', 'aria-label': (movement > 0 ? 'Up ' : 'Down ') + Math.abs(movement) + ' since entering ' + weekLabel.toLowerCase() }, (movement > 0 ? '↑' : '↓') + Math.abs(movement)) : null),
                            h('span', { className: 'mc-live-standings-form', role: 'group', 'aria-label': formLabel, title: formLabel },
                                h('span', { className: 'mc-live-standings-form-label', 'aria-hidden': true }, 'Last 5'),
                                form.length ? form.map((game, gameIndex) => h('span', { key: gameIndex, className: 'mc-live-standings-form-pill', 'data-result': game, 'aria-hidden': true }, game)) : h('span', { className: 'mc-live-standings-form-empty', 'aria-hidden': true }, '—'))),
                        h('td', { className: 'mc-live-standings-record' }, shownRecord),
                        h('td', { className: 'mc-live-standings-points' }, h('strong', null, shownPoints), outcome ? h('span', { className: 'mc-live-standings-result', 'data-result': outcome, 'aria-label': outcome + ' this week' }, outcome) : null));
                }))) : h('p', { className: 'mc-live-standings-empty', role: 'status' }, loading ? 'Standings are loading…' : 'Standings are unavailable. Open League for the latest records.'),
            h('div', { className: 'mc-live-standings-footer' },
                h('span', null, live ? (stale ? 'Saved scores · Not final' : 'Current scores · Not final') : official ? 'Reported league records' : 'Live records appear when scores are ready'),
                typeof onOpenLeague === 'function' ? h('button', { type: 'button', onClick: onOpenLeague }, 'Full standings ', h('span', { 'aria-hidden': true }, '→')) : null));
    }
    root.MobileLiveStandings = MobileLiveStandings;
    root.MobileLiveStandingsData = { lastFive };
})(window);
