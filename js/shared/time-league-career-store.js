/* global module */
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const keyFor = scope => `wr-vault-career-v1:${scope}`;
    function read(scope) {
        try {
            const entries = JSON.parse(root.localStorage.getItem(keyFor(scope)) || '[]');
            return Array.isArray(entries) ? entries.filter(entry => entry && typeof entry.leagueId === 'string') : [];
        } catch { return []; }
    }
    function save(record, scope) {
        if (!record || !scope) return;
        const rows = read(scope).filter(row => !(row.leagueId === record.leagueId && row.mode === record.mode && row.seatTeamId === record.seatTeamId));
        rows.push(record);
        try { root.localStorage.setItem(keyFor(scope), JSON.stringify(rows)); } catch { /* Existing league saves remain the source of truth. */ }
    }
    function remember(league, meta, archived = false) {
        const userId = App.OD?.getCurrentUserId?.();
        if (meta && (!userId || (meta.userId && meta.userId !== userId))) return;
        const record = App.TimeLeagueCareer?.recordFor({ league, mode: meta ? 'multiplayer' : 'solo',
            seatTeamId: meta ? meta.seatTeamId : league.teams.find(team => team.manager === 'human')?.teamId,
            rowId: meta?.rowId, archived });
        save(record, meta ? `account:${userId}` : 'solo:device');
    }
    App.TimeLeagueCareerStore = { read, save, remember };
    if (typeof module !== 'undefined' && module.exports) module.exports = App.TimeLeagueCareerStore;
})(typeof window !== 'undefined' ? window : globalThis);
