/* global module */
/* Shared, account-scoped mobile player columns. Values always come from the caller's league context. */
(function (root) {
    'use strict';
    const definitions = [
        { key: 'proj', title: 'Projection', label: 'PROJ', name: 'Weekly projection' },
        { key: 'ppg', title: 'Last 5 PPG', label: 'L5 PPG', name: 'Last five games PPG' },
        { key: 'dhq', title: 'Player value', label: 'VALUE', name: 'League player value' },
        { key: 'age', title: 'Age', label: 'AGE', name: 'Age' },
        { key: 'season', title: 'Season PPG', label: 'SZN PPG', name: 'Season points per game' },
        { key: 'bye', title: 'Bye week', label: 'BYE', name: 'Bye week' },
        { key: 'matchup', title: 'Matchup grade', label: 'MATCH', name: 'Matchup grade' },
    ];
    const defaults = ['proj', 'ppg', 'dhq', 'age'];
    const memory = new Map(), persistence = new Map();
    let pickerSerial = 0;
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
        persistence.set(key, persistent);
        root.dispatchEvent?.(new root.CustomEvent('wr:player-metrics', { detail: { key, persistent } }));
        return { selected, persistent };
    }
    function useMetrics(accountId, leagueId) {
        const React = root.React;
        const key = scope((root.App?.OD || root.OD)?.getCurrentUserId?.() || accountId, leagueId);
        const currentKey = React.useRef(key);
        currentKey.current = key;
        const [saved, setSaved] = React.useState(() => ({ key, selected: read(key), persistent: persistence.get(key) !== false }));
        React.useEffect(() => {
            const refresh = event => {
                if (event?.type === 'storage') { if (event.key && event.key !== key) return; memory.delete(key); persistence.delete(key); }
                if (!event?.detail?.key || event.detail.key === key) setSaved({ key, selected: read(key), persistent: persistence.get(key) !== false });
            };
            root.addEventListener('wr:player-metrics', refresh);
            root.addEventListener('storage', refresh);
            return () => { root.removeEventListener('wr:player-metrics', refresh); root.removeEventListener('storage', refresh); };
        }, [key]);
        return { key, selected: saved.key === key ? saved.selected : read(key), persistent: saved.key === key ? saved.persistent : persistence.get(key) !== false,
            setSelected: values => {
                // A handler retained across an account/league change must never write its old scope.
                if (currentKey.current !== key) return;
                setSaved({ key, ...write(key, values) });
            } };
    }
    function slots(selected, values) {
        return normalize(selected).map(key => {
            const def = definitions.find(d => d.key === key), raw = values?.[key];
            const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
            const value = n !== null ? ['proj', 'ppg', 'season'].includes(key) ? n.toFixed(1) : key === 'dhq' ? Math.round(n).toLocaleString('en-US') : String(n) : typeof raw === 'string' && raw ? raw : '—';
            return { key, label: def.label, value, tone: value === '—' ? 'mute' : undefined };
        });
    }
    function numericValue(value) {
        if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }
    function gradeValue(value) {
        const number = numericValue(value);
        if (number !== null) return number;
        const grades = ['F', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'];
        const index = typeof value === 'string' ? grades.indexOf(value.trim().toUpperCase().replace(/−/g, '-')) : -1;
        return index < 0 ? null : index;
    }
    function compareValues(a, b, dir = -1, options = {}) {
        const type = options.type || (options.text ? 'text' : 'number');
        const textValue = value => typeof value === 'string' && value.trim() && !['—', '--', '-'].includes(value.trim()) ? value.trim() : null;
        const reader = type === 'text' ? textValue : type === 'grade' ? gradeValue : numericValue;
        const av = reader(a), bv = reader(b);
        if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
        const difference = type === 'text' ? av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true }) : av - bv;
        return difference * (dir === 1 ? 1 : -1);
    }
    function defaultDirection(key) {
        return ['name', 'age', 'bye', 'team', 'pos', 'owner'].includes(key) ? 1 : -1;
    }
    function nextSort(sort, key) {
        return { key, dir: sort?.key === key ? (sort.dir === 1 ? -1 : 1) : defaultDirection(key) };
    }
    function SortButton({ columnKey, label, title, sort, onSort, className = '', style, disabled = false }) {
        const h = root.React.createElement;
        const active = sort?.key === columnKey;
        const direction = sort?.dir === 1 ? 'ascending' : 'descending';
        const definition = definitions.find(item => item.key === columnKey);
        const name = title || definition?.name || label || columnKey;
        if (disabled || typeof onSort !== 'function') return h('span', { className: 'mc-sort-static ' + className, style, title: name }, label);
        return h('button', { type: 'button', className: 'mc-sort-button' + (active ? ' is-active' : '') + (className ? ' ' + className : ''), style,
            title: name, 'aria-pressed': active, 'aria-label': 'Sort by ' + name + (active ? '; currently ' + direction + ', activate to reverse' : ''),
            onClick: event => { event.stopPropagation(); onSort(columnKey); } },
            h('span', { className: 'mc-sort-label' }, label),
            h('span', { className: 'mc-sort-arrow', 'aria-hidden': 'true' }, active ? sort.dir === 1 ? '↑' : '↓' : '↕'));
    }
    function SortHeader({ columns = [], sort, onSort, className = '', style, nameKey = 'name', nameLabel = 'Player', nameControl, groupMetrics = false }) {
        const h = root.React.createElement;
        const metrics = columns.map(column => h(SortButton, { key: column.key, columnKey: column.key, label: column.label, title: column.title, sort, onSort, disabled: column.sortable === false }));
        return h('div', { className: 'mc-player-sort-header' + (className ? ' ' + className : ''), style: { '--mc-sort-columns': columns.length, ...style } },
            nameControl || h(SortButton, { columnKey: nameKey, label: nameLabel, title: nameLabel, sort, onSort, className: 'mc-sort-player' }),
            groupMetrics ? h('div', { className: 'mc-sort-metrics' }, metrics) : metrics);
    }
    function move(selected, key, to) {
        const next = normalize(selected), from = next.indexOf(key);
        if (from < 0 || !Number.isInteger(to) || to < 0 || to >= next.length) return next;
        next.splice(from, 1);
        next.splice(to, 0, key);
        return next;
    }
    function toggle(selected, key) {
        const next = normalize(selected);
        if (!definitions.some(def => def.key === key)) return next;
        if (next.includes(key)) return next.length > 3 ? next.filter(value => value !== key) : next;
        return next.length < 4 ? [...next, key] : next;
    }
    function Picker({ preference }) {
        const React = root.React, h = React.createElement;
        const vp = root.WR?.useViewport ? root.WR.useViewport() : { isPhone: false };
        const [openedScope, setOpenedScope] = React.useState(null);
        const [preview, setPreview] = React.useState(null);
        const [announcement, setAnnouncement] = React.useState('');
        const pickerRef = React.useRef(null), listRef = React.useRef(null), triggerRef = React.useRef(null);
        const handles = React.useRef({}), drag = React.useRef(null), focusAfterMove = React.useRef(null);
        const id = React.useRef(null);
        if (!id.current) id.current = 'mc-player-columns-' + (++pickerSerial);
        const selected = normalize(preference.selected), signature = selected.join('|');
        const key = preference.key || 'player-columns';
        const open = openedScope === key;
        const current = React.useRef(null);
        current.current = { key, signature, selected, preference, open };
        function cancelDrag(update = true) {
            const session = drag.current;
            drag.current = null;
            if (session) {
                try { if (session.handle.hasPointerCapture?.(session.pointerId)) session.handle.releasePointerCapture(session.pointerId); } catch (_) { /* capture can already be released */ }
            }
            if (update) setPreview(null);
        }
        function close() {
            cancelDrag();
            setOpenedScope(null);
            if (!vp.isPhone) triggerRef.current?.focus({ preventScroll: true });
        }
        const useLayout = React.useLayoutEffect || React.useEffect;
        useLayout(() => {
            if (drag.current && (drag.current.key !== key || drag.current.signature !== signature || !open)) cancelDrag();
            if (focusAfterMove.current) {
                if (focusAfterMove.current.key === key) handles.current[focusAfterMove.current.metric]?.focus({ preventScroll: true });
                focusAfterMove.current = null;
            }
        }, [key, signature, open]);
        React.useEffect(() => {
            cancelDrag();
            setOpenedScope(null);
        }, [key, vp.isPhone]);
        React.useEffect(() => () => cancelDrag(false), []);
        React.useEffect(() => {
            if (!open) return;
            const onBlur = () => { if (drag.current) cancelDrag(); };
            const onKey = event => { if (event.key === 'Escape') close(); };
            const onOutside = event => { if (!pickerRef.current?.contains(event.target)) close(); };
            root.addEventListener('blur', onBlur);
            root.addEventListener('resize', onBlur);
            root.addEventListener('scroll', onBlur, true);
            // Phone focus trapping, backdrop dismissal and scroll locking belong to the shared sheet.
            if (!vp.isPhone) {
                root.document?.addEventListener('keydown', onKey);
                root.document?.addEventListener('pointerdown', onOutside);
            }
            return () => {
                root.removeEventListener('blur', onBlur);
                root.removeEventListener('resize', onBlur);
                root.removeEventListener('scroll', onBlur, true);
                root.document?.removeEventListener('keydown', onKey);
                root.document?.removeEventListener('pointerdown', onOutside);
            };
        }, [open, vp.isPhone]);
        function save(next, movedKey) {
            const now = current.current;
            cancelDrag();
            if (!now.open) return;
            if (next.join('|') === now.signature) return;
            if (movedKey) {
                focusAfterMove.current = { key: now.key, metric: movedKey };
                const name = definitions.find(def => def.key === movedKey).name;
                setAnnouncement(name + ', column ' + (next.indexOf(movedKey) + 1) + ' of ' + next.length + '.');
            }
            now.preference.setSelected(next);
        }
        function moveBy(metric, amount) {
            const now = current.current;
            save(move(now.selected, metric, now.selected.indexOf(metric) + amount), metric);
        }
        function startDrag(event, metric) {
            if (drag.current || event.isPrimary === false || (event.button != null && event.button !== 0)) return;
            const now = current.current;
            if (!now.open || !now.selected.includes(metric)) return;
            const nodes = Array.from(listRef.current?.querySelectorAll('[data-metric-selected="true"]') || []);
            const rects = nodes.map(node => node.getBoundingClientRect());
            if (rects.length !== now.selected.length) return;
            event.preventDefault();
            const handle = event.currentTarget;
            handle.focus({ preventScroll: true });
            drag.current = { key: now.key, signature: now.signature, metric, pointerId: event.pointerId, handle, rects,
                from: now.selected.indexOf(metric), to: now.selected.indexOf(metric), startY: event.clientY, moved: false };
            try { handle.setPointerCapture(event.pointerId); } catch (_) { /* keyboard buttons remain available when capture is unsupported */ }
        }
        function updateDrag(event) {
            const session = drag.current, now = current.current;
            if (!session || event.pointerId !== session.pointerId) return;
            if (!now.open || session.key !== now.key || session.signature !== now.signature) { cancelDrag(); return; }
            event.preventDefault();
            if (!session.moved && Math.abs(event.clientY - session.startY) < 6) return;
            session.moved = true;
            const centers = session.rects.map(rect => rect.top + rect.height / 2);
            session.to = centers.reduce((best, center, index) => Math.abs(event.clientY - center) < Math.abs(event.clientY - centers[best]) ? index : best, 0);
            setPreview({ metric: session.metric, to: session.to, offset: event.clientY - session.startY });
        }
        function finishDrag(event) {
            const session = drag.current, now = current.current;
            if (!session || event.pointerId !== session.pointerId) return;
            updateDrag(event);
            const first = session.rects[0], last = session.rects[session.rects.length - 1];
            const inside = event.clientY >= first.top && event.clientY <= last.bottom && event.clientX >= first.left && event.clientX <= first.right;
            const valid = now.open && session.key === now.key && session.signature === now.signature && session.moved && inside;
            cancelDrag();
            if (valid) save(move(now.selected, session.metric, session.to), session.metric);
        }
        function onGripKey(event, metric) {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                moveBy(metric, event.key === 'ArrowUp' ? -1 : 1);
            } else if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault();
                save(move(current.current.selected, metric, event.key === 'Home' ? 0 : current.current.selected.length - 1), metric);
            }
        }
        function rowStyle(metric, index) {
            const session = drag.current;
            if (!preview || !session || index < 0) return undefined;
            let offset = 0;
            if (metric === preview.metric) offset = preview.offset;
            else if (session.from < preview.to && index > session.from && index <= preview.to) offset = session.rects[index - 1].top - session.rects[index].top;
            else if (session.from > preview.to && index >= preview.to && index < session.from) offset = session.rects[index + 1].top - session.rects[index].top;
            return { transform: 'translateY(' + offset + 'px)' };
        }
        const ordered = [...selected, ...definitions.map(def => def.key).filter(metric => !selected.includes(metric))];
        const content = h('section', { className: 'mc-metric-editor', 'aria-label': 'Choose and order player columns' },
            !vp.isPhone && h('h2', { className: 'mc-metric-title' }, 'Player columns'),
            h('p', { id: id.current + '-help', className: 'mc-metric-help' },
                h('strong', null, selected.length + ' of 4 selected'),
                h('span', null, selected.length === 4 ? 'Remove one to swap. Keep at least 3.' : 'Add one more, or keep these 3.'),
                h('span', null, 'Drag selected stats or use the arrows to order.')),
            h('ul', { ref: listRef, className: 'mc-metric-list', 'aria-label': 'Stats in column order', 'aria-describedby': id.current + '-help' },
                ordered.map(metric => {
                    const def = definitions.find(item => item.key === metric), index = selected.indexOf(metric), active = index !== -1;
                    return h('li', { key: metric, 'data-metric-key': metric, 'data-metric-selected': active ? 'true' : 'false',
                        className: 'mc-metric-row' + (active ? ' is-selected' : ' is-available') + (preview?.metric === metric ? ' is-dragging' : ''), style: rowStyle(metric, index) },
                        h('label', { className: 'mc-metric-choice' },
                            h('input', { type: 'checkbox', checked: active, disabled: active ? selected.length === 3 : selected.length === 4,
                                'aria-label': def.name, onChange: () => save(toggle(current.current.selected, metric)) }),
                            h('span', { className: 'mc-metric-name', title: def.name }, def.title)),
                        active && h('div', { className: 'mc-metric-controls' },
                            h('button', { type: 'button', className: 'mc-metric-grip', ref: node => { handles.current[metric] = node; },
                                'aria-label': 'Reorder ' + def.name + ', column ' + (index + 1) + '. Use up or down arrow keys.',
                                'aria-keyshortcuts': 'ArrowUp ArrowDown Home End',
                                onPointerDown: event => startDrag(event, metric), onPointerMove: updateDrag, onPointerUp: finishDrag,
                                onPointerCancel: event => { if (drag.current?.pointerId === event.pointerId) cancelDrag(); },
                                onLostPointerCapture: event => { if (drag.current?.pointerId === event.pointerId) cancelDrag(); },
                                onKeyDown: event => onGripKey(event, metric) },
                                h('span', { 'aria-hidden': 'true', className: 'mc-metric-grip-dots' }, '⠿')),
                            h('button', { type: 'button', className: 'mc-metric-step', disabled: index === 0,
                                'aria-label': 'Move ' + def.name + ' up', onClick: () => moveBy(metric, -1) }, h('span', { 'aria-hidden': 'true' }, '↑')),
                            h('button', { type: 'button', className: 'mc-metric-step', disabled: index === selected.length - 1,
                                'aria-label': 'Move ' + def.name + ' down', onClick: () => moveBy(metric, 1) }, h('span', { 'aria-hidden': 'true' }, '↓'))));
                })),
            h('p', { className: 'mc-metric-scope' }, 'Shared across player lists in this league.'),
            !preference.persistent && h('p', { className: 'mc-metric-storage', role: 'status' }, 'Saved for this visit. Device storage is unavailable.'),
            h('span', { className: 'mc-metric-announcement', 'aria-live': 'polite', 'aria-atomic': 'true' }, announcement));
        const footer = h('div', { className: 'mc-metric-footer' },
            h('button', { type: 'button', onClick: () => save(defaults.slice()) }, 'Reset'),
            h('button', { type: 'button', className: 'mc-metric-done', onClick: close }, 'Done'));
        return h('div', { ref: pickerRef, className: 'mc-metric-picker' },
            h('button', { ref: triggerRef, type: 'button', className: 'mc-columns-button', 'aria-haspopup': 'dialog', 'aria-expanded': open,
                onClick: () => { if (open) close(); else { setAnnouncement(''); setOpenedScope(key); } } }, 'Columns · ' + selected.length),
            vp.isPhone && root.WR?.FilterSheet
                ? h(root.WR.FilterSheet, { open, onClose: close, title: 'Player columns', sections: [{ node: content }], footer })
                : open && h('section', { className: 'mc-metric-popover', role: 'dialog', 'aria-label': 'Player columns' }, content, footer));
    }
    const api = { definitions, defaults, normalize, scope, read, write, useMetrics, slots, numericValue, gradeValue, compareValues, defaultDirection, nextSort, SortButton, SortHeader, move, toggle, Picker };
    root.WR = root.WR || {};
    root.WR.PlayerMetrics = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
