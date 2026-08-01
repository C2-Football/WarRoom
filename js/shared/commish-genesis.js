// ══════════════════════════════════════════════════════════════════
// js/shared/commish-genesis.js — window.App.Commish.Genesis
// SEASON GENESIS — the August war room. Opening-Day readiness per league:
// the six weeks BEFORE the draft, scored. Every readiness item is either
// AUTO (recomputed from live league data on every call, never stored) or
// MANUAL (a commissioner's own checklist, persisted per league).
//
//   buildReadiness({ league, calendarEvents, driftResult, seats,
//                    constitutionOnFile, manual, nowMs })
//     → { leagueId, leagueName, pct,               // 0–100, round(done/total)
//         items: [{ id, label, kind:'auto'|'manual', done, detail }],
//         blockers: [labels of not-done items, worst first] }
//       AUTO items: draft_scheduled, settings_ratified, all_seats_filled,
//       deadline_set, rosters_present, constitution_on_file.
//       MANUAL items: dues_noted, rules_reratified, welcome_drafted.
//       `manual` param ({ [itemId]: done }) overrides storage — for tests.
//       Returns null when the league has no id (nothing honest to score).
//
//   toggleManual(leagueId, itemId, { nowMs })
//     → flips the item and persists it under 'commish_genesis_<leagueId>'
//       via App.DhqStorage (in-memory Map fallback in Node); returns
//       { id, done, ts }, or null for an unknown item / missing league id.
//
//   buildAll({ leagues, calendarEvents, driftByLeague, seats,
//              constitutionByLeague, nowMs })
//     → [readiness…] sorted LOWEST pct first — the league that needs you
//       leads. driftByLeague / constitutionByLeague are keyed by league id.
//
//   manualDefaults() → fresh copies of the manual checklist definitions.
//
// Inputs are other Commish bricks, treated read-only: calendarEvents from
// Calendar.buildCalendar, driftResult from Drift.checkLeague, seats from
// buildMemberGraph. constitutionOnFile is a flag the office computes (do
// league_docs exist) — this engine never fetches.
//
// MONEY: the dues_noted item is a literal note-to-self. DHQ never handles,
// tracks, or moves money — its detail says exactly that.
//
// Blocker order (worst first): rosters_present, all_seats_filled,
// draft_scheduled, settings_ratified, deadline_set, constitution_on_file,
// then the manual housekeeping. Structure before paperwork.
//
// Pure compute + the manual-checklist storage seam; no fetches. No
// Date.now() on test paths — callers pass nowMs. Copy is seeded through
// AlexVoice.pick with a plain first-variant fallback so Node tests are
// byte-stable. Warroom-local (direct <script> tag), Node-testable.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const KEY = lid => 'commish_genesis_' + lid;

    function leagueIdOf(l) { return String((l && (l.league_id || l.id)) || ''); }
    function leagueNameOf(l) { return (l && l.name) || ('League ' + leagueIdOf(l)); }

    // Deterministic seeded copy; plain first-variant fallback keeps Node
    // tests (no AlexVoice) byte-stable.
    function say(seed, variants) {
        if (root.AlexVoice && typeof root.AlexVoice.pick === 'function') {
            return root.AlexVoice.pick(seed, variants);
        }
        return variants[0] || '';
    }

    function fmtWhen(ts) {
        const d = new Date(ts);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return d.toDateString() + ' ' + hh + ':' + mm;
    }

    // ── Storage (manual checklist only) ──────────────────────────────
    // Browser: the shared DhqStorage localStorage wrapper (same seam as
    // commish-drift.js). Node tests: an in-memory Map that JSON round-trips
    // values so it keeps localStorage's exact semantics.
    const _mem = new Map();
    const memStore = {
        get(key, fallback) { return _mem.has(key) ? JSON.parse(_mem.get(key)) : (fallback !== undefined ? fallback : null); },
        set(key, value) { _mem.set(key, JSON.stringify(value)); return true; },
    };
    function store() { return (App.DhqStorage) || memStore; }

    // ── Manual checklist definitions ─────────────────────────────────
    // dues_noted NEVER touches money: DHQ holds no balances, sends no
    // payments, integrates no processor. It is a reminder that the
    // commissioner tracked dues in whatever outside system they use.
    const MANUAL_DEFS = [
        {
            id: 'dues_noted',
            label: 'Dues noted (tracked outside DHQ)',
            detail: 'A note-to-self only — DHQ never handles or tracks money. Mark this once dues are squared away in whatever you use outside DHQ.',
        },
        {
            id: 'rules_reratified',
            label: 'Constitution re-ratified for the season',
            detail: 'Mark once the league has re-agreed to this season’s rules.',
        },
        {
            id: 'welcome_drafted',
            label: 'Welcome broadcast drafted',
            detail: 'Mark once your season-opening message to the league is written.',
        },
    ];

    // Worst-first ranking for the blockers list: structural holes (no
    // rosters, open seats) outrank the draft, which outranks paperwork.
    const SEVERITY = [
        'rosters_present', 'all_seats_filled', 'draft_scheduled',
        'settings_ratified', 'deadline_set', 'constitution_on_file',
        'rules_reratified', 'dues_noted', 'welcome_drafted',
    ];

    function manualDefaults() {
        return MANUAL_DEFS.map(d => ({ id: d.id, label: d.label, detail: d.detail, done: false }));
    }

    // ── AUTO checks (computed, never stored) ─────────────────────────
    function checkDraftScheduled(lid, lname, calendarEvents, nowMs) {
        const evs = (calendarEvents || []).filter(e =>
            e && e.type === 'draft' && String(e.leagueId) === lid);
        const completed = evs.find(e => e.status === 'complete');
        if (completed) {
            return {
                done: true,
                detail: say('genesis:drafted:' + lid, [
                    'Already drafted — this league’s draft is in the books.',
                    'Draft complete. ' + lname + ' has already picked its teams.',
                ]),
            };
        }
        const future = evs.find(e => e.ts != null && e.status !== 'complete' && e.ts > nowMs);
        if (future) return { done: true, detail: 'Draft scheduled — ' + fmtWhen(future.ts) + '.' };
        if (evs.some(e => e.ts == null)) {
            return { done: false, detail: 'A draft exists but has no start time — set one in Sleeper.' };
        }
        if (evs.length) {
            return { done: false, detail: 'The scheduled draft time has passed without completing — reschedule it.' };
        }
        return { done: false, detail: 'No draft on the calendar for this league.' };
    }

    function checkSettingsRatified(driftResult) {
        if (driftResult == null) return { done: false, detail: 'not checked yet' };
        if (driftResult.firstRun) {
            return { done: true, detail: 'Baseline captured — settings are being watched from here.' };
        }
        const n = (driftResult.changes || []).length;
        if (!n) return { done: true, detail: 'Settings match the last ratified baseline.' };
        return {
            done: false,
            detail: n + ' unacknowledged settings change' + (n === 1 ? '' : 's') + ' pending review.',
        };
    }

    function checkSeats(lid, seats) {
        const open = (seats || []).filter(s => s && String(s.leagueId) === lid);
        if (!open.length) return { done: true, detail: 'Every seat has an owner.' };
        const bits = open.map(s => 'roster ' + s.rosterId + (s.reason === 'owner_left' ? ' (owner left)' : ' (unowned)'));
        return {
            done: false,
            detail: open.length + ' open seat' + (open.length === 1 ? '' : 's') + ': ' + bits.join(', ') + '.',
        };
    }

    function checkDeadline(league) {
        const dw = Number(league && league.settings && league.settings.trade_deadline);
        if (Number.isFinite(dw) && dw >= 1 && dw <= 18) {
            return { done: true, detail: 'Trade deadline set — Week ' + dw + '.' };
        }
        return { done: false, detail: 'No trade deadline set (on Sleeper, 0 means none).' };
    }

    function checkRosters(league) {
        const n = ((league && league.rosters) || []).length;
        if (n > 0) return { done: true, detail: n + ' roster' + (n === 1 ? '' : 's') + ' in place.' };
        return { done: false, detail: 'No rosters found — the league is empty or not yet hydrated.' };
    }

    function checkConstitution(constitutionOnFile) {
        if (constitutionOnFile) return { done: true, detail: 'Constitution document on file.' };
        return { done: false, detail: 'No constitution on file — upload one under Settings → league docs.' };
    }

    // ── Manual state (persisted; param override for tests) ───────────
    function manualDoneReader(lid, manualParam) {
        if (manualParam && typeof manualParam === 'object') {
            return id => {
                const v = manualParam[id];
                return !!(v && typeof v === 'object' ? v.done : v);
            };
        }
        const rec = store().get(KEY(lid), null);
        const m = (rec && rec.manual) || {};
        return id => !!(m[id] && m[id].done);
    }

    function toggleManual(leagueId, itemId, opts) {
        const lid = String(leagueId || '');
        if (!lid) return null;
        if (!MANUAL_DEFS.some(d => d.id === itemId)) return null;
        const nowMs = (opts && opts.nowMs != null) ? Number(opts.nowMs) : Date.now();
        const st = store();
        const rec = st.get(KEY(lid), null) || {};
        rec.manual = rec.manual || {};
        const cur = !!(rec.manual[itemId] && rec.manual[itemId].done);
        rec.manual[itemId] = { done: !cur, ts: nowMs };
        st.set(KEY(lid), rec);
        return { id: itemId, done: !cur, ts: nowMs };
    }

    // ── Readiness (one league) ───────────────────────────────────────
    function buildReadiness(opts) {
        const o = opts || {};
        const league = o.league || {};
        const lid = leagueIdOf(league);
        if (!lid) return null;
        const lname = leagueNameOf(league);
        const nowMs = (o.nowMs != null) ? Number(o.nowMs) : Date.now();

        const items = [];
        const auto = (id, label, res) => items.push({ id, label, kind: 'auto', done: res.done, detail: res.detail });

        auto('draft_scheduled', 'Draft scheduled', checkDraftScheduled(lid, lname, o.calendarEvents, nowMs));
        auto('settings_ratified', 'Settings ratified (no unacknowledged drift)', checkSettingsRatified(o.driftResult));
        auto('all_seats_filled', 'All seats filled', checkSeats(lid, o.seats));
        auto('deadline_set', 'Trade deadline set', checkDeadline(league));
        auto('rosters_present', 'Rosters present', checkRosters(league));
        auto('constitution_on_file', 'Constitution on file', checkConstitution(o.constitutionOnFile));

        const isDone = manualDoneReader(lid, o.manual);
        for (const d of MANUAL_DEFS) {
            items.push({ id: d.id, label: d.label, kind: 'manual', done: isDone(d.id), detail: d.detail });
        }

        const doneCount = items.filter(i => i.done).length;
        const pct = Math.round(100 * doneCount / items.length);

        const rank = id => { const i = SEVERITY.indexOf(id); return i < 0 ? SEVERITY.length : i; };
        const blockers = items
            .filter(i => !i.done)
            .sort((a, b) => rank(a.id) - rank(b.id))
            .map(i => i.label);

        return { leagueId: lid, leagueName: lname, pct, items, blockers };
    }

    // ── Readiness (every commissioned league) ────────────────────────
    // Lowest pct leads — the league that needs its commissioner most.
    function buildAll(opts) {
        const o = opts || {};
        const driftBy = o.driftByLeague || {};
        const constBy = o.constitutionByLeague || {};
        const out = [];
        for (const l of (o.leagues || [])) {
            const lid = leagueIdOf(l);
            const r = buildReadiness({
                league: l,
                calendarEvents: o.calendarEvents,
                driftResult: Object.prototype.hasOwnProperty.call(driftBy, lid) ? driftBy[lid] : null,
                seats: o.seats,
                constitutionOnFile: !!constBy[lid],
                nowMs: o.nowMs,
            });
            if (r) out.push(r);
        }
        out.sort((a, b) => a.pct - b.pct || a.leagueName.localeCompare(b.leagueName));
        return out;
    }

    const api = { buildReadiness, buildAll, toggleManual, manualDefaults, _mem };
    App.Commish = App.Commish || {};
    App.Commish.Genesis = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
