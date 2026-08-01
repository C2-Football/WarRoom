// ══════════════════════════════════════════════════════════════════
// js/shared/commish-renewal.js — App.Commish.Renewal
// RENEWAL FORECAST: will each human come back next season? Forecast it in
// June from signals we already hold — activity radar + season arc — instead
// of discovering it by silence in August when the league is un-saveable.
//
//   buildForecast({ graph, radar, ledgers, week, nowMs })
//     → { people: [{ userId, name, leagueCount,
//                    probability,       // 0-1, rounded to 2dp
//                    band,              // 'SAFE' | 'WATCH' | 'AT_RISK'
//                    factors: [str],    // EVERY factor that moved the number
//                    plays: [str] }],   // 0-2 retention plays (WATCH/AT_RISK)
//         summary: { safe, watch, atRisk },
//         forecastBasis: 'activity_only' | 'behavior+season' }
//       people sorted riskiest first (probability ascending). isMe excluded —
//       the commissioner doesn't forecast their own renewal.
//
//   fetchForecastInputs({ leagues })
//     → Promise<{ ledgers: { [leagueId]: App.Luck.build result } }>
//       (impure, browser-only convenience; Sleeper leagues only, failures
//        skipped so a dead league yields no ledger, never a fake one)
//
// Inputs are OTHER BRICKS' outputs, treated read-only:
//   graph   = App.Commish.buildMemberGraph result (people/overlap/seats)
//   radar   = App.Commish.Radar.buildRadar result ({ people: [...] })
//   ledgers = { [leagueId]: { rows, weeks } } — App.Luck.buildLedger per
//             league (rows carry rosterId / allPlayPct / luck)
//
// ── THE HEURISTIC (transparent by design — this feeds a forecast card,
//    not a black box; every applied line below emits a factor string) ──
//   baseline                                        0.85
//   radar status   ACTIVE                          +0.08
//                  FADING                          -0.10
//                  DARK_ONE                        -0.20
//                  DARK_ALL                        -0.35
//   season arc, PER TEAM, only when that league's ledger has counted weeks
//   (quartile/half = rank by allPlayPct within that league's ledger rows,
//    ties broken by rosterId; bottom quartile = lowest floor(n/4) teams,
//    min 1; top half = highest floor(n/2) teams):
//                  bottom-quartile all-play, luck < 0
//                    ("bad AND unlucky")           -0.10
//                  bottom-quartile all-play, luck >= 0
//                    ("just bad")                  -0.05
//                  top-half all-play               +0.05
//                  robbed: luck <= -1.5 while allPlayPct >= .5
//                    (stacks with top-half)        -0.08
//   multi-league membership: +0.04 per league beyond the first, capped at
//   +0.08 — sunk identity; people don't walk away from a whole hobby.
//   clamp [0.05, 0.98] — never certain, either way.
//   band (on the ROUNDED probability, so the card never shows a number that
//   contradicts its label): >= .75 SAFE, >= .5 WATCH, else AT_RISK.
//
// OFFSEASON HONESTY: when NO ledger has counted weeks the season-arc lines
// can't fire and the read is behavior-only — forecastBasis: 'activity_only'
// and the factor "offseason read — behavior signals only" is prepended to
// every person. Any counted week anywhere → basis 'behavior+season'.
//
// plays: seeded AlexVoice.pick drafts grounded in the factors that fired
// (robbed → show them the luck ledger; DARK_ONE → name THAT league; …),
// deterministic per person, plain-template fallback when AlexVoice is absent.
//
// Pure compute takes no wall clock (week/nowMs accepted for signature parity
// with sibling engines; nothing here calls Date.now()) — same inputs, same
// forecast, always. Warroom-local (direct <script> tag), Node-testable.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    App.Commish = App.Commish || {};

    const BASELINE = 0.85;
    const CLAMP_LO = 0.05, CLAMP_HI = 0.98;
    const OFFSEASON_FACTOR = 'offseason read — behavior signals only';

    // ── Copy (pure, seeded) ──────────────────────────────────────────
    function pickCopy(seed, variants) {
        const AV = root.AlexVoice;
        if (AV && typeof AV.pick === 'function') return AV.pick(seed, variants);
        return variants[0];
    }

    function bandFor(probability) {
        if (probability >= 0.75) return 'SAFE';
        if (probability >= 0.5) return 'WATCH';
        return 'AT_RISK';
    }

    // ── Season arc for one team (pure) ───────────────────────────────
    // Rank the person's row inside its own league's ledger. Returns
    // { delta, factors, hooks } — factors carry the league name so a
    // three-league person's card reads unambiguously.
    function seasonArc(team, ledger) {
        const out = { delta: 0, factors: [], robbed: false, badSeason: false };
        if (!ledger || !Array.isArray(ledger.weeks) || !ledger.weeks.length) return out;
        const rows = ledger.rows || [];
        const row = rows.find(x => String(x.rosterId) === String(team.rosterId));
        if (!row) return out;
        const n = rows.length;
        if (n < 2) return out;

        const sorted = rows.slice().sort((a, b) =>
            (Number(a.allPlayPct) || 0) - (Number(b.allPlayPct) || 0)
            || String(a.rosterId).localeCompare(String(b.rosterId)));
        const pos = sorted.findIndex(x => String(x.rosterId) === String(row.rosterId));
        const bottomQuartile = pos < Math.max(1, Math.floor(n / 4));
        const topHalf = pos >= Math.ceil(n / 2);
        const luck = Number(row.luck) || 0;
        const pct = Number(row.allPlayPct) || 0;
        const lname = team.leagueName || ('League ' + team.leagueId);

        if (bottomQuartile && luck < 0) {
            out.delta -= 0.10;
            out.factors.push(lname + ': bottom-quartile all-play with negative luck — bad AND unlucky (-0.10)');
            out.badSeason = true;
        } else if (bottomQuartile) {
            out.delta -= 0.05;
            out.factors.push(lname + ': bottom-quartile all-play — just bad (-0.05)');
            out.badSeason = true;
        } else if (topHalf) {
            out.delta += 0.05;
            out.factors.push(lname + ': top-half all-play season (+0.05)');
        }
        // Robbed stacks: a winning all-play side whose H2H record got mugged.
        if (luck <= -1.5 && pct >= 0.5) {
            out.delta -= 0.08;
            out.factors.push(lname + ': unlucky season — rage-quit risk (-0.08)');
            out.robbed = true;
        }
        return out;
    }

    // ── Retention plays (pure, seeded, 0-2) ──────────────────────────
    // Ordered by how loudly each hook predicts churn; capped at two so the
    // card suggests, never lectures. Grounded strictly in factors that fired.
    function draftPlays(userId, hooks) {
        const plays = [];
        const add = (key, variants) => {
            if (plays.length < 2) plays.push(pickCopy('commish-renewal:' + userId + ':' + key, variants));
        };
        if (hooks.darkAll) {
            add('darkall', [
                'Reach out person-to-person — no league talk, just make sure they\'re okay.',
                'Send a human check-in first; the leagues can wait until they answer.',
            ]);
        }
        if (hooks.darkOneLeague) {
            add('darkone', [
                'Check in about ' + hooks.darkOneLeague + ' by name — ask what would make it worth their time again.',
                'Message them about ' + hooks.darkOneLeague + ' specifically — that league is the problem, not the person.',
            ]);
        }
        if (hooks.robbed) {
            add('robbed', [
                'Show them the luck ledger — their roster is better than their record.',
                'Send the all-play table: they were robbed, and receipts beat sympathy.',
            ]);
        }
        if (hooks.badSeason) {
            add('bad', [
                'Pitch next season\'s reset — draft picks, rule tweaks, a clean slate.',
                'Talk up the offseason rebuild — bad years end at the draft.',
            ]);
        }
        if (hooks.fading) {
            add('fade', [
                'A light nudge now beats a renewal chase later — ping them this week.',
                'Ask their take on a league question — feeling needed is retention.',
            ]);
        }
        if (!plays.length) {
            add('generic', [
                'Lock next season\'s draft date early — a date on the calendar renews quietly.',
                'Run a quick offseason poll — voting is the cheapest re-commitment there is.',
            ]);
        }
        return plays;
    }

    // ── The forecast (pure) ──────────────────────────────────────────
    function buildForecast(opts) {
        const graph = (opts && opts.graph) || {};
        const radar = (opts && opts.radar) || {};
        const ledgers = (opts && opts.ledgers) || {};

        const radarByUid = {};
        (Array.isArray(radar) ? radar : (radar.people || []))
            .forEach(p => { radarByUid[String(p.userId)] = p; });

        // Any counted week anywhere upgrades the whole read to season-aware.
        const hasSeason = Object.keys(ledgers).some(lid => {
            const l = ledgers[lid];
            return !!(l && Array.isArray(l.weeks) && l.weeks.length);
        });
        const forecastBasis = hasSeason ? 'behavior+season' : 'activity_only';

        const people = [];
        for (const uid of Object.keys(graph.people || {})) {
            const person = graph.people[uid];
            if (person.isMe) continue;

            let p = BASELINE;
            const factors = [];
            const hooks = { darkAll: false, darkOneLeague: null, robbed: false, badSeason: false, fading: false };

            // Radar status — behavior is the strongest single signal.
            const r = radarByUid[String(uid)];
            const status = r && r.status;
            if (status === 'ACTIVE') {
                p += 0.08; factors.push('active everywhere (+0.08)');
            } else if (status === 'FADING') {
                p -= 0.10; factors.push('fading — watch signals on at least one team (-0.10)');
                hooks.fading = true;
            } else if (status === 'DARK_ONE') {
                p -= 0.20;
                const darkTeam = (r.teams || []).find(t => t.status === 'DARK');
                const lname = darkLeagueName(person, darkTeam);
                factors.push('gone dark in ' + lname + ' (-0.20)');
                hooks.darkOneLeague = lname;
            } else if (status === 'DARK_ALL') {
                p -= 0.35; factors.push('dark across every league (-0.35)');
                hooks.darkAll = true;
            }

            // Season arc, per team.
            for (const team of (person.teams || [])) {
                const arc = seasonArc(team, ledgers[String(team.leagueId)]);
                p += arc.delta;
                arc.factors.forEach(f => factors.push(f));
                if (arc.robbed) hooks.robbed = true;
                if (arc.badSeason) hooks.badSeason = true;
            }

            // Sunk identity — each extra shared league is a reason to stay.
            const leagueCount = Number(person.leagueCount)
                || (person.leagueIds || []).length
                || (person.teams || []).length
                || 1;
            const extra = Math.min(2, leagueCount - 1);
            if (extra > 0) {
                p += extra * 0.04;
                factors.push(leagueCount + ' leagues together — sunk identity (+0.0' + (extra * 4) + ')');
            }

            if (forecastBasis === 'activity_only') factors.unshift(OFFSEASON_FACTOR);

            const probability = Math.round(Math.min(CLAMP_HI, Math.max(CLAMP_LO, p)) * 100) / 100;
            const band = bandFor(probability);
            people.push({
                userId: person.userId,
                name: person.name,
                leagueCount,
                probability,
                band,
                factors,
                plays: band === 'SAFE' ? [] : draftPlays(person.userId, hooks),
            });
        }

        // Riskiest first; name then id as stable tie-breaks.
        people.sort((a, b) =>
            a.probability - b.probability
            || String(a.name).localeCompare(String(b.name))
            || String(a.userId).localeCompare(String(b.userId)));

        const summary = { safe: 0, watch: 0, atRisk: 0 };
        for (const person of people) {
            if (person.band === 'SAFE') summary.safe++;
            else if (person.band === 'WATCH') summary.watch++;
            else summary.atRisk++;
        }
        return { people, summary, forecastBasis };
    }

    // Radar team entries may or may not carry leagueName (the contract only
    // promises leagueId); fall back to the graph, then an honest id label.
    function darkLeagueName(person, darkTeam) {
        if (!darkTeam) return 'that league';
        if (darkTeam.leagueName) return darkTeam.leagueName;
        const t = (person.teams || []).find(x => String(x.leagueId) === String(darkTeam.leagueId));
        return (t && t.leagueName) || ('League ' + darkTeam.leagueId);
    }

    // ── Input hydration (fetch helper — impure, browser-only) ────────
    // One luck-ledger build per league via App.Luck.build (which already
    // gates unplayed weeks). Failures skip the league — a missing ledger
    // reads as "offseason / no data", never as a fabricated season.
    async function fetchForecastInputs(opts) {
        const leagues = (opts && opts.leagues) || [];
        const ledgers = {};
        if (!App.Luck || typeof App.Luck.build !== 'function') return { ledgers };
        await Promise.all(leagues.map(async l => {
            const lid = String(l.league_id || l.id || '');
            if (!lid || lid.startsWith('mfl_')) return; // Sleeper only, v1
            try {
                ledgers[lid] = await App.Luck.build({ league: l });
            } catch (e) { if (root.wrLog) root.wrLog('commish.renewal.ledger', e); }
        }));
        return { ledgers };
    }

    const api = {
        buildForecast,
        fetchForecastInputs,
        // Exposed pure internals — unit-testable seams.
        bandFor,
        seasonArc,
        draftPlays,
    };
    App.Commish.Renewal = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
