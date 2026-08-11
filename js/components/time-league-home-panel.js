// ══════════════════════════════════════════════════════════════════
// js/components/time-league-home-panel.js — window.WrTimeLeagueHomePanel
// The League Home landing screen: my-team hero, a mini matchup (last
// played, or upcoming if the season just started), a league-wire
// snippet, a top-3 standings snippet, and quick actions into the other
// tabs. New in this pass — Duat's TimeLeagueView had no equivalent
// screen; it opened straight into a tab.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const { useMemo } = React;
    const h = React.createElement;

    const Engine = window.App.TimeLeagueEngine;
    const UI = window.App.TimeLeagueUI;

    function WrTimeLeagueHomePanel({ league, onNavigate }) {
        const standings = useMemo(() => Engine.computeStandings(league), [league]);
        const myTeam = league.teams.find((t) => t.manager === 'human') ?? league.teams[0];
        const myAvatar = UI.avatarFor(myTeam, league.teams);
        const myStanding = standings.find((s) => s.teamId === myTeam.teamId);
        const myPlace = standings.findIndex((s) => s.teamId === myTeam.teamId) + 1;
        const teamName = (teamId) => league.teams.find((t) => t.teamId === teamId)?.name ?? teamId;

        const lastFinalized = league.finalizedWeeks[league.finalizedWeeks.length - 1] ?? null;
        const lastMatchup = lastFinalized?.matchups.find((m) => m.home === myTeam.teamId || m.away === myTeam.teamId) ?? null;
        const upcomingPair = league.schedule.find((w) => w.week === league.currentWeek)?.pairs
            .find((p) => p.includes(myTeam.teamId)) ?? null;

        let matchup = null;
        if (lastMatchup) {
            const mine = lastMatchup.home === myTeam.teamId;
            matchup = {
                week: lastFinalized.week, status: 'FINAL',
                myPts: mine ? lastMatchup.homePoints : lastMatchup.awayPoints,
                oppPts: mine ? lastMatchup.awayPoints : lastMatchup.homePoints,
                oppId: mine ? lastMatchup.away : lastMatchup.home,
            };
        } else if (upcomingPair) {
            const oppId = upcomingPair[0] === myTeam.teamId ? upcomingPair[1] : upcomingPair[0];
            matchup = { week: league.currentWeek, status: 'UPCOMING', myPts: 0, oppPts: 0, oppId };
        }
        const oppTeam = matchup ? league.teams.find((t) => t.teamId === matchup.oppId) : null;
        const oppAvatar = oppTeam ? UI.avatarFor(oppTeam, league.teams) : null;

        const recentActivity = [...league.activity].reverse().slice(0, 4);
        // Team names show up mid-message ("Waivers — X files a claim…"), not at the
        // start, so find whichever team is mentioned earliest rather than a prefix match.
        const activityAvatarFor = (message) => {
            let best = null; let bestIndex = Infinity;
            for (const team of league.teams) {
                const index = message.indexOf(team.name);
                if (index !== -1 && index < bestIndex) { best = team; bestIndex = index; }
            }
            return best;
        };

        const pendingWaivers = league.pendingClaims.filter((c) => c.teamId === myTeam.teamId).length;

        return h('div', null,
            h('div', { className: 'tl-home-hero' },
                h('div', { className: 'tl-home-hero-top' },
                    h('span', { className: 'tl-avatar lg', style: { background: myAvatar.color } }, myAvatar.initials),
                    h('div', { className: 'tl-h-info' },
                        h('div', { className: 'tl-h-league' }, league.name),
                        h('div', { className: 'tl-h-sub' },
                            `${myTeam.name} · ${myStanding ? `${myStanding.wins}-${myStanding.losses}${myStanding.ties ? `-${myStanding.ties}` : ''}` : '0-0'} · ${myPlace ? `${myPlace}${['th', 'st', 'nd', 'rd'][(myPlace % 10 === 1 && myPlace % 100 !== 11) ? 1 : (myPlace % 10 === 2 && myPlace % 100 !== 12) ? 2 : (myPlace % 10 === 3 && myPlace % 100 !== 13) ? 3 : 0]} place` : ''} · Week ${league.currentWeek} of ${league.settings.regularSeasonWeeks}`)),
                    h('span', { className: `tl-pill ${league.phase === 'season' ? 'info' : 'gold'}` }, league.phase.toUpperCase())),
                matchup && oppTeam ? h('div', { className: 'tl-mini-matchup' },
                    h('div', { className: 'tl-mm-side' },
                        h('span', { className: 'tl-avatar', style: { background: myAvatar.color } }, myAvatar.initials),
                        h('div', null, h('div', { style: { fontWeight: 700, fontSize: 13 } }, myTeam.name), h('div', { className: 'tl-mm-pts tabular' }, matchup.myPts.toFixed(1)))),
                    h('div', { className: 'tl-mm-vs' }, matchup.status, h('br'), `WK ${matchup.week}`),
                    h('div', { className: 'tl-mm-side', style: { flexDirection: 'row-reverse', textAlign: 'right' } },
                        h('span', { className: 'tl-avatar', style: { background: oppAvatar.color } }, oppAvatar.initials),
                        h('div', null, h('div', { style: { fontWeight: 700, fontSize: 13 } }, oppTeam.name), h('div', { className: 'tl-mm-pts tabular' }, matchup.oppPts.toFixed(1)))))
                    : null,
                h('div', { className: 'tl-quick-actions' },
                    h('button', { className: 'tl-btn primary', onClick: () => onNavigate('gameday') }, '▶ VIEW GAMEDAY'),
                    h('button', { className: 'tl-btn', onClick: () => onNavigate('roster') }, 'SET LINEUP'),
                    h('button', { className: 'tl-btn', onClick: () => onNavigate('waivers') }, `WAIVERS${pendingWaivers ? ` (${pendingWaivers})` : ''}`))),
            h('div', { className: 'tl-grid-2' },
                h('div', { className: 'tl-card' },
                    h('div', { className: 'tl-card-title' }, h('span', null, 'League Wire'), h('span', { className: 'tl-pill' }, 'LATEST')),
                    recentActivity.length === 0
                        ? h('p', { className: 'tl-empty' }, 'Nothing on the wire yet.')
                        : recentActivity.map((event) => {
                            const team = activityAvatarFor(event.message);
                            const avatar = team ? UI.avatarFor(team, league.teams) : null;
                            return h('div', { key: event.id, className: 'tl-home-row' },
                                avatar ? h('span', { className: 'tl-avatar sm', style: { background: avatar.color } }, avatar.initials) : h('span', { className: 'tl-pill' }, event.kind.toUpperCase()),
                                h('span', { style: { flex: 1 } }, event.message),
                                h('span', { style: { color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10 } }, `WK${event.week}`));
                        })),
                h('div', { className: 'tl-card' },
                    h('div', { className: 'tl-card-title' }, h('span', null, 'Standings'), h('span', { className: 'tl-pill' }, 'TOP 3')),
                    standings.slice(0, 3).map((row, i) => {
                        const team = league.teams.find((t) => t.teamId === row.teamId);
                        const avatar = UI.avatarFor(team, league.teams);
                        return h('div', { key: row.teamId, className: 'tl-home-row' },
                            h('b', { className: 'tabular', style: { width: 16 } }, i + 1),
                            h('span', { className: 'tl-avatar sm', style: { background: avatar.color } }, avatar.initials),
                            h('span', { style: { flex: 1 } }, teamName(row.teamId)),
                            h('span', { className: 'tabular' }, `${row.wins}-${row.losses}${row.ties ? `-${row.ties}` : ''}`));
                    }),
                    h('button', { className: 'tl-btn', style: { marginTop: 10, width: '100%' }, onClick: () => onNavigate('standings') }, 'FULL STANDINGS'))));
    }

    window.WrTimeLeagueHomePanel = WrTimeLeagueHomePanel;
})();
