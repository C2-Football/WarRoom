/* A view is data, never generated HTML or code. */
(function () {
    'use strict';
    window.WR = window.WR || {};
    function format(value, field) {
        if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return 'Unavailable';
        if (field?.type === 'number') {
            if (field.unit === 'percent') return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(value / 100);
            return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
        }
        if (field?.type === 'date') {
            const date = new Date(value);
            return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        }
        return String(value);
    }
    function DashboardDataView({ widget, context }) {
        const data = window.WR.DashboardViewData;
        const view = widget.view;
        const { display, x, y, appearance, ...query } = view;
        const result = data.resolve(query, context);
        const fields = result.fields || [];
        const rows = result.rows || [];
        const xField = fields.find(field => field.id === x);
        const yField = fields.find(field => field.id === y);
        const dataset = data.catalog().find(item => item.id === view.source);
        const labelFor = id => dataset?.fields.find(field => field.id === id)?.label || id;
        const filterCopy = (view.filters || []).map(filter => labelFor(filter.field) + ' ' + ({ eq: 'is', neq: 'is not', gt: 'above', gte: 'at least', lt: 'below', lte: 'at most', contains: 'includes', in: 'in', not_in: 'not in', isMissing: 'is unavailable', isPresent: 'is available' }[filter.op] || filter.op) + (filter.value == null ? '' : ' ' + (Array.isArray(filter.value) ? filter.value.join(', ') : filter.value))).join(' · ');
        const aggregation = view.aggregate ? ({ count: 'Count', sum: 'Total', avg: 'Average', min: 'Minimum', max: 'Maximum' }[view.aggregate.op] + (view.aggregate.field ? ' ' + labelFor(view.aggregate.field) : '') + (view.groupBy ? ' by ' + labelFor(view.groupBy) : '')) : '';
        const provenance = typeof result.source === 'string' ? result.source : result.source?.label || dataset?.label;
        const table = <div className="alex-data-scroll" data-alex-scroll="true" tabIndex={0} role="region" aria-label={widget.title + ' data table'}>
            <table><caption className="alex-data-sr-only">{widget.title}</caption><thead><tr>{fields.map(field => <th key={field.id} scope="col">{field.label}</th>)}</tr></thead>
                <tbody>{rows.map((row, index) => <tr key={index}>{fields.map(field => <td key={field.id} className={field.type === 'number' ? 'alex-data-number' : ''}>{format(row[field.id], field)}</td>)}</tr>)}</tbody>
            </table>
        </div>;
        const finite = rows.map(row => row[y]).filter(value => typeof value === 'number' && Number.isFinite(value));
        const min = Math.min(0, ...finite), max = Math.max(0, ...finite);
        const range = max - min || 1;
        const baseline = -min / range * 100;
        return <section className={'alex-data-view alex-data-' + (appearance?.accent || 'gold') + ' alex-data-' + (appearance?.density || 'comfortable')} aria-label={widget.title} data-view-display={display}>
            <header><span className="alex-data-kicker">{dataset?.label || 'League data'}</span><h3>{widget.title}</h3>
                {(aggregation || filterCopy) && <p>{[aggregation, filterCopy].filter(Boolean).join(' · ')}</p>}
            </header>
            {result.status !== 'ready' ? <p className="alex-data-empty" role="status">{result.note || (result.status === 'empty' ? 'No records match this view.' : 'This data is unavailable right now.')}</p> : <div className="alex-data-body">
                {display === 'table' && <>{fields.length > 3 && <p className="alex-data-table-hint">Scroll across to see all columns →</p>}{table}</>}
                {display === 'metric' && <div className="alex-data-metric"><strong>{format(rows[0]?.[y], yField)}</strong><span>{yField?.label || 'Value'}</span></div>}
                {display === 'cards' && <div className="alex-data-cards">{rows.map((row, index) => <dl key={index}>{fields.map(field => <div key={field.id}><dt>{field.label}</dt><dd>{format(row[field.id], field)}</dd></div>)}</dl>)}</div>}
                {display === 'bar' && <div className="alex-data-bars" role="list" aria-label={(yField?.label || 'Value') + ' by ' + (xField?.label || 'label')}>
                    {rows.map((row, index) => {
                        const value = row[y];
                        const known = typeof value === 'number' && Number.isFinite(value);
                        return <div key={index} role="listitem" className="alex-data-bar-row">
                            <div className="alex-data-bar-label"><span>{format(row[x], xField)}</span><strong>{format(value, yField)}</strong></div>
                            <div className="alex-data-bar-track" aria-hidden="true"><i className="alex-data-zero" style={{ left: baseline + '%' }} />{known && <i className="alex-data-bar" style={{ left: (value < 0 ? (value - min) / range * 100 : baseline) + '%', width: (Math.abs(value) / range * 100) + '%' }} />}</div>
                        </div>;
                    })}
                </div>}
            </div>}
            <footer>{provenance || dataset?.label}{result.source?.season ? ' · ' + result.source.season : ''}{result.status === 'ready' && <> · {rows.length} {view.aggregate ? 'result' : 'record'}{rows.length === 1 ? '' : 's'}{rows.length === view.limit ? ' shown (limit ' + view.limit + ')' : ''}</>}{result.status === 'ready' && result.note && <span>{result.note}</span>}</footer>
        </section>;
    }
    window.WR.DashboardDataView = DashboardDataView;
})();
