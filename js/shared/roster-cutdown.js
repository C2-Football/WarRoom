// ══════════════════════════════════════════════════════════════════
// js/shared/roster-cutdown.js — window.App.RosterCutdown
// Roster Cutdown Day: the date a league shrinks its roster limits (e.g. an
// NFL-cutdown-style rule — "42 active / 10 taxi starting Week 1") and every
// owner needs to trim down to fit. Settable from either Commissioner Office
// (framed as the league rule) or GM's Office / Strategy Editor (framed as a
// personal note) — both write the SAME per-league local record. This app has
// no cross-owner sync (see commish-bylaws.js's identical local-only model),
// so "league rule" here means the same tier of persistence as a Bylaws
// amendment: recorded on whichever device set it, not broadcast to the league.
//
//   getRule(leagueId) → { activeSlots, taxiSlots, effectiveDate ('YYYY-MM-DD'),
//     setBy ('commissioner'|'owner'), updatedAt } | null
//   setRule(leagueId, { activeSlots, taxiSlots, effectiveDate }, setBy)
//     → validates, persists, dispatches 'wr:cutdown-rule-changed' on window,
//       returns the stored record (or null if activeSlots/effectiveDate missing).
//   clearRule(leagueId) → removes the record, dispatches the same event.
//   status(rule, nowMs) → { daysUntil, isPast, isNear } | null.
//     isNear = within NEAR_DAYS of the date or already past it — the window
//     where My Roster should start surfacing cutdown alerts.
//   overage(rule, rosterCount) → how many rostered players (active + taxi +
//     bench, non-IR) exceed activeSlots + taxiSlots. 0 (never negative) when
//     under the cap or no rule is set.
//
// Pure compute split from storage; status/overage take nowMs/rosterCount as
// args (no Date.now() on pure paths). Warroom-local (direct <script> tag),
// Node-testable.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const KEY = lid => 'wr_roster_cutdown_' + lid;
    const NEAR_DAYS = 14;
    const DAY_MS = 86400000;

    // ── Storage ──────────────────────────────────────────────────────
    // Browser: the shared DhqStorage localStorage wrapper. Node tests: an
    // in-memory Map that JSON round-trips values (matches commish-bylaws.js).
    const _mem = new Map();
    const memStore = {
        get(key, fallback) { return _mem.has(key) ? JSON.parse(_mem.get(key)) : (fallback !== undefined ? fallback : null); },
        set(key, value) { _mem.set(key, JSON.stringify(value)); return true; },
    };
    function store() { return (App.DhqStorage) || memStore; }

    function getRule(leagueId) {
        const lid = String(leagueId || '');
        if (!lid) return null;
        return store().get(KEY(lid), null);
    }

    function setRule(leagueId, fields, setBy) {
        const lid = String(leagueId || '');
        if (!lid) return null;
        const effectiveDate = fields && fields.effectiveDate ? String(fields.effectiveDate) : '';
        const rawActive = Number(fields && fields.activeSlots) || 0;
        if (!rawActive || !effectiveDate) return null;
        const activeSlots = Math.max(1, Math.round(rawActive));
        const taxiSlots = Math.max(0, Math.round(Number(fields && fields.taxiSlots) || 0));
        const rec = {
            activeSlots, taxiSlots, effectiveDate,
            setBy: setBy === 'owner' ? 'owner' : 'commissioner',
            updatedAt: Date.now(),
        };
        store().set(KEY(lid), rec);
        try { root.dispatchEvent(new CustomEvent('wr:cutdown-rule-changed', { detail: { leagueId: lid, rule: rec } })); } catch (_e) { /* noop */ }
        return rec;
    }

    function clearRule(leagueId) {
        const lid = String(leagueId || '');
        if (!lid) return;
        store().set(KEY(lid), null);
        try { root.dispatchEvent(new CustomEvent('wr:cutdown-rule-changed', { detail: { leagueId: lid, rule: null } })); } catch (_e) { /* noop */ }
    }

    function status(rule, nowMs) {
        if (!rule || !rule.effectiveDate) return null;
        const now = nowMs != null ? nowMs : Date.now();
        const target = new Date(rule.effectiveDate + 'T00:00:00').getTime();
        if (Number.isNaN(target)) return null;
        const daysUntil = Math.ceil((target - now) / DAY_MS);
        return { daysUntil, isPast: daysUntil < 0, isNear: daysUntil <= NEAR_DAYS };
    }

    function overage(rule, rosterCount) {
        if (!rule) return 0;
        const cap = (rule.activeSlots || 0) + (rule.taxiSlots || 0);
        const n = Number(rosterCount) || 0;
        return Math.max(0, n - cap);
    }

    App.RosterCutdown = { getRule, setRule, clearRule, status, overage, NEAR_DAYS };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.RosterCutdown;
})(typeof window !== 'undefined' ? window : globalThis);
