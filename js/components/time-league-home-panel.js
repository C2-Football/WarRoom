// ══════════════════════════════════════════════════════════════════
// js/components/time-league-home-panel.js — window.WrTimeLeagueHomePanel
// Matchup-first league home. The most important player decisions lead the
// page; recent results and league moves share the same compact visual language.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const { useMemo } = React;
    const h = React.createElement;

    const Engine = window.App.TimeLeagueEngine;
    const EraRules = window.App.TimeLeagueEraRules;

    function computeEraSpread(league) {
        const entries = league.teams.flatMap((team) => team.roster);
        const decades = new Set();
        let oldest = null;
        for (const entry of entries) {
            const decade = EraRules.decadeOf(entry.drawnSeason);
            if (decade) decades.add(decade);
            if (!oldest || entry.drawnSeason < oldest.drawnSeason) oldest = entry;
        }
        return { decades: [...decades].sort(), oldest };
    }

    function TeamLockup({ team, standing, side, score }) {
        if (!team) return h('div', { className: `tl-home-team ${side}` }, h('div', { className: 'tl-home-bye' }, 'BYE'));
        return h('div', { className: `tl-home-team ${side}` },
            h('span', { className: `tl-matchup-helmet${side === 'mine' ? ' is-left' : ''}` },
                h(window.TimeLeagueHelmetIcon, { helmet: team.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(team.name), size: 86 })),
            h('strong', null, team.name),
            Number.isFinite(score) && h('strong', { className: 'tabular', style: { fontSize: 28 } }, score.toFixed(1)),
            h('span', null, standing ? `${standing.wins}-${standing.losses}${standing.ties ? `-${standing.ties}` : ''} · ${standing.pointsFor.toFixed(1)} PF` : '0-0 · SEASON OPENER'));
    }

    function ActionCard({ icon, kicker, title, detail, tone, onClick }) {
        return h('button', { type: 'button', className: `tl-home-action ${tone || ''}`, onClick },
            h('span', { className: 'tl-home-action-icon' }, icon),
            h('span', { className: 'tl-home-action-copy' }, h('small', null, kicker), h('strong', null, title), h('span', null, detail)),
            h('span', { className: 'tl-home-action-go', 'aria-hidden': true }, '↗'));
    }

    function WrTimeLeagueHomePanel({ league, onNavigate, seatTeamId }) {
        const standings = useMemo(() => Engine.computeStandings(league), [league]);
        const teamOf = (teamId) => league.teams.find((team) => team.teamId === teamId);
        const teamName = (teamId) => teamOf(teamId)?.name ?? teamId;
        const standingOf = (teamId) => standings.find((row) => row.teamId === teamId);
        const myTeam = league.teams.find((team) => seatTeamId ? team.teamId === seatTeamId : team.manager === 'human') ?? league.teams[0];
        const myStanding = standingOf(myTeam.teamId);
        const currentSchedule = league.currentWeek > league.settings.regularSeasonWeeks ? { pairs: Engine.playoffPairs(league, league.currentWeek) } : league.schedule.find((item) => item.week === league.currentWeek);
        const postgame = league.weekStage === 'postgame';
        const justFinished = postgame ? league.finalizedWeeks[league.finalizedWeeks.length - 1] : null;
        const finishedMatch = justFinished?.matchups.find(match => match.home === myTeam.teamId || match.away === myTeam.teamId);
        const currentPair = postgame ? (finishedMatch ? [finishedMatch.home, finishedMatch.away] : null) : currentSchedule?.pairs.find((pair) => pair.includes(myTeam.teamId)) ?? null;
        const opponentId = currentPair?.find((teamId) => teamId !== myTeam.teamId) ?? null;
        const opponent = opponentId ? teamOf(opponentId) : null;
        const opponentStanding = opponent ? standingOf(opponent.teamId) : null;
        const lineupProblems = Engine.lineupProblems(league, myTeam.teamId);
        const pendingWaivers = league.pendingClaims.filter((claim) => claim.teamId === myTeam.teamId).length;
        const openTrades = league.trades.filter((trade) => trade.status === 'pending' && trade.toTeamId === myTeam.teamId).length;
        const lastFinalized = league.finalizedWeeks[league.finalizedWeeks.length - 1] ?? null;
        const lastMatchup = lastFinalized?.matchups.find((matchup) => matchup.home === myTeam.teamId || matchup.away === myTeam.teamId) ?? null;
        const lastResult = lastMatchup ? (lastMatchup.winner === null ? 'T' : lastMatchup.winner === myTeam.teamId ? 'W' : 'L') : null;
        const eraSpread = useMemo(() => computeEraSpread(league), [league]);
        const recentActivity = [...league.activity].reverse().filter(event => event.week >= (lastFinalized?.week ?? league.currentWeek) && event.kind !== 'draft' && event.kind !== 'reveal').slice(0, 3);
        const champion = league.championTeamId ? teamOf(league.championTeamId) : null;

        const weeklyLeaders = useMemo(() => {
            if (!lastFinalized) return null;
            const topTeam = [...lastFinalized.results].sort((left, right) => right.total - left.total)[0];
            const topPlayer = lastFinalized.results.flatMap(result => result.starters.map(player => ({ ...player, teamId: result.teamId }))).sort((left, right) => right.points - left.points)[0];
            const closest = [...lastFinalized.matchups].sort((left, right) => Math.abs(left.homePoints-left.awayPoints) - Math.abs(right.homePoints-right.awayPoints))[0];
            return { topTeam, topPlayer, closest };
        }, [lastFinalized]);

        const heroStatus = league.phase === 'complete'
            ? 'SEASON COMPLETE'
            : lastResult
                ? `${lastResult === 'W' ? 'WIN' : lastResult === 'L' ? 'LOSS' : 'TIE'} IN WEEK ${lastFinalized?.week ?? league.currentWeek - 1}`
                : `WEEK ${Math.min(league.currentWeek, league.settings.regularSeasonWeeks)} · SEASON OPENER`;
        const ready = lineupProblems.length === 0;
        const playoffCount = Engine.playoffCount(league);
        const showHunt = playoffCount > 0 && league.currentWeek > Math.floor(league.settings.regularSeasonWeeks / 2);
        const remaining = Math.max(0, league.settings.regularSeasonWeeks - league.finalizedWeeks.filter(week => week.week <= league.settings.regularSeasonWeeks).length);
        const playoffHunt = showHunt && h('section', { className: 'tl-card tl-playoff-hunt' },
            h('div', { className: 'tl-card-title' }, h('span', null, '🏆 Playoff Hunt'), h('small', null, remaining ? `${remaining} regular-season games left · Top ${playoffCount} advance` : 'Postseason field')),
            h('p', { className: 'tl-hint' }, remaining ? 'The field if the season ended today. The line separates playoff seeds from the chase; standings can still change.' : champion ? `${champion.name} is your champion.` : 'The regular season is settled. Follow the bracket through game day.'),
            h('div', { className: 'tl-hunt-field' }, standings.map((row, index) => h('div', { key: row.teamId, className: 'tl-hunt-team' + (index < playoffCount ? ' in-field' : '') + (index === playoffCount ? ' cut-line' : '') },
                h('span', { className: 'tl-hunt-seed' }, index < playoffCount ? `#${index+1}` : 'Chasing'),
                h('strong', null, teamName(row.teamId)), h('span', null, `${row.wins}–${row.losses}${row.ties ? '–'+row.ties : ''}`), h('small', null, `${row.pointsFor.toFixed(1)} PF`)))),
            !remaining && league.currentWeek <= Engine.seasonEndWeek(league) && h('div', { className: 'tl-hunt-bracket' }, Engine.playoffPairs(league, league.currentWeek).map((pair, index) => h('div', { key: index }, h('small', null, `WEEK ${league.currentWeek}`), h('strong', null, pair.map(teamName).join(' vs. '))))));

        if (postgame && league.phase === 'season' && justFinished) {
            const nextPair = currentSchedule?.pairs.find(pair => pair.includes(myTeam.teamId));
            const nextOpponent = nextPair ? teamOf(nextPair.find(id => id !== myTeam.teamId)) : null;
            const myScore = justFinished.results.find(result => result.teamId === myTeam.teamId)?.total;
            return h('section', { className: 'tl-home tl-week-recap', 'aria-label': `Week ${justFinished.week} recap` },
                h('header', { className: 'tl-recap-heading' },
                    h('span', { className: 'tl-eyebrow' }, 'FINAL WHISTLE'), h('h1', null, `Week ${justFinished.week} recap`),
                    h('p', null, 'The scores are final. Review the week, then select End week to roll into the next waiver window.')),
                h('section', { className: 'tl-home-hero tl-recap-result' },
                    h('div', { className: 'tl-home-hero-copy' }, h('span', { className: 'tl-eyebrow' }, 'YOUR RESULT'),
                        h('h2', null, lastResult === 'W' ? 'A win in the books.' : lastResult === 'L' ? 'A tough week. A fresh start ahead.' : lastResult === 'T' ? 'All square at the final whistle.' : 'Your bye week is complete.'),
                        h('p', null, `${myTeam.name} · ${myStanding.wins}–${myStanding.losses}${myStanding.ties ? '–' + myStanding.ties : ''} · ${myStanding.pointsFor.toFixed(1)} season points`)),
                    h('div', { className: 'tl-home-matchup' },
                        h(TeamLockup, { team: myTeam, standing: myStanding, side: 'mine', score: myScore }),
                        h('div', { className: 'tl-home-vs' }, h('span', null, `WEEK ${justFinished.week}`), h('strong', null, 'FINAL')),
                        h(TeamLockup, { team: opponent, standing: opponentStanding, side: 'opponent', score: opponent && justFinished.results.find(result => result.teamId === opponent.teamId)?.total }))),
                h('section', { className: 'tl-card tl-league-update' },
                    h('h2', null, 'Around the league'),
                    weeklyLeaders && h('div', { className: 'tl-update-highlights' },
                        weeklyLeaders.topTeam && h('div', null, h('small', null, 'High score'), h('strong', null, `${weeklyLeaders.topTeam.total.toFixed(1)} pts`), h('span', null, teamName(weeklyLeaders.topTeam.teamId))),
                        weeklyLeaders.topPlayer && h('div', null, h('small', null, 'Player of the week'), h('strong', null, weeklyLeaders.topPlayer.name), h('span', null, `${weeklyLeaders.topPlayer.points.toFixed(1)} pts · ${teamName(weeklyLeaders.topPlayer.teamId)}`))),
                    h('div', { className: 'tl-update-results', 'aria-label': `Week ${justFinished.week} results` }, justFinished.matchups.map(match =>
                        h('div', { key: `${match.home}:${match.away}`, className: 'tl-update-match' }, h('small', null, 'FINAL'),
                            [[match.home, match.homePoints], [match.away, match.awayPoints]].map(([id, points]) => h('div', { key: id, className: match.winner === id ? 'winner' : '' }, h('span', null, teamName(id)), h('strong', null, points.toFixed(1)))))))),
                h('details', { className: 'tl-home-secondary' }, h('summary', null, 'Updated standings & team profiles'), h(window.WrTimeLeagueStandingsPanel, { league, embedded: true })),
                h('section', { className: 'tl-card tl-recap-next' }, h('span', { className: 'tl-eyebrow' }, `UP NEXT · WEEK ${league.currentWeek}`),
                    h('h2', null, nextOpponent ? `${myTeam.name} vs. ${nextOpponent.name}` : 'No matchup scheduled'),
                    h('p', null, league.settings.waiversEnabled ? 'End week opens the next waiver window. Submit claims, resolve waivers, then set your lineup for kickoff.' : 'End week opens the next planning window. Review trades and set your lineup for kickoff.')));
        }

        return h('div', { className: 'tl-home' },
            league.phase === 'complete' && window.WrTimeLeagueCeremony && h(window.WrTimeLeagueCeremony, { key: league.leagueId || league.id || league.name, league, onNavigate }),
            (league.phase !== 'complete' || !window.WrTimeLeagueCeremony) && h('section', { className: `tl-home-hero${league.phase === 'complete' ? ' champion' : ''}` },
                h('div', { className: 'tl-home-hero-copy' },
                    h('span', { className: 'tl-eyebrow' }, heroStatus),
                    league.phase === 'complete'
                        ? h('h1', null, champion?.teamId === myTeam.teamId ? 'You own the timeline.' : `${champion?.name ?? 'A champion'} owns the timeline.`)
                        : h('h1', null, opponent ? `${myTeam.name} vs. ${opponent.name}` : `${myTeam.name} has the week off`),
                    h('p', null, league.phase === 'complete'
                        ? `${champion?.name ?? 'The champion'} survived every era and finished on top of ${league.name}.`
                        : postgame
                            ? 'The final is in. Review the results below, then use End week to open the next bidding window.'
                        : ready
                            ? 'Your lineup is ready. Review the matchup, make a final move, then let the week play out live.'
                            : `${lineupProblems.length} lineup ${lineupProblems.length === 1 ? 'decision needs' : 'decisions need'} your attention before kickoff.`),
                    league.phase !== 'complete' && !postgame && h('div', { className: 'tl-home-hero-actions' },
                        h('button', { type: 'button', className: `tl-btn ${ready ? '' : 'primary'}`, onClick: () => onNavigate('roster') }, ready ? 'REVIEW LINEUP' : `FIX LINEUP (${lineupProblems.length})`),
                        h('button', { type: 'button', className: `tl-btn ${ready ? 'primary' : ''}`, onClick: () => onNavigate('gameday') }, 'GO TO GAME DAY →'))),
                h('div', { className: 'tl-home-matchup' },
                    league.phase === 'complete'
                        ? h('div', { className: 'tl-home-trophy' }, h('span', null, '♛'), h('strong', null, 'VAULT CHAMPION'), h('small', null, champion?.name ?? 'Season complete'))
                        : h(React.Fragment, null,
                            h(TeamLockup, { team: myTeam, standing: myStanding, side: 'mine', score: finishedMatch ? (finishedMatch.home === myTeam.teamId ? finishedMatch.homePoints : finishedMatch.awayPoints) : undefined }),
                            h('div', { className: 'tl-home-vs' }, h('span', null, `WK ${justFinished?.week ?? league.currentWeek}`), h('strong', null, 'VS'), h('small', null, postgame ? 'FINAL' : 'UPCOMING')),
                            h(TeamLockup, { team: opponent, standing: opponentStanding, side: 'opponent', score: finishedMatch ? (finishedMatch.home === opponentId ? finishedMatch.homePoints : finishedMatch.awayPoints) : undefined }))),
                h('div', { className: 'tl-home-yardline one' }),
                h('div', { className: 'tl-home-yardline two' })),

            league.phase !== 'complete' && !postgame && h('section', { className: 'tl-home-action-grid' },
                h(ActionCard, {
                    icon: '+', kicker: 'WAIVER WIRE', tone: pendingWaivers ? 'info' : '',
                    title: 'Players',
                    detail: !league.settings.waiversEnabled ? 'Waivers are off' : pendingWaivers ? `${pendingWaivers} claim${pendingWaivers === 1 ? '' : 's'} pending` : 'Find your next addition',
                    onClick: () => onNavigate('waivers'),
                }),
                h(ActionCard, {
                    icon: '⇄', kicker: 'TRADE BLOCK', tone: openTrades ? 'gold' : '',
                    title: 'Trades',
                    detail: !league.settings.tradesEnabled ? 'Trades are off' : openTrades ? `${openTrades} offer${openTrades === 1 ? '' : 's'} waiting` : 'Make your next deal',
                    onClick: () => onNavigate('trades'),
                })),

            playoffHunt,
            showHunt ? h('details', { className: 'tl-home-secondary' }, h('summary', null, 'Full standings & team details'), h(window.WrTimeLeagueStandingsPanel, { league, onNavigate, embedded: true })) : h(window.WrTimeLeagueStandingsPanel, { league, onNavigate, embedded: true }),
            h('section', { className: 'tl-home-recap-grid' },
                h('article', { className: 'tl-card tl-league-update' },
                    h('header', { className: 'tl-league-update-heading' }, h('h2', null, 'League update'),
                        h('span', { className: 'tl-pill info' }, lastFinalized ? `Week ${lastFinalized.week} final` : 'Season opener')),
                    weeklyLeaders && h('div', { className: 'tl-update-highlights' },
                        weeklyLeaders.topTeam && h('div', null, h('small', null, 'High score'), h('strong', null, `${weeklyLeaders.topTeam.total.toFixed(1)} pts`), h('span', null, teamName(weeklyLeaders.topTeam.teamId))),
                        weeklyLeaders.topPlayer && h('div', null, h('small', null, 'Top performer'), h('strong', null, weeklyLeaders.topPlayer.name), h('span', null, `${weeklyLeaders.topPlayer.drawnSeason} · ${weeklyLeaders.topPlayer.points.toFixed(1)} pts · ${teamName(weeklyLeaders.topPlayer.teamId)}`)),
                        weeklyLeaders.closest && h('div', null, h('small', null, 'Closest game'), h('strong', null, weeklyLeaders.closest.homePoints === weeklyLeaders.closest.awayPoints ? 'Tie game' : `${Math.abs(weeklyLeaders.closest.homePoints-weeklyLeaders.closest.awayPoints).toFixed(1)}-point margin`), h('span', null, `${teamName(weeklyLeaders.closest.home)} vs. ${teamName(weeklyLeaders.closest.away)}`))),
                    lastFinalized ? h('div', { className: 'tl-update-results', 'aria-label': `Week ${lastFinalized.week} results` },
                        lastFinalized.matchups.map(match => h('div', { key: `${match.home}:${match.away}`, className: 'tl-update-match' },
                            h('small', null, 'FINAL'),
                            [[match.home,match.homePoints],[match.away,match.awayPoints]].map(([id,points]) => h('div', { key: id, className: match.winner === id ? 'winner' : '' },
                                h('span', null, teamName(id)), h('strong', null, points.toFixed(1)))))))
                        : h('p', { className: 'tl-update-empty' }, 'Week 1 results and standout performances will appear here after game day.'),
                    recentActivity.length > 0 && h('details', { className: 'tl-update-activity' }, h('summary', null, 'Recent league activity'),
                        recentActivity.map(event => h('div', { key: event.id }, h('span', null, `W${event.week}`), h('p', null, event.message)))),
                    h('footer', { className: 'tl-update-links' },
                        lastFinalized && h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate('gameday') }, 'Replays & box scores →'),
                        h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate('activity') }, 'All activity →')))),

            h('section', { className: 'tl-home-era-strip' },
                h('div', null, h('span', { className: 'tl-eyebrow' }, 'YOUR LEAGUE DNA'), h('strong', null, 'Football history is the playing field')),
                h('div', { className: 'tl-home-era-line' }, EraRules.ERA_DECADES.map((decade) => h('span', {
                    key: decade.id, className: eraSpread.decades.includes(decade.id) ? 'live' : '',
                }, h('b', null, decade.label), h('small', null, `${decade.from}–${decade.to}`)))),
                h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate('achievements') }, 'VIEW TROPHY CASE →')));
    }

    window.WrTimeLeagueHomePanel = WrTimeLeagueHomePanel;
})();
