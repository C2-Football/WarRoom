// ══════════════════════════════════════════════════════════════════
// js/components/time-league-home-panel.js — window.WrTimeLeagueHomePanel
// Matchup-first league home. The most important player decisions lead the
// page; the Vault Gazette survives as flavor in the League Pulse below.
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
            h(window.TimeLeagueHelmetIcon, { helmet: team.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(team.name), size: 86 }),
            h('strong', null, team.name),
            Number.isFinite(score) && h('strong', { className: 'tabular', style: { fontSize: 28 } }, score.toFixed(1)),
            h('span', null, standing ? `${standing.wins}-${standing.losses}${standing.ties ? `-${standing.ties}` : ''} · ${standing.pointsFor.toFixed(1)} PF` : '0-0 · SEASON OPENER'));
    }

    function ActionCard({ icon, kicker, title, detail, action, tone, onClick }) {
        return h('button', { type: 'button', className: `tl-home-action ${tone || ''}`, onClick },
            h('span', { className: 'tl-home-action-icon' }, icon),
            h('span', { className: 'tl-home-action-copy' }, h('small', null, kicker), h('strong', null, title), h('span', null, detail)),
            h('span', { className: 'tl-home-action-go' }, action, ' →'));
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
        const recentActivity = [...league.activity].reverse().slice(0, 5);
        const champion = league.championTeamId ? teamOf(league.championTeamId) : null;

        const pulse = useMemo(() => {
            if (!lastFinalized) {
                return {
                    headline: 'THE TEAMS ARE SET. THE SEASONS ARE REVEALED. NOW IT COUNTS.',
                    lede: `${league.teams.length} managers enter Week 1 with rosters pulled from across football history. Every lineup decision can change the timeline.`,
                };
            }
            const top = [...lastFinalized.results].sort((left, right) => right.total - left.total)[0];
            return {
                headline: `${teamName(top.teamId).toUpperCase()} SETS THE PACE WITH ${top.total.toFixed(1)}`,
                lede: `${lastFinalized.results.length} teams played. The league scored ${lastFinalized.results.reduce((sum, result) => sum + result.total, 0).toFixed(1)} points in Week ${lastFinalized.week}. Results and lineup leaders are below.`,
            };
        }, [league, lastFinalized]);

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
                            ? 'The final is in. Review the results below, then use Advance week to open the next bidding window.'
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
                    title: pendingWaivers ? `${pendingWaivers} claim${pendingWaivers === 1 ? '' : 's'} pending` : 'Find a difference-maker',
                    detail: league.settings.waiversEnabled ? 'Shop more than five decades of talent.' : 'Waivers are off in this league.',
                    action: 'BROWSE', onClick: () => onNavigate('waivers'),
                }),
                h(ActionCard, {
                    icon: '⇄', kicker: 'TRADE BLOCK', tone: openTrades ? 'gold' : '',
                    title: openTrades ? `${openTrades} offer${openTrades === 1 ? '' : 's'} waiting` : 'Shake up the timeline',
                    detail: league.settings.tradesEnabled ? 'Deal with rivals before game day.' : 'Trades are off in this league.',
                    action: 'OPEN', onClick: () => onNavigate('trades'),
                })),

            playoffHunt,
            showHunt ? h('details', { className: 'tl-home-secondary' }, h('summary', null, 'Full standings & team details'), h(window.WrTimeLeagueStandingsPanel, { league, onNavigate, embedded: true })) : h(window.WrTimeLeagueStandingsPanel, { league, onNavigate, embedded: true }),
            h('section', { className: 'tl-home-recap-grid' },
                h('article', { className: 'tl-card tl-home-pulse' },
                    h('div', { className: 'tl-pulse-masthead' },
                        h('span', null, 'THE VAULT'), h('strong', null, 'LEAGUE PULSE'), h('small', null, lastFinalized ? `WEEK ${lastFinalized.week} RECAP` : 'PRESEASON EDITION')),
                    h('h2', null, pulse.headline),
                    h('p', null, pulse.lede),
                    lastFinalized && h('details', { className: 'tl-weekly-report' },
                        h('summary', null, 'Read the full weekly recap'),
                        h('h3', null, 'Around the league'),
                        lastFinalized.matchups.map((match, i) => h('div', { key: i, className: 'tl-recap-match' },
                            h('strong', null, `${teamName(match.home)} ${match.homePoints.toFixed(1)} — ${match.awayPoints.toFixed(1)} ${teamName(match.away)}`),
                            h('small', null, match.homePoints === match.awayPoints ? 'A dead heat — both teams take a tie.' : `${teamName(match.homePoints > match.awayPoints ? match.home : match.away)} wins by ${Math.abs(match.homePoints - match.awayPoints).toFixed(1)} points.`))),
                        h('h3', null, 'Team report cards'),
                        [...lastFinalized.results].sort((a,b) => b.total-a.total).map((result, i) => {
                            const star = [...result.starters].sort((a,b) => b.points-a.points)[0];
                            const blanks = result.starters.filter(player => !player.stats).length;
                            return h('div', { key: result.teamId, className: 'tl-recap-match' },
                                h('strong', null, `#${i + 1} · ${teamName(result.teamId)} · ${result.total.toFixed(1)} pts`),
                                h('small', null, star ? `${star.name} (${star.drawnSeason}) led the lineup with ${star.points.toFixed(1)}. ${blanks ? `${blanks} starter(s) had no game log.` : 'Every starter had a recorded game.'}` : 'No starters recorded.'));
                        })),
                    h('div', { className: 'tl-pulse-wire' },
                        h('span', { className: 'tl-label' }, 'LATEST FROM THE WIRE'),
                        recentActivity.length
                            ? recentActivity.filter(event => !lastFinalized || event.week === lastFinalized.week).slice(0, 6).map((event) => h('div', { key: event.id }, h('time', null, `W${event.week}`), h('p', null, event.message)))
                            : h('p', { className: 'tl-empty' }, 'The wire is quiet—for now.')))),

            h('section', { className: 'tl-home-era-strip' },
                h('div', null, h('span', { className: 'tl-eyebrow' }, 'YOUR LEAGUE DNA'), h('strong', null, 'Football history is the playing field')),
                h('div', { className: 'tl-home-era-line' }, EraRules.ERA_DECADES.map((decade) => h('span', {
                    key: decade.id, className: eraSpread.decades.includes(decade.id) ? 'live' : '',
                }, h('b', null, decade.label), h('small', null, `${decade.from}–${decade.to}`)))),
                h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate('achievements') }, 'VIEW TROPHY CASE →')));
    }

    window.WrTimeLeagueHomePanel = WrTimeLeagueHomePanel;
})();
