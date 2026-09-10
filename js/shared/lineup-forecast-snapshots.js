// Stable, browser-local baselines for submitted-lineup scoring comparisons.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    function createStore(storage) {
        const memory = new Map();
        const valid = item => item && Number.isFinite(item.points) && Number.isFinite(item.capturedAt) && ['pregame', 'first-view'].includes(item.kind);
        const keyFor = (league, week) => 'wr.lineup-forecast.v1:' + encodeURIComponent(String(league?.league_id || league?.id || '')) + ':' + encodeURIComponent(String(league?.season || '')) + ':' + Number(week);
        function read(league, week) {
            const key = keyFor(league, week);
            if (memory.has(key)) return memory.get(key);
            let stored = {};
            try { stored = JSON.parse(storage?.getItem(key) || '{}'); } catch (_) {}
            const players = {};
            Object.entries(stored && typeof stored === 'object' ? stored : {}).forEach(([pid, item]) => { if (valid(item)) players[pid] = item; });
            const result = { players, persistent: !!storage };
            memory.set(key, result);
            return result;
        }
        function capture({ league, week, projections, statuses, now = Date.now() }) {
            const previous = read(league, week), players = { ...previous.players };
            let changed = false;
            Object.entries(projections || {}).forEach(([pid, points]) => {
                if (!pid || pid === '0' || players[pid] || !Number.isFinite(points)) return;
                // Wait for NFL metadata before classifying first-view versus pregame.
                const status = statuses?.[pid];
                if (!['upcoming', 'live', 'final', 'locked'].includes(status)) return;
                players[pid] = { points, capturedAt: now, kind: status === 'upcoming' ? 'pregame' : 'first-view' };
                changed = true;
            });
            if (!changed) return previous;
            let persistent = false;
            try { if (storage) { storage.setItem(keyFor(league, week), JSON.stringify(players)); persistent = true; } } catch (_) {}
            const result = { players, persistent };
            memory.set(keyFor(league, week), result);
            return result;
        }
        return { read, capture };
    }
    let storage;
    try { storage = root.localStorage; } catch (_) {}
    App.LineupForecastSnapshots = { createStore, ...createStore(storage) };
})(typeof window !== 'undefined' ? window : globalThis);
