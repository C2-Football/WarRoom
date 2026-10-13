// Server-confirmed Ignore choices. Local caches never grant server authority.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const KEY = 'commish_ignore_cloud_v1';
    const AUTH_KEYS = ['fw_session_v1', 'od_session_v1'];
    const listeners = new Set();
    const clone = value => JSON.parse(JSON.stringify(value));
    let stamp = null, epoch = 0, owner = null, records = Object.create(null), pending = null;
    let phase = 'idle', error = null, errorCode = null, cacheError = null, loaded = false, runningLoad = null, writeClock = 0;
    let lastReturn = 0;
    const writes = new Map();
    function credentials() {
        const raw = AUTH_KEYS.map(key => { try { return root.localStorage?.getItem(key) || null; } catch { return null; } });
        const values = raw.map(value => { try { return JSON.parse(value); } catch { return null; } });
        const od = App.OD || root.OD;
        const token = values[0]?.token || values[1]?.token || od?.getSessionToken?.() || null;
        const currentOwner = App.AccountSession?.isCurrent?.() === false ? null : App.AccountStorage?.owner?.() || null;
        return { owner: currentOwner, token, stamp: JSON.stringify([currentOwner, ...raw, token]) };
    }
    const bytes = value => new root.TextEncoder().encode(value).length;
    const validTaskId = id => typeof id === 'string' && id.length > 0 && bytes(id) <= 512 && !/[\u0000-\u001f\u007f]/.test(id);
    const validSnapshot = (value, id) => value === null || (value && typeof value === 'object' && !Array.isArray(value)
        && value.id === id && bytes(JSON.stringify(value)) <= 8192);
    const validRecord = row => row && validTaskId(row.taskId)
        && ['ignored', 'restored'].includes(row.state) && Number.isSafeInteger(row.revision) && row.revision > 0
        && typeof row.updatedAt === 'string' && Number.isFinite(Date.parse(row.updatedAt)) && validSnapshot(row.snapshot, row.taskId);
    const decorated = (row, source = 'cloud') => ({ ...clone(row), source, confirmed: source === 'cloud' });
    function view() {
        const safePending = pending ? { taskId: pending.taskId, state: pending.state, operationId: pending.operationId,
            inFlight: pending.inFlight, uncertain: pending.uncertain, snapshot: JSON.parse(pending.body).snapshot || { id: pending.taskId } } : null;
        return clone({ phase, error, errorCode, cacheError, records, owner, pending: safePending, loaded });
    }
    function emit() { const value = view(); listeners.forEach(fn => { try { fn(value); } catch { /* One consumer cannot stop account reconciliation. */ } }); }
    function saveCache() {
        try {
            const saved = App.AccountStorage?.set?.(KEY, { version: 1, owner, records, pending: pending ? { ...pending, inFlight: false } : null }) === true;
            cacheError = saved ? null : 'Account choices could not be cached in this browser. Keep this page open to retry any unconfirmed change.';
            return saved;
        } catch { cacheError = 'Account choices could not be cached in this browser. Keep this page open to retry any unconfirmed change.'; return false; }
    }
    function identity() {
        const auth = credentials();
        if (stamp === auth.stamp) return auth;
        stamp = auth.stamp; epoch++; owner = auth.owner;
        records = Object.create(null); pending = null; writes.clear(); writeClock = 0;
        loaded = false; runningLoad = null; error = null; errorCode = null; cacheError = null;
        phase = owner?.startsWith('account:') && auth.token ? 'idle' : 'auth-required';
        if (phase === 'idle') {
            let saved;
            try { saved = App.AccountStorage?.get?.(KEY, null); } catch { /* Cache failure does not become cloud success. */ }
            if (saved?.version === 1 && saved.owner === owner) {
                Object.values(saved.records || {}).filter(validRecord).forEach(row => { records[row.taskId] = decorated(row, 'cache'); });
                const candidate = saved.pending;
                try {
                    const body = JSON.parse(candidate?.body || 'null');
                    if (candidate?.operationId && body?.operationId === candidate.operationId && body.taskId === candidate.taskId && body.state === candidate.state
                        && validTaskId(body.taskId) && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.operationId)
                        && Object.keys(body).every(key => ['taskId', 'state', 'operationId', 'expectedRevision', 'snapshot'].includes(key))
                        && validSnapshot(body.snapshot ?? null, body.taskId) && bytes(candidate.body) <= 12000
                        && ['ignored', 'restored'].includes(body.state) && Number.isSafeInteger(body.expectedRevision) && body.expectedRevision >= 0) {
                        pending = { ...candidate, inFlight: false, uncertain: true };
                    }
                } catch { /* Invalid recovery data is never sent. */ }
                if (Object.keys(records).length || pending) phase = 'checking';
            }
        }
        emit();
        return auth;
    }
    function current(auth, generation) { return identity().stamp === auth.stamp && epoch === generation; }
    function fail(message, code, auth, generation) {
        if (!current(auth, generation)) return false;
        phase = 'error'; error = message; errorCode = code; emit(); return false;
    }
    async function request(auth, method, body, cursor) {
        const config = App.CONFIG || (App.OD || root.OD)?.CONFIG || {};
        const base = config.supabaseUrl || App.SUPABASE_URL || (App.OD || root.OD)?.SUPABASE_URL;
        const anon = config.supabaseAnon || App.SUPABASE_ANON || (App.OD || root.OD)?.SUPABASE_ANON;
        if (!base || !anon) throw new Error('Account sync is still loading. Try again.');
        const url = new URL(base.replace(/\/$/, '') + '/functions/v1/fw-commish-ignored');
        if (method === 'GET') { url.searchParams.set('limit', '200'); if (cursor !== null) url.searchParams.set('cursor', cursor); }
        const controller = new root.AbortController();
        const timer = root.setTimeout(() => controller.abort(), 15000);
        try {
            const response = await root.fetch(url.href, { method, headers: { apikey: anon, Authorization: 'Bearer ' + auth.token, 'Content-Type': 'application/json' },
                ...(body ? { body } : {}), signal: controller.signal, cache: 'no-store' });
            const data = await response.json().catch(() => null);
            return { response, data };
        } finally { root.clearTimeout(timer); }
    }
    function accountMatches(data, auth) { return data?.accountId === auth.owner.slice('account:'.length); }
    async function load() {
        const auth = identity(), generation = epoch;
        if (!auth.owner?.startsWith('account:') || !auth.token) return fail('Sign in to sync ignored tasks across your devices.', 'AUTH_REQUIRED', auth, generation);
        if (runningLoad) return runningLoad;
        const started = writeClock;
        phase = 'loading'; error = null; errorCode = null; emit();
        runningLoad = (async () => {
            const incoming = Object.create(null), cursors = new Set();
            let cursor = null;
            try {
                do {
                    const { response, data } = await request(auth, 'GET', null, cursor);
                    if (!current(auth, generation)) return false;
                    if (!response.ok) return fail(data?.error || 'Could not load ignored tasks. Your last known choices remain visible.', response.status === 401 ? 'AUTH_REQUIRED' : 'LOAD_FAILED', auth, generation);
                    if (data?.ok !== true || !accountMatches(data, auth) || !Array.isArray(data.records) || !data.records.every(validRecord)
                        || !(data.nextCursor === null || (typeof data.nextCursor === 'string' && data.nextCursor))) {
                        return fail('Account sync returned an incomplete response. Retry to confirm your ignored tasks.', 'INVALID_RESPONSE', auth, generation);
                    }
                    data.records.forEach(row => { if (!incoming[row.taskId] || incoming[row.taskId].revision < row.revision) incoming[row.taskId] = decorated(row); });
                    cursor = data.nextCursor;
                    if (cursor !== null && cursors.has(cursor)) return fail('Account sync could not finish loading all ignored tasks. Retry.', 'INVALID_RESPONSE', auth, generation);
                    if (cursor !== null) cursors.add(cursor);
                } while (cursor !== null);
                if (!current(auth, generation)) return false;
                // A completed GET replaces untrusted cache entries. A POST
                // confirmed during this GET cannot be undone by an older page.
                writes.forEach((clock, id) => {
                    if (records[id] && ((clock > started && !incoming[id]) || (incoming[id] && incoming[id].revision < records[id].revision))) incoming[id] = records[id];
                });
                records = incoming; loaded = true;
                phase = pending?.inFlight ? 'saving' : pending ? 'error' : 'ready';
                error = pending && !pending.inFlight ? 'A task change is not confirmed. Retry that choice to recover the same operation.' : null;
                errorCode = pending && !pending.inFlight ? 'UNCONFIRMED_CHANGE' : null;
                saveCache(); emit(); return true;
            } catch { return fail('Could not reach account sync. Your last known choices remain visible; retry when connected.', 'LOAD_FAILED', auth, generation); }
            finally { if (current(auth, generation)) runningLoad = null; }
        })();
        return runningLoad;
    }
    function taskSnapshot(item) {
        if (!item || !validTaskId(String(item.id ?? ''))) throw new Error('Choose a valid task to sync.');
        const list = value => (Array.isArray(value) ? value : []).slice(0, 50).map(entry => String(entry).slice(0, 200));
        const value = { id: String(item.id), headline: String(item.headline || 'Ignored task').slice(0, 500), detail: String(item.detail || '').slice(0, 2000),
            kind: String(item.kind || '').slice(0, 100), hub: String(item.hub || 'command').slice(0, 60), domain: String(item.domain || '').slice(0, 60),
            leagueIds: list(item.leagueIds), leagueNames: list(item.leagueNames) };
        while (bytes(JSON.stringify(value)) > 8192) {
            if (value.leagueNames.length) value.leagueNames.pop();
            else if (value.leagueIds.length) value.leagueIds.pop();
            else value.detail = value.detail.slice(0, Math.floor(value.detail.length / 2));
        }
        return value;
    }
    function apply(row) {
        if (!validRecord(row)) return;
        const previous = records[row.taskId];
        if (!previous || previous.revision <= row.revision) { records[row.taskId] = decorated(row); writes.set(row.taskId, ++writeClock); }
    }
    async function change(item, state) {
        const auth = identity(), generation = epoch;
        if (!auth.owner?.startsWith('account:') || !auth.token) return fail('Sign in to sync ignored tasks across your devices.', 'AUTH_REQUIRED', auth, generation);
        let snapshot;
        try { snapshot = taskSnapshot(item); } catch (cause) { return fail(cause.message, 'INVALID_TASK', auth, generation); }
        if (!['ignored', 'restored'].includes(state)) return fail('Choose Ignore or Restore.', 'INVALID_STATE', auth, generation);
        if (pending?.inFlight) return false;
        if (pending && (pending.taskId !== snapshot.id || pending.state !== state)) return fail('Retry the unconfirmed task change before making another choice.', 'PENDING_CHANGE', auth, generation);
        if (!loaded && !pending) { if (!await load() || !current(auth, generation)) return false; }
        // Two clicks can share the initial GET; only the first may begin a POST.
        if (pending?.inFlight) return false;
        if (pending && (pending.taskId !== snapshot.id || pending.state !== state)) return fail('Retry the unconfirmed task change before making another choice.', 'PENDING_CHANGE', auth, generation);
        if (!pending) {
            const operationId = root.crypto.randomUUID();
            const body = JSON.stringify({ taskId: snapshot.id, state, expectedRevision: records[snapshot.id]?.revision || 0, operationId, snapshot });
            pending = { taskId: snapshot.id, state, operationId, body, inFlight: false, uncertain: false };
        }
        pending.inFlight = true; phase = 'saving'; error = null; errorCode = null; saveCache(); emit();
        try {
            const { response, data } = await request(auth, 'POST', pending.body);
            if (!current(auth, generation)) return false;
            if (response.status === 409 && accountMatches(data, auth) && (data.record === null || (validRecord(data.record) && data.record.taskId === snapshot.id))) {
                if (data.record) apply(data.record); else delete records[snapshot.id];
                pending = null; saveCache();
                await load();
                return fail('This task changed on another device. Review the current choice, then retry if you still want to change it.', 'REVISION_CONFLICT', auth, generation);
            }
            if (!response.ok) {
                pending.inFlight = false; pending.uncertain = true; saveCache();
                return fail(data?.error || 'The task change was not confirmed. Retry to recover the same choice.', response.status === 401 ? 'AUTH_REQUIRED' : 'SAVE_FAILED', auth, generation);
            }
            if (data?.ok !== true || !accountMatches(data, auth) || !validRecord(data.record) || data.record.taskId !== snapshot.id
                || !Number.isSafeInteger(data.appliedRevision) || data.appliedRevision <= 0 || data.appliedRevision > data.record.revision || typeof data.duplicate !== 'boolean') {
                pending.inFlight = false; pending.uncertain = true; saveCache();
                return fail('The task change could not be confirmed. Retry to recover the same operation.', 'INVALID_RESPONSE', auth, generation);
            }
            apply(data.record); pending = null; saveCache();
            if (records[snapshot.id]?.state !== state) return fail('This task was changed again on another device. Review its current choice before retrying.', 'REVISION_CONFLICT', auth, generation);
            phase = 'ready'; error = null; errorCode = null; emit(); return true;
        } catch {
            if (!current(auth, generation)) return false;
            pending.inFlight = false; pending.uncertain = true; saveCache();
            return fail('The task change is not confirmed. Retry when connected to recover the same operation.', 'SAVE_UNCONFIRMED', auth, generation);
        }
    }
    const api = { snapshot() { identity(); return view(); }, subscribe(fn) { identity(); listeners.add(fn); return () => listeners.delete(fn); }, load, refresh: load, change,
        retryPending() { identity(); if (!pending) return Promise.resolve(false); const body = JSON.parse(pending.body); return change(body.snapshot || { id: pending.taskId }, pending.state); } };
    const onReturn = () => { if (root.document?.visibilityState === 'hidden' || Date.now() - lastReturn < 1000) return; lastReturn = Date.now(); load(); };
    root.addEventListener?.('focus', onReturn);
    root.addEventListener?.('online', onReturn);
    root.addEventListener?.('storage', event => { if (event.key === null || AUTH_KEYS.includes(event.key) || event.key?.endsWith(':' + KEY)) onReturn(); });
    root.document?.addEventListener?.('visibilitychange', onReturn);
    App.Commish = App.Commish || {};
    App.Commish.IgnoreSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
