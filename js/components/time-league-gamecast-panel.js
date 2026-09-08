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

    const GAMECAST_END = Gamecast.GAMECAST_END;
    /** Playback durations are wall-clock seconds, excluding pauses. */
    const CAST_DURATIONS = [300, 180, 60];

    // Use the lineup that played this week, including during archived replays.
    // Saved results are deliberately hidden until their scoring moments arrive.
    function LiveLineups({ row, teams, rosterSlots, weekData, landed, final, currentPlay }) {
        if (!row) return null;
        const ids = row.mineIsHome ? [row.home, row.away] : [row.away, row.home];
        const sides = ids.map(teamId => {
            const team = teams.find(item => item.teamId === teamId);
            const starters = weekData ? weekData.results.find(result => result.teamId === teamId)?.starters || []
                : (team?.roster || []).filter(entry => !['BN', 'IR', 'TAXI'].includes(entry.slot));
            const moments = new Map();
            for (const event of landed) {
                if (event.teamId !== teamId) continue;
                const value = moments.get(event.entryId) || { cents: 0, stats: {} };
                value.cents += Math.round(event.points * 100);
                Gamecast.addStats(value.stats, event.stats || {});
                moments.set(event.entryId, value);
            }
            return { team, starters: starters.map(entry => ({ ...entry,
                points: final ? entry.points || 0 : (moments.get(entry.entryId)?.cents || 0) / 100,
                stats: final ? entry.stats : moments.get(entry.entryId)?.stats,
                scoring: !final && currentPlay?.teamId === teamId && currentPlay.entryId === entry.entryId,
            })) };
        });
        const slots = window.App.TimeLeagueRoster.ROSTER_SLOT_IDS.filter(slot => !['BN', 'IR', 'TAXI'].includes(slot));
        const rows = slots.flatMap(slot => {
            const entries = sides.map(side => side.starters.filter(entry => entry.slot === slot));
            const count = Math.max(rosterSlots[slot] || 0, ...entries.map(list => list.length));
            return Array.from({ length: count }, (_, index) => ({ slot, index, entries: entries.map(list => list[index]) }));
        });
        const player = (entry, side) => h('div', { className: `tl-live-player is-${side}${entry?.scoring ? ' is-scoring' : ''}`, 'data-entry-id': entry?.entryId },
            h('div', { className: 'tl-live-player-name' },
                h('strong', null, entry?.name || 'Empty slot'),
                entry && h('small', null, `${entry.drawnSeason} · ${entry.position}`)),
            h('strong', { className: 'tl-live-player-points tabular' }, entry ? entry.points.toFixed(2) : '—'),
            entry && h('span', { className: 'tl-live-player-stats' }, Gamecast.describeStats(entry.stats || {}, 2) || (final ? entry.stats ? 'No scoring stats' : 'No game recorded' : weekData ? 'No scoring yet' : 'Awaiting kickoff')));
        return h('section', { className: 'tl-live-lineups', 'aria-label': 'Head-to-head starting lineups' },
            h('div', { className: 'tl-live-lineups-title' }, h('h3', null, 'Lineup matchup'), h('small', null, final ? 'FINAL POINTS' : weekData ? 'LIVE POINTS' : 'STARTERS')),
            h('div', { className: 'tl-live-lineups-head' }, h('strong', null, sides[0].team?.name || ids[0]), h('span', null, 'VS'), h('strong', null, sides[1].team?.name || ids[1])),
            rows.map(item => h('div', { key: `${item.slot}:${item.index}`, className: 'tl-live-lineup-row' },
                player(item.entries[0], 'left'),
                h('span', { className: 'tl-live-lineup-slot', title: item.slot.replaceAll('_', ' ') }, item.slot === 'SUPER_FLEX' ? 'SFLEX' : item.slot),
                player(item.entries[1], 'right'))));
    }

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

    function ScoreboardStrip({ rows, teams, myTeamId, statusLabel, live, leaders = [], showLeaders = false }) {
        if (!rows.length) return null;
        return h('div', { className: 'tl-scoreboard-strip' }, rows.map((row) => {
            const homeTeam = teams.find((t) => t.teamId === row.home);
            const awayTeam = teams.find((t) => t.teamId === row.away);
            const mine = row.home === myTeamId || row.away === myTeamId;
            const homeLeading = row.homePoints > row.awayPoints;
            const awayLeading = row.awayPoints > row.homePoints;
            const leader = leaders.find(player => player.teamId === row.home || player.teamId === row.away);
            return h('div', { key: `${row.home}:${row.away}`, className: `tl-score-chip${mine ? ' mine' : ''}${live ? ' live' : ''}` },
                h('div', { className: 'tl-sc-tag' }, live ? h('span', { className: 'tl-sc-dot' }) : null, mine ? `${statusLabel} · YOUR MATCHUP` : statusLabel),
                h('div', { className: `tl-sc-row${homeLeading ? ' winning' : ''}` },
                    h('span', { className: 'tl-sc-team' }, h(window.TimeLeagueHelmetIcon, { helmet: homeTeam?.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(homeTeam?.name || row.home), size: 20 }), h('span', null, homeTeam?.name ?? row.home)),
                    h('span', { className: 'tl-sc-pts tabular' }, row.homePoints.toFixed(1))),
                h('div', { className: `tl-sc-row${awayLeading ? ' winning' : ''}` },
                    h('span', { className: 'tl-sc-team' }, h(window.TimeLeagueHelmetIcon, { helmet: awayTeam?.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(awayTeam?.name || row.away), size: 20 }), h('span', null, awayTeam?.name ?? row.away)),
                    h('span', { className: 'tl-sc-pts tabular' }, row.awayPoints.toFixed(1))),
                showLeaders && h('div', { className: 'tl-sc-leader' },
                    h('small', null, 'AROUND THE LEAGUE'),
                    leader ? h('span', null, h('b', null, leader.name), ` · ${leader.points.toFixed(1)} pts`, h('small', null, Gamecast.describeStats(leader.stats, 2)))
                        : h('span', null, 'Waiting for the first scoring moment')));
        }));
    }

    function QuarterScore({ row, teams, timeline, landed, clock }) {
        const ids = row.mineIsHome ? [row.home, row.away] : [row.away, row.home];
        const totals = new Map(ids.map(id => [id, [0, 0, 0, 0]]));
        for (const event of landed) if (totals.has(event.teamId)) totals.get(event.teamId)[event.quarter - 1] += Math.round(event.points * 100);
        return h('div', { className: 'tl-quarter-score' }, h('table', { 'aria-label': 'Score by simulated quarter' },
            h('thead', null, h('tr', null, h('th', null, 'BY QUARTER'), timeline.quarters.map(q => h('th', { key: q.quarter, className: Gamecast.quarterAt(clock) === q.quarter ? 'current' : '' }, `Q${q.quarter}`)))),
            h('tbody', null, ids.map(id => h('tr', { key: id }, h('th', { scope: 'row' }, teams.find(team => team.teamId === id)?.name || id),
                timeline.quarters.map(q => h('td', { key: q.quarter, className: Gamecast.quarterAt(clock) === q.quarter ? 'current' : '' }, clock > q.start ? (totals.get(id)[q.quarter - 1] / 100).toFixed(1) : '—')))))));
    }

    function QuarterRecap({ row, landed, clock, teamName }) {
        const quarter = Gamecast.quarterAt(clock);
        const ids = row ? [row.mineIsHome ? row.home : row.away, row.mineIsHome ? row.away : row.home] : [];
        const moments = landed.filter(event => event.quarter === quarter);
        if (!moments.length || !ids.length) return null;
        const complete = clock >= quarter * Gamecast.QUARTER_LENGTH;
        return h('div', { className: 'tl-quarter-recap' },
            h('div', { className: 'tl-quarter-recap-title' }, `Q${quarter} ${complete ? 'RECAP' : 'SO FAR'}`, h('span', null, complete && quarter === 2 ? 'HALFTIME' : 'YOUR MATCHUP')),
            h('div', { className: 'tl-quarter-teams' }, ids.map(id => {
                const players = new Map();
                let cents = 0;
                for (const event of moments.filter(item => item.teamId === id)) {
                    const player = players.get(event.entryId) || { name: event.playerName, stats: {}, points: 0 };
                    Gamecast.addStats(player.stats, event.stats); player.points += event.points;
                    players.set(event.entryId, player); cents += Math.round(event.points * 100);
                }
                const ranked = [...players.values()].sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
                const kicker = ranked.find(player => player.stats.extra?.xpm || player.stats.extra?.xpmiss);
                const featured = [...ranked.filter(player => player !== kicker).slice(0, kicker ? 2 : 3), ...(kicker ? [kicker] : [])];
                return h('div', { key: id }, h('strong', null, teamName(id), h('span', null, `${(cents / 100).toFixed(1)} pts`)),
                    featured.length ? featured.map(player => h('p', { key: player.name }, h('b', null, player.name), h('span', null, Gamecast.describeStats(player.stats)))) : h('p', null, 'No production this quarter yet.'));
            })));
    }

    function HeroMatchup({ row, teams, week, statusLabel, clockLabel, progress = 0, records = [], spotlight, quarterScore }) {
        if (!row) return null;
        const homeTeam = teams.find((t) => t.teamId === row.home);
        const awayTeam = teams.find((t) => t.teamId === row.away);
        const mine = row.mineIsHome ? homeTeam : awayTeam;
        const opp = row.mineIsHome ? awayTeam : homeTeam;
        const minePts = row.mineIsHome ? row.homePoints : row.awayPoints;
        const oppPts = row.mineIsHome ? row.awayPoints : row.homePoints;
        const minePct = statusLabel === 'FINAL' ? (minePts === oppPts ? 50 : minePts > oppPts ? 100 : 0)
            : Math.max(1, Math.min(99, 100 / (1 + Math.exp(-(minePts - oppPts) / Math.max(3, 24 * Math.sqrt(1 - Math.min(1, progress)))))));
        const record = team => { const row = records.find(r => r.teamId === team.teamId); return row ? `${row.wins}–${row.losses}${row.ties ? '–'+row.ties : ''}` : '0–0'; };
        return h('div', { className: 'tl-hero-matchup' },
            h('div', { className: 'tl-hero-top' },
                h('div', { className: 'tl-hero-side' },
                    h('span', { className: 'tl-matchup-helmet is-left' }, h(window.TimeLeagueHelmetIcon, { helmet: mine.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(mine.name), size: 52 })),
                    h('div', { className: `tl-h-name${minePts >= oppPts ? ' leading' : ''}` }, mine.name), h('small', { className: 'tl-live-record' }, record(mine)),
                    h('div', { className: `tl-h-pts tabular${minePts >= oppPts ? ' leading' : ''}` }, minePts.toFixed(1))),
                h('div', { className: 'tl-hero-mid' }, h('div', { className: 'tl-h-vs' }, `WEEK ${week}`), h('div', { className: 'tl-h-clock' }, clockLabel)),
                h('div', { className: 'tl-hero-side' },
                    h('span', { className: 'tl-matchup-helmet' }, h(window.TimeLeagueHelmetIcon, { helmet: opp.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(opp.name), size: 52 })),
                    h('div', { className: `tl-h-name${oppPts > minePts ? ' leading' : ''}` }, opp.name), h('small', { className: 'tl-live-record' }, record(opp)),
                    h('div', { className: `tl-h-pts tabular${oppPts > minePts ? ' leading' : ''}` }, oppPts.toFixed(1)))),
            h('div', { className: 'tl-win-prob' }, h('span', null, statusLabel === 'FINAL' ? 'FINAL RESULT' : 'ESTIMATED WIN CHANCE'), h('strong', null, `${minePct.toFixed(0)}% — ${(100 - minePct).toFixed(0)}%`)),
            h('div', { className: 'tl-score-bar' }, h('div', { className: 'tl-fill', style: { width: `${minePct}%` } }), h('div', { className: 'tl-fill against', style: { width: `${100 - minePct}%` } })),
            statusLabel !== 'FINAL' && h('small', { className: 'tl-live-model-note' }, 'Illustrative estimate from score gap and time remaining; not a calibrated prediction.'), quarterScore, spotlight);

    }

    function WrTimeLeagueGamecastPanel({ league, cards, logIndex, logsMissing, eraFactors, onUpdate, onGoRoster, onlineMeta, autoPlayWeek, onGoCeremony, active = true, onPlaybackChange, seatTeamId, mailNotice }) {
        const [playback, setPlayback] = useState(null);
        const [clock, setClock] = useState(0);
        const [playing, setPlaying] = useState(false);
        const [speed, setSpeed] = useState(300);
        const [followMine,setFollowMine]=useState(true);
        const [warnings, setWarnings] = useState(null);
        const [boxWeek, setBoxWeek] = useState(null);
        const clockRef = useRef(0);
        const autoPlayed = useRef(null);
        const previousStage = useRef(league.weekStage);
        useEffect(() => {
            if (!autoPlayWeek || autoPlayed.current === autoPlayWeek) return;
            const weekData = league.finalizedWeeks.find(week => week.week === autoPlayWeek);
            if (!weekData) return;
            autoPlayed.current = autoPlayWeek;
            setPlayback({ timeline: Gamecast.buildGamecast({ week: weekData.week, results: weekData.results, matchups: weekData.matchups, seed: league.seed, scoring: league.settings.scoring }), weekData, finalized: league, live: true });
            setBoxWeek(null); clockRef.current = 0; setClock(0); setSpeed(300); setPlaying(active);
        }, [autoPlayWeek, league.finalizedWeeks, league.seed, league.settings.scoring]);

        const myTeamId = (league.teams.find((t) => onlineMeta || seatTeamId ? t.teamId === (onlineMeta?.seatTeamId || seatTeamId) : t.manager === 'human') ?? league.teams[0])?.teamId;

        const teamName = useMemo(() => {
            const names = new Map(league.teams.map((t) => [t.teamId, t.name]));
            return (teamId) => names.get(teamId) ?? teamId;
        }, [league.teams]);

        const finishPlayback = useCallback(() => { setPlaying(false); }, []);

        useEffect(() => {
            if (!playing || !active) return;
            let raf = 0;
            let last = performance.now();
            const step = (now) => {
                const dt = Math.min(0.1, (now - last) / 1000);
                last = now;
                clockRef.current = Math.min(GAMECAST_END, clockRef.current + dt * GAMECAST_END / speed);
                setClock(clockRef.current);
                if (clockRef.current >= GAMECAST_END) { finishPlayback(); return; }
                raf = window.requestAnimationFrame(step);
            };
            raf = window.requestAnimationFrame(step);
            return () => window.cancelAnimationFrame(raf);
        }, [playing, speed, finishPlayback, active]);

        // Keep this panel mounted across tabs, but pause its clock while away.
        useEffect(() => { if (!active) setPlaying(false); }, [active]);
        useEffect(() => {
            const advanced = previousStage.current === 'postgame' && league.weekStage !== 'postgame';
            previousStage.current = league.weekStage;
            if (playback && (advanced || (playback.live && league.weekStage !== 'postgame' && league.currentWeek > playback.weekData.week))) {
                setPlayback(null); setPlaying(false); clockRef.current = 0; setClock(0);
            }
        }, [league.weekStage, league.currentWeek, playback]);

        const skipToEnd = () => { clockRef.current = GAMECAST_END; setClock(GAMECAST_END); if (playing) finishPlayback(); };
        const canRun = league.weekStage === 'ready' && (!onlineMeta || onlineMeta.role === 'commissioner') && league.phase === 'season' && cards !== null && cards.size > 0 && logIndex !== null && (!league.settings.eraAdjusted || Boolean(eraFactors?.size));

        const runGameDay = async (force) => {
            if (!canRun || !cards || !logIndex) return;
            const prepared = AI.aiPrepareWeek(league, cards, logIndex);
            if (!force) {
                const problems = prepared.teams.filter((t) => t.manager === 'human' && (league.currentWeek <= league.settings.regularSeasonWeeks || Engine.playoffPairs(league, league.currentWeek).some(pair => pair.includes(t.teamId)))).flatMap((t) => Engine.lineupProblems(prepared, t.teamId).map((p) => `${t.name} — ${p}`));
                if (problems.length) { setWarnings(problems); return; }
            }
            setWarnings(null);
            const stamp = new Date().toISOString();
            const finalized = Engine.finalizeCurrentWeek(prepared, logIndex, eraFactors, stamp);
            const weekData = finalized.finalizedWeeks.find((item) => item.week === league.currentWeek);
            if (!weekData) return;
            const settled = { ...finalized, weekStage: 'postgame' };
            const saved = await onUpdate(settled, { type: 'week', force });
            if (saved === false) return;
            const canonical = saved && typeof saved === 'object' ? saved : settled;
            const savedWeek = canonical.finalizedWeeks.find(item => item.week === weekData.week);
            if (!savedWeek) return;
            setPlayback({ timeline: Gamecast.buildGamecast({ week: savedWeek.week, results: savedWeek.results, matchups: savedWeek.matchups, seed: canonical.seed, scoring: canonical.settings.scoring }), weekData: savedWeek, finalized: canonical, live: true });
            setBoxWeek(null); clockRef.current = 0; setClock(0); setSpeed(300); setPlaying(true);
        };

        const replayWeek = (week) => {
            setPlayback({ timeline: Gamecast.buildGamecast({ week: week.week, results: week.results, matchups: week.matchups, seed: league.seed, scoring: league.settings.scoring }), weekData: week, finalized: league, live: false });
            setBoxWeek(null); clockRef.current = 0; setClock(0); setSpeed(300); setPlaying(true);
        };

        const done = playback !== null && clock >= GAMECAST_END;
        const quarter = Gamecast.quarterAt(clock);
        const togglePlayback = useCallback(() => setPlaying(value => !value), []);
        const nextQuarter = useCallback(() => { setPlaying(false); clockRef.current = Gamecast.nextQuarterEnd(clockRef.current); setClock(clockRef.current); }, []);
        useEffect(() => {
            onPlaybackChange?.(playback ? { leagueId: league.leagueId, week: playback.weekData.week, done, playing: playing && active, quarter, replay: !playback.live, toggle: togglePlayback, nextQuarter } : null);
        }, [onPlaybackChange, league.leagueId, playback, done, playing, active, quarter, togglePlayback, nextQuarter]);
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

        const pairs = league.currentWeek > league.settings.regularSeasonWeeks ? Engine.playoffPairs(league, league.currentWeek) : league.schedule.find((item) => item.week === league.currentWeek)?.pairs ?? [];
        const boxWeekData = boxWeek === null ? null : league.finalizedWeeks.find((item) => item.week === boxWeek) ?? null;
        const champion = league.championTeamId ? teamName(league.championTeamId) : null;

        // Normalize this week's matchups into one shape whether we're pre-run
        // (0-0, from the schedule) or mid/post-gamecast (from the playback timeline),
        // so the scoreboard strip and hero card render identically either way.
        const savedFinal = !playback && (league.weekStage === 'postgame' || league.phase === 'complete') ? league.finalizedWeeks[league.finalizedWeeks.length - 1] : null;
        const matchupRows = playback
            ? playback.weekData.matchups.map((m) => ({ home: m.home, away: m.away, homePoints: liveTotals.get(m.home) ?? 0, awayPoints: liveTotals.get(m.away) ?? 0 }))
            : savedFinal ? savedFinal.matchups.map(match => ({ home: match.home, away: match.away, homePoints: match.homePoints, awayPoints: match.awayPoints })) : pairs.map(([home, away]) => ({ home, away, homePoints: 0, awayPoints: 0 }));
        const myRow = (() => {
            const row = matchupRows.find((m) => m.home === myTeamId || m.away === myTeamId);
            return row ? { ...row, mineIsHome: row.home === myTeamId } : null;
        })();
        const weekLabel = playback ? playback.weekData.week : savedFinal ? savedFinal.week : league.currentWeek;
        const leaders = new Map();
        for (const event of landed) {
            const key = `${event.teamId}:${event.entryId}`;
            const row = leaders.get(key) || { name: event.playerName, teamId: event.teamId, points: 0, stats: {} };
            row.points += event.points; Gamecast.addStats(row.stats, event.stats); leaders.set(key, row);
        }
        const leagueLeaders = [...leaders.values()].sort((a,b) => b.points-a.points);
        const strip = league.phase !== 'draft' && matchupRows.length
            ? h(ScoreboardStrip, { rows: matchupRows, teams: league.teams, myTeamId, leaders: leagueLeaders, showLeaders: Boolean(playback) && speed === 300, live: Boolean(playback) && !done, statusLabel: playback ? (done ? 'FINAL' : `Q${Gamecast.quarterAt(clock)} · ${playing ? 'PLAYING' : 'PAUSED'}`) : savedFinal ? 'FINAL' : 'UPCOMING' })
            : null;
        const visibleEvents=followMine&&myRow?landed.filter(e=>e.teamId===myRow.home||e.teamId===myRow.away):landed;
        const currentPlay=visibleEvents[visibleEvents.length-1];
        const nextPlay=()=>{setPlaying(false);const next=playback.timeline.events.find(e=>e.t>clockRef.current && (!followMine||!myRow||e.teamId===myRow.home||e.teamId===myRow.away));clockRef.current=next?next.t:GAMECAST_END;setClock(clockRef.current);};
        const spotlight = h('div', { className: 'tl-current-play tl-live-spotlight' },
            h('span', { className: 'tl-label' }, currentPlay ? `${teamName(currentPlay.teamId)} · ${Gamecast.clockLabel(currentPlay.t)}` : savedFinal ? `FINAL · WEEK ${weekLabel}` : 'READY FOR KICKOFF'),
            h('h3', null, currentPlay?.description || (savedFinal ? 'The final is in. View the lineup results below or replay the game from the Week Archive.' : 'The scores and win estimate update as scoring moments arrive.')),
            currentPlay && h('strong', null, `${currentPlay.points >= 0 ? '+' : ''}${currentPlay.points.toFixed(2)} fantasy points`));
        const records = Engine.computeStandings({ ...league, finalizedWeeks: league.finalizedWeeks.filter(week => week.week < weekLabel) });
        const hero = myRow ? h(HeroMatchup, { row: myRow, teams: league.teams, week: weekLabel, records, spotlight,
            quarterScore: playback ? h(QuarterScore, { row: myRow, teams: league.teams, timeline: playback.timeline, landed, clock }) : null,
            progress: clock / GAMECAST_END, statusLabel: playback ? (done ? 'FINAL' : playing ? 'SIMULATION' : 'PAUSED') : savedFinal ? 'FINAL' : 'UPCOMING',
            clockLabel: playback ? Gamecast.clockLabel(clock) : savedFinal ? 'FINAL' : `WK ${weekLabel}` }) : spotlight;
        const lineups = h(LiveLineups, { row: myRow, teams: league.teams, rosterSlots: league.settings.rosterSlots,
            weekData: playback?.weekData || savedFinal, landed, final: done || Boolean(savedFinal), currentPlay });
        if (playback) {
            return h('div', null,
                strip, hero, done && mailNotice, lineups,
                h('p',{className:'tl-hint'},'Historical totals, reconstructed across four quarters. Quarter timing is simulated. Playback controls do not change the saved result.'),
                h('div', { className: 'tl-card' },
                    h('div', { className: 'tl-card-title' }, h('span', null, `Week ${playback.weekData.week} — ${done ? 'Final' : playing ? 'Playing' : 'Paused'}`), h('small', null, `${landed.length}/${playback.timeline.events.length} scoring moments`)),
                    h('div', { className: 'tl-cast-controls' },
                        h('span', { style: { color: playing ? 'var(--gold)' : 'var(--text-muted)' } }, '📡'),
                        h('span', { className: 'tabular tl-cast-clock' }, Gamecast.clockLabel(clock)),
                        h('span', { className: 'tl-cast-progress', role: 'progressbar', 'aria-label': 'Game playback', 'aria-valuenow': Math.round(clock / GAMECAST_END * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 },
                            h('span', { style: { display: 'block', height: '100%', width: `${(clock / GAMECAST_END) * 100}%`, background: 'var(--gold)' } })),
                        !onPlaybackChange && h('button',{className:'tl-btn primary',disabled:done,onClick:togglePlayback},playing?'PAUSE':'RESUME'),
                        !onPlaybackChange && h('button',{className:'tl-btn primary',disabled:done,onClick:nextQuarter},'NEXT QUARTER'),
                        h('button',{className:'tl-btn',disabled:done,onClick:nextPlay},'NEXT PLAY'),
                        done&&h('button',{className:'tl-btn',onClick:()=>{clockRef.current=0;setClock(0);setPlaying(false);}},'REPLAY FROM START'),
                        h('button',{className:'tl-btn','aria-pressed':followMine,onClick:()=>setFollowMine(v=>!v)},followMine?'MY MATCHUP':'ALL MATCHUPS'),
                        CAST_DURATIONS.map(duration => h('button', { key: duration, className: `tl-btn${speed === duration ? ' primary' : ''}`, 'aria-pressed': speed === duration, onClick: () => setSpeed(duration) }, `${duration / 60} MIN`)),
                        h('button', { className: 'tl-btn icon', disabled: done, onClick: skipToEnd }, 'INSTANT')),
                    h('p', { className: 'tl-cast-pace' }, `${speed / 60}-minute game · ${speed / 4} seconds per quarter. Next quarter skips to the break and pauses.`),
                    h(QuarterRecap, { row: myRow, landed, clock, teamName }),
                    done && headlines.length > 0 && h('div', { style: { marginBottom: 14 } },
                        h('span', { className: 'tl-label' }, `Week ${playback.weekData.week} Wire`),
                        headlines.map((headline, i) => h('p', { key: i, style: { fontSize: 12.5, color: 'var(--text-secondary)', margin: '4px 0' } }, headline))),
                    h('div', { style: { maxHeight: 320, overflowY: 'auto' } },
                        visibleEvents.length === 0
                            ? h('div', { className: 'tl-feedrow' }, h('time', null, 'Q1 · 15:00'), h('p', null, 'Crews are in the booth — kickoff momentarily.'))
                            : visibleEvents.slice().reverse().map((event, i) => h('div', { key: i, className: `tl-feedrow${event.isTouchdown ? ' urgent' : ''}` },
                                h('time', null, `${Gamecast.clockLabel(event.t)} · ${event.points >= 0 ? '+' : ''}${event.points.toFixed(2)}`),
                                h('p', null, `${event.description} — ${teamName(event.teamId)}`)))),
                    done && h('div', { style: { marginTop: 14, textAlign: 'center' } },
                        league.phase === 'complete' && onGoCeremony && h('button', { className: 'tl-btn primary', onClick: onGoCeremony }, 'CHAMPIONSHIP CEREMONY'),
                        h('button', { className: 'tl-btn', onClick: () => { setPlayback(null); clockRef.current = 0; setClock(0); } }, 'CLOSE GAMECAST'))));
        }

        return h('div', null,
            strip, hero, savedFinal && mailNotice, lineups,
            league.phase === 'season' && league.weekStage === 'ready' && (!onPlaybackChange || warnings || logsMissing || !logIndex || !cards?.size || (league.settings.eraAdjusted && !eraFactors?.size)) && h('div', { className: 'tl-card' },
                h('div', { className: 'tl-card-title' }, h('span', null, `Week ${league.currentWeek} Command`), h('small', null, `${pairs.length} matchups · ${league.settings.eraAdjusted ? 'era-adjusted' : 'raw scoring'}`)),
                logsMissing && h('div', { className: 'tl-feedrow urgent' }, h('time', null, 'DATA'), h('p', null, 'Weekly game data has not loaded. Use Retry loading above.')),
                !logsMissing && !logIndex && h('div', { className: 'tl-feedrow' }, h('time', null, 'DATA'), h('p', null, 'Loading historical games…')),
                cards !== null && cards.size === 0 && h('div', { className: 'tl-feedrow urgent' }, h('time', null, 'DATA'), h('p', null, 'The player archive has not loaded. Use Retry loading above.')),
                league.settings.eraAdjusted && !eraFactors?.size && h('div', { className: 'tl-feedrow caution' }, h('time', null, 'DATA'), h('p', null, 'Era scoring must load before game day. If loading fails, use Retry loading above.')),
                warnings && h('div', { style: { marginBottom: 10 } },
                    warnings.map((problem, i) => h('div', { key: i, className: 'tl-feedrow caution' }, h('time', null, 'LINEUP'), h('p', null, problem))),
                    h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
                        h('button', { className: 'tl-btn', onClick: onGoRoster }, 'FIX LINEUPS'),
                        h('button', { className: 'tl-btn', onClick: () => runGameDay(true) }, 'RUN ANYWAY'))),
                !onPlaybackChange && h('button', { className: 'tl-btn primary', disabled: !canRun, onClick: () => runGameDay(false), style: { width: '100%', justifyContent: 'center', padding: '10px', marginTop: 4 } }, onlineMeta && onlineMeta.role !== 'commissioner' ? 'WAITING FOR COMMISSIONER' : '▶ RUN GAME DAY')),
            league.phase === 'complete' && h('div', { className: 'tl-card', style: { display: 'flex', alignItems: 'center', gap: 12 } },
                h('span', { style: { fontSize: 24 } }, '🏆'),
                h('div', null, h('span', { className: 'tl-label', style: { display: 'block' } }, 'Season Complete — Champion'), h('strong', { style: { fontFamily: 'var(--font-title)', fontSize: 18 } }, champion ?? 'Unknown')), onGoCeremony && h('button', { className: 'tl-btn primary', onClick: onGoCeremony }, 'CHAMPIONSHIP CEREMONY')),
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
