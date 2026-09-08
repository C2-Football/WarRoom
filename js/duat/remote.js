// Account-authenticated Duat transport. Campaign state is computed on the server.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    async function request(body) {
        const auth = App.OD || root.OD;
        const client = auth?.getClient?.();
        const token = auth?.getSessionToken?.();
        const actor = auth?.getCurrentUserId?.();
        if (!client || !token || !actor) return { ok: false, error: 'Sign in to play The Duat with friends.' };
        try {
            const { data, error } = await client.functions.invoke('duat', { body, headers: { Authorization: 'Bearer ' + token } });
            if (auth.getCurrentUserId() !== actor) return { ok: false, error: 'Your account changed. Reopen the campaign.' };
            if (error) {
                const detail = await error.context?.json?.().catch(() => null);
                return { ok: false, conflict: detail?.conflict === true, revision: detail?.revision, error: detail?.error || 'Could not reach the campaign. Check your connection and retry.' };
            }
            return data || { ok: false, error: 'The campaign server returned no response.' };
        } catch {
            return { ok: false, error: 'Could not reach the campaign. Check your connection and retry.' };
        }
    }
    App.DuatRemote = { request };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.DuatRemote;
})(typeof window !== 'undefined' ? window : globalThis);
