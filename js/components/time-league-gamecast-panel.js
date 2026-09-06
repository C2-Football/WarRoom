// ══════════════════════════════════════════════════════════════════
// js/components/time-league-gamecast-panel.js — window.WrTimeLeagueGamecastPanel
// The Gameday tab: a scoreboard strip (every matchup, ESPN-style) and a
// hero matchup card for the human team (Sleeper-style live score bar +
// win probability), then the pre-run week command panel or the live/replay
// gamecast player (owns the autoplay timer), box scores, and the week
// archive. Ported from the GamedayPanel/BoxScores portion of The Duat's
// app/TimeLeagueView.tsx, with the scoreboard strip/hero card added.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const { useState, useEffect, useCallback, useMemo, useRef } = React;
    const h = React.createElement;

    const Engine = window.App.TimeLeagueEngine;
    const AI = window.App.TimeLeagueAI;
    const Gamecast = window.App.TimeLeagueGamecast;

    const GAMECAST_END = 200;
    /** 1x plays the 200 simulated minutes in ~8 real seconds. */
    const CAST_MINUTES_PER_SECOND = 25;

    function BoxScores({ week, teamName }) {
        const resultOf = new Map(week.results.map((r) => [r.teamId, r]));
        return h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginTop: 12 } },
            week.matchups.map((matchup) => h('div', { key: `${matchup.home}:${matchup.away}`, style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 } },
                [matchup.home, matchup.away].map((teamId) => {
                    const result = resultOf.get(teamId);
                    return h('div', { key: teamId, style: { overflowX: 'auto' } }, h('table', { className: 'tl-tbl' },
                        h('thead', null, h('tr', null,
                            h('th', null, teamName(teamId) + (matchup.winner === teamId ? ' ◆' : '')), h('th', { className: 'num' }, 'YR'), h('th', { className: 'num' }, (result?.total ?? 0).toFixed(2)))),
                        h('tbody', null, (result?.starters ?? []).map((starter) => h('tr', { key: starter.entryId },
                            h('td', null, `${starter.slot} · ${starter.name}`), h('td', { className: 'num' }, starter.drawnSeason), h('td', { className: 'num' }, starter.points.toFixed(2)))))));
                }))));
    }

    function ScoreboardStrip({ rows, teams, myTeamId, statusLabel, live }) {
        if (!rows.length) return null;
        return h('div', { className: 'tl-scoreboard-strip' }, rows.map((row) => {
            const homeTeam = teams.find((t) => t.teamId === row.home);
            const awayTeam = teams.find((t) => t.teamId === row.away);
            const mine = row.home === myTeamId || row.away === myTeamId;
            const homeLeading = row.homePoints > row.awayPoints;
            const awayLeading = row.awayPoints > row.homePoints;
            return h('div', { key: `${row.home}:${row.away}`, className: `tl-score-chip${mine ? ' mine' : ''}${live ? ' live' : ''}` },
                h('div', { className: 'tl-sc-tag' }, live ? h('span', { className: 'tl-sc-dot' }) : null, mine ? `${statusLabel} · YOUR MATCHUP` : statusLabel),
                h('div', { className: `tl-sc-row${homeLeading ? ' winning' : ''}` },
                    h('span', { className: 'tl-sc-team' }, h(window.TimeLeagueHelmetIcon, { helmet: homeTeam?.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(homeTeam?.name || row.home), size: 20 }), h('span', null, homeTeam?.name ?? row.home)),
                    h('span', { className: 'tl-sc-pts tabular' }, row.homePoints.toFixed(1))),
                h('div', { className: `tl-sc-row${awayLeading ? ' winning' : ''}` },
                    h('span', { className: 'tl-sc-team' }, h(window.TimeLeagueHelmetIcon, { helmet: awayTeam?.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(awayTeam?.name || row.away), size: 20 }), h('span', null, awayTeam?.name ?? row.away)),
                    h('span', { className: 'tl-sc-pts tabular' }, row.awayPoints.toFixed(1))));
        }));
    }

    function HeroMatchup({ row, teams, week, statusLabel, clockLabel }) {
        if (!row) return null;
        const homeTeam = teams.find((t) => t.teamId === row.home);
        const awayTeam = teams.find((t) => t.teamId === row.away);
        const mine = row.mineIsHome ? homeTeam : awayTeam;
        const opp = row.mineIsHome ? awayTeam : homeTeam;
        const minePts = row.mineIsHome ? row.homePoints : row.awayPoints;
        const oppPts = row.mineIsHome ? row.awayPoints : row.homePoints;
        const total = minePts + oppPts;
        const minePct = total > 0 ? (minePts / total) * 100 : 50;
        return h('div', { className: 'tl-hero-matchup' },
            h('div', { className: 'tl-hero-top' },
                h('div', { className: 'tl-hero-side' },
                    h(window.TimeLeagueHelmetIcon, { helmet: mine.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(mine.name), size: 52 }),
                    h('div', { className: `tl-h-name${minePts >= oppPts ? ' leading' : ''}` }, mine.name),
                    h('div', { className: `tl-h-pts tabular${minePts >= oppPts ? ' leading' : ''}` }, minePts.toFixed(1))),
                h('div', { className: 'tl-hero-mid' }, h('div', { className: 'tl-h-vs' }, `WEEK ${week}`), h('div', { className: 'tl-h-clock' }, clockLabel)),
                h('div', { className: 'tl-hero-side' },
                    h(window.TimeLeagueHelmetIcon, { helmet: opp.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(opp.name), size: 52 }),
                    h('div', { className: `tl-h-name${oppPts > minePts ? ' leading' : ''}` }, opp.name),
                    h('div', { className: `tl-h-pts tabular${oppPts > minePts ? ' leading' : ''}` }, oppPts.toFixed(1)))),
            total > 0 ? h('div', { className: 'tl-win-prob' }, h('span', null, statusLabel), h('span', null, `${minePct.toFixed(0)}% — ${(100 - minePct).toFixed(0)}%`)) : h('div', { className: 'tl-win-prob' }, h('span', null, statusLabel), h('span', null, '—')),
            h('div', { className: 'tl-score-bar' }, h('div', { className: 'tl-fill', style: { width: `${minePct}%` } }), h('div', { className: 'tl-fill against', style: { width: `${100 - minePct}%` } })));
    }

    function WrTimeLeagueGamecastPanel({ league, cards, logIndex, logsMissing, eraFactors, onUpdate, onGoRoster }) {
        const [playback, setPlayback] = useState(null);
        const [clock, setClock] = useState(0);
        const [playing, setPlaying] = useState(false);
        const [speed, setSpeed] = useState(1);
        const [warnings, setWarnings] = useState(null);
        const [boxWeek, setBoxWeek] = useState(null);
        const clockRef = useRef(0);

        const myTeamId = (league.teams.find((t) => t.manager === 'human') ?? league.teams[0])?.teamId;

        const teamName = useMemo(() => {
            const names = new Map(league.teams.map((t) => [t.teamId, t.name]));
            return (teamId) => names.get(teamId) ?? teamId;
        }, [league.teams]);

        const finishPlayback = useCallback(() => { setPlaying(false); }, []);

        useEffect(() => {
            if (!playing) return;
            let raf = 0;
            let last = performance.now();
            const step = (now) => {
                const dt = Math.min(0.1, (now - last) / 1000);
                last = now;
                clockRef.current = Math.min(GAMECAST_END, clockRef.current + dt * CAST_MINUTES_PER_SECOND * speed);
                setClock(clockRef.current);
                if (clockRef.current >= GAMECAST_END) { finishPlayback(); return; }
                raf = window.requestAnimationFrame(step);
            };
            raf = window.requestAnimationFrame(step);
            return () => window.cancelAnimationFrame(raf);
        }, [playing, speed, finishPlayback]);

        const skipToEnd = () => { clockRef.current = GAMECAST_END; setClock(GAMECAST_END); if (playing) finishPlayback(); };
        const canRun = league.phase === 'season' && cards !== null && cards.size > 0 && logIndex !== null;

        const runGameDay = (force) => {
            if (!canRun || !cards || !logIndex) return;
            const prepared = AI.aiPrepareWeek(league, cards);
            if (!force) {
                const problems = prepared.teams.filter((t) => t.manager === 'human').flatMap((t) => Engine.lineupProblems(prepared, t.teamId).map((p) => `${t.name} — ${p}`));
                if (problems.length) { setWarnings(problems); return; }
            }
            setWarnings(null);
            const stamp = new Date().toISOString();
            const finalized = Engine.finalizeCurrentWeek(prepared, logIndex, eraFactors, stamp);
            const weekData = finalized.finalizedWeeks.find((item) => item.week === league.currentWeek);
            if (!weekData) return;
            let settled = AI.aiSubmitWaiverClaims(finalized, cards, stamp);
            settled = Engine.processWaivers(settled, cards, stamp);
            settled = AI.aiGenerateTrades(settled, cards, stamp);
            settled = AI.aiRespondToTrades(settled, cards, stamp);
            onUpdate(settled);
            setPlayback({ timeline: Gamecast.buildGamecast({ week: weekData.week, results: weekData.results, matchups: weekData.matchups, seed: league.seed }), weekData, finalized: settled, live: true });
            setBoxWeek(null); clockRef.current = 0; setClock(0); setSpeed(1); setPlaying(true);
        };

        const replayWeek = (week) => {
            setPlayback({ timeline: Gamecast.buildGamecast({ week: week.week, results: week.results, matchups: week.matchups, seed: league.seed }), weekData: week, finalized: league, live: false });
            setBoxWeek(null); clockRef.current = 0; setClock(0); setSpeed(1); setPlaying(true);
        };

        const done = playback !== null && clock >= GAMECAST_END;
        const landed = useMemo(() => (playback ? playback.timeline.events.filter((e) => e.t <= clock) : []), [playback, clock]);
        const liveTotals = useMemo(() => {
            const totals = new Map();
            if (!playback) return totals;
            if (done) { for (const [teamId, total] of Object.entries(playback.timeline.finals)) totals.set(teamId, total); return totals; }
            const cents = new Map();
            for (const event of landed) cents.set(event.teamId, (cents.get(event.teamId) ?? 0) + Math.round(event.points * 100));
            for (const [teamId, value] of cents) totals.set(teamId, value / 100);
            return totals;
        }, [playback, landed, done]);
        const headlines = useMemo(() => (playback && done ? Gamecast.weekHeadlines(playback.weekData.results, playback.weekData.matchups, teamName) : []), [playback, done, teamName]);

        const pairs = league.schedule.find((item) => item.week === league.currentWeek)?.pairs ?? [];
        const boxWeekData = boxWeek === null ? null : league.finalizedWeeks.find((item) => item.week === boxWeek) ?? null;
        const champion = league.championTeamId ? teamName(league.championTeamId) : null;

        // Normalize this week's matchups into one shape whether we're pre-run
        // (0-0, from the schedule) or mid/post-gamecast (from the playback timeline),
        // so the scoreboard strip and hero card render identically either way.
        const matchupRows = playback
            ? playback.weekData.matchups.map((m) => ({ home: m.home, away: m.away, homePoints: liveTotals.get(m.home) ?? 0, awayPoints: liveTotals.get(m.away) ?? 0 }))
            : pairs.map(([home, away]) => ({ home, away, homePoints: 0, awayPoints: 0 }));
        const myRow = (() => {
            const row = matchupRows.find((m) => m.home === myTeamId || m.away === myTeamId);
            return row ? { ...row, mineIsHome: row.home === myTeamId } : null;
        })();
        const weekLabel = playback ? playback.weekData.week : league.currentWeek;
        const strip = league.phase !== 'draft' && matchupRows.length
            ? h(ScoreboardStrip, { rows: matchupRows, teams: league.teams, myTeamId, live: Boolean(playback) && !done, statusLabel: playback ? (done ? 'FINAL' : 'LIVE') : 'UPCOMING' })
            : null;
        const hero = myRow
            ? h(HeroMatchup, {
                row: myRow, teams: league.teams, week: weekLabel,
                statusLabel: playback ? (done ? 'FINAL' : 'WIN PROB') : 'UPCOMING',
                clockLabel: playback ? `T+${String(Math.floor(clock)).padStart(3, '0')}′` : `WK ${weekLabel}`,
            })
            : null;

        if (playback) {
            return h('div', null,
                strip, hero,
                h('div', { className: 'tl-card' },
                    h('div', { className: 'tl-card-title' }, h('span', null, `Week ${playback.weekData.week} — ${playback.live ? 'Live' : 'Replay'}`), h('small', null, `${landed.length}/${playback.timeline.events.length} plays landed`)),
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 } },
                        h('span', { style: { color: playing ? 'var(--gold)' : 'var(--text-muted)' } }, '📡'),
                        h('span', { className: 'tabular', style: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--gold)' } }, `T+${String(Math.floor(clock)).padStart(3, '0')}′`),
                        h('span', { style: { flex: 1, height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 100, overflow: 'hidden' } },
                            h('span', { style: { display: 'block', height: '100%', width: `${(clock / GAMECAST_END) * 100}%`, background: 'var(--gold)' } })),
                        h('button', { className: `tl-btn icon${speed === 1 ? ' primary' : ''}`, onClick: () => setSpeed(1) }, '1X'),
                        h('button', { className: `tl-btn icon${speed === 4 ? ' primary' : ''}`, onClick: () => setSpeed(4) }, '4X'),
                        h('button', { className: 'tl-btn icon', disabled: done, onClick: skipToEnd }, 'INSTANT')),
                    done && headlines.length > 0 && h('div', { style: { marginBottom: 14 } },
                        h('span', { className: 'tl-label' }, `Week ${playback.weekData.week} Wire`),
                        headlines.map((headline, i) => h('p', { key: i, style: { fontSize: 12.5, color: 'var(--text-secondary)', margin: '4px 0' } }, headline))),
                    h('div', { style: { maxHeight: 320, overflowY: 'auto' } },
                        landed.length === 0
                            ? h('div', { className: 'tl-feedrow' }, h('time', null, 'T+000′'), h('p', null, 'Crews are in the booth — kickoff momentarily.'))
                            : landed.slice().reverse().map((event, i) => h('div', { key: i, className: `tl-feedrow${event.isTouchdown ? ' urgent' : ''}` },
                                h('time', null, `T+${String(Math.round(event.t)).padStart(3, '0')}′ · +${event.points.toFixed(2)}`),
                                h('p', null, `${event.description} — ${teamName(event.teamId)}`)))),
                    done && h('div', { style: { marginTop: 14, textAlign: 'center' } },
                        h('button', { className: 'tl-btn', onClick: () => { setPlayback(null); clockRef.current = 0; setClock(0); } }, 'CLOSE GAMECAST'))));
        }

        return h('div', null,
            strip, hero,
            league.phase === 'season' && h('div', { className: 'tl-card' },
                h('div', { className: 'tl-card-title' }, h('span', null, `Week ${league.currentWeek} Command`), h('small', null, `${pairs.length} matchups · ${league.settings.eraAdjusted ? 'era-adjusted' : 'raw scoring'}`)),
                logsMissing && h('div', { className: 'tl-feedrow urgent' }, h('time', null, 'DATA'), h('p', null, 'Bundled game logs missing — check data/time-league/.')),
                !logsMissing && !logIndex && h('div', { className: 'tl-feedrow' }, h('time', null, 'DATA'), h('p', null, 'Parsing bundled game logs (170k weekly lines)…')),
                cards !== null && cards.size === 0 && h('div', { className: 'tl-feedrow urgent' }, h('time', null, 'DATA'), h('p', null, 'Player cards missing — check data/time-league/.')),
                league.settings.eraAdjusted && eraFactors === null && h('div', { className: 'tl-feedrow caution' }, h('time', null, 'DATA'), h('p', null, 'Era factors unavailable — this week would score raw until the bundle is rebuilt.')),
                warnings && h('div', { style: { marginBottom: 10 } },
                    warnings.map((problem, i) => h('div', { key: i, className: 'tl-feedrow caution' }, h('time', null, 'LINEUP'), h('p', null, problem))),
                    h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
                        h('button', { className: 'tl-btn', onClick: onGoRoster }, 'FIX LINEUPS'),
                        h('button', { className: 'tl-btn', onClick: () => runGameDay(true) }, 'RUN ANYWAY'))),
                h('button', { className: 'tl-btn primary', disabled: !canRun, onClick: () => runGameDay(false), style: { width: '100%', justifyContent: 'center', padding: '10px', marginTop: 4 } }, '▶ RUN GAME DAY')),
            league.phase === 'complete' && h('div', { className: 'tl-card', style: { display: 'flex', alignItems: 'center', gap: 12 } },
                h('span', { style: { fontSize: 24 } }, '🏆'),
                h('div', null, h('span', { className: 'tl-label', style: { display: 'block' } }, 'Season Complete — Champion'), h('strong', { style: { fontFamily: 'var(--font-title)', fontSize: 18 } }, champion ?? 'Unknown'))),
            league.finalizedWeeks.length > 0 && h('div', { className: 'tl-card', style: { marginTop: 14 } },
                h('div', { className: 'tl-card-title' }, h('span', null, 'Week Archive'), h('small', null, 'replay any gamecast or audit the box scores')),
                league.finalizedWeeks.map((week) => h('div', { key: week.week, style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' } },
                    h('span', { className: 'tl-label', style: { flex: 'none' } }, `WK ${String(week.week).padStart(2, '0')}`),
                    h('span', { style: { flex: 1, fontSize: 12, color: 'var(--text-secondary)' } }, week.headlines[0] ?? ''),
                    h('button', { className: 'tl-btn icon', onClick: () => replayWeek(week) }, 'REPLAY'),
                    h('button', { className: 'tl-btn icon', onClick: () => setBoxWeek(boxWeek === week.week ? null : week.week) }, boxWeek === week.week ? 'HIDE BOX' : 'BOX SCORE'))),
                boxWeekData && h(BoxScores, { week: boxWeekData, teamName })));
    }

    window.WrTimeLeagueGamecastPanel = WrTimeLeagueGamecastPanel;
})();
