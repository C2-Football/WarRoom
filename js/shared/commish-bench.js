// ══════════════════════════════════════════════════════════════════
// js/shared/commish-bench.js — window.App.Commish.Bench
// THE BENCH + DAY ONE FOLDER: seat-filling from the commissioner's own
// network. An open seat is a recruiting problem, and the multi-league
// commissioner already knows the recruits — the member graph IS the bench.
//
//   candidatesForSeat({ graph, radar, seat, limit })
//     → [{ userId, name, score, reasons:[strings], radarClass }]
//     Ranked people NOT already in the seat's league. Scoring is transparent
//     on purpose — every point ships with the reason it was earned, so the
//     commissioner can defend the shortlist to themselves.
//   buildProspectus({ seat, league, graph, playersData, values })
//     → { leagueName, recordLine, rosterSize, topAssets, positionCounts,
//         pitch }   // the one-glance sell sheet for the open roster
//   buildDayOneFolder({ league, seat, recruitName, graph, playersData,
//                       values, constitutionDigest })
//     → { sections: [{ title, body }], leagueName, recruitName }
//        // Welcome / Your Roster / Your Rivals / First 90 Days /
//        // House Rules. leagueName + recruitName let a caller label
//        // one folder among several without re-deriving them.
//
// Inputs are App.Commish.buildMemberGraph output (read-only) plus the radar
// classification from the engagement engine. Pure compute throughout — no
// fetching, no clock reads. Copy is seeded through AlexVoice.pick so the
// same seat always reads the same, with a plain-template fallback when
// AlexVoice is absent (Node tests). Honest empty states everywhere: no
// values map → no rankings, no constitution → say so, never invent.
// Warroom-local (direct <script> tag), Node-testable.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    // Deterministic copy: AlexVoice varies the phrasing per seed so two seats
    // never read identically; without it (Node) the first variant stands —
    // the templates are written so variants[0] is always presentable.
    function voicePick(seed, variants) {
        if (root.AlexVoice && typeof root.AlexVoice.pick === 'function') {
            return root.AlexVoice.pick(seed, variants);
        }
        return (variants && variants[0]) || '';
    }

    function playerName(playersData, pid) {
        const p = playersData && playersData[pid];
        if (!p) return String(pid);
        return p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || String(pid);
    }

    // The radar engine ships classes like ACTIVE / FADING / DARK_30. Accept
    // the common container shapes (map of strings, map of rows, rows array,
    // or a wrapped { people } / { rows }) so this module doesn't break if the
    // radar output evolves — a missing signal degrades to "no radar", not a
    // crash.
    function radarClassFor(radar, userId) {
        if (!radar) return null;
        const uid = String(userId);
        let entry = null;
        if (Array.isArray(radar)) {
            entry = radar.find(r => r && String(r.userId) === uid);
        } else if (typeof radar === 'object') {
            if (radar.people || radar.rows) return radarClassFor(radar.people || radar.rows, userId);
            entry = radar[uid];
        }
        if (entry == null) return null;
        if (typeof entry === 'string') return entry;
        return entry.class || entry.radarClass || entry.status || entry.state || null;
    }

    // ── The Bench ────────────────────────────────────────────────────
    // Rank the commissioner's network for an open seat. The score is a
    // deliberately small integer: +3 radar-ACTIVE (they'll actually answer),
    // +1 FADING, 0 for DARK_*; +1 per league beyond their first (capped +2 —
    // multi-league citizens show up); +1 for any winning record (competent).
    function candidatesForSeat(opts) {
        const graph = (opts && opts.graph) || { people: {} };
        const radar = opts && opts.radar;
        const seat = (opts && opts.seat) || {};
        const limit = (opts && opts.limit) || 5;
        const seatLid = String(seat.leagueId != null ? seat.leagueId : '');

        const out = [];
        for (const p of Object.values(graph.people || {})) {
            if (p.isMe) continue;
            if ((p.leagueIds || []).some(lid => String(lid) === seatLid)) continue;

            let score = 0;
            const reasons = [];
            const rc = radarClassFor(radar, p.userId);

            if (rc === 'ACTIVE') {
                score += 3; reasons.push('Active on Sleeper right now (+3)');
            } else if (rc === 'FADING') {
                score += 1; reasons.push('Fading — reachable, but cooling (+1)');
            } else if (rc && rc.indexOf('DARK') === 0) {
                // Zero points, but say why — a transparent 0 beats a silent one.
                reasons.push('Gone dark — expect a cold call (+0)');
            }

            const extraLeagues = Math.min(Math.max((p.leagueCount || 0) - 1, 0), 2);
            if (extraLeagues > 0) {
                score += extraLeagues;
                reasons.push('In ' + p.leagueCount + ' of your leagues — an engaged citizen (+' + extraLeagues + ')');
            }

            const winner = (p.teams || []).find(t => t.record && t.record.w > t.record.l);
            if (winner) {
                score += 1;
                reasons.push('Winning record (' + winner.record.w + '-' + winner.record.l + ') in ' + winner.leagueName + ' (+1)');
            }

            out.push({ userId: p.userId, name: p.name, score, reasons, radarClass: rc || null });
        }
        return out
            .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
            .slice(0, limit);
    }

    // ── Shared roster read (prospectus + folder) ─────────────────────
    // One honest read of the open roster. Without a values map there are NO
    // rankings — position counts are facts we have, "top assets" would be a
    // guess we won't make.
    function readRoster(league, seat, playersData, values) {
        const rosters = (league && league.rosters) || [];
        const roster = rosters.find(r => String(r.roster_id) === String(seat && seat.rosterId));
        const players = (roster && roster.players) || [];

        const positionCounts = {};
        for (const pid of players) {
            const pos = (playersData && playersData[pid] && playersData[pid].position) || '?';
            positionCounts[pos] = (positionCounts[pos] || 0) + 1;
        }

        let topAssets = [];
        if (values && typeof values === 'object') {
            topAssets = players
                .filter(pid => typeof values[pid] === 'number')
                .sort((a, b) => values[b] - values[a])
                .slice(0, 5)
                .map(pid => ({
                    pid,
                    name: playerName(playersData, pid),
                    pos: (playersData && playersData[pid] && playersData[pid].position) || '?',
                    value: values[pid],
                }));
        }

        const st = roster && roster.settings;
        const recordLine = st
            ? (Number(st.wins) || 0) + '-' + (Number(st.losses) || 0) + ((Number(st.ties) || 0) ? '-' + Number(st.ties) : '')
            : 'no record on file';

        return { roster, players, positionCounts, topAssets, recordLine };
    }

    function countsLine(positionCounts) {
        const order = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
        const keys = Object.keys(positionCounts)
            .sort((a, b) => {
                const ia = order.indexOf(a), ib = order.indexOf(b);
                return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
            });
        return keys.map(k => positionCounts[k] + ' ' + k).join(', ');
    }

    // ── Prospectus ───────────────────────────────────────────────────
    // The sell sheet: what a recruit sees before saying yes. The pitch leads
    // with the strongest CONCRETE fact available — a named top asset beats a
    // record beats raw roster shape — and never claims what the data can't back.
    function buildProspectus(opts) {
        const seat = (opts && opts.seat) || {};
        const league = (opts && opts.league) || {};
        const playersData = (opts && opts.playersData) || {};
        const read = readRoster(league, seat, playersData, opts && opts.values);
        const leagueName = league.name || seat.leagueName || 'the league';

        const seed = 'bench:' + String(seat.leagueId || '') + ':' + String(seat.rosterId || '');
        const opener = voicePick(seed + ':open', [
            'There’s an open chair in ' + leagueName + '.',
            leagueName + ' has a seat that needs a real GM.',
            'A franchise in ' + leagueName + ' just came on the market.',
        ]);

        // Strongest fact, in strict preference order — one true thing, said plainly.
        let fact;
        const rec = (read.roster && read.roster.settings) || null;
        if (read.topAssets.length) {
            const a = read.topAssets[0];
            fact = voicePick(seed + ':fact', [
                a.name + ' headlines the roster (' + a.pos + ', value ' + a.value + ').',
                'The roster starts with ' + a.name + ' — a real asset, not a rebuild myth.',
                'You’d inherit ' + a.name + ' (' + a.pos + ') at value ' + a.value + ' on day one.',
            ]);
        } else if (rec && (Number(rec.wins) || 0) > (Number(rec.losses) || 0)) {
            fact = voicePick(seed + ':fact', [
                'The seat comes with a ' + read.recordLine + ' record — this is not a teardown.',
                'It’s a ' + read.recordLine + ' team already; you’d be steering, not rebuilding.',
            ]);
        } else if (read.players.length) {
            fact = voicePick(seed + ':fact', [
                'The roster runs ' + read.players.length + ' deep: ' + countsLine(read.positionCounts) + '.',
                read.players.length + ' players on the books — ' + countsLine(read.positionCounts) + '.',
            ]);
        } else {
            // Honest empty state: no roster data is a fact too.
            fact = 'The roster sheet is blank on our side — but the seat and the league are real.';
        }

        const closer = voicePick(seed + ':close', [
            'Want the keys?',
            'Say the word and it’s yours.',
            'One yes and the franchise is yours.',
        ]);

        return {
            leagueName,
            recordLine: read.recordLine,
            rosterSize: read.players.length,
            topAssets: read.topAssets,
            positionCounts: read.positionCounts,
            pitch: opener + ' ' + fact + ' ' + closer,
        };
    }

    // ── Day One Folder ───────────────────────────────────────────────
    // Everything a new owner needs on the day they say yes, as sections a
    // commissioner can paste straight into a DM. Every body is a non-empty
    // string even when the data is thin — thin data gets said out loud.

    // Sleeper's waiver_day_of_week is 0-indexed from MONDAY (the default of 2
    // renders as Wednesday in the Sleeper app), not from Sunday.
    const WAIVER_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    function scoringLine(league) {
        const ss = league && league.scoring_settings;
        if (!ss) return 'scoring settings not on file';
        const rec = Number(ss.rec) || 0;
        const base = rec === 1 ? 'full-PPR' : rec === 0.5 ? 'half-PPR' : rec === 0 ? 'standard (no PPR)' : rec + '-per-reception';
        return base;
    }

    function isSuperflex(league) {
        const rp = (league && league.roster_positions) || [];
        // Either an explicit SUPER_FLEX slot or a second starting QB slot.
        return rp.includes('SUPER_FLEX') || rp.filter(p => p === 'QB').length >= 2;
    }

    function buildDayOneFolder(opts) {
        const league = (opts && opts.league) || {};
        const seat = (opts && opts.seat) || {};
        const graph = (opts && opts.graph) || { people: {} };
        const playersData = (opts && opts.playersData) || {};
        const recruitName = (opts && opts.recruitName) || '';
        const constitutionDigest = opts && opts.constitutionDigest;
        const seatLid = String(seat.leagueId != null ? seat.leagueId : (league.league_id || league.id || ''));
        const leagueName = league.name || seat.leagueName || 'the league';
        const read = readRoster(league, seat, playersData, opts && opts.values);
        const seed = 'folder:' + seatLid + ':' + String(seat.rosterId || '');

        const sections = [];

        // Welcome — name, size, the two settings that change how you play.
        const size = Number(league.total_rosters) || ((league.rosters || []).length) || 0;
        const welcome = voicePick(seed + ':welcome', [
            'Welcome' + (recruitName ? ', ' + recruitName : '') + ' — you’re taking over a franchise in ' + leagueName + '.',
            (recruitName ? recruitName + ', w' : 'W') + 'elcome aboard: ' + leagueName + ' is your league now too.',
        ]) + ' It’s a ' + (size ? size + '-team ' : '') + scoringLine(league) + ' league'
          + (isSuperflex(league) ? ' with a superflex slot — QBs matter double here.' : '.');
        sections.push({ title: 'Welcome', body: welcome });

        // Your Roster — rankings only when a values map exists; otherwise
        // position counts and an honest note, never invented rankings.
        let rosterBody;
        if (!read.players.length) {
            rosterBody = 'The roster is empty — a clean slate. Your first waiver run builds the team from scratch.';
        } else if (read.topAssets.length) {
            rosterBody = 'Top assets: ' + read.topAssets.map(a => a.name + ' (' + a.pos + ', ' + a.value + ')').join(', ')
                + '. Full shape: ' + countsLine(read.positionCounts) + ' — ' + read.players.length + ' players, record ' + read.recordLine + '.';
        } else {
            rosterBody = read.players.length + ' players on the roster: ' + countsLine(read.positionCounts)
                + '. Record ' + read.recordLine + '. No market values loaded, so no rankings here — the counts are the honest read.';
        }
        sections.push({ title: 'Your Roster', body: rosterBody });

        // Your Rivals — everyone else in this league, with records, flagging
        // multi-league citizens (they're in 2+ of MY leagues: known quantities).
        const rivalLines = [];
        for (const p of Object.values(graph.people || {})) {
            const team = (p.teams || []).find(t => String(t.leagueId) === seatLid);
            if (!team) continue;
            const r = team.record || { w: 0, l: 0, t: 0 };
            let line = '• ' + p.name + ' — ' + r.w + '-' + r.l + (r.t ? '-' + r.t : '');
            if (p.isMe) line += ' (your commissioner)';
            else if ((p.leagueCount || 0) >= 2) line += ' (also in ' + p.leagueCount + ' of the commissioner’s leagues)';
            rivalLines.push(line);
        }
        sections.push({
            title: 'Your Rivals',
            body: rivalLines.length ? rivalLines.join('\n') : 'No other members on record yet — the league sheet is thin on our side.',
        });

        // First 90 Days — a checklist of the things new owners actually forget.
        const s = league.settings || {};
        const first90 = ['• Set your lineup every week — auto-start is not a strategy.'];
        const wd = Number(s.waiver_day_of_week);
        if (s.waiver_day_of_week != null && wd >= 0 && wd <= 6) {
            first90.push('• Waivers process on ' + WAIVER_DAYS[wd] + ' — get claims in the night before.');
        }
        const deadline = Number(s.trade_deadline);
        // Sleeper uses an out-of-season sentinel (99) for "no deadline".
        if (deadline >= 1 && deadline <= 18) {
            first90.push('• Trade deadline is week ' + deadline + ' — plan your moves before it, not during it.');
        }
        first90.push('• Read the house rules below before your first trade or waiver fight.');
        sections.push({ title: 'First 90 Days', body: first90.join('\n') });

        // House Rules — the digest verbatim when one exists; otherwise say so.
        sections.push({
            title: 'House Rules',
            body: (typeof constitutionDigest === 'string' && constitutionDigest.trim())
                ? constitutionDigest
                : 'No constitution on file for this league. Until one is written, rulings come from the commissioner — ask before assuming.',
        });

        // leagueName/recruitName travel with the folder: the People panel
        // renders one folder per open seat and had no way to say which
        // league (or which candidate) a given folder was for.
        return { sections, leagueName, recruitName: recruitName || null };
    }

    const api = { candidatesForSeat, buildProspectus, buildDayOneFolder };
    App.Commish = App.Commish || {};
    App.Commish.Bench = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
