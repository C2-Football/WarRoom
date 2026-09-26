// Account and scoped guest Duat transport. Campaign state is computed on the server.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    let rejectedSession = null;
    const currentActor = () => App.GameGuest?.getActor?.('duat') || (() => {
        const auth = App.OD || root.OD, userId = auth?.getCurrentUserId?.(), token = auth?.getSessionToken?.();
        return userId && token ? { userId, token, kind: 'account' } : null;
    })();
    const signInRequired = () => ({ ok: false, authRequired: true, error: 'Reconnect to your account or restore your guest pass to continue this campaign.' });
    async function request(body) {
        const auth = App.OD || root.OD;
        const client = auth?.getClient?.();
        const actor = currentActor(), token = actor?.token;
        if (!token || !actor?.userId) return signInRequired();
        if (rejectedSession?.token === token && rejectedSession.userId === actor.userId) return signInRequired();
        if (!client) return { ok: false, error: 'The campaign service is still loading. Try again.' };
        try {
            const { data, error } = await client.functions.invoke('duat', { body, headers: { Authorization: 'Bearer ' + token } });
            const latest = currentActor();
            if (latest?.userId !== actor.userId || latest?.kind !== actor.kind) return { ok: false, error: 'Your account changed. Reopen the campaign.' };
            if (latest?.token !== token) return { ok: false, error: 'Your session changed. Reopen the campaign.' };
            if (error) {
                if (error.context?.status === 401) {
                    rejectedSession = { token, userId: actor.userId };
                    return signInRequired();
                }
                const detail = await error.context?.json?.().catch(() => null);
                return { ok: false, conflict: detail?.conflict === true, revision: detail?.revision, error: detail?.error || 'Could not reach the campaign. Check your connection and retry.' };
            }
            return data || { ok: false, error: 'The campaign server returned no response.' };
        } catch {
            return { ok: false, error: 'Could not reach the campaign. Check your connection and retry.' };
        }
    }
    App.DuatRemote = { request, resetAuth() { rejectedSession = null; } };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.DuatRemote;
})(typeof window !== 'undefined' ? window : globalThis);
