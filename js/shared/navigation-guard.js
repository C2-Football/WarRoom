// Same-document navigation must not discard a form whose durable save failed.
(function (root) {
    'use strict';
    const guards = new Set();
    let blockedRoute = null;
    const api = {
        register(check) {
            const entry = { check, url: root.location.href, state: root.history.state };
            guards.add(entry);
            return () => guards.delete(entry);
        },
        canNavigate() {
            blockedRoute = null;
            for (const entry of guards) {
                if (entry.check() === false && !blockedRoute) blockedRoute = entry;
            }
            return blockedRoute === null;
        },
        restoreHistory() {
            // popstate fires after the browser moved. Reinsert the protected
            // screen so its URL and mounted form agree; keep the older entry
            // available after the user retries or explicitly discards edits.
            if (blockedRoute) root.history.pushState(blockedRoute.state, '', blockedRoute.url);
        },
    };
    root.App = root.App || {};
    root.App.NavigationGuard = api;
})(window);
