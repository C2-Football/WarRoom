// ══════════════════════════════════════════════════════════════════
// js/shared/commish-schedule.js — window.App.Commish.Schedule
//
// SCHEDULE BUILDER — a commissioner-authored week-by-week matchup plan for
// one league. This is a PLANNING tool, not a live schedule editor: Sleeper
// (and every other platform this app reads) generates its own matchups and
// exposes no write endpoint for them, the same read-only posture
// commish-calendar.js already documents ("Sleeper is READ-ONLY: the solver
// *suggests* a shift, it never reschedules"). What this engine produces is
// a plan the commissioner can hand-enter into their platform's own
// schedule tool, or simply use as the league's record of intent — plus a
// live comparison against what ACTUALLY happened once games are played, so
// a rebuilt plan never contradicts real results.
//
//   buildRoundRobin({ teamIds, weeks })            — pure
//     → { rounds: [[[a,b], ...], ...], byeTeam: '__BYE__'|null }
//       Canonical single-cycle round-robin via the circle method. Odd team
//       counts get a synthetic '__BYE__' slot so every round is a perfect
//       matching; cycles repeat (round 0 reused) when `weeks` exceeds one
//       full cycle (N-1 rounds), so a double round-robin is just weeks =
//       2*(N-1).
//
//   applyPins({ rounds, weeks, pins })              — pure
//     → { schedule: [{week, matchups:[[a,b],...], bye}], conflicts: [...] }
//       Places each of the N-1 (or more, if cycled) generated ROUNDS onto a
//       week number. A pin {week, teamA, teamB} finds the round that
//       already contains that pair — every pair meets in exactly one round
//       per cycle by construction — and assigns THAT round to the
//       requested week. This never invents new pairings or reruns the
//       generator; it only relabels which week a round occupies, so the
//       schedule stays a valid round-robin no matter how many pins are
//       applied. Two pins that would force the same round onto two
//       different weeks, or two different rounds onto the same week,
//       cannot both be honored — the first pin given wins and every
//       loser is reported in `conflicts`, never silently dropped.
//
//   forcePairing(schedule, week, teamA, teamB)      — pure
//     → { schedule, ok, changed, error }
//       Ad hoc single-week edit for after generation: makes teamA and
//       teamB opponents in `week` by swapping in their current opponents
//       (or the bye slot). A matching-preserving transposition — every
//       team still appears exactly once in the resulting week.
//
//   validateSchedule(schedule, teamIds)             — pure
//     → { gamesPerTeam, meetingCounts, minMeetings, maxMeetings,
//         byeCounts, warnings:[...] }
//       Never auto-fixes anything it finds — states of the count.
//
//   annotateDivisions(schedule, divisions)          — pure
//     → schedule with matchups[].sameDivision + { divisionMeetingCounts }
//       Read-only awareness, not a division-balancing generator: circle-
//       method round-robin does not guarantee even division coverage, so
//       this only surfaces which weeks already land as division games —
//       the commissioner pins the rest by hand if they want more.
//
//   fetchActualMatchups(leagueId, week)             — impure, Sleeper only
//     → Promise<[[rosterIdA, rosterIdB], ...]>  ([] on any failure)
//
//   mergeActuals(schedule, actualsByWeek)           — pure
//     → schedule with source:'actual'|'planned' per week; actual matchups
//       overwrite the plan for that week (real results are never
//       contradicted by a plan), planned weeks are untouched.
//
//   toText(schedule, nameFor) / toCSV(schedule, nameFor) — pure exports.
//
// Every function here is pure except fetchActualMatchups; teamIds and week
// numbers are always strings/numbers, never React elements or DOM nodes —
// this file has no framework dependency and is Node-testable like every
// other commish-*.js engine.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    App.Commish = App.Commish || {};

    const BYE = '__BYE__';

    // ── Round-robin generator (circle method) ─────────────────────────
    function buildRoundRobin(opts) {
        const o = opts || {};
        const teamIds = (o.teamIds || []).map(String);
        const n = teamIds.length;
        if (n < 2) return { rounds: [], byeTeam: null };

        const odd = n % 2 === 1;
        const arr = odd ? teamIds.concat([BYE]) : teamIds.slice();
        const size = arr.length; // even by construction
        const cycleLen = size - 1;
        const half = size / 2;

        // Fix arr[0]; rotate the rest through cycleLen rounds.
        const fixed = arr[0];
        let rest = arr.slice(1);
        const canonicalRounds = [];
        for (let r = 0; r < cycleLen; r++) {
            const ring = [fixed].concat(rest);
            const pairs = [];
            for (let i = 0; i < half; i++) pairs.push([ring[i], ring[size - 1 - i]]);
            canonicalRounds.push(pairs);
            rest.unshift(rest.pop()); // rotate right by one
        }

        const weeks = Number.isFinite(Number(o.weeks)) && Number(o.weeks) > 0 ? Math.floor(Number(o.weeks)) : cycleLen;
        const rounds = [];
        for (let w = 0; w < weeks; w++) rounds.push(canonicalRounds[w % cycleLen]);

        return { rounds, byeTeam: odd ? BYE : null };
    }

    // ── Pin placement (relabel rounds → weeks, never regenerate) ──────
    function applyPins(opts) {
        const o = opts || {};
        const rounds = o.rounds || [];
        const pins = o.pins || [];
        const totalWeeks = rounds.length;

        const roundOfPair = (a, b) => {
            for (let i = 0; i < rounds.length; i++) {
                if (rounds[i].some(p => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a))) return i;
            }
            return -1;
        };

        const weekToRound = new Map(); // week(1-based) -> round index
        const roundToWeek = new Map(); // round index -> week(1-based)
        const conflicts = [];

        pins.forEach(pin => {
            const week = Number(pin && pin.week);
            const a = String(pin && pin.teamA), b = String(pin && pin.teamB);
            if (!Number.isFinite(week) || week < 1 || week > totalWeeks) {
                conflicts.push({ pin, reason: 'week ' + (pin && pin.week) + ' is outside the ' + totalWeeks + '-week schedule' });
                return;
            }
            if (a === b) { conflicts.push({ pin, reason: 'a team cannot play itself' }); return; }
            const ri = roundOfPair(a, b);
            if (ri < 0) {
                // Every pair meets in exactly one round PER CYCLE. If weeks >
                // one cycle length the pair may appear in more than one round
                // (once per cycle) — roundOfPair finds the first; that is
                // fine, later-cycle repeats of the same pair are identical
                // matchings so any instance satisfies the pin.
                conflicts.push({ pin, reason: a + ' vs ' + b + ' never occurs in this schedule' });
                return;
            }
            const existingWeekForRound = roundToWeek.get(ri);
            const existingRoundForWeek = weekToRound.get(week);
            if (existingWeekForRound != null && existingWeekForRound !== week) {
                conflicts.push({ pin, reason: a + ' vs ' + b + ' is already pinned to week ' + existingWeekForRound });
                return;
            }
            if (existingRoundForWeek != null && existingRoundForWeek !== ri) {
                conflicts.push({ pin, reason: 'week ' + week + ' is already claimed by another pin' });
                return;
            }
            weekToRound.set(week, ri);
            roundToWeek.set(ri, week);
        });

        // Fill remaining weeks with remaining rounds, in original order —
        // deterministic, no magic reordering beyond what pins requested.
        const usedRounds = new Set(roundToWeek.keys());
        const freeRounds = [];
        for (let i = 0; i < rounds.length; i++) if (!usedRounds.has(i)) freeRounds.push(i);
        let fi = 0;
        for (let w = 1; w <= totalWeeks; w++) {
            if (!weekToRound.has(w)) { weekToRound.set(w, freeRounds[fi]); fi++; }
        }

        const schedule = [];
        for (let w = 1; w <= totalWeeks; w++) {
            const pairs = rounds[weekToRound.get(w)];
            const byePair = pairs.find(p => p[0] === BYE || p[1] === BYE);
            const bye = byePair ? (byePair[0] === BYE ? byePair[1] : byePair[0]) : null;
            const matchups = pairs.filter(p => p !== byePair);
            schedule.push({ week: w, matchups, bye, source: 'planned' });
        }
        return { schedule, conflicts };
    }

    // ── Ad hoc single-week edit ────────────────────────────────────────
    function forcePairing(schedule, week, teamA, teamB) {
        const a = String(teamA), b = String(teamB);
        const idx = (schedule || []).findIndex(wk => wk.week === Number(week));
        if (idx < 0) return { schedule, ok: false, changed: false, error: 'week ' + week + ' not found' };
        if (a === b) return { schedule, ok: false, changed: false, error: 'a team cannot play itself' };
        const wk = schedule[idx];
        const already = (wk.matchups || []).some(p => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));
        if (already) return { schedule, ok: true, changed: false };

        const findOpp = (team) => {
            if (wk.bye === team) return BYE;
            const pair = (wk.matchups || []).find(p => p[0] === team || p[1] === team);
            if (!pair) return undefined; // team not in this week at all — caller error
            return pair[0] === team ? pair[1] : pair[0];
        };
        const oppA = findOpp(a), oppB = findOpp(b);
        if (oppA === undefined || oppB === undefined) {
            return { schedule, ok: false, changed: false, error: 'one of these teams is not scheduled this week' };
        }

        const newMatchups = (wk.matchups || []).filter(p => !p.includes(a) && !p.includes(b));
        let newBye = wk.bye;
        if (oppA === BYE) { newBye = oppB; newMatchups.push([a, b]); }
        else if (oppB === BYE) { newBye = oppA; newMatchups.push([a, b]); }
        else { newMatchups.push([a, b], [oppA, oppB]); }

        const newWeek = { ...wk, matchups: newMatchups, bye: newBye, source: 'planned' };
        const next = schedule.slice();
        next[idx] = newWeek;
        return { schedule: next, ok: true, changed: true };
    }

    // ── Validation (states, never fixes) ───────────────────────────────
    function validateSchedule(schedule, teamIds) {
        const ids = (teamIds || []).map(String);
        const gamesPerTeam = {}; ids.forEach(id => { gamesPerTeam[id] = 0; });
        const byeCounts = {}; ids.forEach(id => { byeCounts[id] = 0; });
        const meetingCounts = {};
        const key = (a, b) => [a, b].sort().join('|');

        (schedule || []).forEach(wk => {
            (wk.matchups || []).forEach(([a, b]) => {
                if (gamesPerTeam[a] != null) gamesPerTeam[a]++;
                if (gamesPerTeam[b] != null) gamesPerTeam[b]++;
                const k = key(a, b);
                meetingCounts[k] = (meetingCounts[k] || 0) + 1;
            });
            if (wk.bye != null && byeCounts[wk.bye] != null) byeCounts[wk.bye]++;
        });

        // minMeetings/maxMeetings are computed over the FULL C(ids,2) pair
        // universe, defaulting an unobserved pair to 0 — NOT just
        // Object.values(meetingCounts), which only holds pairs that met at
        // least once and so cannot see a pair displaced down to zero. A pair
        // silently missing from the schedule is exactly the failure mode
        // forcePairing() can cause (see below) and exactly what a min of "1"
        // would hide.
        const allPairKeys = [];
        for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) allPairKeys.push(key(ids[i], ids[j]));
        const allMeetingVals = allPairKeys.map(k => meetingCounts[k] || 0);
        const minMeetings = allMeetingVals.length ? Math.min(...allMeetingVals) : 0;
        const maxMeetings = allMeetingVals.length ? Math.max(...allMeetingVals) : 0;

        const warnings = [];
        const gameVals = Object.values(gamesPerTeam);
        if (gameVals.length && Math.max(...gameVals) - Math.min(...gameVals) > 1) {
            warnings.push('Some teams play more games than others (max ' + Math.max(...gameVals) + ', min ' + Math.min(...gameVals) + ').');
        }
        // A round-robin generated in one pass always has minMeetings ===
        // maxMeetings (every pair meets the same number of times per cycle).
        // The one thing that can break this AFTER generation is
        // forcePairing(): it is a LOCAL, single-week transposition — it does
        // not know whether the two teams it just paired already meet
        // elsewhere in the schedule, so it can create a second meeting
        // between them while some other pair now meets zero times. That
        // imbalance changes gamesPerTeam only by luck of who was displaced,
        // so it needs its OWN check naming the actual pairs, not just a
        // number range the games-per-team check might miss entirely.
        if (minMeetings !== maxMeetings) {
            const atMax = allPairKeys.filter(k => (meetingCounts[k] || 0) === maxMeetings).map(k => k.replace('|', ' vs '));
            const atMin = allPairKeys.filter(k => (meetingCounts[k] || 0) === minMeetings).map(k => k.replace('|', ' vs '));
            warnings.push('Some pairs meet ' + maxMeetings + ' time' + (maxMeetings === 1 ? '' : 's') + ' (' + atMax.join(', ') + ') while others meet ' + minMeetings + (minMeetings === 0 ? ' (never play)' : ' time' + (minMeetings === 1 ? '' : 's')) + ' (' + atMin.join(', ') + ').');
        }
        // Consecutive-bye check (relevant only for odd team counts).
        ids.forEach(id => {
            let streak = 0, worst = 0;
            (schedule || []).forEach(wk => { streak = wk.bye === id ? streak + 1 : 0; worst = Math.max(worst, streak); });
            if (worst >= 2) warnings.push(id + ' has ' + worst + ' consecutive bye weeks.');
        });

        return { gamesPerTeam, meetingCounts, minMeetings, maxMeetings, byeCounts, warnings };
    }

    // ── Division awareness (read-only annotation) ──────────────────────
    function annotateDivisions(schedule, divisions) {
        const div = divisions || {};
        if (!Object.keys(div).length) return { schedule, divisionMeetingCounts: {} };
        const counts = {};
        const out = (schedule || []).map(wk => ({
            ...wk,
            matchups: (wk.matchups || []).map(([a, b]) => {
                const same = div[a] != null && div[a] === div[b];
                if (same) { const k = [div[a]].join(''); counts[k] = (counts[k] || 0) + 1; }
                return { pair: [a, b], sameDivision: same };
            }),
        }));
        return { schedule: out, divisionMeetingCounts: counts };
    }

    // ── Actual results (impure, Sleeper only — read never write) ──────
    async function fetchActualMatchups(leagueId, week) {
        try {
            const res = await fetch('https://api.sleeper.app/v1/league/' + leagueId + '/matchups/' + week);
            if (!res.ok) return [];
            const rows = await res.json();
            const byMatchupId = {};
            (rows || []).forEach(r => {
                if (r == null || r.matchup_id == null) return;
                const k = String(r.matchup_id);
                (byMatchupId[k] = byMatchupId[k] || []).push(String(r.roster_id));
            });
            return Object.values(byMatchupId).filter(g => g.length === 2);
        } catch (e) {
            if (root.wrLog) root.wrLog('commish.schedule.actuals', e);
            return [];
        }
    }

    // ── Merge real results over the plan (actuals always win) ─────────
    function mergeActuals(schedule, actualsByWeek) {
        const a = actualsByWeek || {};
        return (schedule || []).map(wk => {
            const real = a[wk.week];
            if (!real || !real.length) return wk;
            return { ...wk, matchups: real, source: 'actual' };
        });
    }

    // ── Export ──────────────────────────────────────────────────────
    function toText(schedule, nameFor) {
        const name = (id) => (typeof nameFor === 'function' ? (nameFor(id) || id) : id);
        return (schedule || []).map(wk => {
            const lines = (wk.matchups || []).map(([a, b]) => name(a) + ' vs ' + name(b));
            if (wk.bye != null) lines.push(name(wk.bye) + ' — BYE');
            return 'Week ' + wk.week + (wk.source === 'actual' ? ' (actual)' : '') + '\n' + lines.map(l => '  ' + l).join('\n');
        }).join('\n\n');
    }

    function toCSV(schedule, nameFor) {
        const name = (id) => (typeof nameFor === 'function' ? (nameFor(id) || id) : id);
        const rows = [['Week', 'Team A', 'Team B', 'Source']];
        (schedule || []).forEach(wk => {
            (wk.matchups || []).forEach(([a, b]) => rows.push([wk.week, name(a), name(b), wk.source || 'planned']));
            if (wk.bye != null) rows.push([wk.week, name(wk.bye), 'BYE', wk.source || 'planned']);
        });
        return rows.map(r => r.map(c => /[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : c).join(',')).join('\n');
    }

    App.Commish.Schedule = {
        BYE,
        buildRoundRobin,
        applyPins,
        forcePairing,
        validateSchedule,
        annotateDivisions,
        fetchActualMatchups,
        mergeActuals,
        toText,
        toCSV,
    };

    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.Commish.Schedule;
})(typeof window !== 'undefined' ? window : globalThis);
