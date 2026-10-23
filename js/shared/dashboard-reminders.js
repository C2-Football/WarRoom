/* global module, globalThis */
/* Reminder drafts are local; authenticated service acknowledgements own actual delivery. */
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

    function pushSupport() {
        const agent = root.navigator || {};
        const ios = /iPad|iPhone|iPod/.test(agent.userAgent || '') || (agent.platform === 'MacIntel' && agent.maxTouchPoints > 1);
        const installed = agent.standalone === true || root.matchMedia?.('(display-mode: standalone)')?.matches;
        if (ios && !installed) return { supported: false, reason: 'For push on iPhone or iPad, add Dynasty HQ to your Home Screen, then open it there.' };
        if (root.isSecureContext !== true) return { supported: false, reason: 'Open Dynasty HQ over a secure connection to connect push.' };
        if (!agent.serviceWorker || !root.PushManager || !root.Notification) return { supported: false, reason: 'Push is not supported in this browser. You can use email reminders.' };
        if (root.Notification.permission === 'denied') return { supported: false, reason: 'Push is blocked in your browser settings. Allow notifications for Dynasty HQ, then try again.' };
        return { supported: true, reason: '' };
    }

    function workerLocation() {
        const base = root.document?.baseURI || root.location?.href;
        if (!base) fail('Open Dynasty HQ before connecting push.');
        return new URL('dashboard-reminder-sw.js', base);
    }

    async function currentSubscription() {
        if (!root.navigator?.serviceWorker?.getRegistration) return null;
        const registration = await root.navigator.serviceWorker.getRegistration();
        if (!registration) return null;
        // Never inspect or replace an unrelated worker's subscription.
        const script = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL;
        if (script && new URL(script).pathname !== workerLocation().pathname) return null;
        return registration.pushManager?.getSubscription?.() || null;
    }

    async function subscriptionKey(subscription) {
        if (!subscription?.endpoint || !root.crypto?.subtle) return null;
        const digest = await root.crypto.subtle.digest('SHA-256', new root.TextEncoder().encode(subscription.endpoint));
        return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }

    async function workerMessage(type, payload = {}) {
        const registration = await root.navigator?.serviceWorker?.getRegistration?.();
        const worker = registration?.active;
        if (!worker || !root.MessageChannel) return null;
        const expected = workerLocation();
        if (worker.scriptURL && new URL(worker.scriptURL).pathname !== expected.pathname) return null;
        return new Promise((resolve, reject) => {
            const channel = new root.MessageChannel();
            const close = () => { channel.port1.close(); channel.port2.close(); };
            const timer = root.setTimeout(() => { close(); reject(new Error('Push setup did not confirm this device. Try again.')); }, 1500);
            channel.port1.onmessage = event => {
                root.clearTimeout(timer); close();
                event.data?.ok === true ? resolve(event.data) : reject(new Error('Push setup could not save this device. Try again.'));
            };
            worker.postMessage({ type, ...payload }, [channel.port2]);
        });
    }

    async function pushDeviceKey() {
        if (root.Notification?.permission !== 'granted' || !root.navigator?.serviceWorker?.getRegistration || !root.crypto?.subtle) return null;
        try {
            return await subscriptionKey(await currentSubscription());
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
                if (response.status === 429) fail('Please wait before trying again. Too many reminder requests were made.');
                if (response.status === 400 && body?.action === 'email-confirm') fail('That code is invalid or expired. Check the code or request a new one.');
                if (response.status === 400 && body?.action === 'push-subscribe') fail('This push subscription could not be connected. Try connecting this device again.');
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
            let deviceBinding = null;
            if (deviceKey) { try { deviceBinding = (await workerMessage('dhq-reminder-binding'))?.binding; } catch (_) { /* explicit Connect push can repair this device */ } }
            if (credentials()?.token !== auth.token) return unavailable('Your account changed. Reopen the dashboard builder.');
            const value = await request(auth, id, 'GET', null, signal, deviceKey);
            if (!plain(value.channels) || !Array.isArray(value.reminders) || value.reminders.length > MAX_REMINDERS) fail('Reminder delivery returned an incomplete response.');
            const reminders = value.reminders.map(serverReminder);
            if (new Set(reminders.map(item => item.id)).size !== reminders.length) fail('Reminder delivery returned duplicate records.');
            const push = value.channels.push;
            // Checking delivery never prompts for permission. Push readiness requires
            // this browser's subscription and the authenticated server binding.
            const subscriptionReady = push?.subscriptionReady === true && !!deviceKey && push?.deviceKey === deviceKey && deviceBinding?.accountId === auth.accountId && deviceBinding?.deviceKey === deviceKey;
            const pushReady = push?.available === true && subscriptionReady;
            const service = { status: 'ready', reason: '', reminders, channels: {
                email: {
                    ready: value.channels.email?.available === true && value.channels.email?.recipientVerified === true && value.channels.email?.optedIn === true,
                    available: value.channels.email?.available === true,
                    recipientVerified: value.channels.email?.recipientVerified === true,
                    optedIn: value.channels.email?.optedIn === true,
                    maskedEmail: typeof value.channels.email?.maskedEmail === 'string' ? value.channels.email.maskedEmail.slice(0, 200) : '',
                    verificationPending: value.channels.email?.verificationPending === true,
                },
                push: { ready: !!pushReady, available: push?.available === true,
                    vapidPublicKey: typeof push?.vapidPublicKey === 'string' && /^[A-Za-z0-9_-]{87}$/.test(push.vapidPublicKey) ? push.vapidPublicKey : null,
                    subscriptionReady: !!subscriptionReady,
                },
            } };
            proofs.set(service, { auth, scope, leagueId: id, checkedAt: Date.now(), deviceKey: pushReady ? deviceKey : null,
                channels: clone(service.channels), reminders: clone(reminders) });
            return service;
        } catch (error) {
            return unavailable(error?.message || 'Delivery could not be checked. Your reminder draft can still be saved.');
        }
    }

    function requireProof({ scope, leagueId, service }) {
        const proof = proofs.get(service);
        const auth = credentials();
        if (!proof || proof.auth.token !== auth?.token || proof.scope !== scope || proof.leagueId !== String(leagueId) || Date.now() - proof.checkedAt > 60000) fail('Check delivery status before connecting or changing reminders.');
        return proof;
    }

    async function channelAction(options = {}) {
        const { action, code, subscription, deviceKey, signal } = options;
        const proof = requireProof(options);
        if (!['email-start', 'email-confirm', 'email-disable', 'push-subscribe', 'push-unsubscribe'].includes(action)) fail('Choose a supported delivery action.');
        if (['email-start', 'email-confirm'].includes(action) && !proof.channels.email.available) fail('Email delivery is unavailable right now. Try again later.');
        if (action === 'email-confirm' && (typeof code !== 'string' || !/^\d{6}$/.test(code))) fail('Enter the six-digit code from your email.');
        if (action === 'push-subscribe' && (!proof.channels.push.available || !plain(subscription) || typeof subscription.endpoint !== 'string' || !plain(subscription.keys) || typeof subscription.keys.p256dh !== 'string' || typeof subscription.keys.auth !== 'string')) fail('Push could not connect to this device. Try again.');
        if (action.startsWith('push-') && (typeof deviceKey !== 'string' || !/^[a-f0-9]{64}$/.test(deviceKey))) fail('Connect this device before changing push delivery.');
        proofs.delete(options.service);
        const response = await request(proof.auth, proof.leagueId, 'POST', { action,
            ...(action === 'email-confirm' ? { code } : {}),
            ...(action === 'push-subscribe' ? { subscription, deviceKey, appUrl: new URL('index.html', workerLocation()).href } : {}),
            ...(action === 'push-unsubscribe' ? { deviceKey } : {}),
        }, signal);
        if (response.action !== action || response.ok !== true || (action.startsWith('push-') && response.deviceKey !== deviceKey)) fail('The service did not confirm this delivery change. Check delivery status before trying again.');
        return response;
    }

    function vapidBytes(value) {
        if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(value)) fail('Push setup is unavailable right now. Check delivery status again.');
        const raw = root.atob((value + '=').replace(/-/g, '+').replace(/_/g, '/'));
        const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
        if (bytes.length !== 65 || bytes[0] !== 4) fail('Push setup is unavailable right now. Check delivery status again.');
        return bytes;
    }

    async function registerWorker() {
        const url = workerLocation();
        const existing = await root.navigator.serviceWorker.getRegistration();
        const script = existing?.active?.scriptURL || existing?.waiting?.scriptURL || existing?.installing?.scriptURL;
        if (script && new URL(script).href !== url.href) fail('Push setup needs a page refresh before continuing.');
        const registration = await root.navigator.serviceWorker.register(url.href, { scope: new URL('./', url).pathname, updateViaCache: 'none' });
        if (registration.active) return registration;
        const worker = registration.installing || registration.waiting;
        if (!worker) fail('Push could not start on this device. Try again.');
        await new Promise((resolve, reject) => {
            const timer = root.setTimeout(() => { worker.removeEventListener('statechange', changed); reject(new Error('Push setup is taking longer than expected. Try again.')); }, 12000);
            function changed() {
                if (worker.state === 'activated' || worker.state === 'redundant') {
                    root.clearTimeout(timer); worker.removeEventListener('statechange', changed);
                    worker.state === 'activated' ? resolve() : reject(new Error('Push could not start on this device. Try again.'));
                }
            }
            worker.addEventListener('statechange', changed); changed();
        });
        return registration;
    }

    // Call directly from a trusted click. requestPermission runs before any await.
    function connectPush(options = {}) {
        const proof = requireProof(options);
        const support = pushSupport();
        if (!support.supported) return Promise.reject(new Error(support.reason));
        if (!proof.channels.push.available) return Promise.reject(new Error('Push delivery is unavailable right now. Try again later.'));
        const applicationServerKey = vapidBytes(proof.channels.push.vapidPublicKey);
        const permission = root.Notification.permission === 'granted' ? Promise.resolve('granted') : root.Notification.requestPermission();
        return (async () => {
            if (await permission !== 'granted') fail('Push was not connected. You can still use email reminders.');
            if (credentials()?.token !== proof.auth.token) fail('Your account changed. Open the dashboard builder again.');
            const registration = await registerWorker();
            let subscription = await registration.pushManager.getSubscription();
            let created = false;
            if (!subscription) { subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }); created = true; }
            try {
                const deviceKey = await subscriptionKey(subscription);
                // Permission prompts can take longer than the short proof window;
                // recheck without prompting again before committing the subscription.
                const fresh = await checkService({ scope: options.scope, leagueId: options.leagueId, signal: options.signal });
                const response = await channelAction({ ...options, service: fresh, action: 'push-subscribe', subscription: subscription.toJSON(), deviceKey });
                if (credentials()?.token !== proof.auth.token) fail('Your account changed. Open the dashboard builder again.');
                const bound = await workerMessage('dhq-reminder-bind', { accountId: proof.auth.accountId, deviceKey });
                if (!bound?.binding || bound.binding.accountId !== proof.auth.accountId || bound.binding.deviceKey !== deviceKey) fail('Push setup did not confirm this device. Try again.');
                return response;
            } catch (error) {
                if (created) { try { await subscription.unsubscribe(); } catch (_) { /* server reconciliation remains available */ } }
                throw error;
            }
        })();
    }

    async function disconnectPush(options = {}) {
        const subscription = await currentSubscription();
        const deviceKey = await subscriptionKey(subscription);
        if (!deviceKey) fail('No push subscription is connected on this device.');
        const response = await channelAction({ ...options, action: 'push-unsubscribe', deviceKey });
        const auth = credentials();
        if (auth) await workerMessage('dhq-reminder-clear', { accountId: auth.accountId });
        if (subscription) await subscription.unsubscribe();
        return response;
    }

    async function clearDeviceForAccount(accountId) {
        if (!accountId) return false;
        try {
            const result = await workerMessage('dhq-reminder-clear', { accountId });
            if (!result?.cleared || !result?.previous?.deviceKey) return false;
            const subscription = await currentSubscription();
            if (!subscription || await subscriptionKey(subscription) !== result.previous.deviceKey) return true;
            const current = await workerMessage('dhq-reminder-binding');
            // A newly signed-in account may have connected while cleanup was
            // waiting. Never unsubscribe that account's device binding.
            if (current?.binding && current.binding.accountId !== accountId) return false;
            await subscription.unsubscribe();
            return true;
        } catch (_) { return false; }
    }

    function clearPushForAccountChange(previousIdentity) {
        const accountId = typeof previousIdentity === 'string' && previousIdentity.startsWith('account:') ? previousIdentity.slice(8) : '';
        return clearDeviceForAccount(accountId);
    }

    function disconnectForSignOut() {
        // Capture before account teardown clears or blocks the session.
        const auth = credentials();
        if (!auth) return Promise.resolve(false);
        return (async () => {
            const controller = new root.AbortController();
            const timer = root.setTimeout(() => controller.abort(), 1000);
            try {
                const binding = await workerMessage('dhq-reminder-binding');
                if (binding?.binding?.accountId === auth.accountId) {
                    await request(auth, 'device', 'POST', { action: 'push-unsubscribe', deviceKey: binding.binding.deviceKey }, controller.signal);
                }
            } catch (_) { /* local invalidation still stops this browser endpoint */ }
            finally { root.clearTimeout(timer); await clearDeviceForAccount(auth.accountId); }
            return true;
        })();
    }

    async function stopLocalPush() {
        const auth = credentials();
        return auth ? clearDeviceForAccount(auth.accountId) : false;
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

    return { validateSchedule, validateDraft, timezone, pushSupport, channelAction, connectPush, disconnectPush, stopLocalPush, disconnectForSignOut, clearPushForAccountChange, read, saveDraft, removeDraft, newId, checkService, configure, statusLabel, scheduleLabel, mergeReminders };
});
