/* global React */
(function (root) {
    'use strict';
    const App = root.App = root.App || {}, h = React.createElement;
    function statusOf({ offline = false, authRequired = false, saving = false, error = false, lastSyncedAt = 0, now = Date.now() } = {}) {
        if (authRequired) return { state: 'auth', label: 'Sign-in required', detail: 'Reconnect to your account or restore your guest pass.' };
        if (offline) return { state: 'offline', label: 'Offline', detail: 'Your last saved room is shown. Reconnection resumes when you are online.' };
        if (saving) return { state: 'saving', label: 'Saving…', detail: 'Waiting for the game server to confirm your move.' };
        if (error || !lastSyncedAt || now - lastSyncedAt > 15000) return { state: 'reconnecting', label: 'Reconnecting', detail: 'Your last saved room is shown. Research stays available while the room reconnects.' };
        return { state: 'synced', label: 'Synced', detail: 'The latest room update is confirmed. Joined and ready labels describe seat status, not live presence.' };
    }
    function GameRoomStatus({ authRequired, saving, error, lastSyncedAt, joined, total, ready, onRetry, retrying = false }) {
        const [offline, setOffline] = React.useState(() => root.navigator?.onLine === false);
        const [now, setNow] = React.useState(Date.now);
        React.useEffect(() => {
            const update = () => { setOffline(root.navigator?.onLine === false); setNow(Date.now()); };
            root.addEventListener('online', update); root.addEventListener('offline', update);
            const timer = root.setInterval(update, 5000);
            return () => { root.removeEventListener('online', update); root.removeEventListener('offline', update); root.clearInterval(timer); };
        }, []);
        const status = statusOf({ offline, authRequired, saving, error, lastSyncedAt, now });
        return h('aside', { className: 'game-room-status', 'data-state': status.state, 'aria-label': 'Friends room status' },
            h('span', { className: 'game-room-sync', role: 'status', 'aria-live': 'polite', 'aria-atomic': true, title: status.detail },
                h('i', { 'aria-hidden': true }), status.label),
            Number.isFinite(total) && h('span', { className: 'game-room-members' }, `${joined || 0}/${total} joined`, Number.isFinite(ready) ? ` · ${ready} ready` : ''),
            ['offline', 'reconnecting'].includes(status.state) && h('span', { className: 'game-room-explanation' }, status.detail),
            status.state === 'reconnecting' && onRetry && h('button', { type: 'button', disabled: retrying || saving, onClick: onRetry }, retrying ? 'Reconnecting…' : 'Reconnect now'));
    }
    App.GameRoomStatus = GameRoomStatus;
    App.GameRoomStatusModel = { statusOf };
})(window);
