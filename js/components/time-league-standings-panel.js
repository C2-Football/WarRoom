// ══════════════════════════════════════════════════════════════════
// js/components/time-league-standings-panel.js — window.WrTimeLeagueStandingsPanel
// Ported from the StandingsPanel portion of The Duat's app/TimeLeagueView.tsx,
// with team avatars and a computed win/loss streak column added.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const { useMemo } = React;
    const h = React.createElement;
    const Engine = window.App.TimeLeagueEngine;
    const UI = window.App.TimeLeagueUI;

    function WrTimeLeagueStandingsPanel({ league }) {
        const standings = useMemo(() => Engine.computeStandings(league), [league]);
        const teamOf = (teamId) => league.teams.find((t) => t.teamId === teamId);
        const [selectedId, setSelectedId] = React.useState(league.teams.find(team => team.manager === 'human')?.teamId);
        const selected = teamOf(selectedId) || league.teams[0];
        const selectedRow = standings.find(row => row.teamId === selected?.teamId);
        const scored = league.finalizedWeeks.filter(week => week.week <= league.settings.regularSeasonWeeks).length;
        const leader = standings[0];
        const scoringLeader = [...standings].sort((a,b) => b.pointsFor-a.pointsFor)[0];
        const past = league.finalizedWeeks.map(week => ({ week: week.week, result: week.results.find(row => row.teamId === selected?.teamId), match: week.matchups.find(match => match.home === selected?.teamId || match.away === selected?.teamId) }));
        const upcoming = league.schedule.filter(row => row.week >= league.currentWeek).map(row => {
            const pair = row.pairs.find(pair => pair.includes(selected?.teamId));
            return { week: row.week, opponent: pair ? teamOf(pair.find(id => id !== selected.teamId))?.name : 'Bye' };
        });
        const metric = (label, value, detail) => h('div', { className: 'tl-command-metric' }, h('small', null, label), h('strong', null, value), h('span', null, detail));
        const champion = league.phase === 'complete' && league.championTeamId ? teamOf(league.championTeamId) : null;
        return h('div', { className: 'tl-command-center' },
            h('div', { className: 'tl-command-metrics' },
                metric('League leader', scored ? teamOf(leader?.teamId)?.name : 'Not yet decided', scored ? `${leader.wins} wins · ${leader.losses} losses` : 'Season opener ahead'),
                metric('Scoring pace', scored ? (scoringLeader.pointsFor/scored).toFixed(1) : '—', scored ? `${teamOf(scoringLeader.teamId)?.name} · points/week` : 'No completed games'),
                metric('Weeks remaining', Math.max(0, league.settings.regularSeasonWeeks-scored), `of ${league.settings.regularSeasonWeeks} scheduled`)),
            h('div', { className: 'tl-card' },
            h('div', { className: 'tl-card-title' }, h('span', null, 'Standings'), h('small', null, `${league.finalizedWeeks.length} of ${league.settings.regularSeasonWeeks} weeks scored`)),
            champion && h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', marginBottom: 10, borderBottom: '1px solid var(--charcoal)' } },
                h('span', { style: { fontSize: 20 } }, '🏆'),
                h('div', null, h('span', { className: 'tl-label', style: { display: 'block' } }, 'Champion'), h('strong', { style: { fontFamily: 'var(--font-title)', fontSize: 16 } }, champion.name))),
            h('div', { style: { overflowX: 'auto' } }, h('table', { className: 'tl-tbl' },
                h('thead', null, h('tr', null,
                    h('th', { className: 'num' }, '#'), h('th', null, 'Team'), h('th', { className: 'num' }, 'W'), h('th', { className: 'num' }, 'L'), h('th', { className: 'num' }, 'T'),
                    h('th', { className: 'num' }, 'Streak'), h('th', { className: 'num' }, 'All-Play'), h('th', { className: 'num' }, 'PF'), h('th', { className: 'num' }, 'PA'))),
                h('tbody', null, standings.map((row, position) => {
                    const team = teamOf(row.teamId);
                    const streak = UI.streakFor(league, row.teamId);
                    return h('tr', { key: row.teamId, className: league.championTeamId === row.teamId ? 'selected' : undefined },
                        h('td', { className: 'num tabular' }, position + 1),
                        h('td', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                            h(window.TimeLeagueHelmetIcon, { helmet: team?.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(team?.name || row.teamId), size: 22 }),
                            h('button', { className: 'tl-command-team', 'aria-pressed': selected?.teamId === row.teamId, onClick: () => setSelectedId(row.teamId) }, team?.name ?? row.teamId), ' ', h('span', { className: `tl-pill${team?.manager === 'ai' ? ' info' : ''}` }, team?.manager === 'ai' ? 'AI' : 'HUM')),
                        h('td', { className: 'num tabular' }, row.wins), h('td', { className: 'num tabular' }, row.losses), h('td', { className: 'num tabular' }, row.ties),
                        h('td', { className: 'num' }, streak ? h('span', { className: `tl-streak ${streak.kind}` }, `${streak.kind}${streak.count}`) : '—'),
                        h('td', { className: 'num tabular' }, `${row.allPlayWins}-${row.allPlayLosses}`),
                        h('td', { className: 'num tabular' }, row.pointsFor.toFixed(1)), h('td', { className: 'num tabular' }, row.pointsAgainst.toFixed(1)));
                }))))),
            selected && h('section', { className: 'tl-command-intel tl-card' },
                h('div', { className: 'tl-card-title' }, h('span', null, `${selected.name} · Team intelligence`), h('small', null, 'SELECT A TEAM ABOVE')),
                h('div', { className: 'tl-command-metrics' }, metric('Record', `${selectedRow.wins}–${selectedRow.losses}–${selectedRow.ties}`, 'Wins · losses · ties'), metric('Point differential', (selectedRow.pointsFor-selectedRow.pointsAgainst).toFixed(1), 'Points for minus points against'), metric('All-play', `${selectedRow.allPlayWins}–${selectedRow.allPlayLosses}`, 'Compared against every team each week')),
                h('div', { className: 'tl-command-columns' },
                    h('div', null, h('h3', null, 'Recent form'),
                        past.length ? past.slice(-5).reverse().map(row => h('div', { key: row.week, className: 'tl-command-result' }, h('small', null, `W${row.week}`), h('strong', null, row.result ? `${row.result.total.toFixed(1)} pts` : '—'), h('span', null, !row.match ? 'Bye' : `${row.match.winner === null ? 'Tie' : row.match.winner === selected.teamId ? 'Win' : 'Loss'} vs ${teamOf(row.match.home === selected.teamId ? row.match.away : row.match.home)?.name}`))) : h('p', null, 'No games completed yet.')),
                    h('div', null, h('h3', null, 'Remaining schedule'),
                        upcoming.length ? upcoming.map(row => h('div', { key: row.week, className: 'tl-command-result' }, h('small', null, `W${row.week}`), h('strong', null, row.opponent))) : h('p', null, 'Season complete.')))));

    }

    window.WrTimeLeagueStandingsPanel = WrTimeLeagueStandingsPanel;
})();
