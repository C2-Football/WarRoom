// ══════════════════════════════════════════════════════════════════
// js/components/commish-command-panel.js — window.WrCommishCommandPanel
//
// COMMAND — the Commissioner's Office landing view. Five bands, top to
// bottom, in the order a commissioner actually thinks:
//   1. THE READ    — one sentence + four numbers. What kind of day is it?
//   2. NEEDS YOU   — the hero. Every open item across every league you
//                    commission, ranked by severity. This is the product.
//   3. THE GRID    — league × domain. Where the trouble is concentrated.
//   4. THE DESKS   — the twelve rooms, each with its worst number.
//   5. footer      — how the office found your leagues, and what it won't do.
//
// Pure render layer, same contract as every other commish-* panel: numbers
// arrive via props (App.Commish triage/KPI/grid/desk builders), the only
// side effects are the two callbacks. No fetching, no engine calls — the
// container owns load order, this file owns how it reads.
//
//   <WrCommishCommandPanel queue={buildQueue(...)} kpis={...} grid={...}
//                          desks={[...]} filter={filter}
//                          onOpenHub={fn} onFilter={fn} phone={bool} />
//
// TOKENS — the office ladder (CO_* customs defined on the office shell).
// The older season-odds/network idiom reached for --panel / --ov-4 / --text /
// --k-*, every one of which is UNDEFINED in this app; this file uses the CO_*
// ladder with literal fallbacks and never emits rgba(), opacity, gradients,
// shadows or backdrop-filter. Every tint below is a pre-blended solid hex.
//
// TYPE — six roles + a lede, and a number never shares size OR weight with
// its own label (two size steps and 100 weight apart, minimum). That rule is
// the whole reason the office reads as an instrument instead of a table dump.
// ══════════════════════════════════════════════════════════════════
function WrCommishCommandPanel({ queue, kpis, grid, desks, onOpenHub, onFilter, filter, phone, onSelectItem }) {
    // ── The ladder ───────────────────────────────────────────────────
    const PAGE = 'var(--co-page, #08080B)';
    const SURF = 'var(--co-surface, #121217)';
    const SURF2 = 'var(--co-surface-2, #1B1B22)';
    const SURF3 = 'var(--co-surface-3, #17171D)';
    const WELL = 'var(--co-well, #0F0F14)';
    const LINE = 'var(--co-line, #27262E)';
    const LINE_SOFT = 'var(--co-line-soft, #201F27)';
    const ACCENT = 'var(--co-accent, #5DADE2)';
    const ACCENT_FILL = 'var(--co-accent-fill, #12212B)';
    const ACCENT_LINE = 'var(--co-accent-line, #2B4B63)';
    const FILL_BAD = 'var(--co-fill-bad, #2A1512)';
    const FILL_WARN = 'var(--co-fill-warn, #2A2010)';
    const FILL_GOOD = 'var(--co-fill-good, #14281C)';
    const WHITE = 'var(--white, #F5F2EA)';
    const SILVER = 'var(--silver, #BDB8AD)';
    const GOLD = 'var(--gold, #D4AF37)';
    const GOOD = 'var(--good, #2ECC71)';
    const WARN = 'var(--warn, #F0A500)';
    const BAD = 'var(--bad, #E74C3C)';
    const MUTED = '#8D887E';   // the third text tier; --text-muted is a lie (= --silver)
    const DIM = '#4A463F';     // "nothing here" — quieter than muted, still legible
    const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
    const BODY = 'var(--font-body, "DM Sans", sans-serif)';
    const HEAD = 'var(--font-title, "Rajdhani", sans-serif)';

    // ── The six roles ────────────────────────────────────────────────
    // font shorthand first, longhands after — React assigns in key order, so
    // fontVariantNumeric survives the shorthand reset.
    const T = {
        display: { font: '700 2.25rem/1 ' + MONO, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', color: WHITE },
        metric: { font: '700 1.5rem/1 ' + MONO, fontVariantNumeric: 'tabular-nums', color: WHITE },
        metricSm: { font: '600 0.875rem/1 ' + MONO, fontVariantNumeric: 'tabular-nums', color: WHITE },
        title: { font: '700 0.9375rem/1 ' + HEAD, letterSpacing: '0.06em', textTransform: 'uppercase', color: WHITE },
        subject: { font: '600 0.875rem/1.3 ' + BODY, color: WHITE },
        body: { font: '400 0.8125rem/1.55 ' + BODY, maxWidth: '68ch', color: SILVER },
        label: { font: '700 0.6875rem/1 ' + MONO, letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED },
        chip: { font: '700 0.625rem/1 ' + MONO, letterSpacing: '0.08em', textTransform: 'uppercase' },
        lede: { font: '400 0.9375rem/1.5 ' + BODY, color: WHITE },
    };
    const ell = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
    const bare = { background: 'transparent', border: 'none', padding: 0, margin: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit' };

    // ── Props, defensively ───────────────────────────────────────────
    const q = queue || {};
    const items = Array.isArray(q.items) ? q.items : [];
    const counts = q.counts || { now: 0, soon: 0, backlog: 0 };
    const K = kpis || {};
    const needs = K.needsYou || { now: 0, soon: 0, backlog: 0 };
    const needsTotal = (needs.now || 0) + (needs.soon || 0) + (needs.backlog || 0);
    const G = grid || {};
    const gLeagues = Array.isArray(G.leagues) ? G.leagues : [];
    const gDomains = Array.isArray(G.domains) ? G.domains : [];
    const cellOf = typeof G.cell === 'function' ? G.cell : () => null;
    const deskList = Array.isArray(desks) ? desks : [];
    const f = filter || {};

    const [hovRow, setHovRow] = React.useState(null);
    const [hovCol, setHovCol] = React.useState(null);
    const [hovDesk, setHovDesk] = React.useState(null);
    const [hovTile, setHovTile] = React.useState(null);
    const [hovAct, setHovAct] = React.useState(null);
    const gridRef = React.useRef(null);

    const openHub = (hub, leagueId, extra) => {
        if (typeof onOpenHub !== 'function' || !hub) return;
        onOpenHub(hub, Object.assign({ leagueId: leagueId == null ? null : String(leagueId) }, extra || {}));
    };
    // Always emits the full shape so the container never has to merge.
    const emit = (patch) => {
        if (typeof onFilter !== 'function') return;
        onFilter(Object.assign({ tier: f.tier || null, leagueId: f.leagueId || null, domain: f.domain || null }, patch));
    };
    const clearFilter = () => emit({ tier: null, leagueId: null, domain: null });

    const sevColor = (s) => {
        const k = String(s || '').toUpperCase();
        if (k === 'NOW' || k === 'BAD' || k === 'CRITICAL') return BAD;
        if (k === 'SOON' || k === 'WARN' || k === 'WARNING') return WARN;
        if (k === 'BACKLOG' || k === 'INFO') return SILVER;
        if (k === 'CLEAR' || k === 'GOOD' || k === 'OK') return GOOD;
        return LINE;
    };

    // The container may hand back a pre-filtered queue or the whole thing;
    // re-applying the same predicate is idempotent either way.
    const visible = items.filter(it => {
        if (f.tier && it.tier !== f.tier) return false;
        if (f.domain && it.domain !== f.domain) return false;
        if (f.leagueId && !(it.leagueIds || []).map(String).includes(String(f.leagueId))) return false;
        return true;
    });

    if (!queue && !kpis && !grid && !desks) {
        return (
            <div style={{ background: SURF, border: '1px solid ' + LINE, borderRadius: '10px', padding: '16px' }}>
                <div style={T.body}>The office is still reading your leagues. Command fills in the moment the desk has something to rank.</div>
            </div>
        );
    }

    // ══ BAND 1 — THE READ ═════════════════════════════════════════════
    // NOTE — every piece below is a plain render FUNCTION, not a component
    // declared in the render body. A component defined inline gets a fresh
    // function identity on every render, so React tears down and rebuilds its
    // DOM node each time; with hover state driving those re-renders, the node
    // under the cursor is destroyed mid-hover and the enter/leave pair can
    // thrash. Returning elements directly keeps the host node stable.
    const renderTile = ({ label, value, unit, valueColor, valueRole, sub, accent, onClick, id, extra }) => (
        <button type="button" key={id} onClick={onClick} onMouseEnter={() => setHovTile(id)} onMouseLeave={() => setHovTile(null)}
            style={{
                ...bare, display: 'block', width: '100%', boxSizing: 'border-box',
                background: hovTile === id ? SURF3 : SURF2,
                border: '1px solid ' + LINE, borderTop: '2px solid ' + accent,
                borderRadius: '8px', padding: '12px 14px',
                minHeight: phone ? '96px' : undefined,
            }}>
            <div style={{ ...T.label, marginBottom: '12px' }}>{label}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', minWidth: 0 }}>
                <span style={{ ...(valueRole || T.display), color: valueColor || WHITE, ...ell, minWidth: 0 }}>{value}</span>
                {unit ? <span style={{ font: '600 0.9rem/1 ' + MONO, color: MUTED, marginLeft: '3px', flex: '0 0 auto' }}>{unit}</span> : null}
            </div>
            {extra ? <div style={{ marginTop: '8px' }}>{extra}</div> : null}
            {sub ? <div style={{ ...T.body, fontSize: '0.75rem', color: MUTED, maxWidth: 'none', marginTop: '8px', ...ell }}>{sub}</div> : null}
        </button>
    );

    const readiness = Array.isArray(K.readiness) ? K.readiness.slice(0, 4) : [];
    const nd = K.nextDate || null;
    // A long label ("SEP 4 · DRAFT") at 2.25rem overflows a 180px tile; drop it
    // one step rather than ellipsing a date into nonsense.
    const ndLong = nd && String(nd.label || '').length > 9;
    // Zero open items printed in red is a lie — an empty desk is a good day.
    const needsColor = needsTotal > 0 ? BAD : GOOD;

    const band1 = (
        <div style={{ background: SURF, border: '1px solid ' + LINE, borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ ...T.lede, padding: '16px 16px 12px' }}>
                {q.diagnosis || 'The office is quiet. Nothing is overdue, nothing is drifting, and no seat is empty.'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: phone ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', padding: '0 16px 16px' }}>
                {renderTile({
                    id: 't1', label: 'Under your gavel', accent: ACCENT,
                    value: K.leagues != null ? K.leagues : '—',
                    sub: (K.humans != null ? K.humans : '—') + ' humans · ' + (K.crossover != null ? K.crossover : 0) + ' in two of yours',
                    onClick: () => gridRef.current && gridRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }),
                })}
                {renderTile({
                    id: 't2', label: 'Needs you', accent: needsColor,
                    value: needsTotal, valueColor: needsColor,
                    sub: (needs.now || 0) + ' now · ' + (needs.soon || 0) + ' this week · ' + (needs.backlog || 0) + ' backlog',
                    onClick: clearFilter,
                })}
                {renderTile({
                    id: 't3', label: 'Opening day', accent: WARN,
                    value: K.readinessAvg != null ? K.readinessAvg : '—',
                    unit: K.readinessAvg != null ? '%' : null,
                    onClick: () => openHub('genesis', null),
                    extra: readiness.length ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + readiness.length + ', 1fr)', gap: '2px' }}>
                            {readiness.map((r, i) => (
                                <div key={r.leagueId || i}>
                                    <div style={{ height: '6px', background: SURF, borderRadius: '4px', overflow: 'hidden' }}>
                                        <i style={{ display: 'block', height: '100%', width: Math.max(0, Math.min(100, Number(r.pct) || 0)) + '%', background: ACCENT }} />
                                    </div>
                                    <div style={{ ...T.chip, color: MUTED, marginTop: '4px' }}>{String(r.tag || '').slice(0, 3)}</div>
                                </div>
                            ))}
                        </div>
                    ) : null,
                })}
                {renderTile({
                    id: 't4', label: 'Next date', accent: ACCENT,
                    value: nd ? nd.label : 'NONE SET',
                    valueRole: nd ? (ndLong ? T.metric : T.display) : T.metric,
                    valueColor: nd ? WHITE : WARN,
                    sub: nd ? nd.sub : 'No draft, no deadline, nothing on the board.',
                    onClick: () => openHub('ops', null),
                })}
            </div>
        </div>
    );

    // ══ BAND 2 — NEEDS YOU ════════════════════════════════════════════
    const TIERS = ['NOW', 'SOON', 'BACKLOG'];
    const tierCount = (t) => t === 'NOW' ? (counts.now || 0) : t === 'SOON' ? (counts.soon || 0) : (counts.backlog || 0);

    const renderPill = (t) => {
        const on = f.tier === t;
        return (
            <button type="button" key={t} onClick={() => emit({ tier: on ? null : t })}
                style={{
                    ...bare, display: 'flex', alignItems: 'center', gap: '8px',
                    background: on ? ACCENT_FILL : SURF2,
                    border: '1px solid ' + (on ? ACCENT : LINE), borderRadius: '4px',
                    padding: '0 8px', height: phone ? '44px' : '28px',
                }}>
                <span style={{ ...T.metricSm, color: sevColor(t) }}>{tierCount(t)}</span>
                <span style={{ ...T.chip, color: MUTED }}>{t}</span>
            </button>
        );
    };
    const renderLeagueChip = ({ id, tag, active, onClick }) => (
        <button type="button" key={id} onClick={onClick}
            style={{
                ...bare, background: active ? ACCENT_FILL : SURF2,
                border: '1px solid ' + (active ? ACCENT : LINE), borderRadius: '4px',
                padding: '0 8px', height: phone ? '44px' : '28px',
                ...T.chip, color: active ? ACCENT : SILVER,
                display: 'inline-flex', alignItems: 'center',
            }}>{tag}</button>
    );

    const whereChips = (it) => {
        const tags = (it.leagueTags && it.leagueTags.length ? it.leagueTags : (it.leagueNames || [])).map(s => String(s).slice(0, 3).toUpperCase());
        const shown = tags.slice(0, 2), rest = tags.length - shown.length;
        return (
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'nowrap', overflow: 'hidden' }}>
                {shown.map((t, i) => (
                    <span key={i} style={{ ...T.chip, color: SILVER, background: SURF2, border: '1px solid ' + LINE, borderRadius: '4px', padding: '4px 4px' }}>{t}</span>
                ))}
                {rest > 0 ? <span style={{ ...T.chip, color: MUTED }}>+{rest}</span> : null}
            </div>
        );
    };
    const renderAction = (it, full) => {
        // Never invent a verb — an item with no action gets an empty grid cell.
        if (!it.action || !it.action.label) return full ? null : <span />;
        const hov = hovAct === it.id;
        return (
            <button type="button"
                onClick={(e) => { e.stopPropagation(); openHub(it.hub, { leagueId: (it.leagueIds || [])[0] || null, action: it.action.kind || null }); }}
                onMouseEnter={() => setHovAct(it.id)} onMouseLeave={() => setHovAct(null)}
                style={{
                    ...bare, background: hov ? ACCENT_FILL : 'transparent', border: '1px solid ' + ACCENT_LINE, borderRadius: '6px',
                    color: ACCENT, ...T.chip, height: full ? '44px' : '28px', width: full ? '100%' : 'auto',
                    padding: '0 10px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>{it.action.label}</button>
        );
    };

    const ROW_COLS = '3px 60px minmax(0,1fr) 120px 92px 112px 20px';
    const renderRow = (it, last) => {
        const sc = sevColor(it.tier);
        const hov = hovRow === it.id;
        const mv = it.metric || {};
        const common = {
            cursor: 'pointer',
            background: hov ? SURF3 : 'transparent',
            outline: hov ? '1px solid ' + ACCENT : 'none', outlineOffset: '-1px',
            borderBottom: last ? 'none' : '1px solid ' + LINE_SOFT,
        };
        // The row opens the action drawer — that is where mark-done / skip /
        // hide live, and the drawer still offers the deep-link as its primary
        // button. The verb button beside it keeps navigating directly.
        const onRow = () => {
            if (typeof onSelectItem === 'function') { onSelectItem(it); return; }
            openHub(it.hub, { leagueId: (it.leagueIds || [])[0] || null });
        };
        const hoverProps = { onMouseEnter: () => setHovRow(it.id), onMouseLeave: () => setHovRow(null), onClick: onRow };

        if (phone) {
            return (
                <div key={it.id} {...hoverProps} style={{ ...common, display: 'flex', minHeight: '96px', boxSizing: 'border-box' }}>
                    <div style={{ width: '3px', background: sc, flex: '0 0 3px' }} />
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0 }}>
                                <span style={{ ...T.chip, color: sc }}>{it.tier}</span>
                                {mv.value != null ? (
                                    <span style={{ ...T.metricSm, color: mv.breach ? sc : WHITE }}>
                                        {mv.value}
                                        {mv.unit ? <span style={{ ...T.label, marginLeft: '4px' }}>{mv.unit}</span> : null}
                                    </span>
                                ) : null}
                            </div>
                            {whereChips(it)}
                        </div>
                        <div style={{ ...T.subject, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{it.headline}</div>
                        {(it.tier === 'NOW' || it.tier === 'SOON') ? renderAction(it, true) : null}
                    </div>
                </div>
            );
        }

        return (
            <div key={it.id} {...hoverProps} style={{ ...common, display: 'grid', gridTemplateColumns: ROW_COLS, alignItems: 'center', gap: '12px', padding: '10px 14px 10px 0' }}>
                {/* negative margins pull the rail through the row's own padding so
                    it reads as a full-height severity edge, not a dash */}
                <div style={{ alignSelf: 'stretch', margin: '-10px 0', background: sc }} />
                <div style={{ textAlign: 'center' }}>
                    <div style={{ ...T.chip, color: sc }}>{it.tier}</div>
                    <div style={{ ...T.label, marginTop: '4px' }}>{Math.round(Number(it.score) || 0)}</div>
                </div>
                <div style={{ minWidth: 0 }}>
                    {it.kicker ? <div style={{ ...T.label, marginBottom: '4px' }}>{it.kicker}</div> : null}
                    <div style={{ ...T.subject, ...ell }} title={it.headline || ''}>{it.headline}</div>
                    {it.detail ? <div style={{ ...T.body, fontSize: '0.75rem', color: MUTED, maxWidth: 'none', marginTop: '4px', ...ell }} title={it.detail}>{it.detail}</div> : null}
                </div>
                {whereChips(it)}
                <div>
                    {mv.value != null ? <div style={{ ...T.metricSm, color: mv.breach ? sc : WHITE }}>{mv.value}</div> : <div style={{ ...T.metricSm, color: DIM }}>—</div>}
                    {mv.unit ? <div style={{ ...T.label, marginTop: '4px' }}>{mv.unit}</div> : null}
                </div>
                {renderAction(it, false)}
                <div style={{ ...T.metricSm, color: MUTED, textAlign: 'center' }}>›</div>
            </div>
        );
    };

    const groups = TIERS.map(t => ({ tier: t, rows: visible.filter(it => it.tier === t) })).filter(g => g.rows.length);
    const filtered = !!(f.tier || f.leagueId || f.domain);

    const band2 = (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={T.title}>Needs you</span>
                    <span style={T.label}>· {visible.length} item{visible.length === 1 ? '' : 's'} · ranked by severity</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {TIERS.map(t => renderPill(t))}
                    <span style={{ width: '1px', height: '20px', background: LINE }} />
                    {renderLeagueChip({ id: '__all', tag: 'All', active: !f.leagueId, onClick: () => emit({ leagueId: null }) })}
                    {gLeagues.map(l => renderLeagueChip({
                        id: l.leagueId, tag: l.tag,
                        active: String(f.leagueId || '') === String(l.leagueId),
                        onClick: () => emit({ leagueId: String(f.leagueId || '') === String(l.leagueId) ? null : l.leagueId }),
                    }))}
                </div>
            </div>
            <div style={{ background: SURF, border: '1px solid ' + LINE, borderRadius: '10px', overflow: 'hidden', minHeight: '420px' }}>
                {groups.length ? groups.map(g => (
                    <React.Fragment key={g.tier}>
                        <div style={{ height: '28px', display: 'flex', alignItems: 'center', padding: '0 14px', background: WELL, borderBottom: '1px solid ' + LINE, ...T.label }}>
                            {g.tier} — {g.rows.length} item{g.rows.length === 1 ? '' : 's'}
                        </div>
                        {g.rows.map((it, i) => renderRow(it, i === g.rows.length - 1))}
                    </React.Fragment>
                )) : (
                    <div style={{ height: '120px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '0 16px', textAlign: 'center' }}>
                        {filtered && items.length ? (
                            <React.Fragment>
                                <div style={{ ...T.metric, color: SILVER }}>NO MATCH</div>
                                <div style={{ ...T.body, textAlign: 'center' }}>Nothing in this slice. Clear the filter to see all {items.length} open item{items.length === 1 ? '' : 's'}.</div>
                            </React.Fragment>
                        ) : (
                            <React.Fragment>
                                <div style={{ ...T.metric, color: GOOD }}>DESK CLEAR</div>
                                <div style={{ ...T.body, textAlign: 'center' }}>Nothing needs you right now. The office keeps watching — items appear here the moment a league drifts, a seat empties or a date closes in.</div>
                            </React.Fragment>
                        )}
                    </div>
                )}
            </div>
        </div>
    );

    // ══ BAND 3 — THE GRID ═════════════════════════════════════════════
    // Solid tints only — a translucent wash over 28 cells is how a grid turns
    // to mud. Each state owns one pre-blended hex.
    const CELL = {
        NOW: { bg: FILL_BAD, fg: BAD },
        SOON: { bg: FILL_WARN, fg: WARN },
        BACKLOG: { bg: SURF2, fg: SILVER },
        CLEAR: { bg: SURF, fg: DIM },
        NOT_YET: { bg: SURF, fg: DIM },
    };
    const gridCols = phone
        ? '140px repeat(' + (gDomains.length || 7) + ', 56px)'
        : '190px repeat(' + (gDomains.length || 7) + ', minmax(0,1fr))';
    const stickyCell = phone ? { position: 'sticky', left: 0, zIndex: 1, background: SURF } : null;

    const band3 = (
        <div ref={gridRef}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <span style={T.title}>The grid</span>
                <span style={T.label}>Cell = open items · click to filter · click a column to open the hub</span>
            </div>
            <div style={phone ? { overflowX: 'auto', WebkitOverflowScrolling: 'touch' } : null}>
                <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: '4px', minWidth: phone ? 'min-content' : undefined }}>
                    <div style={{ ...(stickyCell || {}) }} />
                    {gDomains.map(d => (
                        <button type="button" key={d.key} onClick={() => openHub(d.hub, null)}
                            onMouseEnter={() => setHovCol(d.key)} onMouseLeave={() => setHovCol(null)}
                            style={{
                                ...bare, ...T.label, lineHeight: 1.2, textAlign: 'center', alignSelf: 'end',
                                padding: '0 2px 8px', whiteSpace: 'normal', wordBreak: 'break-word',
                                color: hovCol === d.key ? ACCENT : MUTED,
                                textDecoration: hovCol === d.key ? 'underline' : 'none',
                            }}>{d.label}</button>
                    ))}

                    {gLeagues.map(l => (
                        <React.Fragment key={l.leagueId}>
                            <div style={{ height: '44px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px', minWidth: 0, paddingRight: '8px', ...(stickyCell || {}) }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                                    <span style={{ ...T.chip, color: MUTED, flex: '0 0 auto' }}>{l.tag}</span>
                                    <span style={{ ...T.subject, ...ell }} title={l.name || ''}>{l.name}</span>
                                </div>
                                <div style={T.label}>{l.pct != null ? l.pct + '% ready' : 'readiness —'}</div>
                            </div>
                            {gDomains.map(d => {
                                const c = cellOf(l.leagueId, d.key) || { n: 0, state: 'CLEAR' };
                                const st = CELL[c.state] || CELL.CLEAR;
                                const sel = String(f.leagueId || '') === String(l.leagueId) && f.domain === d.key;
                                const counted = c.state === 'NOW' || c.state === 'SOON' || c.state === 'BACKLOG';
                                return (
                                    <button type="button" key={d.key}
                                        onClick={() => emit({ leagueId: sel ? null : l.leagueId, domain: sel ? null : d.key })}
                                        title={l.name + ' · ' + d.label + (counted ? ' · ' + c.n + ' open' : c.state === 'NOT_YET' ? ' · nothing to read until Week 1' : ' · clear')}
                                        style={{
                                            ...bare, height: '44px', width: '100%', boxSizing: 'border-box',
                                            background: st.bg, border: '1px solid ' + LINE, borderRadius: '4px',
                                            outline: sel ? '1px solid ' + ACCENT : 'none', outlineOffset: '-1px',
                                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px',
                                        }}>
                                        <span style={{ ...T.metricSm, color: st.fg }}>{counted ? c.n : c.state === 'NOT_YET' ? '—' : '·'}</span>
                                        {counted ? <span style={{ ...T.chip, color: MUTED }}>open</span> : null}
                                        {c.state === 'NOT_YET' ? <span style={{ ...T.chip, color: MUTED }}>WK 1</span> : null}
                                    </button>
                                );
                            })}
                        </React.Fragment>
                    ))}
                </div>
            </div>
        </div>
    );

    // ══ BAND 4 — THE DESKS ════════════════════════════════════════════
    const DESK_GROUPS = ['OPEN THE SEASON', 'HOLD THE ROOM', 'THE BROADCAST'];
    const byGroup = DESK_GROUPS.map(name => ({ name, cards: deskList.filter(d => d.group === name) })).filter(g => g.cards.length);

    const renderDesk = (d, i, broadcast) => {
        const dormant = !!d.dormant || broadcast;
        const badge = dormant ? null : d.badge;
        const sc = badge && badge.n ? sevColor(badge.severity) : LINE;
        const key = d.hub + ':' + i;
        const hov = hovDesk === key;
        return (
            <div key={key} onClick={() => openHub(d.hub, null)} onMouseEnter={() => setHovDesk(key)} onMouseLeave={() => setHovDesk(null)}
                style={{
                    position: 'relative', height: '96px', boxSizing: 'border-box', cursor: 'pointer',
                    background: hov ? SURF3 : SURF, border: '1px solid ' + (hov ? ACCENT : LINE),
                    borderRadius: '8px', padding: '10px 12px',
                    display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden',
                }}>
                <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '3px', background: dormant ? LINE : sc }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <span style={{ ...T.label, ...ell }}>{d.name}</span>
                    {badge && badge.n ? (
                        <span style={{
                            ...T.chip, color: sevColor(badge.severity), background: SURF2, borderRadius: '4px',
                            minWidth: '18px', height: '18px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
                        }}>{badge.n}</span>
                    ) : null}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', minWidth: 0 }}>
                    <span style={{ ...T.metric, color: dormant ? MUTED : (badge && badge.n && d.statBreach ? sevColor(badge.severity) : WHITE), ...ell }}>
                        {dormant ? '—' : (d.stat != null && d.stat !== '' ? d.stat : '—')}
                    </span>
                    {!dormant && d.unit ? <span style={{ ...T.label }}>{d.unit}</span> : null}
                </div>
                <div style={{ ...T.body, fontSize: '0.75rem', color: MUTED, maxWidth: 'none', ...ell }} title={d.status || ''}>{d.status}</div>
            </div>
        );
    };

    const band4 = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {byGroup.map(g => {
                const broadcast = g.name === 'THE BROADCAST';
                const open = g.cards.reduce((s, d) => s + ((!d.dormant && !broadcast && d.badge && d.badge.n) || 0), 0);
                return (
                    <div key={g.name}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                            <span style={T.label}>{g.name}</span>
                            {broadcast ? <span style={{ ...T.chip, color: ACCENT, background: ACCENT_FILL, border: '1px solid ' + ACCENT_LINE, borderRadius: '4px', padding: '4px' }}>Wakes wk 1</span> : null}
                            <span style={{ flex: 1, height: '1px', background: LINE }} />
                            <span style={T.label}>{g.cards.length} desk{g.cards.length === 1 ? '' : 's'}{open ? ' · ' + open + ' open' : ''}</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: phone ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '12px' }}>
                            {g.cards.map((d, i) => renderDesk(d, i, broadcast))}
                        </div>
                    </div>
                );
            })}
        </div>
    );

    // ══ BAND 5 — the footer ═══════════════════════════════════════════
    // co-label type, but sentence case and lh 1.5: the string is a sentence
    // with punctuation, and uppercasing it at 0.1em tracking makes it shout.
    const band5 = (
        <div style={{ minHeight: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
            <span style={{ ...T.label, textTransform: 'none', lineHeight: 1.5 }}>
                Discovered from your Sleeper commissioner flag — nothing to configure. The office reads; it never writes to a platform.
            </span>
            {K.syncedLabel ? <span style={{ ...T.label, textTransform: 'none', lineHeight: 1.5 }}>{K.syncedLabel}</span> : null}
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '1240px', width: '100%', background: PAGE }}>
            {band1}
            {band2}
            {band3}
            {band4}
            {band5}
        </div>
    );
}

window.WrCommishCommandPanel = WrCommishCommandPanel;
