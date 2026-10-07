// Private, editable waiver plans. Local planning only; no provider claims are submitted.
(function (root) {
    'use strict';
    const account = () => {
        const authenticated = (root.App?.OD || root.OD)?.getCurrentUserId?.();
        if (authenticated) return 'account:' + authenticated;
        return (root.S?.platform || 'sleeper') === 'sleeper' && root.S?.user?.user_id ? 'sleeper:' + root.S.user.user_id : null;
    };
    function scope(league) {
        const owner = account(), id = league?.league_id || league?.id;
        return owner && id ? 'wr_waiver_plans_v1:' + [owner, league?._platform || root.S?.platform || 'sleeper', id, league?.season || ''].map(encodeURIComponent).join(':') : null;
    }
    function normalize(plan) {
        if (!plan || plan.pid == null || String(plan.pid) === '') return null;
        const bid = plan.bid == null || plan.bid === '' ? null : Number(plan.bid);
        if (bid != null && (!Number.isInteger(bid) || bid < 0)) return null;
        const pid = String(plan.pid);
        return { id: String(plan.id || 'claim:' + pid), pid, dropPid: plan.dropPid == null || plan.dropPid === '' ? null : String(plan.dropPid), bid,
            position: String(plan.position || ''), reason: String(plan.reason || '').slice(0, 1200), source: String(plan.source || 'waiver-plan'),
            createdAt: Number(plan.createdAt) || Date.now(), updatedAt: Number(plan.updatedAt) || Date.now() };
    }
    function list(league) {
        const key = scope(league);
        if (!key) return [];
        try {
            const saved = JSON.parse(root.localStorage.getItem(key) || '[]'), seen = new Set();
            return (Array.isArray(saved) ? saved : []).map(normalize).filter(plan => {
                if (!plan || seen.has(plan.pid)) return false;
                seen.add(plan.pid); return true;
            });
        } catch (_) { return []; }
    }
    function write(league, plans) {
        const key = scope(league);
        if (!key) return false;
        try {
            const value = JSON.stringify(plans);
            root.localStorage.setItem(key, value);
            if (root.localStorage.getItem(key) !== value) return false;
            root.dispatchEvent?.(new root.CustomEvent('wr:waiver-plans-changed', { detail: { key } }));
            return true;
        } catch (_) { return false; }
    }
    function get(league, pid) { return list(league).find(plan => plan.pid === String(pid)) || null; }
    function save(league, input) {
        const plans = list(league), next = normalize(input);
        if (!next) return null;
        const index = plans.findIndex(plan => plan.pid === next.pid);
        const previous = index >= 0 ? plans[index] : null;
        const saved = { ...next, id: previous?.id || next.id, createdAt: previous?.createdAt || next.createdAt, updatedAt: Date.now() };
        if (index >= 0) plans[index] = saved; else plans.push(saved);
        return write(league, plans) ? saved : null;
    }
    function remove(league, id) { return write(league, list(league).filter(plan => plan.id !== id)); }
    function move(league, id, direction) {
        const plans = list(league), index = plans.findIndex(plan => plan.id === id), next = index + (direction < 0 ? -1 : 1);
        if (index < 0 || next < 0 || next >= plans.length) return false;
        [plans[index], plans[next]] = [plans[next], plans[index]];
        return write(league, plans);
    }
    root.WR = root.WR || {};
    root.WR.WaiverPlans = { account, scope, list, get, save, remove, move };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.WR.WaiverPlans;
})(typeof window !== 'undefined' ? window : globalThis);
