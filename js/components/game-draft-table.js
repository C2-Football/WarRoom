/* global React */
// The shared draft-board interactions from Dynasty HQ, with game-owned data
// and actions. Adapters supply public rows; this component never loads players.
(function (root) {
    'use strict';
    const App = root.App = root.App || {}, h = React.createElement;
    const text = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const present = value => value !== null && value !== undefined && value !== '' && !(typeof value === 'number' && !Number.isFinite(value));
    const optionOf = option => typeof option === 'string' ? { value: option, label: option === 'SUPER_FLEX' ? 'Superflex' : option, positions: [option] } : option;
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
        pageSize = 24, defaultSort = 'rank', query: controlledQuery, onQueryChange, className = '', hasExternalFilters = false, onClearFilters, externalFilterKey = '' }) {
        const [ownQuery, setOwnQuery] = React.useState(''), [position, setPosition] = React.useState('');
        const [sortKey, setSortKey] = React.useState(defaultSort), [direction, setDirection] = React.useState(() => columns.find(column => column.key === defaultSort)?.defaultDirection || 'asc');
        const [queueOnly, setQueueOnly] = React.useState(false), [showDrafted, setShowDrafted] = React.useState(false);
        const [limit, setLimit] = React.useState(pageSize);
        const query = controlledQuery ?? ownQuery;
        const setQuery = value => { setOwnQuery(value); onQueryChange?.(value); };
        const allColumns = [
            { key: 'rank', label: 'Rank', getValue: row => row.rank },
            { key: 'name', label: 'Player', getValue: row => row.name },
            { key: 'position', label: 'Pos', getValue: row => row.position },
            ...columns,
        ];
        const activeSort = allColumns.some(column => column.key === sortKey) ? sortKey : 'rank';
        const activePosition = positionOptions.map(optionOf).some(option => option.value === position) ? position : '';
        const queue = new Set(Array.from(queuedIds, String));
        const filtered = viewRows(rows, { query, position: activePosition, positions: positionOptions, queueOnly, queuedIds, showDrafted, sortKey: activeSort, direction, columns: allColumns });
        const visible = filtered.slice(0, limit);
        const hasDrafted = rows.some(row => row.drafted);
        const activeFilters = Boolean(query || activePosition || queueOnly || showDrafted || hasExternalFilters);
        React.useEffect(() => { setLimit(pageSize); }, [query, activePosition, queueOnly, showDrafted, activeSort, direction, pageSize, externalFilterKey]);
        function changeSort(key) {
            setSortKey(key);
            setDirection(key === activeSort ? direction === 'asc' ? 'desc' : 'asc' : allColumns.find(column => column.key === key)?.defaultDirection || 'asc');
        }
        function clear() {
            setQuery(''); setPosition(''); setQueueOnly(false); setShowDrafted(false); onClearFilters?.();
        }
        const stop = (callback, row) => event => { event.stopPropagation(); callback?.(row, event); };
        const renderedValue = (row, column) => column.render ? column.render(row) : present(column.getValue(row)) ? String(column.getValue(row)) : '—';
        return h('section', { className: 'game-draft-board ' + className, 'aria-label': title },
            h('header', { className: 'game-draft-heading' }, h('h3', null, title), h('span', { role: 'status' }, `${filtered.length} ${queueOnly ? 'queued' : showDrafted ? 'players' : 'available'}${query || activePosition || hasExternalFilters ? ' matching' : ''}`)),
            h('div', { className: 'game-draft-tools' },
                h('label', { className: 'game-draft-search' }, h('span', null, 'Search'), h('input', { type: 'search', 'aria-label': 'Search draft players', placeholder: 'Search players…', value: query, onChange: event => setQuery(event.target.value) })),
                h('label', null, h('span', null, 'Position'), h('select', { 'aria-label': 'Draft position', value: activePosition, onChange: event => setPosition(event.target.value) },
                    h('option', { value: '' }, 'All positions'), positionOptions.map(optionOf).map(option => h('option', { key: option.value, value: option.value }, option.label)))),
                h('label', { className: 'game-draft-sort-picker' }, h('span', null, 'Sort by'), h('select', { 'aria-label': 'Sort draft players', value: activeSort, onChange: event => { const key = event.target.value; setSortKey(key); setDirection(allColumns.find(column => column.key === key)?.defaultDirection || 'asc'); } },
                    allColumns.map(column => h('option', { key: column.key, value: column.key }, column.label)))),
                h('button', { type: 'button', className: 'game-draft-direction', 'aria-label': `Sort ${direction === 'asc' ? 'descending' : 'ascending'}`, title: direction === 'asc' ? 'Ascending; click to reverse' : 'Descending; click to reverse', onClick: () => setDirection(direction === 'asc' ? 'desc' : 'asc') }, direction === 'asc' ? '↑' : '↓'),
                filterControls),
            h('div', { className: 'game-draft-visibility' },
                onToggleQueue && h('button', { type: 'button', 'aria-pressed': queueOnly, onClick: () => setQueueOnly(!queueOnly) }, `★ My queue (${queue.size})`),
                hasDrafted && h('button', { type: 'button', 'aria-pressed': showDrafted, onClick: () => setShowDrafted(!showDrafted) }, showDrafted ? 'Hide drafted' : 'Show drafted'),
                activeFilters && h('button', { type: 'button', onClick: clear }, 'Clear filters'),
                h('span', null, 'Select a player to open their card')),
            statusText && h('p', { className: 'game-draft-context' }, statusText),
            h('div', { className: 'game-draft-table-scroll', role: 'region', tabIndex: 0, 'aria-label': 'Draft player table' },
                h('table', { className: 'game-draft-table' },
                    h('thead', null, h('tr', null, allColumns.map(column => h('th', { key: column.key, scope: 'col', 'aria-sort': activeSort === column.key ? direction === 'asc' ? 'ascending' : 'descending' : 'none', className: 'game-draft-col-' + column.key },
                        h('button', { type: 'button', title: column.title || `Sort by ${column.label}`, onClick: () => changeSort(column.key) }, column.label, activeSort === column.key ? direction === 'asc' ? ' ↑' : ' ↓' : ''))),
                        (onToggleQueue || onDraft) && h('th', { scope: 'col', className: 'game-draft-col-actions' }, 'Actions'))),
                    h('tbody', null, visible.map(row => {
                        const queued = queue.has(String(row.id)), label = typeof draftLabel === 'function' ? draftLabel(row) : draftLabel;
                        return h('tr', { key: row.id, className: (String(selectedId) === String(row.id) ? 'is-selected ' : '') + (row.drafted ? 'is-drafted' : ''), onClick: event => onSelect?.(row, event) },
                            h('td', { className: 'game-draft-col-rank', 'data-label': 'Rank' }, row.rank),
                            h('td', { className: 'game-draft-col-name' }, h('button', { type: 'button', className: 'game-draft-player-link', onClick: stop(onSelect, row), 'aria-label': `Open player card for ${row.name}` }, row.name),
                                row.detail && h('small', null, row.detail), row.drafted && h('small', { className: 'game-draft-drafted-label' }, row.draftedBy ? `Drafted · ${row.draftedBy}` : 'Drafted')),
                            h('td', { className: 'game-draft-col-position', 'data-label': 'Pos' }, h('span', { className: 'game-draft-position game-draft-position-' + row.position }, row.position === 'DEF' ? 'D/ST' : row.position)),
                            columns.map(column => h('td', { key: column.key, className: 'game-draft-metric game-draft-col-' + column.key, 'data-label': column.label, title: column.title }, renderedValue(row, column))),
                            (onToggleQueue || onDraft) && h('td', { className: 'game-draft-row-actions' },
                                onToggleQueue && h('button', { type: 'button', className: 'game-draft-queue', 'aria-label': `${queued ? 'Remove' : 'Queue'} ${row.name}${queued ? ' from queue' : ''}`, 'aria-pressed': queued, disabled: Boolean(row.drafted && !queued), onClick: stop(onToggleQueue, row) }, queued ? '★' : '☆'),
                                onDraft && h('button', { type: 'button', className: 'game-draft-pick', disabled: row.canDraft !== true || Boolean(row.drafted), 'aria-label': `${label} ${row.name}`, title: row.draftDisabledReason || undefined, onClick: stop((value, event) => { if (value.canDraft === true && !value.drafted) onDraft(value, event); }, row) }, row.drafted ? 'Drafted' : label)));
                    })))),
            !filtered.length && h('div', { className: 'game-draft-empty', role: 'status' }, queueOnly && !queue.size ? 'Your queue is empty. Star a player to add them.' : emptyText, activeFilters && h('button', { type: 'button', onClick: clear }, 'Clear filters')),
            filtered.length > visible.length && h('button', { type: 'button', className: 'game-draft-more', onClick: () => setLimit(value => value + pageSize) }, `Show ${Math.min(pageSize, filtered.length - visible.length)} more players · ${filtered.length - visible.length} remaining`));
    }
    App.GameDraftTable = GameDraftTable;
    App.GameDraftTableModel = { viewRows };
})(window);
