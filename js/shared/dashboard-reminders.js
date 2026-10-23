/* global module, globalThis */
/* Reminder drafts are local. Only a fresh authenticated service response can enable delivery. */
(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.WR = root.WR || {};
    root.WR.DashboardReminders = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';
    const PREFIX = 'wr_dashboard_reminders_v1:';
    const MAX_REMINDERS = 24;
    const ID = /^[a-zA-Z0-9_.:-]{1,100}$/;
    const proofs = new WeakMap();
    const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const clone = value => JSON.parse(JSON.stringify(value));
    const fail = message => { throw new Error(message); };

    function timezone() {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; }
    }

    function validateSchedule(value) {
        if (!plain(value) || !['daily', 'weekly'].includes(value.frequency)) fail('Choose a daily or weekly reminder.');
        if (typeof value.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time)) fail('Choose a valid reminder time.');
        if (typeof value.timeZone !== 'string' || value.timeZone.length > 100 || !value.timeZone.trim()) fail('Choose a valid time zone.');
        try { new Intl.DateTimeFormat('en-US', { timeZone: value.timeZone }).format(); } catch (_) { fail('Choose a valid time zone, such as America/Chicago.'); }
        if (value.frequency === 'weekly' && (!Number.isInteger(value.day) || value.day < 0 || value.day > 6)) fail('Choose a day of the week.');
        return { frequency: value.frequency, day: value.frequency === 'weekly' ? value.day : null, time: value.time, timeZone: value.timeZone };
    }

    function validateDraft(value) {
        if (!plain(value) || typeof value.id !== 'string' || !ID.test(value.id) || typeof value.viewId !== 'string' || !ID.test(value.viewId)) fail('Choose a dashboard view for this reminder.');
        if (!['email', 'push'].includes(value.channel)) fail('Choose email or push for this reminder.');
        if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120 || /[\u0000-\u001f\u007f]/.test(value.title)) fail('Give this reminder a title of up to 120 characters.');
        return { id: value.id, viewId: value.viewId, title: value.title.trim(), channel: value.channel, schedule: validateSchedule(value.schedule) };
    }

    function storageKey(scope) {
        if (typeof scope !== 'string' || !scope || scope.length > 1300 || /[\u0000-\u001f\u007f]/.test(scope)) fail('Open an account and league before saving reminders.');
        return PREFIX + scope;
    }

    function read(scope) {
        const key = storageKey(scope);
        let raw;
        try { raw = root.localStorage?.getItem(key); } catch (_) { fail('Reminder drafts could not be read on this device.'); }
        if (raw == null) return { version: 1, revision: 0, reminders: [] };
        try {
            if (raw.length > 100000) throw new Error('size');
            const value = JSON.parse(raw);
            if (value?.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.reminders) || value.reminders.length > MAX_REMINDERS) throw new Error('shape');
            const reminders = value.reminders.map(validateDraft);
            if (new Set(reminders.map(item => item.id)).size !== reminders.length) throw new Error('duplicates');
            // Ignore any cached claim of active delivery. It is never authoritative.
            return { version: 1, revision: value.revision, reminders };
        } catch (_) { fail('Saved reminder drafts could not be read. They have been kept on this device.'); }
    }

    function write(scope, next, expectedRevision) {
        const previous = read(scope);
        if (expectedRevision !== previous.revision) fail('Reminders changed in another tab. Reopen this panel before saving.');
        const saved = { version: 1, revision: previous.revision + 1, reminders: next.map(validateDraft) };
        const text = JSON.stringify(saved);
        try {
            if (!root.localStorage) throw new Error('storage');
            root.localStorage.setItem(storageKey(scope), text);
            if (root.localStorage.getItem(storageKey(scope)) !== text) throw new Error('not retained');
        } catch (_) { fail('This reminder could not be saved on this device. Free some browser storage and try again.'); }
        return clone(saved);
    }

    function saveDraft(scope, value, expectedRevision) {
        const draft = validateDraft(value);
        const prior = read(scope);
        const next = prior.reminders.filter(item => item.id !== draft.id);
        if (next.length >= MAX_REMINDERS) fail('You can save up to 24 reminder drafts per league.');
        next.push(draft);
        return write(scope, next, expectedRevision);
    }

    function removeDraft(scope, id, expectedRevision) {
        return write(scope, read(scope).reminders.filter(item => item.id !== id), expectedRevision);
    }

    function newId() {
        return 'rem_' + (root.crypto?.randomUUID?.() || Date.now().toString(36) + '_' + Math.random().toString(36).slice(2));
    }

    function credentials() {
        const app = root.App || {}, od = app.OD || root.OD;
        if (app.AccountSession?.isCurrent?.() === false) return null;
        try {
            let token = od?.getSessionToken?.();
            if (!token) {
                for (const key of ['fw_session_v1', 'od_session_v1']) {
                    const stored = JSON.parse(root.localStorage?.getItem(key) || 'null');
                    if (stored?.token) { token = stored.token; break; }
                }
            }
            if (!token) return null;
            const raw = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const claims = JSON.parse(root.atob(raw.padEnd(Math.ceil(raw.length / 4) * 4, '=')));
            // App sessions mint the same sub and app user ID. An inconsistent
            // token must not silently select a different account namespace.
            if (claims.sub && claims.app_metadata?.user_id && claims.sub !== claims.app_metadata.user_id) return null;
            const accountId = claims.sub || claims.app_metadata?.user_id;
            if (typeof accountId !== 'string' || !accountId || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now() || Number(claims.app_metadata?.session_version) < 1 || !claims.app_metadata?.session_version) return null;
            return { token, accountId };
        } catch (_) { return null; }
    }

    function matchesScope(auth, scope, leagueId) {
        return auth && scope === encodeURIComponent(auth.accountId) + ':' + encodeURIComponent(leagueId);
    }

    function unavailable(reason) {
        return { status: 'unavailable', reason, channels: { email: { ready: false }, push: { ready: false } }, reminders: [] };
    }

    async function pushDeviceKey() {
        if (root.Notification?.permission !== 'granted' || !root.navigator?.serviceWorker?.getRegistration || !root.crypto?.subtle) return null;
        try {
            const registration = await root.navigator.serviceWorker.getRegistration();
            const subscription = await registration?.pushManager?.getSubscription();
            if (!subscription?.endpoint) return null;
            const digest = await root.crypto.subtle.digest('SHA-256', new root.TextEncoder().encode(subscription.endpoint));
            return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        } catch (_) { return null; }
    }

    async function request(auth, leagueId, method, body, signal, deviceKey) {
        const app = root.App || {}, od = app.OD || root.OD;
        const config = app.CONFIG || od?.CONFIG || {};
        const base = config.supabaseUrl || app.SUPABASE_URL || od?.SUPABASE_URL;
        const anon = config.supabaseAnon || app.SUPABASE_ANON || od?.SUPABASE_ANON;
        if (!base || !anon || typeof root.fetch !== 'function') fail('Delivery not connected. Your reminder draft can still be saved.');
        const url = new URL(base.replace(/\/$/, '') + '/functions/v1/fw-dashboard-reminders');
        url.searchParams.set('leagueId', leagueId);
        if (method === 'GET' && deviceKey) url.searchParams.set('deviceKey', deviceKey);
        const controller = new root.AbortController();
        const abort = () => controller.abort();
        if (signal?.aborted) abort();
        signal?.addEventListener('abort', abort, { once: true });
        const timer = root.setTimeout(abort, 12000);
        try {
            const response = await root.fetch(url.href, { method, cache: 'no-store', signal: controller.signal,
                headers: { apikey: anon, Authorization: 'Bearer ' + auth.token, 'Content-Type': 'application/json' },
                ...(body ? { body: JSON.stringify(body) } : {}) });
            const value = await response.json().catch(() => null);
            if (credentials()?.token !== auth.token) fail('Your account changed. Reopen the dashboard builder.');
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) fail('Sign in again to check reminder delivery.');
                if (response.status === 409) fail('This reminder changed on another device. Check delivery status before trying again.');
                fail(method === 'GET' ? 'Delivery not connected. Your reminder draft can still be saved.' : 'The service did not confirm this change. Check delivery status before trying again.');
            }
            if (value?.version !== 1 || value?.accountId !== auth.accountId || value?.leagueId !== leagueId) fail('Reminder delivery returned an incomplete response. Check delivery status again.');
            return value;
        } catch (error) {
            if (error?.name === 'AbortError') fail(method === 'GET' ? 'Delivery could not be checked. Your reminder draft can still be saved.' : 'This reminder change is not confirmed. Check delivery status before trying again.');
            if (error?.name === 'TypeError') fail(method === 'GET' ? 'Delivery could not be checked. Your reminder draft can still be saved.' : 'This reminder change is not confirmed. Check delivery status before trying again.');
            throw error;
        } finally {
            root.clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
        }
    }

    function serverReminder(value) {
        const draft = validateDraft(value);
        if (!['enabled', 'paused'].includes(value.state) || !Number.isSafeInteger(value.revision) || value.revision < 1) fail('Reminder delivery returned an incomplete response.');
        if (value.state === 'enabled' && (typeof value.nextRunAt !== 'string' || !Number.isFinite(Date.parse(value.nextRunAt)))) fail('The service has not confirmed a next reminder time.');
        return { ...draft, state: value.state, revision: value.revision, nextRunAt: value.state === 'enabled' ? value.nextRunAt : null };
    }

    async function checkService({ scope, leagueId, signal } = {}) {
        const id = String(leagueId ?? '');
        const auth = credentials();
        if (!matchesScope(auth, scope, id)) return unavailable('Sign in to connect delivery. Drafts stay in this browser for this account and league.');
        try {
            const deviceKey = await pushDeviceKey();
            if (credentials()?.token !== auth.token) return unavailable('Your account changed. Reopen the dashboard builder.');
            const value = await request(auth, id, 'GET', null, signal, deviceKey);
            if (!plain(value.channels) || !Array.isArray(value.reminders) || value.reminders.length > MAX_REMINDERS) fail('Reminder delivery returned an incomplete response.');
            const reminders = value.reminders.map(serverReminder);
            if (new Set(reminders.map(item => item.id)).size !== reminders.length) fail('Reminder delivery returned duplicate records.');
            const push = value.channels.push;
            // Push is usable only with an existing server-confirmed subscription on this device.
            // This client does not prompt for permission or retain a push endpoint locally.
            const pushReady = push?.available === true && push?.subscriptionReady === true && !!deviceKey && push?.deviceKey === deviceKey;
            const service = { status: 'ready', reason: '', reminders, channels: {
                email: { ready: value.channels.email?.available === true && value.channels.email?.recipientVerified === true },
                push: { ready: !!pushReady },
            } };
            proofs.set(service, { auth, scope, leagueId: id, checkedAt: Date.now(), deviceKey: pushReady ? deviceKey : null,
                channels: clone(service.channels), reminders: clone(reminders) });
            return service;
        } catch (error) {
            return unavailable(error?.message || 'Delivery could not be checked. Your reminder draft can still be saved.');
        }
    }

    async function configure({ scope, leagueId, draft, service, action = 'enable', viewSaved = false, signal } = {}) {
        const proof = proofs.get(service);
        const auth = credentials();
        if (!proof || proof.auth.token !== auth?.token || proof.scope !== scope || proof.leagueId !== String(leagueId) || Date.now() - proof.checkedAt > 60000) fail('Check delivery status before enabling or changing a reminder.');
        if (!['enable', 'pause'].includes(action)) fail('Choose a supported reminder action.');
        const normalized = validateDraft(draft);
        const previous = proof.reminders.find(item => item.id === normalized.id);
        if (action === 'enable' && !viewSaved) fail('Save this view to your dashboard before enabling its reminder.');
        if (action === 'enable' && !proof.channels[normalized.channel]?.ready) fail('Delivery not connected for this channel. Save a reminder draft for now.');
        if (action === 'pause' && !previous) fail('Check delivery status before pausing this reminder.');
        // Consume the proof once: another mutation requires a fresh read/reconciliation.
        proofs.delete(service);
        const body = { action, operationId: root.crypto?.randomUUID?.() || newId(), expectedRevision: previous?.revision || 0,
            reminder: normalized, ...(normalized.channel === 'push' && action === 'enable' ? { deviceKey: proof.deviceKey } : {}) };
        const response = await request(auth, proof.leagueId, 'POST', body, signal);
        const confirmed = serverReminder(response.reminder);
        if (confirmed.id !== normalized.id || confirmed.state !== (action === 'enable' ? 'enabled' : 'paused')
            || confirmed.revision <= (previous?.revision || 0) || (action === 'enable' && JSON.stringify(validateDraft(confirmed)) !== JSON.stringify(normalized))) fail('The service did not confirm the requested reminder. Check delivery status again.');
        return confirmed;
    }

    function statusLabel(draft, service) {
        const remote = service?.status === 'ready' && service.reminders.find(item => item.id === draft.id);
        if (remote?.state === 'enabled') return JSON.stringify(validateDraft(remote)) === JSON.stringify(validateDraft(draft)) ? 'Scheduled' : 'Earlier schedule is active';
        if (remote?.state === 'paused') return 'Paused';
        return service?.channels?.[draft.channel]?.ready ? 'Draft · ready to enable' : 'Delivery not connected';
    }

    function scheduleLabel(schedule) {
        const valid = validateSchedule(schedule);
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return (valid.frequency === 'daily' ? 'Every day' : 'Every ' + days[valid.day]) + ' at ' + valid.time + ' · ' + valid.timeZone.replace(/_/g, ' ');
    }

    function mergeReminders(local, service) {
        const result = new Map();
        if (service?.status === 'ready') service.reminders.forEach(value => result.set(value.id, validateDraft(value)));
        (local || []).forEach(value => result.set(value.id, validateDraft(value)));
        return Array.from(result.values());
    }

    return { validateSchedule, validateDraft, timezone, read, saveDraft, removeDraft, newId, checkService, configure, statusLabel, scheduleLabel, mergeReminders };
});
