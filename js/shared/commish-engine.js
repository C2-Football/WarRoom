// ══════════════════════════════════════════════════════════════════
// js/shared/commish-engine.js — window.App.Commish (foundation)
// The Commissioner's Office data layer: which leagues the user commissions,
// and the MEMBER GRAPH — every human across those leagues, joined on
// Sleeper's GLOBAL user_id. That join is the whole unlock: the multi-league
// commissioner's private network is discovered from data they already have,
// never configured.
//
//   discoverCommissioned({ leagues, myUserId })
//     → subset of leagues where my user carries is_owner (Sleeper marks
//       commissioners on /league/{id}/users)
//   hydrateCommissioned(leagues)
//     → Promise<same leagues, with .users and .rosters filled in-place via
//       the global Sleeper fetchers when missing (cached upstream)>
//   buildMemberGraph({ leagues, myUserId })
//     → { people: { [userId]: { userId, name, teamNames, teams:[{leagueId,
//          leagueName, rosterId, record:{w,l,t}, pf, isCommissioner}],
//          leagueIds:[], leagueCount, isMe } },
//         overlap: [{ userId, name, leagueCount }],   // 2+ leagues, desc
//         seats: [{ leagueId, leagueName, rosterId, reason }] }  // open seats
//
// Downstream engines (coefficient, radar, bench, calendar, programme, drift)
// consume this graph — they must treat it as read-only input and stay pure.
// Sleeper is READ-ONLY: everything here is intelligence, never execution.
// Warroom-local (direct <script> tag), Node-testable (pure parts).
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    function leagueId(l) { return String(l.league_id || l.id || ''); }
    function leagueName(l) { return l.name || ('League ' + leagueId(l)); }

    function userName(u) {
        return (u && (u.metadata && u.metadata.team_name)) || (u && u.display_name) || (u && u.username) || 'Unknown';
    }
    function displayName(u) {
        return (u && u.display_name) || (u && u.username) || 'Unknown';
    }

    // ── Discovery ────────────────────────────────────────────────────
    // A league is "commissioned" when MY user object on it carries is_owner.
    // Sleeper allows co-commissioners; is_owner is true for each of them.
    function discoverCommissioned(opts) {
        const leagues = (opts && opts.leagues) || [];
        const me = String(opts && opts.myUserId != null ? opts.myUserId : '');
        if (!me) return [];
        return leagues.filter(l => (l.users || []).some(u => String(u.user_id) === me && !!u.is_owner));
    }

    // ── Hydration (fetch helper — impure, browser-only) ──────────────
    // Fills users + rosters in-place for any league missing them. Sleeper
    // responses are small; the global fetchers are already TTL-cached by the
    // provider layer where it matters. Failures leave the league as-is.
    async function hydrateCommissioned(leagues) {
        const list = leagues || [];
        await Promise.all(list.map(async l => {
            const lid = leagueId(l);
            if (!lid || String(lid).startsWith('mfl_')) return; // Sleeper graph only, v1
            try {
                if (!Array.isArray(l.users) || !l.users.length) {
                    if (typeof root.fetchLeagueUsers === 'function') l.users = (await root.fetchLeagueUsers(lid)) || [];
                }
                if (!Array.isArray(l.rosters) || !l.rosters.length) {
                    if (typeof root.fetchRosters === 'function') l.rosters = (await root.fetchRosters(lid)) || [];
                }
                if (!l.settings && typeof root.fetchLeagueInfo === 'function') {
                    const info = await root.fetchLeagueInfo(lid);
                    if (info) {
                        l.settings = info.settings; l.scoring_settings = info.scoring_settings;
                        l.roster_positions = info.roster_positions; l.season = l.season || info.season;
                        l.name = l.name || info.name; l.status = l.status || info.status;
                    }
                }
            } catch (e) { if (root.wrLog) root.wrLog('commish.hydrate', e); }
        }));
        return list;
    }

    // ── The member graph (pure) ──────────────────────────────────────
    function buildMemberGraph(opts) {
        const leagues = (opts && opts.leagues) || [];
        const me = String(opts && opts.myUserId != null ? opts.myUserId : '');
        const people = {};
        const seats = [];

        for (const l of leagues) {
            const lid = leagueId(l);
            const lname = leagueName(l);
            const users = l.users || [];
            const byUid = {};
            users.forEach(u => { byUid[String(u.user_id)] = u; });

            for (const r of (l.rosters || [])) {
                const uid = r.owner_id != null ? String(r.owner_id) : null;
                const u = uid ? byUid[uid] : null;
                // Open seat: no owner, or owner no longer among league users
                // (left the league; Sleeper keeps the roster).
                if (!uid || !u) {
                    seats.push({ leagueId: lid, leagueName: lname, rosterId: r.roster_id, reason: !uid ? 'unowned' : 'owner_left' });
                    continue;
                }
                if (!people[uid]) {
                    people[uid] = {
                        userId: uid,
                        name: displayName(u),
                        teamNames: [],
                        teams: [],
                        leagueIds: [],
                        leagueCount: 0,
                        isMe: uid === me,
                    };
                }
                const st = r.settings || {};
                people[uid].teams.push({
                    leagueId: lid,
                    leagueName: lname,
                    rosterId: r.roster_id,
                    record: { w: Number(st.wins) || 0, l: Number(st.losses) || 0, t: Number(st.ties) || 0 },
                    pf: Math.round(((Number(st.fpts) || 0) + (Number(st.fpts_decimal) || 0) / 100) * 10) / 10,
                    isCommissioner: !!u.is_owner,
                });
                people[uid].teamNames.push(userName(u));
                if (!people[uid].leagueIds.includes(lid)) people[uid].leagueIds.push(lid);
            }
        }
        for (const uid of Object.keys(people)) people[uid].leagueCount = people[uid].leagueIds.length;

        const overlap = Object.values(people)
            .filter(p => p.leagueCount >= 2 && !p.isMe)
            .map(p => ({ userId: p.userId, name: p.name, leagueCount: p.leagueCount }))
            .sort((a, b) => b.leagueCount - a.leagueCount || a.name.localeCompare(b.name));

        return { people, overlap, seats };
    }

    App.Commish = App.Commish || {};
    Object.assign(App.Commish, { discoverCommissioned, hydrateCommissioned, buildMemberGraph });
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.Commish;
})(typeof window !== 'undefined' ? window : globalThis);
