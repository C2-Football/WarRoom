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
        const champion = league.phase === 'complete' && league.championTeamId ? teamOf(league.championTeamId) : null;
        return h('div', { className: 'tl-card' },
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
                            team?.name ?? row.teamId, ' ', h('span', { className: `tl-pill${team?.manager === 'ai' ? ' info' : ''}` }, team?.manager === 'ai' ? 'AI' : 'HUM')),
                        h('td', { className: 'num tabular' }, row.wins), h('td', { className: 'num tabular' }, row.losses), h('td', { className: 'num tabular' }, row.ties),
                        h('td', { className: 'num' }, streak ? h('span', { className: `tl-streak ${streak.kind}` }, `${streak.kind}${streak.count}`) : '—'),
                        h('td', { className: 'num tabular' }, `${row.allPlayWins}-${row.allPlayLosses}`),
                        h('td', { className: 'num tabular' }, row.pointsFor.toFixed(1)), h('td', { className: 'num tabular' }, row.pointsAgainst.toFixed(1)));
                })))));
    }

    window.WrTimeLeagueStandingsPanel = WrTimeLeagueStandingsPanel;
})();
