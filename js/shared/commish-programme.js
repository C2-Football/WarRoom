// ══════════════════════════════════════════════════════════════════
// js/shared/commish-programme.js — window.App.Commish.Programme
// MATCHDAY PROGRAMME: the N-league broadcast composer. For each commissioned
// league, turn the latest counted week into a deterministic "programme" model
// — headline story, matchup results, top score, luck note, standings — that
// the UI renders and exports as PNGs. All compute is pure: scores arrive via
// the luck-engine's weeklyScores shape, names via its ledger rows, and copy
// is seeded (AlexVoice.pick) so the same week always composes the same page.
//
//   buildProgramme({ league, ledger, weeklyScores, week, graph, nowMs })
//     → { leagueId, leagueName, week, headline, results:[{winnerName,
//          loserName, wPts, lPts, margin, tie}], topScore:{name, pts},
//          luckNote:{name, luck, allPlayPct, kind, text}|null,
//          standingsTop3:[{rosterId, name, wins, losses, ties, pf}],
//          generatedAtMs, empty: false }
//       or { empty: true, leagueId, leagueName, reason } when there is
//       nothing honest to print (no counted weeks / no scores).
//   buildAll({ leagues, ledgers, weeklyScoresByLeague, graph, nowMs })
//     → [programme per league, in input order] — empty-state honest per
//       league; one dead league never blanks the rest of the broadcast.
//
// Headline picks the REAL biggest story: closest game if the tightest margin
// is under 6, else the biggest blowout, else the top score (when no matchup
// pairings exist). No Date.now() — the caller passes nowMs for the export
// timestamp. Warroom-local (direct <script> tag), Node-testable.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    // Margin under this = a nail-biter outranks any blowout as the story.
    const CLOSE_MARGIN = 6;

    function r1(n) { return Math.round((Number(n) || 0) * 10) / 10; }

    function leagueIdOf(l) { return String((l && (l.league_id || l.id)) || ''); }
    function leagueNameOf(l) { return (l && l.name) || ('League ' + leagueIdOf(l)); }

    // Seeded copy with a plain-template fallback: Node tests (and any page
    // that loads before alex-voice.js) still get deterministic, real copy.
    function pickCopy(seed, variants) {
        const AV = root.AlexVoice;
        if (AV && typeof AV.pick === 'function') return AV.pick(seed, variants);
        return variants[0];
    }

    // ── Matchup pairing ──────────────────────────────────────────────
    // Pair score rows by matchupId; names come from the ledger because it is
    // the roster authority (rows without a ledger entry are platform noise —
    // deleted rosters — and are dropped rather than labeled with a guess).
    function pairResults(rows, nameById) {
        const groups = {};
        const order = [];
        for (const r of rows) {
            if (r.matchupId == null) continue; // median/bye rows can't pair
            const key = String(r.matchupId);
            if (!groups[key]) { groups[key] = []; order.push(key); }
            groups[key].push(r);
        }
        const results = [];
        for (const key of order) {
            const g = groups[key];
            if (g.length !== 2) continue; // bye or malformed grouping — no game to report
            const [a, b] = g;
            const aPts = Number(a.points) || 0;
            const bPts = Number(b.points) || 0;
            // Higher score takes the winner slot; on a dead tie the first row
            // holds it and the tie flag tells the UI not to crown anyone.
            const [w, l, wp, lp] = aPts >= bPts ? [a, b, aPts, bPts] : [b, a, bPts, aPts];
            results.push({
                winnerName: nameById[String(w.rosterId)],
                loserName: nameById[String(l.rosterId)],
                wPts: r1(wp),
                lPts: r1(lp),
                margin: r1(wp - lp),
                tie: wp === lp,
            });
        }
        return results;
    }

    // ── Headline ─────────────────────────────────────────────────────
    function composeHeadline(seed, results, topScore) {
        if (results.length) {
            const closest = results.reduce((m, r) => (r.margin < m.margin ? r : m), results[0]);
            if (closest.margin < CLOSE_MARGIN) {
                if (closest.tie) {
                    return pickCopy(seed + ':tie', [
                        closest.winnerName + ' and ' + closest.loserName + ' finish dead level at ' + closest.wPts + ' — nobody blinked',
                        'A dead heat: ' + closest.winnerName + ' vs ' + closest.loserName + ', ' + closest.wPts + ' apiece',
                        'Split the trophy — ' + closest.winnerName + ' and ' + closest.loserName + ' tie at ' + closest.wPts,
                    ]);
                }
                return pickCopy(seed + ':close', [
                    closest.winnerName + ' survives ' + closest.loserName + ' by ' + closest.margin + ' — the week’s nail-biter',
                    'Photo finish: ' + closest.winnerName + ' edges ' + closest.loserName + ' by just ' + closest.margin,
                    closest.winnerName + ' escapes — ' + closest.loserName + ' falls ' + closest.margin + ' short',
                ]);
            }
            const blowout = results.reduce((m, r) => (r.margin > m.margin ? r : m), results[0]);
            return pickCopy(seed + ':blowout', [
                blowout.winnerName + ' steamrolls ' + blowout.loserName + ' by ' + blowout.margin,
                'No contest: ' + blowout.winnerName + ' buries ' + blowout.loserName + ' by ' + blowout.margin,
                blowout.winnerName + ' hangs ' + blowout.wPts + ' in a ' + blowout.margin + '-point rout of ' + blowout.loserName,
            ]);
        }
        // No pairings this week (median-only or points-only platforms):
        // the top score is the only story we can honestly tell.
        return pickCopy(seed + ':top', [
            topScore.name + ' posts the week’s top score: ' + topScore.pts,
            topScore.name + ' leads all scorers with ' + topScore.pts,
            'Scoreboard king: ' + topScore.name + ' with ' + topScore.pts,
        ]);
    }

    // ── Luck note ────────────────────────────────────────────────────
    // The robbed team first: strong by all-play (≥ .500) yet under its
    // expected wins — the story every league actually argues about. Only if
    // nobody's been robbed do we point at the schedule's darling instead.
    function composeLuckNote(seed, ledgerRows) {
        const robbed = ledgerRows
            .filter(r => r.luck < 0 && r.allPlayPct >= 0.5)
            .sort((a, b) => a.luck - b.luck)[0];
        const pick2 = robbed || ledgerRows.filter(r => r.luck > 0).sort((a, b) => b.luck - a.luck)[0];
        if (!pick2) return null; // flat luck across the board — no note beats a fake one
        const kind = robbed ? 'robbed' : 'charmed';
        const pct = Math.round(pick2.allPlayPct * 100);
        const mag = r1(Math.abs(pick2.luck));
        const text = kind === 'robbed'
            ? pickCopy(seed + ':robbed', [
                pick2.name + ' outscores the field (' + pct + '% all-play) yet sits ' + mag + ' wins under expectation — the schedule owes them',
                'Robbed: ' + pick2.name + ' plays at ' + pct + '% all-play but trails its expected record by ' + mag,
                pick2.name + ' keeps winning the scoreboard and losing the schedule — ' + mag + ' wins below expected',
            ])
            : pickCopy(seed + ':charmed', [
                pick2.name + ' rides the schedule: ' + mag + ' wins over expectation',
                'Schedule’s darling: ' + pick2.name + ', up ' + mag + ' on expected wins',
                pick2.name + ' cashes ' + mag + ' wins the all-play says it never earned',
            ]);
        return { name: pick2.name, luck: pick2.luck, allPlayPct: pick2.allPlayPct, kind, text };
    }

    // ── Programme (pure) ─────────────────────────────────────────────
    function buildProgramme(opts) {
        const league = (opts && opts.league) || {};
        const ledger = (opts && opts.ledger) || {};
        const weeklyScores = (opts && opts.weeklyScores) || {};
        const graph = (opts && opts.graph) || null; // reserved: cross-league flavor lands here
        void graph;
        const lid = leagueIdOf(league);
        const lname = leagueNameOf(league);
        const nowMs = opts && opts.nowMs != null ? opts.nowMs : null;

        const weeks = (ledger.weeks || []).filter(w => w > 0);
        if (!weeks.length) return { empty: true, leagueId: lid, leagueName: lname, reason: 'no_counted_weeks' };

        // Latest counted week by default; a caller may pin an earlier COUNTED
        // week (rewind programmes) but never an uncounted one — the ledger is
        // the authority on which weeks actually happened.
        const asked = Number(opts && opts.week);
        const W = weeks.includes(asked) ? asked : Math.max.apply(null, weeks);

        const nameById = {};
        for (const row of (ledger.rows || [])) nameById[String(row.rosterId)] = row.name;

        const scoreRows = (weeklyScores[W] || []).filter(r => nameById[String(r.rosterId)] != null);
        if (!scoreRows.length) return { empty: true, leagueId: lid, leagueName: lname, reason: 'no_scores' };

        const seed = 'programme:' + lid + ':' + W;
        const results = pairResults(scoreRows, nameById);

        const topRow = scoreRows.reduce((m, r) => ((Number(r.points) || 0) > (Number(m.points) || 0) ? r : m), scoreRows[0]);
        const topScore = { name: nameById[String(topRow.rosterId)], pts: r1(topRow.points) };

        return {
            leagueId: lid,
            leagueName: lname,
            week: W,
            headline: composeHeadline(seed, results, topScore),
            results,
            topScore,
            luckNote: composeLuckNote(seed, ledger.rows || []),
            standingsTop3: (ledger.rows || []).slice(0, 3).map(r => ({
                rosterId: r.rosterId, name: r.name, wins: r.wins, losses: r.losses, ties: r.ties, pf: r.pf,
            })),
            generatedAtMs: nowMs,
            empty: false,
        };
    }

    // ── Batch (pure) ─────────────────────────────────────────────────
    // One programme per league, input order preserved. Ledgers and scores are
    // keyed by leagueId; a league missing either gets an honest empty page.
    function buildAll(opts) {
        const leagues = (opts && opts.leagues) || [];
        const ledgers = (opts && opts.ledgers) || {};
        const scoresBy = (opts && opts.weeklyScoresByLeague) || {};
        return leagues.map(l => {
            const lid = leagueIdOf(l);
            const ledger = ledgers[lid];
            if (!ledger) return { empty: true, leagueId: lid, leagueName: leagueNameOf(l), reason: 'no_ledger' };
            return buildProgramme({
                league: l,
                ledger,
                weeklyScores: scoresBy[lid] || {},
                graph: opts && opts.graph,
                nowMs: opts && opts.nowMs,
            });
        });
    }

    App.Commish = App.Commish || {};
    const api = { buildProgramme, buildAll };
    App.Commish.Programme = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
