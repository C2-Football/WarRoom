// ══════════════════════════════════════════════════════════════════
// js/shared/commish-tasks.js — window.App.Commish.Tasks
// The commissioner's own board: hand-added tasks, milestones and events that
// no Sleeper field encodes — "collect dues by the 15th", "vote on playoff
// format", "welcome email to the new owner". Sits alongside the AUTO-derived
// Master Calendar (drafts, deadlines, playoffs from commish-calendar.js) as
// the one MANUAL layer, so the office can hold work no platform tracks.
//
//   TYPES = ['task', 'milestone', 'event']
//   add({ title, type, dueTs, leagueId, note }, opts) → the created item
//     → { id, title, type, dueTs|null, leagueId|null, note, done:false,
//         createdTs }
//       leagueId null = cross-league ("all leagues"); dueTs null = no date
//       yet (surfaces as unscheduled, same as a TBD draft). Blank title is
//       rejected (returns null) — nothing worth a checkbox with no label.
//   list() → every item, newest-added first
//   toggleDone(id, opts) → flips done, returns the item or null if unknown
//   remove(id) → true if something was removed
//   asEvents(items, opts) → [{ type, leagueId, leagueName, ts, week:null,
//     approximate:false, label, custom:true, id, done, past }], the same
//     shape Calendar.buildCalendar returns, so the Master Calendar can
//     render auto and manual rows in one table. opts: { leagueNameOf(id),
//     nowMs }.
//   mergeSorted(autoEvents, manualEvents) → both arrays combined and
//     resorted (ts asc, null-ts last — mirrors Calendar.buildCalendar's own
//     rule, since a task due mid-season must interleave with real dates).
//
// Storage via App.DhqStorage (localStorage-backed) under 'commish_tasks_v1',
// with an in-module Map fallback so this is Node-testable. One board across
// every commissioned league, not one per league — items opt into a single
// league via leagueId when they belong to one.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const KEY = 'commish_tasks_v1';
    const TYPES = ['task', 'milestone', 'event'];
    const CAP = 200; // a board, not a database

    // Browser: the shared DhqStorage localStorage wrapper (same seam as
    // commish-drift.js / commish-genesis.js). Node tests: an in-memory Map
    // that JSON round-trips values so it keeps localStorage's semantics.
    const _mem = new Map();
    const memStore = {
        get(key, fallback) { return _mem.has(key) ? JSON.parse(_mem.get(key)) : (fallback !== undefined ? fallback : null); },
        set(key, value) { _mem.set(key, JSON.stringify(value)); return true; },
    };
    function store() { return (App.DhqStorage) || memStore; }

    function read() {
        try {
            const raw = store().get(KEY, []);
            return Array.isArray(raw) ? raw : [];
        } catch (e) { return []; }
    }
    function write(list) {
        try { store().set(KEY, list); } catch (e) { /* board is best-effort; never break a render */ }
        return list;
    }

    let _seq = 0;
    function makeId(nowMs) { _seq += 1; return 'ctask_' + (nowMs || 0) + '_' + _seq; }

    function add(input, opts) {
        const title = String((input && input.title) || '').trim();
        if (!title) return null; // nothing worth a checkbox with no label
        const type = TYPES.includes(input && input.type) ? input.type : 'task';
        const dueTsNum = Number(input && input.dueTs);
        const dueTs = Number.isFinite(dueTsNum) ? dueTsNum : null;
        const leagueId = input && input.leagueId ? String(input.leagueId) : null;
        const note = String((input && input.note) || '').trim();
        const nowMs = (opts && opts.nowMs) || 0;
        const item = { id: makeId(nowMs), title, type, dueTs, leagueId, note, done: false, createdTs: nowMs };
        const list = read();
        list.unshift(item);
        write(list.length > CAP ? list.slice(0, CAP) : list);
        return item;
    }

    function list() { return read(); }

    function toggleDone(id, opts) {
        const nowMs = (opts && opts.nowMs) || 0;
        const items = read();
        const idx = items.findIndex(t => t.id === id);
        if (idx === -1) return null;
        const nextDone = !items[idx].done;
        items[idx] = { ...items[idx], done: nextDone, doneTs: nextDone ? nowMs : null };
        write(items);
        return items[idx];
    }

    function remove(id) {
        const items = read();
        const next = items.filter(t => t.id !== id);
        if (next.length === items.length) return false;
        write(next);
        return true;
    }

    // ── Calendar bridge (pure) ───────────────────────────────────────
    function asEvents(items, opts) {
        const o = opts || {};
        const nowMs = o.nowMs;
        const leagueNameOf = typeof o.leagueNameOf === 'function' ? o.leagueNameOf : () => null;
        return (items || []).map(it => ({
            type: it.type, leagueId: it.leagueId,
            leagueName: it.leagueId ? (leagueNameOf(it.leagueId) || ('League ' + it.leagueId)) : 'All leagues',
            ts: it.dueTs, week: null, approximate: false,
            label: it.title + (it.note ? ' — ' + it.note : ''),
            custom: true, id: it.id, done: !!it.done,
            past: Number.isFinite(nowMs) && it.dueTs != null && it.dueTs < nowMs,
        }));
    }

    // ts=null sinks last, same rule as Calendar.buildCalendar — a task
    // without a date is unscheduled, not "first" or "never".
    function mergeSorted(autoEvents, manualEvents) {
        const combined = [].concat(autoEvents || [], manualEvents || []);
        combined.sort((a, b) => {
            if (a.ts != null && b.ts != null) return a.ts - b.ts;
            if (a.ts != null) return -1;
            if (b.ts != null) return 1;
            return 0;
        });
        return combined;
    }

    const api = { TYPES, add, list, toggleDone, remove, asEvents, mergeSorted, _reset: () => write([]) };
    App.Commish = App.Commish || {};
    App.Commish.Tasks = App.Commish.Tasks || api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
