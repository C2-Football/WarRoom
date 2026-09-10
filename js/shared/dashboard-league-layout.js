// Shared dashboard defaults and short-lived navigation into League Central.
(function (root) {
    'use strict';
    const keys = ['weekly-matchups', 'league-standings', 'league-stats', 'league-cup'];
    const destinations = {
        'weekly-matchups': { section: 'league', anchor: 'scoreboard' },
        'league-standings': { section: 'league', anchor: 'standings' },
        'league-cup': { section: 'cup', anchor: 'cup' },
    };
    let pending = null;
    const defaults = () => keys.map(key => ({ id: 'league_kpi_' + key, key, size: 'sm' }));
    const leagueId = league => String(league?.id || league?.league_id || '');
    const marker = id => 'wr_dashboard_league_kpis_v1_' + id;
    const addMissing = widgets => [...defaults().filter(w => !widgets.some(existing => existing.key === w.key)), ...widgets];
    const peek = id => pending && pending.leagueId === String(id) && Date.now() - pending.at < 30000 ? pending : null;
    const request = (target, id) => {
        if (!destinations[target]) return false;
        pending = { ...destinations[target], leagueId: String(id), at: Date.now() };
        root.dispatchEvent(new root.CustomEvent('wr:league-central-nav', { detail: pending }));
        return true;
    };
    const consume = id => { const intent = peek(id); if (intent) pending = null; return intent; };
    root.App = root.App || {};
    root.App.DashboardLeagueLayout = { keys, defaults, leagueId, marker, addMissing, request, peek, consume };
})(window);
