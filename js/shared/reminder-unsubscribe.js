(function () {
    'use strict';
    const title = document.getElementById('reminder-unsubscribe-title');
    const description = document.getElementById('reminder-unsubscribe-description');
    const button = document.getElementById('reminder-unsubscribe-button');
    const status = document.getElementById('reminder-unsubscribe-status');
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    let token = fragment.get('token');
    // The capability lives only in this page's memory, never in history or storage.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    function inactive() {
        token = null;
        title.textContent = 'This link is no longer active';
        description.textContent = 'Open a recent reminder email to use its link, or manage your reminders in Dynasty HQ.';
        button.hidden = true;
        status.textContent = '';
    }
    if (fragment.size !== 1 || !/^[0-9a-f]{64}$/.test(token || '')) {
        inactive();
        return;
    }
    button.disabled = false;
    button.addEventListener('click', async () => {
        if (button.disabled || !token) return;
        button.disabled = true;
        status.textContent = 'Stopping email reminders…';
        const controller = new window.AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 15000);
        try {
            const endpoint = new URL('https://sxshiqyxhhifvtfqawbq.supabase.co/functions/v1/fw-dashboard-reminders');
            endpoint.searchParams.set('action', 'unsubscribe');
            endpoint.searchParams.set('token', token);
            const response = await window.fetch(endpoint.href, {
                method: 'POST', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal,
                headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'List-Unsubscribe=One-Click',
            });
            const result = await response.json();
            if (response.status === 410 && result?.unsubscribed === false) {
                inactive();
                return;
            }
            if (!response.ok || result?.ok !== true || result?.unsubscribed !== true) throw new Error('Unconfirmed unsubscribe');
            token = null;
            title.textContent = 'Email reminders stopped';
            description.textContent = 'Your dashboard email reminders are paused. You can reconnect email reminders in Dynasty HQ whenever you like.';
            button.hidden = true;
            status.textContent = 'Your account and saved views are unchanged.';
        } catch (_) {
            status.textContent = 'We couldn’t confirm that reminders stopped. Please try again.';
            button.disabled = false;
        } finally {
            window.clearTimeout(timeout);
        }
    });
})();
