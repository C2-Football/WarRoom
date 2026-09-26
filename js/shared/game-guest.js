// A guest pass is a capability for one invited game seat, never an app login.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const KEY = 'wr-game-guests-v1', EVENT = 'wr-game-guest-changed';
    const validGame = game => ['vault', 'duat'].includes(game);
    const validToken = token => typeof token === 'string' && /^dg1\.[0-9a-f]{64}$/.test(token);
    const empty = () => ({ version: 1, sessions: {}, active: {}, pending: {} });
    const withLock = callback => {
        // localStorage read/modify/write is not atomic across browser tabs.
        // Hold one origin-wide lock until the seat receipt is safely saved.
        if (!root.navigator?.locks?.request) return Promise.resolve({ ok: false, error: 'Guest access needs a current browser with secure storage. Update your browser or sign in with an account.' });
        return root.navigator.locks.request(KEY, callback);
    };
    function read() {
        try {
            const value = JSON.parse(root.localStorage.getItem(KEY) || 'null');
            return value?.version === 1 && value.sessions && value.active && value.pending ? value : empty();
        } catch { return empty(); }
    }
    function write(value) {
        const text = JSON.stringify(value);
        root.localStorage.setItem(KEY, text);
        if (root.localStorage.getItem(KEY) !== text) throw new Error('Guest access could not be saved in this browser. Enable browser storage or sign in.');
        root.dispatchEvent?.(new root.Event(EVENT));
    }
    const usable = (session, game) => session?.game === game && typeof session.userId === 'string' && typeof session.roomId === 'string' && typeof session.displayName === 'string'
        && validToken(session.token) && Number.isFinite(Date.parse(session.expiresAt)) && Date.parse(session.expiresAt) > Date.now();
    function getSessions(game) {
        if (!validGame(game)) return [];
        const sessions = read().sessions[game];
        return (Array.isArray(sessions) ? sessions : []).filter(session => usable(session, game)).map(session => ({ ...session }));
    }
    function getSession(game) {
        const active = read().active[game];
        return getSessions(game).find(session => session.roomId === active) || null;
    }
    function getActor(game) {
        const auth = App.OD || root.OD, userId = auth?.getCurrentUserId?.(), token = auth?.getSessionToken?.();
        if (userId && token) return { userId, token, kind: 'account' };
        const guest = getSession(game);
        return guest ? { ...guest, kind: 'guest' } : null;
    }
    function accountSnapshot() {
        const auth = App.OD || root.OD;
        return JSON.stringify([auth?.getCurrentUserId?.() || null, auth?.getSessionToken?.() || null]);
    }
    function freshToken() {
        if (!root.crypto?.getRandomValues) throw new Error('Guest access requires a secure browser connection.');
        return 'dg1.' + [...root.crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, '0')).join('');
    }
    async function invoke(game, body, token) {
        const db = (App.OD || root.OD)?.getClient?.();
        if (!db) return { ok: false, error: 'The game service is still loading. Try again.' };
        try {
            const operation = db.functions.invoke(game === 'vault' ? 'time-league' : 'duat', {
                body, ...(token ? { headers: { Authorization: 'Bearer ' + token } } : {}),
            });
            let timer;
            try {
                const { data, error } = await Promise.race([operation, new Promise((_, reject) => {
                    timer = root.setTimeout(() => reject(new Error('The request timed out. Retry to recover the same guest seat.')), 20000);
                })]);
                if (error) {
                    const detail = await error.context?.json?.().catch(() => null);
                    return { ok: false, error: detail?.error || 'Could not open guest access. Check the invitation and try again.' };
                }
                return data || { ok: false, error: 'No response from the game service. Please retry.' };
            } finally { if (timer) root.clearTimeout(timer); }
        } catch (error) { return { ok: false, error: error.message || 'Could not reach the game service. Please retry.' }; }
    }
    async function accept(game, request, token, snapshot, account) {
        const result = await invoke(game, request, request.op === 'guest-resume' ? token : null);
        if (!result.ok) return result;
        const guest = { ...result.guest, token };
        if (!usable(guest, game)) return { ok: false, error: 'The game service returned incomplete guest access. Retry to recover your seat.' };
        if (root.localStorage.getItem(KEY) !== snapshot || accountSnapshot() !== account) return { ok: false, error: 'Your session changed. Reopen the invitation to continue.' };
        const value = read();
        value.sessions[game] = [...(value.sessions[game] || []).filter(row => row.roomId !== guest.roomId), guest];
        value.active[game] = guest.roomId;
        if (request.op === 'guest-join' && value.pending[game]?.[request.code] === token) delete value.pending[game][request.code];
        write(value);
        return { ok: true, guest };
    }
    async function joinLocked(game, code, displayName) {
        if (!validGame(game) || typeof code !== 'string' || !code.trim() || code.length > 160) return { ok: false, error: 'Open the seat invitation from your host first.' };
        const name = String(displayName || '').trim();
        if (!name || name.length > 60) return { ok: false, error: 'Enter a player name of up to 60 characters.' };
        try {
            const value = read(), invite = code.trim();
            const pending = value.pending[game] && typeof value.pending[game] === 'object' ? value.pending[game] : {};
            const token = validToken(pending[invite]) ? pending[invite] : freshToken();
            // Save before claiming: a lost network response must not lose a seat.
            value.pending[game] = { ...pending, [invite]: token };
            write(value);
            return await accept(game, { op: 'guest-join', code: invite, displayName: name, guestToken: token }, token, root.localStorage.getItem(KEY), accountSnapshot());
        } catch { return { ok: false, error: 'Guest access could not be saved in this browser. Enable browser storage or sign in.' }; }
    }
    async function resumeLocked(game, pass) {
        const token = String(pass || '').trim();
        if (!validGame(game) || !validToken(token)) return { ok: false, error: 'Paste the complete guest pass saved from your game.' };
        try {
            const value = read();
            write(value);
            return await accept(game, { op: 'guest-resume' }, token, root.localStorage.getItem(KEY), accountSnapshot());
        } catch { return { ok: false, error: 'Guest access could not be saved in this browser. Enable browser storage or sign in.' }; }
    }
    function forgetLocked(game) {
        const value = read();
        value.sessions[game] = (value.sessions[game] || []).filter(row => row.roomId !== value.active[game]);
        delete value.active[game]; write(value);
    }
    function selectSessionLocked(game, roomId) {
        if (!getSessions(game).some(row => row.roomId === roomId)) return false;
        const value = read(); value.active[game] = roomId; write(value); return true;
    }
    function subscribe(callback) {
        const storage = event => { if (!event.key || [KEY, 'fw_session_v1', 'od_auth_v1'].includes(event.key)) callback(); };
        root.addEventListener?.(EVENT, callback); root.addEventListener?.('storage', storage); root.addEventListener?.('focus', callback);
        return () => { root.removeEventListener?.(EVENT, callback); root.removeEventListener?.('storage', storage); root.removeEventListener?.('focus', callback); };
    }
    App.GameGuest = { getSession, getSessions, getActor,
        join: (...args) => withLock(() => joinLocked(...args)), resume: (...args) => withLock(() => resumeLocked(...args)),
        guestPass: game => getSession(game)?.token || '', forget: game => withLock(() => forgetLocked(game)),
        selectSession: (...args) => withLock(() => selectSessionLocked(...args)), subscribe };
})(typeof window !== 'undefined' ? window : globalThis);
