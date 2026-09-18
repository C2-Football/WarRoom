// Private planning records and volatile credentials follow the signed-in account.
// Local namespacing grants no server authority; server handlers verify sessions.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const AUTH_KEYS = ['fw_session_v1', 'od_session_v1'];
    const SECRET_KEYS = ['mfl_api_key', 'espn_s2', 'espn_swid', 'yahoo_session_id', 'dhq_personal_ai_v1',
        'dynastyhq_ai_key', 'dynastyhq_apikey', 'dynastyhq_xai_key', 'dynastyhq_gemini_key', 'dynastyhq_anthropic_key'];
    const CONTEXT_KEYS = ['od_auth_v1', 'od_profile_v1', 'od_display_name', 'od_locked_username_v2', 'dynastyhq_username', 'dynastyhq_league', 'mfl_league_id', 'mfl_year', 'mfl_franchise_id'];
    const CONTEXT_OWNER = 'wr_active_connection_owner_v1';
    const CREDENTIAL_OWNER = 'wr_credentials_owner_v1';
    const PENDING_TRANSITION = 'wr_account_pending_transition_v1';
    const safe = run => { try { return run(); } catch { return null; } };
    const read = key => safe(() => JSON.parse(root.localStorage.getItem(key)));
    function identityOf(session) {
        if (!session?.token) return null;
        let payload;
        try { payload = JSON.parse(root.atob(session.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { /* opaque app tokens use the saved account ID */ }
        if (payload?.exp && Date.now() >= payload.exp * 1000) return null;
        if (session.user?.id) return 'account:' + session.user.id;
        const username = payload?.app_metadata?.sleeper_username;
        if (typeof username === 'string' && username) return 'legacy:' + username.toLowerCase();
        // OAuth-only accounts still need isolated local planning data. This does
        // not give them an app-user identity or permission to play shared games.
        return typeof payload?.sub === 'string' && payload.sub ? 'oauth:' + payload.sub : null;
    }
    function identity() {
        const current = read('fw_session_v1');
        if (current) return identityOf(current);
        const legacy = read('od_session_v1');
        if (legacy) return identityOf(legacy);
        const od = App.OD || root.OD;
        return identityOf({ token: od?.getSessionToken?.(), user: { id: od?.getCurrentUserId?.() } });
    }
    function clearSecrets() {
        safe(() => root.DHQAI?.clear());
        for (const key of SECRET_KEYS) {
            safe(() => root.sessionStorage.removeItem(key));
            safe(() => root.localStorage.removeItem(key));
        }
        // Older connector versions embedded credentials in saved metadata.
        for (const storage of [root.localStorage, root.sessionStorage]) {
            const keys = safe(() => Array.from({ length: storage.length }, (_, i) => storage.key(i))) || [];
            for (const key of keys) {
                if (/^(?:dhq_ai_session|dhq_personal_ai)/.test(key || '')) safe(() => storage.removeItem(key));
                if (!/^(?:mfl|espn)_creds_/.test(key || '')) continue;
                try {
                    const value = JSON.parse(storage.getItem(key));
                    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid connector credentials');
                    for (const field of ['apiKey', 'espnS2', 'swid']) delete value[field];
                    const clean = JSON.stringify(value);
                    storage.setItem(key, clean);
                    if (storage.getItem(key) !== clean) throw new Error('Credentials could not be cleared');
                } catch { safe(() => storage.removeItem(key)); }
            }
        }
    }
    function archiveContext() {
        const context = {};
        for (const key of CONTEXT_KEYS) {
            const value = root.localStorage.getItem(key);
            if (value !== null) context[key] = value;
        }
        if (!Object.keys(context).length) return null;
        const markedOwner = root.localStorage.getItem(CONTEXT_OWNER);
        // Append a recovery snapshot. Unmarked older metadata has no trustworthy
        // owner, so it is never attributed to the account signing in next.
        const ownerPart = /^(?:account|legacy|oauth):.+/.test(markedOwner || '') ? encodeURIComponent(markedOwner) : 'unassigned';
        const prefix = 'wr_account_context_v1:' + ownerPart + ':';
        const lastStamp = Array.from({ length: root.localStorage.length }, (_, i) => root.localStorage.key(i))
            .filter(key => key?.startsWith(prefix)).reduce((latest, key) => Math.max(latest, Number(key.slice(prefix.length).split(':')[0]) || 0), 0);
        const nonce = Math.max(Date.now(), lastStamp + 1) + ':' + (root.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
        const key = prefix + nonce;
        const value = JSON.stringify(context);
        root.localStorage.setItem(key, value);
        if (root.localStorage.getItem(key) !== value) throw new Error('Your previous account data could not be backed up. Free browser storage and try again.');
        return key;
    }
    function previousContext(owner) {
        const prefix = 'wr_account_context_v1:' + encodeURIComponent(owner) + ':';
        const keys = Array.from({ length: root.localStorage.length }, (_, i) => root.localStorage.key(i))
            .filter(key => key?.startsWith(prefix)).sort().reverse();
        for (const key of keys) {
            const context = read(key);
            if (context && typeof context === 'object' && !Array.isArray(context)) return context;
        }
        return {};
    }
    function clearContext(includeProfile = true) {
        for (const key of [...AUTH_KEYS, ...(includeProfile ? [...CONTEXT_KEYS, CONTEXT_OWNER] : [])]) safe(() => root.localStorage.removeItem(key));
    }
    function prepareSignIn(nextSession, updates) {
        const before = identity(), after = identityOf(nextSession);
        const pending = root.localStorage.getItem(PENDING_TRANSITION);
        const changing = before !== after || Boolean(pending);
        if (!after) throw new Error('The sign-in response has no account identity. Please sign in again.');
        if (!Array.isArray(updates) || updates.some(row => !Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || (row[1] !== null && typeof row[1] !== 'string'))) throw new Error('The sign-in storage update is invalid.');
        const writes = new Map(updates);
        writes.set(CONTEXT_OWNER, after);
        // Archive before modifying any active key. An unsuccessful backup must
        // leave the previous account and its local work exactly where they were.
        let archive = null;
        if (changing) {
            archive = pending || archiveContext();
            if (archive && !pending) {
                root.localStorage.setItem(PENDING_TRANSITION, archive);
                if (root.localStorage.getItem(PENDING_TRANSITION) !== archive) throw new Error('Your previous account data could not be secured. Try again.');
            }
            const ownsPending = pending?.startsWith('wr_account_context_v1:' + encodeURIComponent(after) + ':');
            const restored = ownsPending ? read(pending) || previousContext(after) : previousContext(after);
            for (const key of CONTEXT_KEYS) if (!writes.has(key)) writes.set(key, typeof restored[key] === 'string' ? restored[key] : null);
            for (const key of AUTH_KEYS) if (!writes.has(key)) writes.set(key, null);
        }
        const previous = new Map([...writes.keys()].map(key => [key, root.localStorage.getItem(key)]));
        const changed = [];
        try {
            // All capacity-sensitive writes precede destructive removals.
            for (const [key, value] of writes) if (value !== null) {
                root.localStorage.setItem(key, value);
                changed.push(key);
                if (root.localStorage.getItem(key) !== value) throw new Error('The new session could not be saved.');
            }
            for (const [key, value] of writes) if (value === null) {
                root.localStorage.removeItem(key);
                changed.push(key);
            }
        } catch (error) {
            // The original state plus its backup already fit before this write.
            // Keep the backup until rollback is verified, including when the
            // browser stops accepting writes altogether partway through login.
            for (const key of changed) safe(() => root.localStorage.removeItem(key));
            for (const key of changed) if (previous.get(key) !== null) safe(() => root.localStorage.setItem(key, previous.get(key)));
            const restored = changed.every(key => safe(() => root.localStorage.getItem(key)) === previous.get(key));
            if (!pending && restored) {
                if (archive) safe(() => root.localStorage.removeItem(archive));
                safe(() => root.localStorage.removeItem(PENDING_TRANSITION));
            }
            throw error;
        }
        root.localStorage.removeItem(PENDING_TRANSITION);
        if (changing) clearSecrets();
        safe(() => root.sessionStorage.setItem(CREDENTIAL_OWNER, after));
        return after;
    }
    let blocked = false;
    const initialOwner = identity();
    const accountElement = () => root.document?.getElementById?.('root') || root.document?.getElementById?.('account-session-root');
    function hideAccount() {
        const element = accountElement();
        if (!element) return;
        safe(() => root.ReactDOM?.unmountComponentAtNode(element));
        element.replaceChildren();
        element.textContent = 'Your account changed. Opening a fresh session…';
    }
    function isCurrent() {
        if (blocked) return false;
        if (!watching || identity() === initialOwner) return true;
        blocked = true;
        clearSecrets();
        hideAccount();
        root.location.reload();
        return false;
    }
    async function signOut() {
        if (blocked) return;
        const od = App.OD || root.OD, client = safe(() => od?.getClient?.());
        let archived = false;
        try { archiveContext(); archived = true; } catch { /* Keep active profile pointers if backup storage is full. */ }
        blocked = true;
        hideAccount();
        clearSecrets();
        clearContext(archived);
        safe(() => root.sessionStorage.removeItem(CREDENTIAL_OWNER));
        // Remove only this project's OAuth persistence; preserve unrelated app
        // and offline game records. SDK sign-out also clears its in-memory user.
        const project = safe(() => new URL(App.SUPABASE_URL || od?.SUPABASE_URL || App.CONFIG?.supabaseUrl || od?.CONFIG?.supabaseUrl).hostname.split('.')[0]);
        if (project) for (const suffix of ['', '-code-verifier', '-user']) safe(() => root.localStorage.removeItem('sb-' + project + '-auth-token' + suffix));
        let timer;
        try {
            await Promise.race([
                Promise.resolve().then(() => client?.auth?.signOut({ scope: 'local' })).catch(() => {}),
                new Promise(resolve => { timer = root.setTimeout(resolve, 1500); }),
            ]);
        } finally {
            if (timer) root.clearTimeout(timer);
            root.location.href = 'landing.html';
        }
    }
    // A changed principal invalidates the entire mounted tree, including stale
    // async callbacks. Reads/writes also check synchronously before using a new
    // account, so they cannot race the browser's queued storage event.
    const watching = Boolean(accountElement() && root.addEventListener);
    if (watching) {
        const prior = safe(() => root.sessionStorage.getItem(CREDENTIAL_OWNER));
        if (prior && prior !== initialOwner) clearSecrets();
        safe(() => initialOwner ? root.sessionStorage.setItem(CREDENTIAL_OWNER, initialOwner) : root.sessionStorage.removeItem(CREDENTIAL_OWNER));
        root.addEventListener('storage', event => { if (event.key === null || AUTH_KEYS.includes(event.key)) isCurrent(); });
        root.addEventListener('focus', isCurrent);
        root.document.addEventListener('visibilitychange', () => { if (root.document.visibilityState === 'visible') isCurrent(); });
        const od = App.OD || root.OD;
        if (od) od.signOut = signOut;
    }
    const owner = () => isCurrent() ? identity() : null;
    const key = name => {
        const id = owner();
        return id ? 'wr_account_v1:' + encodeURIComponent(id) + ':' + name : null;
    };
    App.AccountStorage = {
        owner, key, prepareSignIn,
        get(name, fallback = null) {
            const scoped = key(name);
            return scoped ? App.DhqStorage?.get(scoped, fallback) ?? fallback : fallback;
        },
        set(name, value) {
            const scoped = key(name);
            if (!scoped || !App.DhqStorage?.set) return false;
            if (App.DhqStorage.set(scoped, value) === false) return false;
            return JSON.stringify(App.DhqStorage.get(scoped, null)) === JSON.stringify(value);
        },
    };
    App.AccountSession = { identity, identityOf, isCurrent, signOut };
})(typeof window !== 'undefined' ? window : globalThis);
