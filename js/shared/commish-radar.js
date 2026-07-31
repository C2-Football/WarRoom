// ══════════════════════════════════════════════════════════════════
// js/shared/commish-radar.js — App.Commish.Radar (the "Dave alarm")
// Person-level activity radar over the member graph: which humans have gone
// quiet, on which teams, and whether it reads as "life happened" (dark
// everywhere) or "bored with THIS league" (dark in one). The distinction is
// the whole point — the first gets a human check-in, the second gets a
// league-specific re-engagement nudge, and mixing them up burns goodwill.
//
//   buildRadar({ graph, txnsByLeague, rostersByLeague, playersData, week, nowMs })
//     → { people: [{ userId, name, isMe, leagueCount, status, checkin,
//          teams: [{ leagueId, leagueName, rosterId, inSeason, status,
//            signals: { daysSinceTxn, outStarters, byeStarters, emptySlots } }] }] }
//       people sorted worst-first (DARK_ALL, DARK_ONE, FADING, ACTIVE);
//       team status ∈ OK|WATCH|DARK; checkin = seeded copy draft (null when
//       ACTIVE or when the person is me — you don't message yourself).
//
//   fetchRadarInputs({ graph })
//     → Promise<{ txnsByLeague, rostersByLeague, playersData }> via the global
//       Sleeper fetchers / App.TxnStore (impure, browser-only; Sleeper leagues
//       only, and READ-ONLY — the radar observes, it never acts).
//
// Pure compute takes nowMs explicitly (no Date.now()) so the same inputs
// always classify the same way — tests and cached renders depend on it.
// Warroom-local (direct <script> tag), Node-testable (buildRadar is pure).
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    App.Commish = App.Commish || {};

    const DAY_MS = 24 * 60 * 60 * 1000;
    // Sleeper injury_status values that mean the player CANNOT play. A dead
    // player left in a starting slot is the loudest "nobody's home" signal a
    // roster can emit. Questionable/Doubtful are excluded on purpose — active
    // managers legitimately hold those to game time.
    const OUT_STATUSES = { OUT: 1, IR: 1, PUP: 1, SUS: 1, NA: 1, COV: 1 };
    const RANK = { DARK_ALL: 0, DARK_ONE: 1, FADING: 2, ACTIVE: 3 };

    // ── Transaction recency (pure) ───────────────────────────────────
    // A txn belongs to a roster when roster_ids names it OR any adds/drops
    // entry maps a player to it — waivers/free-agent moves often carry only
    // the adds/drops maps, so roster_ids alone under-attributes.
    function txnTouchesRoster(txn, rosterId) {
        const rid = String(rosterId);
        if (Array.isArray(txn.roster_ids) && txn.roster_ids.some(r => String(r) === rid)) return true;
        for (const k of ['adds', 'drops']) {
            const m = txn[k];
            if (m && typeof m === 'object') {
                for (const pid of Object.keys(m)) if (String(m[pid]) === rid) return true;
            }
        }
        return false;
    }

    // Days since the roster's latest transaction; null = never transacted.
    // Commissioner-type txns are excluded: the commish force-moving a player
    // on a dark team must not reset that MEMBER's activity clock — that's
    // exactly the poisoning this radar exists to see through. Failed waiver
    // claims (when present in the input) DO count: a losing FAAB bid is still
    // proof the human showed up.
    function daysSinceTxn(txns, rosterId, nowMs) {
        let latest = 0;
        for (const t of (txns || [])) {
            if (!t || t.type === 'commissioner') continue;
            const created = Number(t.created) || 0;
            if (created <= latest) continue;
            if (txnTouchesRoster(t, rosterId)) latest = created;
        }
        // No clock → recency is unknowable; report null (worst) rather than
        // inventing a favorable number. Callers pass Date.now() in the browser.
        if (!latest || !isFinite(nowMs) || nowMs <= 0) return null;
        return Math.max(0, Math.floor((nowMs - latest) / DAY_MS));
    }

    // ── Lineup symptoms (pure) ───────────────────────────────────────
    // Returns null when the roster has no starters data at all — that's a
    // "we can't see the lineup" state (offseason, pre-draft, missing fetch),
    // not a clean lineup, and status falls back to txn-only thresholds.
    function lineupSignals(roster, playersData, week) {
        const starters = roster && Array.isArray(roster.starters) ? roster.starters : null;
        if (!starters || !starters.length) return null;
        let outStarters = 0, byeStarters = 0, emptySlots = 0;
        for (const pid of starters) {
            // Sleeper marks an unfilled slot as the string '0'.
            if (!pid || pid === '0') { emptySlots++; continue; }
            const p = playersData && playersData[pid];
            if (!p) continue;
            if (OUT_STATUSES[String(p.injury_status || '').toUpperCase()]) outStarters++;
            if (Number(week) >= 1 && Number(p.bye_week) === Number(week)) byeStarters++;
        }
        return { outStarters, byeStarters, emptySlots };
    }

    // null (never transacted) exceeds every recency threshold by definition.
    function exceeds(days, threshold) { return days == null || days > threshold; }

    // ── Per-team status (pure) ───────────────────────────────────────
    // In-season, DARK requires BOTH silence and a visible lineup casualty —
    // a set-and-forget manager with a clean lineup tops out at WATCH, because
    // "quiet but fine" is not an emergency. Offseason (or no lineup data) the
    // lineup signals are neutral and only the txn clock speaks, with much
    // longer fuses — everyone goes quiet in May.
    function teamStatus(sig) {
        if (sig.inSeason) {
            if (exceeds(sig.daysSinceTxn, 21) && (sig.outStarters + sig.emptySlots) >= 1) return 'DARK';
            if (exceeds(sig.daysSinceTxn, 14) || sig.outStarters >= 1 || sig.byeStarters >= 2) return 'WATCH';
            return 'OK';
        }
        if (exceeds(sig.daysSinceTxn, 60)) return 'DARK';
        if (exceeds(sig.daysSinceTxn, 35)) return 'WATCH';
        return 'OK';
    }

    // ── Person classification (pure) ─────────────────────────────────
    // DARK_ALL needs 2+ teams all dark — one shared-league person going quiet
    // can't distinguish "life" from "boredom", so a single dark team is always
    // read as league-specific. A partially-dark multi-league person (2 of 3
    // dark) also lands DARK_ONE: they're demonstrably alive somewhere, so the
    // dark leagues are the problem, not the person.
    function classifyPerson(teams) {
        const dark = teams.filter(t => t.status === 'DARK').length;
        if (teams.length >= 2 && dark === teams.length) return 'DARK_ALL';
        if (dark >= 1) return 'DARK_ONE';
        if (teams.some(t => t.status === 'WATCH')) return 'FADING';
        return 'ACTIVE';
    }

    // ── Check-in copy (pure, seeded) ─────────────────────────────────
    // Seeded off userId (+ leagueId for league-specific drafts) so the same
    // person always gets the same wording across re-renders, but neighbours
    // in the list don't all open identically. Plain-template fallback keeps
    // Node tests and AlexVoice-less pages working.
    function pickCopy(seed, variants) {
        const AV = root.AlexVoice;
        if (AV && typeof AV.pick === 'function') return AV.pick(seed, variants);
        return variants[0];
    }

    function draftCheckin(person, cls, teams) {
        const first = String(person.name || 'there').split(/\s+/)[0];
        if (cls === 'DARK_ALL') {
            // Dark everywhere = life happened. Human check-in, zero fantasy
            // pressure — the leagues are not the point of this message.
            return pickCopy('commish-radar:' + person.userId + ':all', [
                'Hey ' + first + " — haven't seen you around in a while. Everything good on your end?",
                first + ", just checking in — you've gone quiet lately and I wanted to make sure you're doing alright. No league talk needed.",
                'Hey ' + first + ", noticed you've been off the grid. Hope all is well — give me a shout when you get a sec.",
            ]);
        }
        if (cls === 'DARK_ONE') {
            const darkTeam = teams.find(t => t.status === 'DARK');
            const lg = darkTeam ? darkTeam.leagueName : 'the league';
            return pickCopy('commish-radar:' + person.userId + ':' + (darkTeam ? darkTeam.leagueId : 'one'), [
                'Hey ' + first + ' — ' + lg + ' misses you. Anything I can tweak to make it worth your time again?',
                first + ', your ' + lg + " squad has been on autopilot for a bit. Want to talk trades, or is something about that league not working for you?",
                'Hey ' + first + " — be honest with me: has " + lg + ' gotten stale for you? Open to ideas if so.',
            ]);
        }
        if (cls === 'FADING') {
            const t = teams.find(x => x.status === 'WATCH');
            const lg = t ? t.leagueName : 'the league';
            return pickCopy('commish-radar:' + person.userId + ':fade', [
                'Hey ' + first + ' — quick lineup check in ' + lg + ' this week? A couple of spots look shaky.',
                first + ', heads up — worth a look at your ' + lg + ' lineup before lock.',
            ]);
        }
        return null;
    }

    // ── The radar (pure) ─────────────────────────────────────────────
    function buildRadar(opts) {
        const graph = (opts && opts.graph) || {};
        const txnsByLeague = (opts && opts.txnsByLeague) || {};
        const rostersByLeague = (opts && opts.rostersByLeague) || {};
        const playersData = (opts && opts.playersData) || {};
        const week = Number(opts && opts.week);
        const nowMs = Number(opts && opts.nowMs);

        const people = [];
        for (const uid of Object.keys(graph.people || {})) {
            const p = graph.people[uid];
            const teams = (p.teams || []).map(team => {
                const rosters = rostersByLeague[team.leagueId] || [];
                const roster = rosters.find(r => String(r.roster_id) === String(team.rosterId)) || null;
                const days = daysSinceTxn(txnsByLeague[team.leagueId], team.rosterId, nowMs);
                const lineup = lineupSignals(roster, playersData, week);
                const signals = {
                    daysSinceTxn: days,
                    outStarters: lineup ? lineup.outStarters : 0,
                    byeStarters: lineup ? lineup.byeStarters : 0,
                    emptySlots: lineup ? lineup.emptySlots : 0,
                };
                const inSeason = Number(week) >= 1 && !!lineup;
                return {
                    leagueId: team.leagueId,
                    leagueName: team.leagueName,
                    rosterId: team.rosterId,
                    inSeason,
                    signals,
                    status: teamStatus({
                        inSeason,
                        daysSinceTxn: signals.daysSinceTxn,
                        outStarters: signals.outStarters,
                        byeStarters: signals.byeStarters,
                        emptySlots: signals.emptySlots,
                    }),
                };
            });
            const cls = classifyPerson(teams);
            people.push({
                userId: p.userId,
                name: p.name,
                isMe: !!p.isMe,
                leagueCount: p.leagueCount,
                status: cls,
                teams,
                // No draft for myself — the commissioner is the sender.
                checkin: p.isMe ? null : draftCheckin(p, cls, teams),
            });
        }

        // Worst-first: class rank, then longest silence (never = worst;
        // sentinel instead of Infinity so the comparator never yields NaN),
        // then name for a stable, scannable list.
        const NEVER = 1e9;
        const worstDays = person => person.teams.reduce(
            (m, t) => Math.max(m, t.signals.daysSinceTxn == null ? NEVER : t.signals.daysSinceTxn), -1);
        people.sort((a, b) =>
            RANK[a.status] - RANK[b.status]
            || worstDays(b) - worstDays(a)
            || String(a.name).localeCompare(String(b.name)));

        return { people };
    }

    // ── Input hydration (fetch helper — impure, browser-only) ────────
    // One txn sweep + one rosters call per league, players map once. Failures
    // degrade to empty inputs — the radar then honestly reports "no txns seen"
    // rather than fabricating activity. Sleeper only, v1 (mfl_ skipped, same
    // guard as the foundation's hydrateCommissioned).
    async function fetchRadarInputs(opts) {
        const graph = (opts && opts.graph) || {};
        const lids = new Set();
        Object.values(graph.people || {}).forEach(p => (p.leagueIds || []).forEach(l => lids.add(String(l))));
        (graph.seats || []).forEach(s => lids.add(String(s.leagueId)));

        const txnsByLeague = {};
        const rostersByLeague = {};
        await Promise.all([...lids].map(async lid => {
            if (!lid || lid.startsWith('mfl_')) return;
            try {
                if (App.TxnStore && typeof App.TxnStore.fetchLeagueTxns === 'function') {
                    // Cached season sweep. Note: TxnStore drops failed waiver
                    // claims from its main array, so pure-TxnStore inputs are
                    // slightly conservative on the activity clock.
                    txnsByLeague[lid] = (await App.TxnStore.fetchLeagueTxns(lid)) || [];
                } else if (typeof root.fetchTransactions === 'function') {
                    const weeks = [];
                    for (let w = 0; w <= 18; w++) weeks.push(w);
                    const res = await Promise.all(weeks.map(w =>
                        Promise.resolve(root.fetchTransactions(lid, w)).catch(() => [])));
                    txnsByLeague[lid] = res.flat().filter(t => t && t.type);
                } else {
                    txnsByLeague[lid] = [];
                }
            } catch (e) { txnsByLeague[lid] = []; if (root.wrLog) root.wrLog('commish.radar.txns', e); }
            try {
                rostersByLeague[lid] = typeof root.fetchRosters === 'function'
                    ? ((await root.fetchRosters(lid)) || []) : [];
            } catch (e) { rostersByLeague[lid] = []; if (root.wrLog) root.wrLog('commish.radar.rosters', e); }
        }));

        let playersData = (root.S && root.S.players) || null;
        if (!playersData && typeof root.fetchAllPlayers === 'function') {
            try { playersData = (await root.fetchAllPlayers()) || {}; } catch (e) { playersData = {}; }
        }
        return { txnsByLeague, rostersByLeague, playersData: playersData || {} };
    }

    const api = {
        buildRadar,
        fetchRadarInputs,
        // Exposed pure internals — unit-testable seams, also handy for a UI
        // that wants a single team's status without a full graph pass.
        daysSinceTxn,
        lineupSignals,
        teamStatus,
        classifyPerson,
    };
    App.Commish.Radar = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
