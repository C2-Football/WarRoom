/* global React */
// The shared draft-board interactions from Dynasty HQ, with game-owned data
// and actions. Adapters supply public rows; this component never loads players.
(function (root) {
    'use strict';
    const App = root.App = root.App || {}, h = React.createElement;
    const text = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const present = value => value !== null && value !== undefined && value !== '' && !(typeof value === 'number' && !Number.isFinite(value));
    const optionOf = option => typeof option === 'string' ? { value: option, label: option === 'SUPER_FLEX' ? 'Superflex' : option, positions: [option] } : option;
    const safeString = value => typeof value === 'string' ? value.slice(0, 240) : '';
    const idsOnly = value => Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && id.length <= 240))].slice(0, 3) : [];
    const preferences = value => ({ sortKey: safeString(value?.sortKey) || 'rank', direction: value?.direction === 'desc' ? 'desc' : 'asc', position: safeString(value?.position), queueOnly: value?.queueOnly === true, showDrafted: value?.showDrafted === true, density: value?.density === 'compact' ? 'compact' : 'comfortable', hiddenColumns: Array.isArray(value?.hiddenColumns) ? [...new Set(value.hiddenColumns.filter(key => typeof key === 'string' && key.length <= 80))].slice(0, 30) : [] });
    const research = value => ({ compareIds: idsOnly(value?.compareIds), inspectorId: safeString(value?.inspectorId), query: safeString(value?.query) });
    const storageKey = (kind, key) => typeof key === 'string' && key && key.length <= 500 ? `wr-draft-${kind}-v1:${key}` : '';
    function readSaved(key, sanitize, fallback) {
        if (!key) return sanitize(fallback);
        try { const value = JSON.parse(root.localStorage.getItem(key)); return sanitize(value && typeof value === 'object' ? value : fallback); } catch (_) { return sanitize(fallback); }
    }
    function writeSaved(key, value) { if (key) try { root.localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* Preferences still work for this visit. */ } }
    const renderedValue = (row, column) => column.render ? column.render(row) : present(column.getValue(row)) ? String(column.getValue(row)) : '—';
    function scoutingDetails(row, scoutingForRow, omitMetrics = false) {
        const info = scoutingForRow?.(row);
        if (!info) return null;
        const scalar = value => typeof value === 'string' || typeof value === 'number' && Number.isFinite(value) ? value : '—';
        return h('div', { className: 'game-draft-scouting' },
            info.subtitle && h('p', { className: 'game-draft-scout-subtitle' }, scalar(info.subtitle)),
            info.summary && h('p', null, scalar(info.summary)),
            info.reason && h('p', null, h('strong', null, 'Roster fit: '), scalar(info.reason)),
            info.confidence && h('p', { className: 'game-draft-confidence' }, h('strong', null, 'Evidence: '), scalar(info.confidence)),
            !omitMetrics && Array.isArray(info.metrics) && h('dl', null, info.metrics.slice(0, 12).map((metric, index) => h('div', { key: index }, h('dt', null, scalar(metric.label)), h('dd', null, scalar(metric.value))))));
    }
    function comparisonCards({ rows, columns, scoutingForRow, onSelect, onRemove }) {
        return h('div', { className: 'game-draft-comparison-scroll', role: 'region', tabIndex: 0, 'aria-label': 'Side-by-side player comparison' }, h('div', { className: 'game-draft-comparison-grid', style: { '--compare-count': Math.max(1, rows.length) } }, rows.map(row => h('article', { key: row.id },
            h('button', { type: 'button', className: 'game-draft-player-link', onClick: event => onSelect?.(row, event) }, row.name), h('small', null, row.position, row.drafted ? ' · Drafted' : ''),
            h('dl', null, columns.map(column => h('div', { key: column.key }, h('dt', null, column.label), h('dd', null, renderedValue(row, column))))), scoutingDetails(row, scoutingForRow, true),
            h('button', { type: 'button', 'aria-label': `Remove ${row.name} from comparison`, onClick: () => onRemove(row) }, 'Remove')))));
    }
    // Reuses the draft comparison on a roster/lineup without mounting a board.
    // Values always come from this render's authorized rows, never storage.
    function GamePlayerComparison({ rows = [], columns = [], scoutingForRow, workspaceKey = '', onSelect, title = 'Compare players', selectedIds, onChange, showPicker = true }) {
        const key = storageKey('research', workspaceKey);
        const [saved, setSaved] = React.useState(() => ({ key, value: readSaved(key, research, {}) }));
        const value = saved.key === key ? saved.value : readSaved(key, research, {});
        const ids = selectedIds === undefined ? value.compareIds : idsOnly(selectedIds);
        const [focusHeading, setFocusHeading] = React.useState(false), heading = React.useRef(null);
        React.useEffect(() => { if (focusHeading) { heading.current?.focus(); setFocusHeading(false); } }, [focusHeading]);
        const change = next => {
            const safe = idsOnly(next), updated = research({ compareIds: safe });
            if (selectedIds === undefined) { setSaved({ key, value: updated }); writeSaved(key, updated); }
            onChange?.(safe);
        };
        const toggle = row => { const id = String(row.id); if (ids.includes(id)) change(ids.filter(item => item !== id)); else if (ids.length < 3) change([...ids, id]); };
        const byId = new Map(rows.map(row => [String(row.id), row])), selected = ids.map(id => byId.get(id)).filter(Boolean);
        return h('section', { className: 'game-draft-board game-player-comparison', 'aria-label': title },
            h('div', { className: 'game-draft-comparison' },
                h('header', null, h('h4', { ref: heading, tabIndex: -1 }, title), h('span', { role: 'status' }, `${ids.length}/3 selected`), ids.length > 0 && h('button', { type: 'button', onClick: () => { change([]); setFocusHeading(true); } }, 'Clear comparison')),
                showPicker && h('details', { className: 'game-player-comparison-picker' }, h('summary', null, ids.length ? 'Change players' : 'Choose up to three players'),
                    h('div', null, rows.map(row => h('button', { key: row.id, type: 'button', 'aria-label': `Compare ${row.name}`, 'aria-pressed': ids.includes(String(row.id)), disabled: !ids.includes(String(row.id)) && ids.length >= 3, onClick: () => toggle(row) }, row.name, h('small', null, row.position))))),
                ids.length > selected.length && h('p', { role: 'status' }, 'Some selections are outside this view. ', h('button', { type: 'button', onClick: () => change(selected.map(row => String(row.id))) }, 'Remove selections outside this view')),
                selected.length ? comparisonCards({ rows: selected, columns, scoutingForRow, onSelect, onRemove: row => { toggle(row); setFocusHeading(true); } }) : h('p', { className: 'game-draft-context' }, 'Choose two or three players to compare the same game measures side by side.')));
    }
    function viewRows(rows, { query = '', position = '', positions = [], queueOnly = false, queuedIds = [], showDrafted = false, sortKey = 'rank', direction = 'asc', columns = [] } = {}) {
        const queue = new Set(Array.from(queuedIds, String)), term = text(query.trim());
        const selectedPosition = positions.map(optionOf).find(option => option.value === position);
        const column = columns.find(item => item.key === sortKey);
        const valueOf = row => column ? column.getValue(row) : row[sortKey];
        const indexed = rows.map((row, index) => ({ ...row, rank: row.rank ?? index + 1 }));
        return indexed.filter(row => (showDrafted || !row.drafted)
            && (!queueOnly || queue.has(String(row.id)))
            && (!selectedPosition || (selectedPosition.positions || [selectedPosition.value]).includes(row.position))
            && (!term || text([row.name, row.position, row.detail, row.searchText].filter(Boolean).join(' ')).includes(term)))
            .sort((left, right) => {
                const a = valueOf(left), b = valueOf(right), aPresent = present(a), bPresent = present(b);
                // Missing observations always stay last, including descending.
                if (aPresent !== bPresent) return aPresent ? -1 : 1;
                const comparison = !aPresent ? 0 : typeof a === 'number' && typeof b === 'number'
                    ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
                return comparison * (direction === 'desc' ? -1 : 1) || left.rank - right.rank || String(left.id).localeCompare(String(right.id));
            });
    }
    function GameDraftTable({ rows = [], columns = [], positionOptions = [], selectedId, onSelect, queuedIds = [], onToggleQueue, onDraft,
        draftLabel = 'Draft', filterControls, title = 'Available players', statusText, emptyText = 'No players match these filters.',
        pageSize = 24, defaultSort = 'rank', query: controlledQuery, onQueryChange, className = '', hasExternalFilters = false, onClearFilters, externalFilterKey = '',
        preferenceKey = '', workspaceKey = '', scoutingForRow, enableComparison = true, countNoun = 'available', restoreQuery = false }) {
        const prefKey = storageKey('preferences', preferenceKey), workKey = storageKey('research', workspaceKey);
        const defaults = { sortKey: defaultSort, direction: columns.find(column => column.key === defaultSort)?.defaultDirection || 'asc' };
        const [preferenceState, setPreferences] = React.useState(() => ({ key: prefKey, value: readSaved(prefKey, preferences, defaults) }));
        const prefs = preferenceState.key === prefKey ? preferenceState.value : readSaved(prefKey, preferences, defaults);
        const updatePreferences = patch => { const value = preferences({ ...prefs, ...patch }); setPreferences({ key: prefKey, value }); writeSaved(prefKey, value); };
        const { position, sortKey, direction, queueOnly, showDrafted } = prefs;
        const setPosition = value => updatePreferences({ position: value }), setDirection = value => updatePreferences({ direction: value });
        const setQueueOnly = value => updatePreferences({ queueOnly: value }), setShowDrafted = value => updatePreferences({ showDrafted: value });
        const [researchState, setResearch] = React.useState(() => ({ key: workKey, value: readSaved(workKey, research, {}) }));
        const workspace = researchState.key === workKey ? researchState.value : readSaved(workKey, research, {});
        const updateResearch = patch => { const value = research({ ...workspace, ...patch }); setResearch({ key: workKey, value }); writeSaved(workKey, value); };
        const inspectorRef = React.useRef(null), compareRef = React.useRef(null), compareLauncher = React.useRef(null), scoutTrigger = React.useRef(null);
        const [focusTarget, setFocusTarget] = React.useState('');
        React.useEffect(() => { if (focusTarget) { (focusTarget === 'compare' ? compareRef.current || compareLauncher.current : inspectorRef.current)?.focus(); setFocusTarget(''); } }, [focusTarget]);
        const [limit, setLimit] = React.useState(pageSize);
        const query = controlledQuery ?? workspace.query;
        const setQuery = value => { updateResearch({ query: value }); onQueryChange?.(value); };
        const hydratedWorkspace = React.useRef(null);
        React.useEffect(() => {
            if (!restoreQuery || hydratedWorkspace.current === workKey) return;
            hydratedWorkspace.current = workKey;
            if (controlledQuery !== undefined) onQueryChange?.(workspace.query);
        }, [workKey, restoreQuery]);
        const allColumns = [
            { key: 'rank', label: 'Rank', getValue: row => row.rank },
            { key: 'name', label: 'Player', getValue: row => row.name },
            { key: 'position', label: 'Pos', getValue: row => row.position },
            ...columns,
        ];
        const activeSort = allColumns.some(column => column.key === sortKey) ? sortKey : 'rank';
        const visibleColumns = columns.filter(column => !prefs.hiddenColumns.includes(column.key));
        const headerColumns = allColumns.filter(column => ['rank', 'name', 'position'].includes(column.key) || !prefs.hiddenColumns.includes(column.key));
        const activePosition = positionOptions.map(optionOf).some(option => option.value === position) ? position : '';
        const queue = new Set(Array.from(queuedIds, String));
        const filtered = viewRows(rows, { query, position: activePosition, positions: positionOptions, queueOnly, queuedIds, showDrafted, sortKey: activeSort, direction, columns: allColumns });
        const visible = filtered.slice(0, limit);
        const hasDrafted = rows.some(row => row.drafted);
        const activeFilters = Boolean(query || activePosition || queueOnly || showDrafted || hasExternalFilters);
        React.useEffect(() => { setLimit(pageSize); }, [query, activePosition, queueOnly, showDrafted, activeSort, direction, pageSize, externalFilterKey]);
        function changeSort(key) {
            updatePreferences({ sortKey: key, direction: key === activeSort ? direction === 'asc' ? 'desc' : 'asc' : allColumns.find(column => column.key === key)?.defaultDirection || 'asc' });
        }
        function clear() {
            setQuery(''); updatePreferences({ position: '', queueOnly: false, showDrafted: false }); onClearFilters?.();
        }
        const stop = (callback, row) => event => { event.stopPropagation(); callback?.(row, event); };
        const currentRows = new Map(rows.map(row => [String(row.id), row]));
        const compareRows = workspace.compareIds.map(id => currentRows.get(id)).filter(Boolean);
        const inspector = scoutingForRow ? currentRows.get(workspace.inspectorId) : null;
        const toggleCompare = row => {
            const id = String(row.id), found = workspace.compareIds.includes(id);
            if (!found && workspace.compareIds.length >= 3) return;
            updateResearch({ compareIds: found ? workspace.compareIds.filter(value => value !== id) : [...workspace.compareIds, id] });
        };
        const openCard = (row, event) => { scoutTrigger.current = event?.currentTarget; if (scoutingForRow) updateResearch({ inspectorId: String(row.id) }); onSelect?.(row, event); };
        const inspect = (row, event) => { scoutTrigger.current = event?.currentTarget; updateResearch({ inspectorId: String(row.id) }); setFocusTarget('inspector'); };
        const closeInspector = () => { updateResearch({ inspectorId: '' }); scoutTrigger.current?.focus?.(); };
        const scouting = row => scoutingDetails(row, scoutingForRow);
        const compareButton = row => enableComparison && h('button', { type: 'button', className: 'game-draft-compare-toggle', 'aria-label': `${workspace.compareIds.includes(String(row.id)) ? 'Remove' : 'Compare'} ${row.name}${workspace.compareIds.includes(String(row.id)) ? ' from comparison' : ''}`, 'aria-pressed': workspace.compareIds.includes(String(row.id)), disabled: !workspace.compareIds.includes(String(row.id)) && workspace.compareIds.length >= 3, title: 'Compare up to three players', onClick: stop(toggleCompare, row) }, workspace.compareIds.includes(String(row.id)) ? '✓ Compare' : 'Compare');
        return h('section', { className: 'game-draft-board ' + className + ' game-draft-density-' + prefs.density, 'aria-label': title },
            h('header', { className: 'game-draft-heading' }, h('h3', null, title), h('span', { role: 'status' }, `${filtered.length} ${queueOnly ? 'queued' : showDrafted ? 'players' : countNoun}${query || activePosition || hasExternalFilters ? ' matching' : ''}`)),
            h('div', { className: 'game-draft-tools' },
                h('label', { className: 'game-draft-search' }, h('span', null, 'Search'), h('input', { type: 'search', 'aria-label': 'Search draft players', placeholder: 'Search players…', value: query, onChange: event => setQuery(event.target.value) })),
                h('label', null, h('span', null, 'Position'), h('select', { 'aria-label': 'Draft position', value: activePosition, onChange: event => setPosition(event.target.value) },
                    h('option', { value: '' }, 'All positions'), positionOptions.map(optionOf).map(option => h('option', { key: option.value, value: option.value }, option.label)))),
                h('label', { className: 'game-draft-sort-picker' }, h('span', null, 'Sort by'), h('select', { 'aria-label': 'Sort draft players', value: activeSort, onChange: event => { const key = event.target.value; updatePreferences({ sortKey: key, direction: allColumns.find(column => column.key === key)?.defaultDirection || 'asc' }); } },
                    allColumns.map(column => h('option', { key: column.key, value: column.key }, column.label)))),
                h('button', { type: 'button', className: 'game-draft-direction', 'aria-label': `Sort ${direction === 'asc' ? 'descending' : 'ascending'}`, title: direction === 'asc' ? 'Ascending; click to reverse' : 'Descending; click to reverse', onClick: () => setDirection(direction === 'asc' ? 'desc' : 'asc') }, direction === 'asc' ? '↑' : '↓'),
                filterControls),
            h('div', { className: 'game-draft-visibility' },
                onToggleQueue && h('button', { type: 'button', 'aria-pressed': queueOnly, onClick: () => setQueueOnly(!queueOnly) }, `★ My queue (${queue.size})`),
                hasDrafted && h('button', { type: 'button', 'aria-pressed': showDrafted, onClick: () => setShowDrafted(!showDrafted) }, showDrafted ? 'Hide drafted' : 'Show drafted'),
                activeFilters && h('button', { type: 'button', onClick: clear }, 'Clear filters'),
                enableComparison && h('button', { type: 'button', ref: compareLauncher, 'aria-disabled': !workspace.compareIds.length, onClick: () => { if (workspace.compareIds.length) setFocusTarget('compare'); } }, `Compare (${workspace.compareIds.length}/3)`),
                h('details', { className: 'game-draft-preferences' }, h('summary', null, 'View options'),
                    h('div', null, h('label', null, 'Row spacing', h('select', { 'aria-label': 'Draft row spacing', value: prefs.density, onChange: event => updatePreferences({ density: event.target.value }) }, h('option', { value: 'comfortable' }, 'Comfortable'), h('option', { value: 'compact' }, 'Compact'))),
                        columns.map(column => h('label', { key: column.key }, h('input', { type: 'checkbox', checked: !prefs.hiddenColumns.includes(column.key), onChange: event => updatePreferences({ hiddenColumns: event.target.checked ? prefs.hiddenColumns.filter(key => key !== column.key) : [...prefs.hiddenColumns, column.key] }) }), column.label)),
                        h('button', { type: 'button', onClick: () => updatePreferences({ ...defaults, density: 'comfortable', hiddenColumns: [], position: '', queueOnly: false, showDrafted: false }) }, 'Reset view'))),
                h('span', null, 'Select a player to open their card')),
            statusText && h('p', { className: 'game-draft-context' }, statusText),
            enableComparison && workspace.compareIds.length > 0 && h('section', { className: 'game-draft-comparison', 'aria-label': 'Player comparison' },
                h('header', null, h('h4', { ref: compareRef, tabIndex: -1 }, `Compare players · ${workspace.compareIds.length}/3`), h('button', { type: 'button', onClick: () => { updateResearch({ compareIds: [] }); setFocusTarget('compare'); } }, 'Clear comparison')),
                h('p', { className: 'game-draft-context' }, 'Compare the same public archive measures. A range of possible seasons is not a probability.'),
                compareRows.length < workspace.compareIds.length && h('p', { role: 'status' }, 'Some selections are outside this board view. ', h('button', { type: 'button', onClick: () => updateResearch({ compareIds: compareRows.map(row => String(row.id)) }) }, 'Remove selections outside this view')),
                comparisonCards({ rows: compareRows, columns, scoutingForRow, onSelect: openCard, onRemove: row => { toggleCompare(row); setFocusTarget('compare'); } })),
            h('div', { className: 'game-draft-workspace' + (inspector ? ' has-inspector' : '') },
            h('div', { className: 'game-draft-list' },
            h('div', { className: 'game-draft-table-scroll', role: 'region', tabIndex: 0, 'aria-label': 'Draft player table' },
                h('table', { className: 'game-draft-table' },
                    h('thead', null, h('tr', null, headerColumns.map(column => h('th', { key: column.key, scope: 'col', 'aria-sort': activeSort === column.key ? direction === 'asc' ? 'ascending' : 'descending' : 'none', className: 'game-draft-col-' + column.key },
                        h('button', { type: 'button', title: column.title || `Sort by ${column.label}`, onClick: () => changeSort(column.key) }, column.label, activeSort === column.key ? direction === 'asc' ? ' ↑' : ' ↓' : ''))),
                        (onToggleQueue || onDraft || enableComparison || scoutingForRow) && h('th', { scope: 'col', className: 'game-draft-col-actions' }, 'Actions'))),
                    h('tbody', null, visible.map(row => {
                        const queued = queue.has(String(row.id)), label = typeof draftLabel === 'function' ? draftLabel(row) : draftLabel;
                        return h('tr', { key: row.id, className: (String(selectedId) === String(row.id) || workspace.inspectorId === String(row.id) ? 'is-selected ' : '') + (row.drafted ? 'is-drafted' : ''), onClick: event => openCard(row, event) },
                            h('td', { className: 'game-draft-col-rank', 'data-label': 'Rank' }, row.rank),
                            h('td', { className: 'game-draft-col-name' }, h('button', { type: 'button', className: 'game-draft-player-link', onClick: stop(openCard, row), 'aria-label': `Open player card for ${row.name}` }, row.name),
                                row.detail && h('small', null, row.detail), row.drafted && h('small', { className: 'game-draft-drafted-label' }, row.draftedBy ? `Drafted · ${row.draftedBy}` : 'Drafted')),
                            h('td', { className: 'game-draft-col-position', 'data-label': 'Pos' }, h('span', { className: 'game-draft-position game-draft-position-' + row.position }, row.position === 'DEF' ? 'D/ST' : row.position)),
                            visibleColumns.map(column => h('td', { key: column.key, className: 'game-draft-metric game-draft-col-' + column.key, 'data-label': column.label, title: column.title }, renderedValue(row, column))),
                            (onToggleQueue || onDraft || enableComparison || scoutingForRow) && h('td', { className: 'game-draft-row-actions' },
                                scoutingForRow && h('button', { type: 'button', className: 'game-draft-inspect', 'aria-label': `Quick scout ${row.name}`, onClick: stop(inspect, row) }, 'Quick scout'),
                                compareButton(row),
                                onToggleQueue && h('button', { type: 'button', className: 'game-draft-queue', 'aria-label': `${queued ? 'Remove' : 'Queue'} ${row.name}${queued ? ' from queue' : ''}`, 'aria-pressed': queued, disabled: Boolean(row.drafted && !queued), onClick: stop(onToggleQueue, row) }, queued ? '★' : '☆'),
                                onDraft && h('button', { type: 'button', className: 'game-draft-pick', disabled: row.canDraft !== true || Boolean(row.drafted), 'aria-label': `${label} ${row.name}`, title: row.draftDisabledReason || undefined, onClick: stop((value, event) => { if (value.canDraft === true && !value.drafted) onDraft(value, event); }, row) }, row.drafted ? 'Drafted' : label)));
                    })))),
            !filtered.length && h('div', { className: 'game-draft-empty', role: 'status' }, queueOnly && !queue.size ? 'Your queue is empty. Star a player to add them.' : emptyText, activeFilters && h('button', { type: 'button', onClick: clear }, 'Clear filters')),
            filtered.length > visible.length && h('button', { type: 'button', className: 'game-draft-more', onClick: () => setLimit(value => value + pageSize) }, `Show ${Math.min(pageSize, filtered.length - visible.length)} more players · ${filtered.length - visible.length} remaining`)),
            inspector && h('aside', { className: 'game-draft-inspector', 'aria-label': 'Scouting inspector' }, h('header', null, h('h4', { ref: inspectorRef, tabIndex: -1 }, inspector.name), h('button', { type: 'button', 'aria-label': 'Close scouting inspector', onClick: closeInspector }, '✕')), h('small', null, inspector.position, inspector.drafted ? ' · Drafted' : ''), scouting(inspector),
                h('button', { type: 'button', onClick: event => onSelect?.(inspector, event) }, 'Open full player card'), compareButton(inspector))));
    }
    App.GameDraftTable = GameDraftTable;
    App.GamePlayerComparison = GamePlayerComparison;
    App.GameDraftTableModel = { viewRows, preferences, research, storageKey };
})(window);
