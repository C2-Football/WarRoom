/* global self, indexedDB */
// Notification-only service worker. It does not intercept or cache app requests.
'use strict';
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

function bindingStore(change) {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open('dhq-reminder-device-v1', 1);
        open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('state')) open.result.createObjectStore('state'); };
        open.onerror = () => reject(new Error('Device storage unavailable'));
        open.onsuccess = () => {
            const db = open.result;
            const transaction = db.transaction('state', change ? 'readwrite' : 'readonly');
            const store = transaction.objectStore('state');
            const read = store.get('binding');
            let result = null;
            read.onsuccess = () => {
                const previous = read.result || null;
                result = change ? change(previous, store) : { binding: previous };
            };
            transaction.oncomplete = () => { db.close(); resolve(result); };
            transaction.onerror = () => { db.close(); reject(new Error('Device storage unavailable')); };
            transaction.onabort = () => { db.close(); reject(new Error('Device storage unavailable')); };
        };
    });
}

function safeDestination(value) {
    const fallback = new URL('index.html', self.registration.scope);
    try {
        const url = new URL(value, fallback);
        const scope = new URL(self.registration.scope);
        if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname) || url.username || url.password) return fallback.href;
        if (url.pathname !== fallback.pathname && url.pathname !== scope.pathname) return fallback.href;
        url.search = '';
        return url.href;
    } catch (_) { return fallback.href; }
}

self.addEventListener('message', event => {
    const message = event.data;
    const reply = event.ports?.[0];
    let client;
    try { client = new URL(event.source?.url); } catch (_) { return; }
    const scope = new URL(self.registration.scope);
    if (client.origin !== scope.origin || !client.pathname.startsWith(scope.pathname) || !reply) return;
    if (!['dhq-reminder-bind', 'dhq-reminder-clear', 'dhq-reminder-binding'].includes(message?.type)) return;
    event.waitUntil((async () => {
        try {
            let result;
            if (message.type === 'dhq-reminder-binding') result = await bindingStore();
            else if (typeof message.accountId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(message.accountId)) throw new Error('Invalid account');
            else if (message.type === 'dhq-reminder-bind') {
                if (typeof message.deviceKey !== 'string' || !/^[a-f0-9]{64}$/.test(message.deviceKey)) throw new Error('Invalid device');
                result = await bindingStore((previous, store) => {
                    const binding = { accountId: message.accountId, deviceKey: message.deviceKey };
                    store.put(binding, 'binding');
                    return { binding, changed: previous?.accountId !== binding.accountId };
                });
            } else result = await bindingStore((previous, store) => {
                const cleared = previous?.accountId === message.accountId;
                if (cleared) store.delete('binding');
                return { binding: cleared ? null : previous, previous: cleared ? previous : null, cleared };
            });
            if (result.cleared || result.changed) {
                const notifications = await self.registration.getNotifications();
                notifications.forEach(notification => notification.close());
            }
            reply.postMessage({ ok: true, ...result });
        } catch (_) { reply.postMessage({ ok: false }); }
    })());
});

self.addEventListener('push', event => {
    event.waitUntil((async () => {
        let payload = {}, binding = null;
        try { payload = event.data?.json() || {}; } catch (_) { /* show a neutral reminder */ }
        try { binding = (await bindingStore()).binding; } catch (_) { /* no private content without binding */ }
        const matched = payload.version === 1 && binding?.accountId && payload.accountId === binding.accountId;
        const title = matched && typeof payload.title === 'string' && payload.title.trim() ? payload.title.slice(0, 120) : 'Dynasty HQ reminder';
        const body = matched && typeof payload.body === 'string' && payload.body.trim() ? payload.body.slice(0, 300) : 'Open Dynasty HQ to review your reminders.';
        const tag = matched && typeof payload.tag === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(payload.tag) ? payload.tag : 'dynastyhq-reminder';
        await self.registration.showNotification(title, {
            body, tag, renotify: false, icon: new URL('icon-192.png', self.registration.scope).href,
            data: { url: safeDestination(matched ? payload.url : null), accountId: matched ? binding.accountId : null },
        });
    })());
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil((async () => {
        let binding;
        try { binding = (await bindingStore()).binding; } catch (_) { /* open generic Home */ }
        const matched = binding?.accountId && binding.accountId === event.notification.data?.accountId;
        const url = safeDestination(matched ? event.notification.data?.url : null);
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const destination = new URL(url);
        const existing = windows.find(client => {
            try { const current = new URL(client.url); return current.origin === destination.origin && current.pathname === destination.pathname; }
            catch (_) { return false; }
        });
        if (existing) { await existing.navigate(url); await existing.focus(); }
        else await self.clients.openWindow(url);
    })());
});
