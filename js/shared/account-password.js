// Settings credential changes never read password hashes or target a supplied ID.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const keys = ['fw_session_v1', 'od_session_v1'];
    const changed = () => new Error('Your account changed. Reopen account settings before retrying.');
    const read = key => { try { return JSON.parse(root.localStorage.getItem(key) || 'null'); } catch { return null; } };
    function credentials() {
        const app = read(keys[0]);
        if (app?.token && app.user?.id) return { kind: 'account', token: app.token };
        if (app?.token) return { kind: 'oauth', token: app.token };
        const legacy = read(keys[1]);
        if (legacy?.token) {
            try {
                const payload = JSON.parse(root.atob(legacy.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
                const username = payload?.app_metadata?.sleeper_username;
                if (typeof username === 'string' && username) return { kind: 'legacy', token: legacy.token, username };
            } catch { /* Invalid sessions must use sign-in recovery. */ }
        }
        return { kind: 'missing' };
    }
    async function request(endpoint, token, body, rotation) {
        const config = App.CONFIG || root.OD?.CONFIG || {};
        const base = config.supabaseUrl || App.SUPABASE_URL || root.OD?.SUPABASE_URL;
        const anon = config.supabaseAnon || App.SUPABASE_ANON || root.OD?.SUPABASE_ANON;
        if (!base || !anon) throw new Error('Account services are still loading. Please try again.');
        const controller = new root.AbortController();
        const timer = root.setTimeout(() => controller.abort(), 15000);
        const uncertain = 'The password change could not be confirmed. Try signing in with your new password before retrying.';
        try {
            const response = await root.fetch(base + '/functions/v1/' + endpoint, {
                method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: 'Bearer ' + token },
                body: JSON.stringify(body), signal: controller.signal,
            });
            const result = await response.json().catch(() => null);
            if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : rotation ? uncertain : 'Current password could not be verified. Please try again.');
            if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(rotation ? uncertain : 'Current password could not be verified. Please try again.');
            return result;
        } catch (error) {
            if (controller.signal.aborted || error?.name === 'TypeError') {
                throw new Error(rotation ? uncertain : 'Unable to verify your current password. Check your connection and try again.');
            }
            throw error;
        } finally { root.clearTimeout(timer); }
    }
    async function change(currentPassword, password) {
        const session = credentials();
        if (session.kind === 'oauth') throw new Error('This account signs in through a provider. Change your password in your Google or Apple account.');
        if (session.kind === 'missing') throw new Error('Sign in again before changing your password.');
        if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 1024
            || typeof password !== 'string' || password.length < 8 || password.length > 1024) throw new Error('Enter your current password and a new password between 8 and 1024 characters.');
        if (password === currentPassword) throw new Error('Choose a different new password.');
        if (session.kind === 'legacy' && password.length > 128) throw new Error('Legacy account passwords must be between 8 and 128 characters.');
        const before = keys.map(key => root.localStorage.getItem(key));
        const current = () => keys.every((key, index) => root.localStorage.getItem(key) === before[index]) && App.AccountSession?.isCurrent?.() !== false;
        if (!current()) throw changed();
        if (typeof App.AccountSession?.signOut !== 'function') throw new Error('Account recovery is still loading. Please try again.');
        if (session.kind === 'account') {
            const result = await request('fw-change-password', session.token, { currentPassword, password }, true);
            if (!current()) throw changed();
            if (result.ok !== true || result.signInRequired !== true) throw new Error('The password change could not be confirmed. Sign in again to check your new password.');
        } else {
            // Re-authenticate through the server. Client-readable hashes cannot
            // verify bcrypt legacy passwords and must never authorize a change.
            const verified = await request('get-session-token', session.token, { username: session.username, password: currentPassword }, false);
            if (!current()) throw changed();
            if (typeof verified.token !== 'string' || !verified.token) throw new Error('Current password could not be verified. Please try again.');
            const result = await request('set-password', verified.token, { username: session.username, password }, true);
            if (!current()) throw changed();
            if (result.success !== true) throw new Error('The password change could not be confirmed. Sign in again to check your new password.');
        }
        // Do not let a delayed response sign out a different account in this tab.
        if (!current()) throw changed();
        await App.AccountSession.signOut('login.html?password=changed');
        return true;
    }
    App.AccountPassword = { credentials, change };
})(window);
