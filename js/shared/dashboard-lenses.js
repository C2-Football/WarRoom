/* global module, globalThis */
// Account-and-league scoped lenses. The old dashboard remains untouched so
// migration is recoverable; one localStorage write commits the whole document.
(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) { root.WR = root.WR || {}; root.WR.DashboardLensesStore = api; }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';
    const VERSION = 1;
    const MAX_LENSES = 12;
    const MAX_HISTORY = 10;
    const MAX_STORED_CHARS = 750000;
    const PREFIX = 'wr_dashboard_lenses_v1:';
    const ID = /^[a-zA-Z0-9_.:-]{1,100}$/;
    const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const clone = value => JSON.parse(JSON.stringify(value));
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const fail = message => { throw new Error(message); };
    const origins = new WeakMap();
    let sequence = 0;

    function newId() {
        const token = root.crypto?.randomUUID?.() || Date.now().toString(36) + '_' + (++sequence).toString(36) + '_' + Math.random().toString(36).slice(2, 12);
        return 'lens_' + token;
    }

    function storageKey(scope) {
        if (typeof scope !== 'string' || !scope || scope.length > 1300 || /[\x00-\x1f\x7f]/.test(scope)) fail('Open an account and league before saving lenses.');
        return PREFIX + scope;
    }

    function nameFor(value) {
        if (typeof value !== 'string' || !value.trim() || value.trim().length > 60 || /[\x00-\x1f\x7f]/.test(value)) fail('Give this lens a name of 60 characters or fewer.');
        return value.trim();
    }

    function layoutFor(layout, catalog) {
        const builder = root.WR?.DashboardBuilder;
        if (!builder?.validateLayout) fail('The lens builder is still loading. Refresh the page and try again.');
        return builder.validateLayout(layout, catalog);
    }

    function lensFor(value, catalog) {
        if (!plain(value) || Object.keys(value).some(key => !['id', 'name', 'layout', 'history'].includes(key)) || typeof value.id !== 'string' || !ID.test(value.id) || !Array.isArray(value.history) || value.history.length > MAX_HISTORY) fail('Saved lens data could not be read. Your saved lenses have not been changed.');
        return { id: value.id, name: nameFor(value.name), layout: layoutFor(value.layout, catalog), history: value.history.map(layout => layoutFor(layout, catalog)) };
    }

    function documentFor(value, catalog) {
        if (!plain(value) || Object.keys(value).some(key => !['version', 'revision', 'activeId', 'lenses', 'removed'].includes(key)) || value.version !== VERSION || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.lenses) || !value.lenses.length || value.lenses.length > MAX_LENSES || (value.removed !== null && !plain(value.removed))) fail('Saved lens data could not be read. Your saved lenses have not been changed.');
        const lenses = value.lenses.map(lens => lensFor(lens, catalog));
        const removed = value.removed === null ? null : lensFor(value.removed, catalog);
        const all = removed ? [...lenses, removed] : lenses;
        const lensIds = new Set();
        const owners = new Map();
        for (const lens of all) {
            if (lensIds.has(lens.id)) fail('Saved lenses contain duplicate identifiers. Your saved lenses have not been changed.');
            lensIds.add(lens.id);
            // Past and deleted sections keep their identity. An old reminder
            // must never silently become a reminder for a different lens.
            for (const layout of [lens.layout, ...lens.history]) {
                for (const section of layout) {
                    if (owners.has(section.id) && owners.get(section.id) !== lens.id) fail('Saved lenses contain duplicate section identifiers. Your saved lenses have not been changed.');
                    owners.set(section.id, lens.id);
                }
            }
        }
        if (!lenses.some(lens => lens.id === value.activeId)) fail('The selected lens could not be found. Your saved lenses have not been changed.');
        return { version: VERSION, revision: value.revision, activeId: value.activeId, lenses, removed };
    }

    function rawFor(scope) {
        const key = storageKey(scope);
        try { return root.localStorage?.getItem(key) ?? null; }
        catch (_) { fail('Your lenses could not be read on this device. Reload the page before making changes.'); }
    }

    function tracked(scope, value) {
        const result = clone(value);
        origins.set(result, scope);
        return result;
    }

    function read(scope, fallbackLayout = [], catalog) {
        const source = rawFor(scope);
        if (source !== null) {
            if (source.length > MAX_STORED_CHARS) fail('Saved lens data is too large to read. Your saved lenses have not been changed.');
            let value;
            try { value = JSON.parse(source); }
            catch (_) { fail('Saved lens data could not be read. Your saved lenses have not been changed.'); }
            return tracked(scope, documentFor(value, catalog));
        }
        const prior = root.WR?.DashboardBuilder?.readSaved(scope);
        const home = { id: 'lens_home', name: 'Home', layout: layoutFor(prior?.layout ?? fallbackLayout, catalog), history: (prior?.history || []).slice(-MAX_HISTORY).map(layout => layoutFor(layout, catalog)) };
        return tracked(scope, { version: VERSION, revision: 0, activeId: home.id, lenses: [home], removed: null });
    }

    function reservedIds(document, exceptId) {
        const ids = new Set();
        for (const lens of [...document.lenses, ...(document.removed ? [document.removed] : [])]) {
            if (lens.id === exceptId) continue;
            for (const layout of [lens.layout, ...lens.history]) for (const section of layout) ids.add(section.id);
        }
        return ids;
    }

    function identifiedLayout(document, lens, layout, catalog, fresh = false) {
        const valid = layoutFor(layout, catalog);
        const reserved = reservedIds(document, lens.id);
        const existing = new Set([lens.layout, ...lens.history].flatMap(items => items.map(item => item.id)));
        const prefix = lens.id.slice(0, 48) + '__';
        return valid.map(section => {
            let id = section.id;
            // Alex previews receive their final identity before the user can
            // draft a reminder. Re-preparing or saving that preview must keep
            // those IDs, while another lens's IDs are never adopted.
            const prepared = id.startsWith(prefix);
            if (fresh || (!existing.has(id) && !prepared) || reserved.has(id)) {
                const base = prefix + id.slice(0, 100 - prefix.length);
                id = base;
                let suffix = 1;
                while (reserved.has(id) || existing.has(id)) {
                    const tail = '_' + suffix++;
                    id = base.slice(0, 100 - tail.length) + tail;
                }
            }
            reserved.add(id);
            return { ...section, id };
        });
    }

    function prepareLayout(document, lensId, layout, catalog) {
        const current = documentFor(document, catalog);
        const lens = current.lenses.find(item => item.id === lensId);
        if (!lens) fail('That lens is no longer available. Reopen Alex before making changes.');
        return clone(identifiedLayout(current, lens, layout, catalog));
    }

    function uniqueLensId(document) {
        const used = new Set([...document.lenses.map(lens => lens.id), document.removed?.id]);
        let id = newId();
        while (used.has(id)) id = 'lens_' + Date.now().toString(36) + '_' + (++sequence).toString(36);
        return id;
    }

    function trimOldestHistory(document) {
        const lenses = [...document.lenses, ...(document.removed ? [document.removed] : [])];
        const longest = lenses.reduce((found, lens) => lens.history.length > (found?.history.length || 0) ? lens : found, null);
        if (!longest) return false;
        longest.history.shift();
        return true;
    }

    function write(scope, document) {
        const key = storageKey(scope);
        const next = clone(document);
        let value = JSON.stringify(next);
        while (value.length > MAX_STORED_CHARS && trimOldestHistory(next)) value = JSON.stringify(next);
        if (value.length > MAX_STORED_CHARS) fail('These lenses are too large to save. Reduce the number of sections or filter values. Your saved lenses have not been changed.');
        // localStorage writes are atomic. Never remove the previous document to
        // make room, and never claim a successful save without reading it back.
        try {
            if (!root.localStorage) throw new Error('storage');
            root.localStorage.setItem(key, value);
            if (root.localStorage.getItem(key) !== value) throw new Error('not retained');
        } catch (_) { fail('Your lenses could not be saved on this device. Free some browser storage and try again.'); }
        return tracked(scope, next);
    }

    function change(scope, expectedDocument, action, catalog) {
        if (origins.has(expectedDocument) && origins.get(expectedDocument) !== scope) fail('Your account or league changed. Reopen your lenses before saving.');
        const expected = documentFor(expectedDocument, catalog);
        const current = read(scope, expected.lenses[0].layout, catalog);
        if (!same(current, expected)) fail('Your lenses changed in another tab. Reload the page before saving.');
        if (!plain(action) || typeof action.type !== 'string') fail('Choose a lens action.');
        const next = clone(current);
        const lens = next.lenses.find(item => item.id === action.id);
        const requireLens = () => { if (!lens) fail('That lens is no longer available. Reload the page before making changes.'); return lens; };
        const requireSpace = () => { if (next.lenses.length >= MAX_LENSES) fail('You can keep up to 12 lenses. Remove a lens before adding another.'); };
        switch (action.type) {
        case 'create': {
            requireSpace();
            const added = { id: uniqueLensId(next), name: nameFor(action.name === undefined ? 'New lens' : action.name), layout: [], history: [] };
            added.layout = identifiedLayout(next, added, action.layout === undefined ? [] : action.layout, catalog, true);
            next.lenses.push(added); next.activeId = added.id;
            break;
        }
        case 'save': {
            requireLens();
            const layout = identifiedLayout(next, lens, action.layout, catalog);
            if (!same(layout, lens.layout)) {
                lens.history = [...lens.history, clone(lens.layout)].slice(-MAX_HISTORY);
                lens.layout = layout;
            }
            break;
        }
        case 'rename': requireLens().name = nameFor(action.name); break;
        case 'duplicate': {
            requireLens(); requireSpace();
            const names = new Set(next.lenses.map(item => item.name));
            let number = 1, name;
            do {
                const suffix = number === 1 ? ' copy' : ' copy ' + number;
                name = lens.name.slice(0, 60 - suffix.length) + suffix;
                number++;
            } while (names.has(name));
            const added = { id: uniqueLensId(next), name, layout: [], history: [] };
            added.layout = identifiedLayout(next, added, lens.layout, catalog, true);
            next.lenses.push(added); next.activeId = added.id;
            break;
        }
        case 'remove': {
            requireLens();
            if (next.lenses.length === 1) fail('Keep at least one lens. You can clear or rename it instead.');
            const index = next.lenses.findIndex(item => item.id === lens.id);
            next.removed = clone(lens);
            next.lenses.splice(index, 1);
            if (next.activeId === lens.id) next.activeId = next.lenses[Math.min(index, next.lenses.length - 1)].id;
            break;
        }
        case 'restore':
            if (!next.removed) fail('There is no removed lens to restore.');
            requireSpace(); next.lenses.push(next.removed); next.activeId = next.removed.id; next.removed = null;
            break;
        case 'select': next.activeId = requireLens().id; break;
        case 'undo':
            requireLens();
            if (lens.history.length) lens.layout = lens.history.pop();
            break;
        default: fail('Choose a supported lens action.');
        }
        if (same(current, next)) return tracked(scope, current);
        next.revision += 1;
        if (!Number.isSafeInteger(next.revision)) fail('Your lenses could not be saved. Reload the page and try again.');
        return write(scope, documentFor(next, catalog));
    }

    return { VERSION, MAX_LENSES, MAX_HISTORY, read, change, prepareLayout, newId, storageKey };
});
