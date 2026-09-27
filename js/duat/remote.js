// Account and scoped guest Duat transport. Campaign state is computed on the server.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    let rejectedSession = null;
    // Only server-approved, public scouting rows are reused. This in-memory
    // cache is scoped to the exact actor credential and room; it is never an
    // authority for picks, memberships or game state.
    const scoutingCache = new Map();
    let cacheActor = '';
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
        const actorScope = JSON.stringify([actor.kind, actor.userId, token]);
        if (cacheActor !== actorScope) { scoutingCache.clear(); cacheActor = actorScope; }
        const roomId = typeof body.roomId === 'string' ? body.roomId : '';
        const cached = roomId && scoutingCache.get(roomId);
        const requestBody = { ...body };
        delete requestBody.scoutingRevision;
        if (cached && ['load', 'action'].includes(body.op)) requestBody.scoutingRevision = cached.revision;
        try {
            const { data, error } = await client.functions.invoke('duat', { body: requestBody, headers: { Authorization: 'Bearer ' + token } });
            const latest = currentActor();
            if (latest?.userId !== actor.userId || latest?.kind !== actor.kind) return { ok: false, error: 'Your account changed. Reopen the campaign.' };
            if (latest?.token !== token) return { ok: false, error: 'Your session changed. Reopen the campaign.' };
            if (error) {
                if (error.context?.status === 401) {
                    rejectedSession = { token, userId: actor.userId };
                    return signInRequired();
                }
                const detail = await error.context?.json?.().catch(() => null);
                return { ok: false, conflict: detail?.conflict === true, networkError: !error.context?.status || error.context.status >= 500, revision: detail?.revision, error: detail?.error || 'Could not reach the campaign. Check your connection and retry.' };
            }
            const scouting = data?.room?.campaign?.draft?.scouting;
            if (data?.ok && roomId && data.room?.id === roomId && scouting) {
                if (scouting.unchanged === true) {
                    if (!cached || cached.revision !== scouting.revision || cached.armyId !== scouting.armyId || cached.seatId !== data.room.self?.factionId || Array.isArray(scouting.rows)) {
                        scoutingCache.delete(roomId);
                        return { ok: false, error: 'The scouting archive needs a fresh copy. Reconnect to refresh your room.' };
                    }
                    scouting.rows = cached.rows;
                    delete scouting.unchanged;
                } else if (/^[a-f0-9]{64}$/.test(scouting.revision || '') && Array.isArray(scouting.rows)) {
                    scoutingCache.delete(roomId);
                    scoutingCache.set(roomId, { revision: scouting.revision, armyId: scouting.armyId, seatId: data.room.self?.factionId, rows: scouting.rows });
                    while (scoutingCache.size > 4) scoutingCache.delete(scoutingCache.keys().next().value);
                }
            }
            return data || { ok: false, error: 'The campaign server returned no response.' };
        } catch {
            return { ok: false, networkError: true, error: 'Could not reach the campaign. Check your connection and retry.' };
        }
    }
    App.DuatRemote = { request, resetAuth() { rejectedSession = null; scoutingCache.clear(); cacheActor = ''; } };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.DuatRemote;
})(typeof window !== 'undefined' ? window : globalThis);
