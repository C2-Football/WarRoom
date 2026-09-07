// Account-authenticated Vault I/O. The server computes every shared game move.
(function () {
    'use strict';
    window.App = window.App || {};
    async function request(body) {
        const od = window.App.OD;
        const db = od?.getClient?.();
        const token = od?.getSessionToken?.();
        if (!db || !od?.getCurrentUserId?.() || !token) return { ok: false, error: 'Sign in to play with friends.' };
        try {
            const { data, error } = await db.functions.invoke('time-league', { body, headers: { Authorization: `Bearer ${token}` } });
            if (error) {
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
        if (!result.ok) throw new Error(result.error);
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
        if (!result.ok) throw new Error(result.error);
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
            catch (error) { if (!cancelled) onError(error); }
            finally { running = false; }
        };
        const timer = window.setInterval(refresh, 3000);
        window.addEventListener('focus', refresh);
        window.addEventListener('online', refresh);
        refresh();
        return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); };
    }
    window.App.TimeLeagueRemote = {
        createOnlineLeague, loadOnlineLeague, listMyOnlineLeagues, subscribeToLeague,
        claimInvite: (code) => request({ op: 'claim', code }),
        writeOnlineLeague: async (rowId, action, version) => {
            const result = await request({ op: 'action', rowId, action, version });
            if (!result.ok) return result;
            try { return { ...result, row: await loadOnlineLeague(rowId) }; }
            catch { return { ...result, refreshPending: true }; }
        },
        setReady: (rowId, ready) => request({ op: 'ready', rowId, ready }),
    };
})();
