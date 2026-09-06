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
    const Gamecast = window.App.TimeLeagueGamecast;
    const EraRules = window.App.TimeLeagueEraRules;
    const UI = window.App.TimeLeagueUI;

    function computeSeasonHigh(league) {
        let best = null;
        for (const week of league.finalizedWeeks) {
            for (const result of week.results) {
                if (!best || result.total > best.points) best = { teamId: result.teamId, week: week.week, points: result.total };
            }
        }
        return best;
    }

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

    function TeamLockup({ team, standing, side }) {
        if (!team) return h('div', { className: `tl-home-team ${side}` }, h('div', { className: 'tl-home-bye' }, 'BYE'));
        return h('div', { className: `tl-home-team ${side}` },
            h(window.TimeLeagueHelmetIcon, { helmet: team.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(team.name), size: 86 }),
            h('strong', null, team.name),
            h('span', null, standing ? `${standing.wins}-${standing.losses}${standing.ties ? `-${standing.ties}` : ''} · ${standing.pointsFor.toFixed(1)} PF` : '0-0 · SEASON OPENER'));
    }

    function ActionCard({ icon, kicker, title, detail, action, tone, onClick }) {
        return h('button', { type: 'button', className: `tl-home-action ${tone || ''}`, onClick },
            h('span', { className: 'tl-home-action-icon' }, icon),
            h('span', { className: 'tl-home-action-copy' }, h('small', null, kicker), h('strong', null, title), h('span', null, detail)),
            h('span', { className: 'tl-home-action-go' }, action, ' →'));
    }

    function WrTimeLeagueHomePanel({ league, onNavigate }) {
        const standings = useMemo(() => Engine.computeStandings(league), [league]);
        const teamOf = (teamId) => league.teams.find((team) => team.teamId === teamId);
        const teamName = (teamId) => teamOf(teamId)?.name ?? teamId;
        const standingOf = (teamId) => standings.find((row) => row.teamId === teamId);
        const myTeam = league.teams.find((team) => team.manager === 'human') ?? league.teams[0];
        const myStanding = standingOf(myTeam.teamId);
        const currentSchedule = league.schedule.find((item) => item.week === league.currentWeek);
        const currentPair = currentSchedule?.pairs.find((pair) => pair.includes(myTeam.teamId)) ?? null;
        const opponentId = currentPair?.find((teamId) => teamId !== myTeam.teamId) ?? null;
        const opponent = opponentId ? teamOf(opponentId) : null;
        const opponentStanding = opponent ? standingOf(opponent.teamId) : null;
        const lineupProblems = Engine.lineupProblems(league, myTeam.teamId);
        const pendingWaivers = league.pendingClaims.filter((claim) => claim.teamId === myTeam.teamId).length;
        const openTrades = league.trades.filter((trade) => trade.status === 'pending' && trade.toTeamId === myTeam.teamId).length;
        const lastFinalized = league.finalizedWeeks[league.finalizedWeeks.length - 1] ?? null;
        const lastMatchup = lastFinalized?.matchups.find((matchup) => matchup.home === myTeam.teamId || matchup.away === myTeam.teamId) ?? null;
        const lastResult = lastMatchup ? (lastMatchup.winner === null ? 'T' : lastMatchup.winner === myTeam.teamId ? 'W' : 'L') : null;
        const seasonHigh = useMemo(() => computeSeasonHigh(league), [league]);
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
            const headlines = Gamecast.weekHeadlines(lastFinalized.results, lastFinalized.matchups, teamName);
            const top = [...lastFinalized.results].sort((left, right) => right.total - left.total)[0];
            return {
                headline: `${teamName(top.teamId).toUpperCase()} SETS THE PACE WITH ${top.total.toFixed(1)}`,
                lede: headlines.join(' '),
            };
        }, [league, lastFinalized]);

        const heroStatus = league.phase === 'complete'
            ? 'SEASON COMPLETE'
            : lastResult
                ? `${lastResult === 'W' ? 'WIN' : lastResult === 'L' ? 'LOSS' : 'TIE'} LAST WEEK · WEEK ${Math.min(league.currentWeek, league.settings.regularSeasonWeeks)}`
                : `WEEK ${Math.min(league.currentWeek, league.settings.regularSeasonWeeks)} · SEASON OPENER`;
        const ready = lineupProblems.length === 0;

        return h('div', { className: 'tl-home' },
            h('section', { className: `tl-home-hero${league.phase === 'complete' ? ' champion' : ''}` },
                h('div', { className: 'tl-home-hero-copy' },
                    h('span', { className: 'tl-eyebrow' }, heroStatus),
                    league.phase === 'complete'
                        ? h('h1', null, champion?.teamId === myTeam.teamId ? 'You own the timeline.' : `${champion?.name ?? 'A champion'} owns the timeline.`)
                        : h('h1', null, opponent ? `${myTeam.name} vs. ${opponent.name}` : `${myTeam.name} has the week off`),
                    h('p', null, league.phase === 'complete'
                        ? `${champion?.name ?? 'The champion'} survived every era and finished on top of ${league.name}.`
                        : ready
                            ? 'Your lineup is ready. Review the matchup, make a final move, then let the week play out live.'
                            : `${lineupProblems.length} lineup ${lineupProblems.length === 1 ? 'decision needs' : 'decisions need'} your attention before kickoff.`),
                    league.phase !== 'complete' && h('div', { className: 'tl-home-hero-actions' },
                        h('button', { type: 'button', className: `tl-btn ${ready ? '' : 'primary'}`, onClick: () => onNavigate('roster') }, ready ? 'REVIEW LINEUP' : `FIX LINEUP (${lineupProblems.length})`),
                        h('button', { type: 'button', className: `tl-btn ${ready ? 'primary' : ''}`, onClick: () => onNavigate('gameday') }, 'GO TO GAME DAY →'))),
                h('div', { className: 'tl-home-matchup' },
                    league.phase === 'complete'
                        ? h('div', { className: 'tl-home-trophy' }, h('span', null, '♛'), h('strong', null, 'VAULT CHAMPION'), h('small', null, champion?.name ?? 'Season complete'))
                        : h(React.Fragment, null,
                            h(TeamLockup, { team: myTeam, standing: myStanding, side: 'mine' }),
                            h('div', { className: 'tl-home-vs' }, h('span', null, `WK ${league.currentWeek}`), h('strong', null, 'VS'), h('small', null, 'UPCOMING')),
                            h(TeamLockup, { team: opponent, standing: opponentStanding, side: 'opponent' }))),
                h('div', { className: 'tl-home-yardline one' }),
                h('div', { className: 'tl-home-yardline two' })),

            league.phase !== 'complete' && h('section', { className: 'tl-home-action-grid' },
                h(ActionCard, {
                    icon: ready ? '✓' : '!', kicker: 'LINEUP', tone: ready ? 'good' : 'warn',
                    title: ready ? 'Ready for kickoff' : `${lineupProblems.length} move${lineupProblems.length === 1 ? '' : 's'} to make`,
                    detail: ready ? 'Every starting slot is filled.' : lineupProblems[0], action: ready ? 'REVIEW' : 'FIX NOW', onClick: () => onNavigate('roster'),
                }),
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

            h('section', { className: 'tl-home-grid' },
                h('article', { className: 'tl-card tl-home-standings' },
                    h('div', { className: 'tl-card-title' }, h('span', null, 'LEAGUE TABLE'), h('button', { type: 'button', onClick: () => onNavigate('standings') }, 'FULL STANDINGS →')),
                    standings.slice(0, 5).map((row, index) => {
                        const team = teamOf(row.teamId);
                        const streak = UI.streakFor(league, row.teamId);
                        return h('div', { key: row.teamId, className: `tl-home-standing-row${row.teamId === myTeam.teamId ? ' mine' : ''}` },
                            h('span', { className: 'rank' }, index + 1),
                            h(window.TimeLeagueHelmetIcon, { helmet: team?.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(team?.name || row.teamId), size: 31 }),
                            h('span', { className: 'team' }, h('b', null, team?.name ?? row.teamId), h('small', null, row.teamId === myTeam.teamId ? 'YOUR TEAM' : team?.manager === 'ai' ? (team.aiPersona || 'AI GM').toUpperCase() : 'HUMAN GM')),
                            streak && h('span', { className: `tl-streak ${streak.kind}` }, `${streak.kind}${streak.count}`),
                            h('span', { className: 'record tabular' }, `${row.wins}-${row.losses}`),
                            h('span', { className: 'points tabular' }, row.pointsFor.toFixed(1), h('small', null, 'PF')));
                    })),

                h('article', { className: 'tl-card tl-home-pulse' },
                    h('div', { className: 'tl-pulse-masthead' },
                        h('span', null, 'THE VAULT'), h('strong', null, 'LEAGUE PULSE'), h('small', null, `WEEK ${Math.min(league.currentWeek, league.settings.regularSeasonWeeks)} EDITION`)),
                    h('h2', null, pulse.headline),
                    h('p', null, pulse.lede),
                    h('div', { className: 'tl-pulse-stats' },
                        h('span', null, h('b', { className: 'tabular' }, seasonHigh ? seasonHigh.points.toFixed(1) : '—'), h('small', null, 'SEASON HIGH')),
                        h('span', null, h('b', null, eraSpread.decades.length || '—'), h('small', null, 'ERAS IN PLAY')),
                        h('span', null, h('b', { className: 'tabular' }, eraSpread.oldest?.drawnSeason ?? '—'), h('small', null, 'OLDEST SEASON'))),
                    h('div', { className: 'tl-pulse-wire' },
                        h('span', { className: 'tl-label' }, 'LATEST FROM THE WIRE'),
                        recentActivity.length
                            ? recentActivity.slice(0, 3).map((event) => h('div', { key: event.id }, h('time', null, `W${event.week}`), h('p', null, event.message)))
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
