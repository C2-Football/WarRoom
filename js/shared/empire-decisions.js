// ══════════════════════════════════════════════════════════════════
// js/shared/empire-decisions.js — window.App.EmpireDecisions
// Local-first decision journal for Empire Moves. Recommendations are
// ephemeral; this ledger preserves what the owner chose to investigate,
// propose, pass on, win or lose — plus the eventual realized DHQ delta.
// ══════════════════════════════════════════════════════════════════
/* global module */
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const KEY = 'empire_decisions_v1';
    const STATUSES = ['WATCHING', 'WORKING', 'PROPOSED', 'WON', 'LOST', 'PASSED'];
    const TERMINAL = new Set(['WON', 'LOST', 'PASSED']);
    const _mem = new Map();

    function store() { return App.DhqStorage || null; }
    function read() {
        const st = store();
        try {
            const raw = st ? st.get(KEY, []) : (_mem.has(KEY) ? JSON.parse(_mem.get(KEY)) : []);
            return Array.isArray(raw) ? raw : [];
        } catch (e) { return []; }
    }
    function write(rows) {
        const out = Array.isArray(rows) ? rows : [];
        const st = store();
        try { if (st) st.set(KEY, out); else _mem.set(KEY, JSON.stringify(out)); } catch (e) { /* best effort */ }
        return out;
    }
    function hash(s) {
        let h = 2166136261;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
        return (h >>> 0).toString(36);
    }
    function keyOf(move) {
        const m = move || {};
        return [m.type || '', m.leagueId || '', m.pid || '', m.ownerName || '', m.title || ''].map(String).join('|');
    }
    function cleanStatus(status) {
        const s = String(status || '').toUpperCase();
        return STATUSES.includes(s) ? s : 'WATCHING';
    }
    function cleanPatch(patch) {
        const p = patch || {}, out = {};
        if (p.status != null) out.status = cleanStatus(p.status);
        if (p.note != null) out.note = String(p.note).slice(0, 4000);
        if (p.reviewAt != null) out.reviewAt = String(p.reviewAt).slice(0, 32);
        if (p.actualDelta !== undefined) {
            if (p.actualDelta === null || p.actualDelta === '') out.actualDelta = null;
            else {
                const n = Number(p.actualDelta);
                out.actualDelta = Number.isFinite(n) ? Math.round(n) : null;
            }
        }
        return out;
    }
    function list() { return read().slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); }
    function byMove(move) {
        const k = keyOf(move);
        return read().find(r => r.moveKey === k) || null;
    }
    function track(move, opts) {
        if (!move || !move.title) return null;
        const now = (opts && opts.nowMs) || Date.now();
        const rows = read(), moveKey = keyOf(move);
        const found = rows.find(r => r.moveKey === moveKey);
        if (found) return found;
        const rec = {
            id: 'ed_' + hash(moveKey), moveKey,
            title: String(move.title), type: move.type || '',
            leagueId: String(move.leagueId || ''), leagueName: String(move.leagueName || 'League'),
            ownerName: String(move.ownerName || ''), pid: String(move.pid || ''),
            why: String(move.why || ''), accept: Number(move.accept) || 0,
            estimatedDelta: Math.round(Number(move.value) || 0), actualDelta: null,
            status: 'WATCHING', note: '', reviewAt: '', createdAt: now, updatedAt: now,
        };
        rows.push(rec); write(rows); return rec;
    }
    function update(id, patch, opts) {
        const rows = read(), idx = rows.findIndex(r => r.id === String(id));
        if (idx < 0) return null;
        const now = (opts && opts.nowMs) || Date.now();
        rows[idx] = { ...rows[idx], ...cleanPatch(patch), updatedAt: now };
        write(rows); return rows[idx];
    }
    function remove(id) {
        const rows = read(), next = rows.filter(r => r.id !== String(id));
        if (next.length === rows.length) return false;
        write(next); return true;
    }
    function summary(rows) {
        const listRows = Array.isArray(rows) ? rows : list();
        return listRows.reduce((s, r) => {
            s.total++;
            if (TERMINAL.has(r.status)) s.closed++; else s.active++;
            if (r.status === 'WON') s.won++;
            if (r.status === 'LOST') s.lost++;
            if (Number.isFinite(r.actualDelta)) s.realizedDelta += r.actualDelta;
            return s;
        }, { total: 0, active: 0, closed: 0, won: 0, lost: 0, realizedDelta: 0 });
    }

    const api = { STATUSES, TERMINAL, keyOf, list, byMove, track, update, remove, summary, _mem, _reset: () => write([]) };
    App.EmpireDecisions = App.EmpireDecisions || api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
