// ══════════════════════════════════════════════════════════════════
// js/shared/commish-followups.js — window.App.Commish.Followups
// Local commissioner accountability ledger: editable message drafts, private
// notes, follow-up dates and an append-only action history. It never sends a
// message or writes to a fantasy platform; the UI only copies approved text.
// ══════════════════════════════════════════════════════════════════
/* global module */
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    App.Commish = App.Commish || {};
    const KEY = 'commish_followups_v1';
    const HISTORY_CAP = 100;
    const _mem = new Map();

    function store() { return App.DhqStorage || null; }
    function read() {
        const st = store();
        try {
            const raw = st ? st.get(KEY, {}) : (_mem.has(KEY) ? JSON.parse(_mem.get(KEY)) : {});
            return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        } catch (e) { return {}; }
    }
    function write(obj) {
        const out = obj && typeof obj === 'object' ? obj : {};
        const st = store();
        try { if (st) st.set(KEY, out); else _mem.set(KEY, JSON.stringify(out)); } catch (e) { /* best effort */ }
        return out;
    }
    function itemId(item) { return String(item && item.id || ''); }
    function defaultMessage(item) {
        if (!item) return '';
        const league = (item.leagueNames || [])[0] || 'the league';
        const action = item.action && item.action.label ? ' Next step: ' + item.action.label.toLowerCase() + '.' : '';
        return 'Commissioner follow-up for ' + league + ': ' + String(item.headline || '').trim() + action;
    }
    function base(item, now) {
        return {
            itemId: itemId(item), headline: String(item?.headline || ''),
            leagueIds: (item?.leagueIds || []).map(String), leagueNames: (item?.leagueNames || []).map(String),
            message: defaultMessage(item), note: '', dueAt: '', status: 'OPEN',
            createdAt: now, updatedAt: now, history: [],
        };
    }
    function cleanPatch(patch) {
        const p = patch || {}, out = {};
        if (p.message != null) out.message = String(p.message).slice(0, 6000);
        if (p.note != null) out.note = String(p.note).slice(0, 6000);
        if (p.dueAt != null) out.dueAt = String(p.dueAt).slice(0, 32);
        if (p.status != null) out.status = String(p.status).toUpperCase() === 'DONE' ? 'DONE' : 'OPEN';
        return out;
    }
    function get(id) { return read()[String(id)] || null; }
    function list() { return Object.values(read()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); }
    function save(item, patch, opts) {
        const id = itemId(item);
        if (!id) return null;
        const now = (opts && opts.nowMs) || Date.now();
        const all = read(), rec = all[id] || base(item, now);
        all[id] = { ...rec, ...cleanPatch(patch), headline: String(item.headline || rec.headline || ''), updatedAt: now };
        write(all); return all[id];
    }
    function record(item, type, detail, opts) {
        const id = itemId(item);
        if (!id) return null;
        const now = (opts && opts.nowMs) || Date.now();
        const all = read(), rec = all[id] || base(item, now);
        const event = { type: String(type || 'UPDATED').toUpperCase(), detail: String(detail || '').slice(0, 1000), ts: now };
        rec.history = (rec.history || []).concat([event]).slice(-HISTORY_CAP);
        if (event.type === 'DONE' || event.type === 'HIDDEN') rec.status = 'DONE';
        if (event.type === 'RESTORED' || event.type === 'SKIPPED' || event.type === 'OPENED') rec.status = 'OPEN';
        rec.updatedAt = now; all[id] = rec; write(all); return rec;
    }
    function remove(id) {
        const all = read(), key = String(id);
        if (!all[key]) return false;
        delete all[key]; write(all); return true;
    }
    function summary(rows) {
        const rs = Array.isArray(rows) ? rows : list();
        const today = new Date().toISOString().slice(0, 10);
        return rs.reduce((s, r) => {
            s.total++;
            if (r.status === 'DONE') s.done++; else s.open++;
            if (r.status !== 'DONE' && r.dueAt && r.dueAt <= today) s.due++;
            return s;
        }, { total:0, open:0, done:0, due:0 });
    }

    const api = { defaultMessage, get, list, save, record, remove, summary, _mem, _reset: () => write({}) };
    App.Commish.Followups = App.Commish.Followups || api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
