// ══════════════════════════════════════════════════════════════════
// js/shared/commish-drift.js — window.App.Commish.Drift
// Drift Sentinel: catches SILENT league-settings changes. Sleeper never
// notifies members when a (co-)commissioner edits scoring, roster slots, or
// league settings — the only way to know is to remember what the league
// looked like last time and diff. That memory lives here, per league, in
// DhqStorage under 'commish_drift_<leagueId>'.
//
//   checkLeague(league, { nowMs })
//     → first visit: stores baseline, { firstRun: true, changes: [] }
//     → later:       { firstRun: false, changes: [pending...], baselineTs }
//       changes: [{ path, from, to, detectedAt }] — path is a dot-path leaf
//       ('scoring.rec', 'settings.trade_deadline', 'positions'); `from` is
//       null for an added leaf, `to` is null for a removed one.
//   acknowledge(leagueId, { nowMs })
//     → folds pending into the baseline (next check is quiet until something
//       ELSE moves), appends the group to history (cap 50), stamps ackTs.
//       Returns the archived { ackTs, changes } group, or null if nothing
//       was pending.
//   history(leagueId) → past acknowledged groups, newest first.
//   flattenLeague(league) → the snapshot leaf map (exposed for tests/UI).
//
// Pending survives across checks until acknowledged. Dedupe is by path:
// a further edit of the same key keeps the ORIGINAL `from` (the last
// acknowledged baseline value — that's the delta the commissioner's members
// actually experienced) while `to`/detectedAt track the latest edit. A leaf
// edited back to its baseline value before ack simply drops out — nothing
// net changed, so there is nothing to report.
//
// Pure compute + storage; no fetches. No Date.now() on test paths — callers
// pass nowMs. Warroom-local (direct <script> tag), Node-testable.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const KEY = lid => 'commish_drift_' + lid;
    const HISTORY_CAP = 50;

    // Volatile counters Sleeper bumps on its own schedule — week legs and
    // report markers move every week without any human touching a setting.
    // Diffing them would page the commissioner about nothing.
    const IGNORE = { 'settings.leg': 1, 'settings.last_scored_leg': 1, 'settings.last_report': 1 };

    // ── Storage ──────────────────────────────────────────────────────
    // Browser: the shared DhqStorage localStorage wrapper (same seam as
    // txn-store.js). Node tests: an in-memory Map that JSON round-trips
    // values so it keeps localStorage's exact semantics — undefined leaves
    // dropped, and no object aliasing between get() calls.
    const _mem = new Map();
    const memStore = {
        get(key, fallback) { return _mem.has(key) ? JSON.parse(_mem.get(key)) : (fallback !== undefined ? fallback : null); },
        set(key, value) { _mem.set(key, JSON.stringify(value)); return true; },
    };
    function store() { return (App.DhqStorage) || memStore; }

    // ── Snapshot ─────────────────────────────────────────────────────
    // Flatten the three commissioner-editable surfaces into dot-path leaves.
    // roster_positions joins to a single 'positions' leaf (a slot edit reads
    // as one change); any other array collapses to one JSON leaf for the same
    // reason — a reorder should never explode into index-level diffs.
    function flattenInto(out, prefix, val) {
        if (val === undefined) return;
        if (val === null || typeof val !== 'object') { out[prefix] = val; return; }
        if (Array.isArray(val)) { out[prefix] = JSON.stringify(val); return; }
        for (const k of Object.keys(val)) flattenInto(out, prefix + '.' + k, val[k]);
    }
    function flattenLeague(league) {
        const out = {};
        flattenInto(out, 'settings', (league && league.settings) || {});
        flattenInto(out, 'scoring', (league && league.scoring_settings) || {});
        out.positions = ((league && league.roster_positions) || []).join(',');
        for (const p of Object.keys(IGNORE)) delete out[p];
        return out;
    }

    // Leaf-by-leaf diff over the union of paths. Absent sides become null —
    // undefined would be silently dropped by the JSON storage layer.
    function diff(baseSnap, curSnap, nowMs) {
        const changes = [];
        const paths = new Set(Object.keys(baseSnap).concat(Object.keys(curSnap)));
        for (const p of Array.from(paths).sort()) {
            const from = Object.prototype.hasOwnProperty.call(baseSnap, p) ? baseSnap[p] : null;
            const to = Object.prototype.hasOwnProperty.call(curSnap, p) ? curSnap[p] : null;
            if (from !== to) changes.push({ path: p, from, to, detectedAt: nowMs });
        }
        return changes;
    }

    // ── Sentinel ─────────────────────────────────────────────────────
    function checkLeague(league, opts) {
        const lid = String((league && (league.league_id || league.id)) || '');
        // Refuse to baseline an unhydrated league (no settings AND no scoring):
        // an empty baseline would flag the ENTIRE config as "changed" the first
        // time the league hydrates. Honest null beats fake drift.
        if (!lid || (!league.settings && !league.scoring_settings)) return null;
        const nowMs = (opts && opts.nowMs != null) ? Number(opts.nowMs) : Date.now();
        const st = store();
        const key = KEY(lid);
        const snap = flattenLeague(league);

        const rec = st.get(key, null);
        if (!rec || !rec.snapshot) {
            st.set(key, { ts: nowMs, snapshot: snap, pending: [], history: [] });
            return { firstRun: true, changes: [] };
        }

        // Merge this check's diff into what's already pending. The diff is
        // always against the acknowledged baseline, so a change stays visible
        // across visits until the commissioner explicitly acks it.
        const fresh = diff(rec.snapshot, snap, nowMs);
        const byPath = {};
        for (const c of fresh) byPath[c.path] = c;
        const next = [];
        for (const p of (rec.pending || [])) {
            const f = byPath[p.path];
            if (!f) continue; // edited back to baseline before ack → nothing net changed
            delete byPath[p.path];
            // Same drift seen again → keep the original entry (its detectedAt
            // is when the change was FIRST noticed). A further edit → latest
            // value wins, but the original `from` is preserved: that's the
            // baseline the league last agreed to.
            next.push(f.to === p.to ? p : { path: p.path, from: p.from, to: f.to, detectedAt: f.detectedAt });
        }
        for (const c of fresh) if (byPath[c.path]) next.push(c);

        rec.pending = next;
        st.set(key, rec);
        return { firstRun: false, changes: next.slice(), baselineTs: rec.ts };
    }

    function acknowledge(leagueId, opts) {
        const lid = String(leagueId || '');
        const st = store();
        const rec = st.get(KEY(lid), null);
        if (!rec) return null;
        const nowMs = (opts && opts.nowMs != null) ? Number(opts.nowMs) : Date.now();
        rec.ackTs = nowMs;
        let group = null;
        if (Array.isArray(rec.pending) && rec.pending.length) {
            // Fold: the baseline becomes what the league looks like NOW, so
            // the next check is quiet until something else moves.
            for (const p of rec.pending) {
                if (p.to === null) delete rec.snapshot[p.path];
                else rec.snapshot[p.path] = p.to;
            }
            group = { ackTs: nowMs, changes: rec.pending };
            rec.history = (rec.history || []).concat([group]).slice(-HISTORY_CAP);
            rec.pending = [];
            rec.ts = nowMs;
        }
        st.set(KEY(lid), rec);
        return group;
    }

    // Past acknowledged change groups, newest first (UI order).
    function history(leagueId) {
        const rec = store().get(KEY(String(leagueId || '')), null);
        return (rec && Array.isArray(rec.history)) ? rec.history.slice().reverse() : [];
    }

    App.Commish = App.Commish || {};
    App.Commish.Drift = { checkLeague, acknowledge, history, flattenLeague, _mem };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.Commish.Drift;
})(typeof window !== 'undefined' ? window : globalThis);
