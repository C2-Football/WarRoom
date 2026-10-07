/* Shared, account-scoped mobile player columns. Values always come from the caller's league context. */
(function (root) {
    'use strict';
    const definitions = [
        { key: 'proj', label: 'PROJ', name: 'Weekly projection' },
        { key: 'ppg', label: 'L5 PPG', name: 'Last five games PPG' },
        { key: 'dhq', label: 'VALUE', name: 'League player value' },
        { key: 'age', label: 'AGE', name: 'Age' },
        { key: 'season', label: 'SZN PPG', name: 'Season points per game' },
        { key: 'bye', label: 'BYE', name: 'Bye week' },
        { key: 'matchup', label: 'MATCH', name: 'Matchup grade' },
    ];
    const defaults = ['proj', 'ppg', 'dhq', 'age'];
    const memory = new Map();
    function normalize(value) {
        const valid = [...new Set(Array.isArray(value) ? value : [])].filter(key => definitions.some(d => d.key === key)).slice(0, 4);
        return valid.length >= 3 ? valid : defaults.slice();
    }
    function scope(accountId, leagueId) {
        return 'wr-player-metrics-v1:' + encodeURIComponent(accountId || 'local') + ':' + encodeURIComponent(leagueId || 'league');
    }
    function read(key) {
        if (memory.has(key)) return normalize(memory.get(key));
        try { const saved = root.localStorage.getItem(key); if (saved) return normalize(JSON.parse(saved)); } catch (_) { /* session fallback */ }
        return normalize(memory.get(key));
    }
    function write(key, values) {
        const selected = normalize(values);
        memory.set(key, selected);
        let persistent = true;
        try { root.localStorage.setItem(key, JSON.stringify(selected)); } catch (_) { persistent = false; }
        root.dispatchEvent?.(new root.CustomEvent('wr:player-metrics', { detail: { key } }));
        return { selected, persistent };
    }
    function useMetrics(accountId, leagueId) {
        const React = root.React;
        const key = scope((root.App?.OD || root.OD)?.getCurrentUserId?.() || accountId, leagueId);
        const [saved, setSaved] = React.useState(() => ({ key, selected: read(key), persistent: true }));
        React.useEffect(() => {
            const refresh = event => {
                if (event?.type === 'storage') { if (event.key && event.key !== key) return; memory.delete(key); }
                if (!event?.detail?.key || event.detail.key === key) setSaved({ key, selected: read(key), persistent: true });
            };
            root.addEventListener('wr:player-metrics', refresh);
            root.addEventListener('storage', refresh);
            return () => { root.removeEventListener('wr:player-metrics', refresh); root.removeEventListener('storage', refresh); };
        }, [key]);
        return { selected: saved.key === key ? saved.selected : read(key), persistent: saved.key !== key || saved.persistent,
            setSelected: values => setSaved({ key, ...write(key, values) }) };
    }
    function slots(selected, values) {
        return normalize(selected).map(key => {
            const def = definitions.find(d => d.key === key), raw = values?.[key];
            const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
            const value = n !== null ? ['proj', 'ppg', 'season'].includes(key) ? n.toFixed(1) : key === 'dhq' ? Math.round(n).toLocaleString('en-US') : String(n) : typeof raw === 'string' && raw ? raw : '—';
            return { key, label: def.label, value, tone: value === '—' ? 'mute' : undefined };
        });
    }
    function Picker({ preference }) {
        const React = root.React, h = React.createElement;
        const [open, setOpen] = React.useState(false);
        const { selected, setSelected } = preference;
        return h('div', { className: 'mc-metric-picker' },
            h('button', { type: 'button', className: 'mc-columns-button', onClick: () => setOpen(!open), 'aria-expanded': open }, 'Columns · ' + selected.length),
            open && h('section', { className: 'mc-metric-options', 'aria-label': 'Player columns' },
                h('p', null, 'Choose 3 or 4 stats. Shared across player lists in this league.'),
                h('div', { className: 'mc-metric-order' }, selected.map((key, index) => h('div', { key },
                    h('span', null, definitions.find(d => d.key === key).name),
                    h('button', { type: 'button', disabled: index === 0, 'aria-label': 'Move ' + key + ' left', onClick: () => { const next = selected.slice(); [next[index - 1], next[index]] = [next[index], next[index - 1]]; setSelected(next); } }, '←'),
                    h('button', { type: 'button', disabled: index === selected.length - 1, 'aria-label': 'Move ' + key + ' right', onClick: () => { const next = selected.slice(); [next[index + 1], next[index]] = [next[index], next[index + 1]]; setSelected(next); } }, '→')))),
                definitions.map(def => h('label', { key: def.key }, h('input', { type: 'checkbox', checked: selected.includes(def.key), disabled: selected.includes(def.key) ? selected.length === 3 : selected.length === 4,
                    onChange: () => setSelected(selected.includes(def.key) ? selected.filter(key => key !== def.key) : [...selected, def.key]) }), def.name)),
                !preference.persistent && h('p', { role: 'status' }, 'Saved for this visit. Device storage is unavailable.'),
                h('button', { type: 'button', onClick: () => setSelected(defaults) }, 'Reset columns'),
                h('button', { type: 'button', onClick: () => setOpen(false) }, 'Done')));
    }
    const api = { definitions, defaults, normalize, scope, read, write, useMetrics, slots, Picker };
    root.WR = root.WR || {};
    root.WR.PlayerMetrics = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
