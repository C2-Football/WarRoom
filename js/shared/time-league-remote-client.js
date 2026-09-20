// Account-authenticated Vault I/O. The server computes every shared game move.
(function () {
    'use strict';
    window.App = window.App || {};
    let rejectedSession = null;
    const signInRequired = () => ({ ok: false, authRequired: true, error: 'Sign in again to reconnect to your saved league.' });
    const requestError = result => Object.assign(new Error(result.error), { authRequired: result.authRequired === true });
    async function request(body) {
        const od = window.App.OD;
        const db = od?.getClient?.();
        const token = od?.getSessionToken?.();
        const requestUserId = od?.getCurrentUserId?.();
        if (!requestUserId || !token) return signInRequired();
        if (rejectedSession?.token === token && rejectedSession.userId === requestUserId) return signInRequired();
        if (!db) return { ok: false, error: 'The league service is still loading. Try again.' };
        try {
            const { data, error } = await db.functions.invoke('time-league', { body, headers: { Authorization: `Bearer ${token}` } });
            if (od?.getCurrentUserId?.() !== requestUserId) return { ok: false, error: 'Your account changed. Reopen the league to continue.' };
            if (od?.getSessionToken?.() !== token) return { ok: false, error: 'Your session changed. Reopen the league to continue.' };
            if (error) {
                if (error.context?.status === 401) {
                    // A rejected session cannot recover through polling. Cache
                    // only this exact credential; a fresh sign-in can try again.
                    if (od?.getSessionToken?.() === token) rejectedSession = { token, userId: requestUserId };
                    return signInRequired();
                }
                const details = await error.context?.json?.().catch(() => null);
                return { ok: false, conflict: details?.conflict === true, error: details?.error || details?.message || 'Could not reach your league. Check your connection and try again.' };
            }
            return data || { ok: false, error: 'No response from the league server.' };
        } catch {
            return { ok: false, error: 'Could not reach your league. Check your connection and try again.' };
        }
    }
    async function loadOnlineLeague(rowId) {
        const result = await request({ op: 'load', rowId });
        if (!result.ok) throw requestError(result);
        return result.row;
    }
    async function createOnlineLeague(input) {
        const result = await request({ op: 'create', input });
        if (!result.ok) return result;
        // The atomic create already succeeded; opening the room can be retried
        // from the league shelf even if this subsequent read is interrupted.
        return { ...result, members: [] };
    }
    async function listMyOnlineLeagues() {
        const result = await request({ op: 'list' });
        if (!result.ok) throw requestError(result);
        return (result.leagues || []).flatMap(row => {
            const league = row.time_leagues;
            return league ? [{ rowId: league.id, leagueId: league.league_id, name: league.name, phase: league.phase, currentWeek: league.current_week, teamCount: league.team_count, seatTeamId: row.seat_team_id, role: row.role }] : [];
        });
    }
    // Poll authenticated snapshots so reconnects and membership changes recover
    // automatically without relying on websocket configuration or event order.
    function subscribeToLeague(rowId, onChange, onError = () => {}) {
        let cancelled = false, running = false;
        const refresh = async () => {
            if (cancelled || running) return;
            running = true;
            try { const row = await loadOnlineLeague(rowId); if (!cancelled) onChange(row); }
            catch (error) { if (!cancelled) { if (error.authRequired) stop(); onError(error); } }
            finally { running = false; }
        };
        const timer = window.setInterval(refresh, 3000);
        window.addEventListener('focus', refresh);
        window.addEventListener('online', refresh);
        const stop = () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); };
        refresh();
        return stop;
    }
    window.App.TimeLeagueRemote = {
        createOnlineLeague, loadOnlineLeague, listMyOnlineLeagues, subscribeToLeague,
        claimInvite: (code) => request({ op: 'claim', code }),
        writeOnlineLeague: async (rowId, action, version) => {
            const result = await request({ op: 'action', rowId, action, version });
            if (!result.ok) return result;
            try { return { ...result, row: await loadOnlineLeague(rowId) }; }
            catch (error) { return { ...result, refreshPending: true, ...(error.authRequired ? { authRequired: true } : {}) }; }
        },
        getProfile: () => request({ op: 'profile-get' }),
        saveProfile: profile => request({ op: 'profile-save', profile }),
        listCommunity: ({ view = 'leaderboard', q = '', page = 0, limit = 20, lookingOnly = false } = {}) => request({ op: 'community-list', view, q, page, limit, lookingOnly }),
        listCommunityInvites: () => request({ op: 'community-invites' }),
        sendCommunityInvite: ({ rowId, seatTeamId, profileId }) => request({ op: 'community-invite', rowId, seatTeamId, profileId }),
        respondCommunityInvite: (inviteId, accept) => request({ op: 'community-respond', inviteId, accept }),
        setReady: (rowId, ready) => request({ op: 'ready', rowId, ready }),
    };
})();
