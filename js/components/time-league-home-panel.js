// ══════════════════════════════════════════════════════════════════
// js/components/time-league-home-panel.js — window.WrTimeLeagueHomePanel
// The Vault Gazette: a newspaper front-page treatment for the League Home
// landing screen. Lead story text is generated from the same
// Gamecast.weekHeadlines() output that already drives the Gameday wire —
// no separate copy-generation layer, just a different container for text
// the engine already produces. Stat leaders (season high, biggest
// blowout, eras in play, oldest starter) are all computed from real
// league state, nothing fabricated.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const { useMemo } = React;
    const h = React.createElement;

    const Engine = window.App.TimeLeagueEngine;
    const Gamecast = window.App.TimeLeagueGamecast;
    const EraRules = window.App.TimeLeagueEraRules;
    const UI = window.App.TimeLeagueUI;

    /** Splits a message at the earliest team-name match so it can render bolded, like a wire caption. */
    function withBoldName(message, teams) {
        let best = null; let bestIndex = Infinity;
        for (const team of teams) {
            const index = message.indexOf(team.name);
            if (index !== -1 && index < bestIndex) { best = team; bestIndex = index; }
        }
        if (!best) return message;
        const end = bestIndex + best.name.length;
        return [message.slice(0, bestIndex), h('b', { key: 'b' }, best.name), message.slice(end)];
    }

    function computeSeasonHigh(league) {
        let best = null;
        for (const week of league.finalizedWeeks) {
            for (const result of week.results) {
                if (!best || result.total > best.points) best = { teamId: result.teamId, week: week.week, points: result.total };
            }
        }
        return best;
    }

    function computeBiggestBlowout(league) {
        let best = null;
        for (const week of league.finalizedWeeks) {
            for (const matchup of week.matchups) {
                if (!matchup.winner) continue;
                const margin = Math.abs(matchup.homePoints - matchup.awayPoints);
                if (!best || margin > best.margin) {
                    const loser = matchup.winner === matchup.home ? matchup.away : matchup.home;
                    best = { winnerTeamId: matchup.winner, loserTeamId: loser, margin, week: week.week };
                }
            }
        }
        return best;
    }

    /** Pulls straight from drawnSeason on the roster — no card lookup needed, the draw is already stored. */
    function computeEraSpread(league) {
        const entries = league.teams.flatMap((t) => t.roster);
        const decades = new Set();
        let oldest = null;
        for (const entry of entries) {
            const decade = EraRules.decadeOf(entry.drawnSeason);
            if (decade) decades.add(decade);
            if (!oldest || entry.drawnSeason < oldest.drawnSeason) oldest = entry;
        }
        return { decadeCount: decades.size, oldest };
    }

    function standingsBlurb(league, standings, row) {
        const streak = UI.streakFor(league, row.teamId);
        if (streak && streak.kind === 'W' && streak.count >= 2) return `riding a ${streak.kind}${streak.count} streak`;
        const topScorer = [...standings].sort((a, b) => b.pointsFor - a.pointsFor)[0];
        if (topScorer && topScorer.teamId === row.teamId) return `the league's top scorer at ${row.pointsFor.toFixed(1)} PF`;
        if (streak && streak.kind === 'L' && streak.count >= 2) return `has dropped ${streak.count} straight`;
        return `${row.wins}-${row.losses}${row.ties ? `-${row.ties}` : ''}, ${row.pointsFor.toFixed(1)} PF`;
    }

    function WrTimeLeagueHomePanel({ league, onNavigate }) {
        const standings = useMemo(() => Engine.computeStandings(league), [league]);
        const teamOf = (teamId) => league.teams.find((t) => t.teamId === teamId);
        const teamName = (teamId) => teamOf(teamId)?.name ?? teamId;
        const myTeam = league.teams.find((t) => t.manager === 'human') ?? league.teams[0];
        const pendingWaivers = league.pendingClaims.filter((c) => c.teamId === myTeam.teamId).length;

        const lastFinalized = league.finalizedWeeks[league.finalizedWeeks.length - 1] ?? null;
        const story = useMemo(() => {
            if (!lastFinalized) {
                const eraSpread = computeEraSpread(league);
                return {
                    headline: `${league.name.toUpperCase()} OPENS — ${league.teams.length} MANAGERS, ${eraSpread.decadeCount} DECADES ON THE BOARD`,
                    byline: `Filed Week ${league.currentWeek}`,
                    lede: `The mystery seasons are sealed and the schedule is set. First matchups tip off this week, with rosters spanning from ${eraSpread.oldest ? eraSpread.oldest.drawnSeason : 'the 1970 merger'} to the present day.`,
                    boxscore: null,
                };
            }
            const headlines = Gamecast.weekHeadlines(lastFinalized.results, lastFinalized.matchups, teamName);
            const top = [...lastFinalized.results].sort((a, b) => b.total - a.total)[0];
            const matchup = lastFinalized.matchups.find((m) => m.home === top.teamId || m.away === top.teamId);
            return {
                headline: `${teamName(top.teamId).toUpperCase()} STORMS TO ${top.total.toFixed(1)}, SETS THE WEEK'S PACE`,
                byline: `Filed Week ${lastFinalized.week}`,
                lede: headlines.join(' '),
                boxscore: matchup ? { home: matchup.home, away: matchup.away, homePoints: matchup.homePoints, awayPoints: matchup.awayPoints, winner: matchup.winner, week: lastFinalized.week } : null,
            };
        }, [league, lastFinalized]);

        const seasonHigh = useMemo(() => computeSeasonHigh(league), [league]);
        const blowout = useMemo(() => computeBiggestBlowout(league), [league]);
        const eraSpread = useMemo(() => computeEraSpread(league), [league]);
        const recentActivity = [...league.activity].reverse().slice(0, 4);

        return h('div', { className: 'tl-gazette' },
            h('div', { className: 'tl-masthead' },
                h('div', { className: 'tl-kicker' }, "Est. 1970 · Every Season, One League"),
                h('div', { className: 'tl-name' }, 'THE VAULT ', h('em', null, 'GAZETTE')),
                h('div', { className: 'tl-dateline' },
                    h('span', null, league.name.toUpperCase() + ' EDITION'), h('span', null, '·'),
                    h('span', null, `WEEK ${Math.min(league.currentWeek, league.settings.regularSeasonWeeks)} OF ${league.settings.regularSeasonWeeks}`))),
            h('div', { className: 'tl-gazette-rule' }), h('div', { className: 'tl-gazette-rule thin' }),

            h('div', { className: 'tl-gazette-grid' },
                h('div', { className: 'tl-col-rule' },
                    h('div', { className: 'tl-section-label' }, "This Week's Wire"),
                    h('div', { className: 'tl-gaz-headline' }, story.headline),
                    h('div', { className: 'tl-gaz-byline' }, `By the Wire Desk · ${story.byline}`),
                    h('p', { className: 'tl-gaz-lede drop' }, story.lede),
                    story.boxscore ? h('div', { className: 'tl-boxscore' },
                        h('div', { className: 'tl-boxscore-head' }, `Week ${story.boxscore.week} — Final`),
                        [{ id: story.boxscore.home, pts: story.boxscore.homePoints }, { id: story.boxscore.away, pts: story.boxscore.awayPoints }].map((side) => {
                            const team = teamOf(side.id);
                            return h('div', { key: side.id, className: `tl-boxscore-row${story.boxscore.winner === side.id ? ' winner' : ''}` },
                                h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 8 } }, h(window.TimeLeagueHelmetIcon, { helmet: team?.helmet, letter: window.App.TimeLeagueHelmet.letterFor(team?.name || side.id), size: 20 }), teamName(side.id)),
                                h('span', { className: 'tabular' }, side.pts.toFixed(1)));
                        }))
                        : null,
                    h('div', { className: 'tl-section-label', style: { marginTop: 20 } }, 'Transaction Wire'),
                    recentActivity.length === 0
                        ? h('p', { className: 'tl-empty' }, 'Nothing on the wire yet.')
                        : recentActivity.map((event) => h('div', { key: event.id, className: 'tl-wire-item' }, withBoldName(event.message, league.teams)))),

                h('div', null,
                    h('div', { className: 'tl-section-label' }, 'Stat Leaders'),
                    h('div', { className: 'tl-kpi-grid' },
                        h('div', { className: 'tl-gazette-kpi' }, h('div', { className: 'k-label' }, 'Season High'), h('div', { className: 'k-value tabular' }, seasonHigh ? seasonHigh.points.toFixed(1) : '—'), h('div', { className: 'k-sub' }, seasonHigh ? `${teamName(seasonHigh.teamId)}, Wk ${seasonHigh.week}` : 'No weeks scored')),
                        h('div', { className: 'tl-gazette-kpi' }, h('div', { className: 'k-label' }, 'Biggest Blowout'), h('div', { className: 'k-value tabular' }, blowout ? blowout.margin.toFixed(1) : '—'), h('div', { className: 'k-sub' }, blowout ? `${teamName(blowout.winnerTeamId)} def. ${teamName(blowout.loserTeamId)}` : 'No weeks scored')),
                        h('div', { className: 'tl-gazette-kpi' }, h('div', { className: 'k-label' }, 'Eras in Play'), h('div', { className: 'k-value' }, eraSpread.decadeCount || '—'), h('div', { className: 'k-sub' }, 'decades rostered')),
                        h('div', { className: 'tl-gazette-kpi' }, h('div', { className: 'k-label' }, 'Oldest Starter'), h('div', { className: 'k-value tabular' }, eraSpread.oldest ? eraSpread.oldest.drawnSeason : '—'), h('div', { className: 'k-sub' }, eraSpread.oldest ? `${eraSpread.oldest.name}, ${eraSpread.oldest.position}` : '—'))),

                    h('div', { className: 'tl-section-label' }, 'Standings'),
                    standings.slice(0, 3).map((row, i) => h('div', { key: row.teamId, className: 'tl-brief' }, h('b', null, `${i + 1}. ${teamName(row.teamId)}`), ` (${row.wins}-${row.losses}) — ${standingsBlurb(league, standings, row)}.`)),

                    h('div', { className: 'tl-issue-bar' },
                        h('button', { className: 'primary', onClick: () => onNavigate('gameday') }, '▶ View Gamecast'),
                        h('button', { onClick: () => onNavigate('roster') }, 'Set Lineup'),
                        h('button', { onClick: () => onNavigate('waivers') }, `Waivers${pendingWaivers ? ` (${pendingWaivers})` : ''}`),
                        h('button', { onClick: () => onNavigate('standings') }, 'Full Standings')))));
    }

    window.WrTimeLeagueHomePanel = WrTimeLeagueHomePanel;
})();
