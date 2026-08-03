// ══════════════════════════════════════════════════════════════════
// js/shared/commish-prefs.js — window.App.Commish.Prefs
// The commissioner's own settings for the office: which leagues they want to
// manage here, which kinds of work they want surfaced, and what they've
// already dealt with on each individual item.
//
//   MANAGED LEAGUES  isManaged(lid) / setManaged(lid, bool) / managedFilter(leagues)
//     Opt-OUT, not opt-in: a newly discovered league is managed until the
//     commissioner says otherwise, so the office is never mysteriously empty.
//
//   ALERT PREFS      getAlerts() / setDomainAlert(domain, bool) / setFloor(tier)
//     Per-domain switches plus a severity floor. Turning a domain off silences
//     it in the queue and the desk badges — but NEVER in its own hub, because
//     hiding data from the screen built to show it is a lie, not a preference.
//
//   ITEM STATE       markDone / skip / hide / restore / stateOf / applyStates
//     done   — resolved. Stores a SIGNATURE of the item; if the underlying
//              number moves (2 unratified changes become 5) the signature
//              breaks and the item returns as new work. Marking something done
//              must not blind you to it getting worse.
//     skipped— snoozed until a timestamp (default 7 days).
//     hidden — dismissed indefinitely; only Settings brings it back.
//
// Storage via App.DhqStorage (localStorage-backed) with an in-module Map
// fallback so this is Node-testable. Pure decision logic is separated from
// storage so the filter can be unit-tested without a browser.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const KEY = 'commish_prefs_v1';
    const DAY_MS = 86400000;
    const SKIP_DAYS = 7;
    const TIER_RANK = { NOW: 3, SOON: 2, BACKLOG: 1 };
    const DOMAINS = ['coefficient', 'people', 'operations', 'programmes', 'rulelab', 'genesis', 'bylaws'];

    const _mem = new Map();
    function store() { return (App && App.DhqStorage) || null; }
    function read() {
        const st = store();
        try {
            const raw = st ? st.get(KEY, null) : (_mem.has(KEY) ? JSON.parse(_mem.get(KEY)) : null);
            return raw && typeof raw === 'object' ? raw : {};
        } catch (e) { return {}; }
    }
    function write(obj) {
        const st = store();
        try {
            if (st) st.set(KEY, obj); else _mem.set(KEY, JSON.stringify(obj));
        } catch (e) { /* preferences are best-effort; never break a render */ }
        return obj;
    }

    function defaults() {
        return { unmanaged: {}, domainsOff: {}, floor: 'BACKLOG', items: {} };
    }
    function all() {
        const raw = read();
        const d = defaults();
        return {
            unmanaged: raw.unmanaged && typeof raw.unmanaged === 'object' ? raw.unmanaged : d.unmanaged,
            domainsOff: raw.domainsOff && typeof raw.domainsOff === 'object' ? raw.domainsOff : d.domainsOff,
            floor: TIER_RANK[raw.floor] ? raw.floor : d.floor,
            items: raw.items && typeof raw.items === 'object' ? raw.items : d.items,
        };
    }

    // ── Managed leagues ──────────────────────────────────────────────
    function isManaged(leagueId) { return !all().unmanaged[String(leagueId)]; }
    function setManaged(leagueId, managed) {
        const p = all();
        const k = String(leagueId);
        if (managed) delete p.unmanaged[k]; else p.unmanaged[k] = 1;
        write(p);
        return managed;
    }
    // Never return an empty list from a non-empty input: if every league has
    // been switched off, the office would look broken rather than configured.
    // The Settings view is responsible for saying "all leagues are hidden".
    function managedFilter(leagues) {
        const list = leagues || [];
        const kept = list.filter(l => isManaged(l.league_id || l.id));
        return kept.length ? kept : [];
    }

    // ── Alert preferences ────────────────────────────────────────────
    function getAlerts() {
        const p = all();
        const domains = {};
        DOMAINS.forEach(d => { domains[d] = !p.domainsOff[d]; });
        return { domains, floor: p.floor };
    }
    function setDomainAlert(domain, on) {
        const p = all();
        if (on) delete p.domainsOff[domain]; else p.domainsOff[domain] = 1;
        write(p);
        return on;
    }
    function setFloor(tier) {
        const p = all();
        p.floor = TIER_RANK[tier] ? tier : 'BACKLOG';
        write(p);
        return p.floor;
    }

    // ── Per-item state ───────────────────────────────────────────────
    // The signature is what makes "done" honest. It is derived from the parts
    // of an item that represent the SIZE of the problem, so a resolved item
    // that later gets worse comes back on its own.
    function signatureOf(item) {
        if (!item) return '';
        const m = item.metric || {};
        return [item.tier || '', m.value == null ? '' : String(m.value), m.unit || ''].join('|');
    }
    function stateOf(id) {
        const rec = all().items[String(id)];
        return rec && rec.state ? rec : null;
    }
    function _set(id, rec) {
        const p = all();
        if (rec) p.items[String(id)] = rec; else delete p.items[String(id)];
        write(p);
        return rec;
    }
    function markDone(item, opts) {
        const now = (opts && opts.nowMs) || 0;
        return _set(item && item.id, { state: 'done', sig: signatureOf(item), ts: now });
    }
    function skip(item, opts) {
        const now = (opts && opts.nowMs) || 0;
        const days = (opts && opts.days) || SKIP_DAYS;
        return _set(item && item.id, { state: 'skipped', sig: signatureOf(item), ts: now, until: now + days * DAY_MS });
    }
    function hide(item, opts) {
        const now = (opts && opts.nowMs) || 0;
        return _set(item && item.id, { state: 'hidden', sig: signatureOf(item), ts: now });
    }
    function restore(id) { return _set(id, null); }

    // ── The filter (pure — takes state in, returns the split) ────────
    // Returns BOTH halves. The command view renders `visible`, and Settings
    // renders `suppressed` so nothing the commissioner silenced is
    // unrecoverable — a dismissal you can't find again is a data loss bug.
    function applyStates(items, opts) {
        const o = opts || {};
        const states = o.states || {};
        const alerts = o.alerts || { domains: {}, floor: 'BACKLOG' };
        const managed = o.managedIds || null;   // null = every league
        const nowMs = o.nowMs || 0;
        const floorRank = TIER_RANK[alerts.floor] || 1;
        const visible = [], suppressed = [];

        (items || []).forEach(it => {
            const reasons = [];
            if (managed && (it.leagueIds || []).length && !(it.leagueIds || []).some(l => managed.has(String(l)))) {
                reasons.push('unmanaged');
            }
            if (alerts.domains && alerts.domains[it.domain] === false) reasons.push('domain-off');
            if ((TIER_RANK[it.tier] || 0) < floorRank) reasons.push('below-floor');

            const rec = states[String(it.id)];
            if (rec && rec.state) {
                // A stale signature means the underlying number moved — the
                // item is new work again, so the old resolution doesn't apply.
                const fresh = rec.sig === signatureOf(it);
                if (rec.state === 'hidden' && fresh) reasons.push('hidden');
                else if (rec.state === 'done' && fresh) reasons.push('done');
                else if (rec.state === 'skipped' && fresh && nowMs < (rec.until || 0)) reasons.push('skipped');
            }
            if (reasons.length) suppressed.push({ item: it, reasons, state: rec ? rec.state : null });
            else visible.push(it);
        });
        return { visible, suppressed };
    }

    // Recount tiers over whatever survived the filter, so the severity pills
    // and desk badges can never disagree with the rows on screen.
    function countTiers(items) {
        const c = { now: 0, soon: 0, backlog: 0 };
        (items || []).forEach(it => {
            if (it.tier === 'NOW') c.now++; else if (it.tier === 'SOON') c.soon++; else c.backlog++;
        });
        return c;
    }

    const api = {
        DOMAINS, SKIP_DAYS,
        isManaged, setManaged, managedFilter,
        getAlerts, setDomainAlert, setFloor,
        signatureOf, stateOf, markDone, skip, hide, restore,
        allItemStates: () => all().items,
        applyStates, countTiers,
        _mem, _all: all, _reset: () => write(defaults()),
    };
    App.Commish = App.Commish || {};
    App.Commish.Prefs = App.Commish.Prefs || api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
