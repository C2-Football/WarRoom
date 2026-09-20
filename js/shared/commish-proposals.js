(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const KEY = 'commish_rulelab_proposals', BACKUP = KEY + '_recovery_v1';
    const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
    function valid(list) {
        return Array.isArray(list) && new Set(list.map(row => row?.id)).size === list.length && list.every(row =>
            object(row) && typeof row.id === 'string' && row.id && typeof row.name === 'string'
            && (row.overrides == null || (object(row.overrides) && Object.values(row.overrides).every(Number.isFinite)))
            && (row.rosterProposal == null || (object(row.rosterProposal) && Array.isArray(row.rosterProposal.rosterPositions)
                && row.rosterProposal.rosterPositions.every(slot => typeof slot === 'string'))));
    }
    function read() {
        let raw = null, key = null;
        try {
            const store = App.AccountStorage;
            if (!store?.get) throw new Error('Account storage is unavailable.');
            let list;
            if (store.key && root.localStorage) {
                key = store.key(KEY);
                if (!key) throw new Error('Sign in again to reopen your proposals.');
                raw = root.localStorage.getItem(key);
                list = raw === null ? [] : JSON.parse(raw);
            } else {
                list = store.get(KEY, []);
                raw = JSON.stringify(list);
            }
            if (!valid(list)) throw new Error('Saved proposal data has an unexpected format.');
            return { list, raw, key, error: null };
        } catch (_) {
            return { list: [], raw, key, error: 'Your saved proposals could not be read. Recovery will preserve a copy before starting a new list.', canRecover: typeof raw === 'string' };
        }
    }
    function assertUnchanged(before) {
        const after = read();
        if (before.key !== after.key || before.raw !== after.raw) throw new Error('Your account or saved proposals changed. Reload the list before trying again.');
    }
    function update(change) {
        const before = read();
        if (before.error) throw new Error(before.error);
        const next = change(before.list);
        if (!valid(next)) throw new Error('This proposal could not be saved. Check its rules and try again.');
        assertUnchanged(before);
        if (App.AccountStorage?.set?.(KEY, next) !== true) throw new Error('Your rule proposal was not saved. Your inputs remain; free browser storage and retry.');
        return true;
    }
    function recover() {
        const before = read();
        if (!before.error || !before.canRecover) throw new Error('Reload the saved proposals before starting recovery.');
        let previous;
        try {
            const key = App.AccountStorage.key?.(BACKUP);
            previous = key && root.localStorage ? JSON.parse(root.localStorage.getItem(key) || '[]') : App.AccountStorage.get(BACKUP, []);
        } catch (_) { throw new Error('The earlier recovery copy could not be read. Download the original data before trying recovery elsewhere.'); }
        if (!Array.isArray(previous) || previous.some(row => !object(row) || typeof row.raw !== 'string')) throw new Error('The earlier recovery copy could not be read. Export the original data before trying recovery elsewhere.');
        const copies = previous.some(row => row.raw === before.raw) ? previous : [...previous, { savedAt: new Date().toISOString(), raw: before.raw }];
        assertUnchanged(before);
        if (App.AccountStorage.set(BACKUP, copies) !== true) throw new Error('The recovery copy was not saved. Your original proposals are unchanged. Free browser storage and retry.');
        assertUnchanged(before);
        if (App.AccountStorage.set(KEY, []) !== true) throw new Error('The recovery copy is saved, but the new list could not be confirmed. Reload to check before retrying.');
        return true;
    }
    function recoveryCopies() {
        try {
            const rows = App.AccountStorage?.get?.(BACKUP, []);
            return Array.isArray(rows) ? rows.filter(row => object(row) && typeof row.raw === 'string') : [];
        } catch (_) { return []; }
    }
    App.Commish = App.Commish || {};
    App.Commish.Proposals = { read, update, recover, recoveryCopies };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.Commish.Proposals;
})(typeof window !== 'undefined' ? window : globalThis);
