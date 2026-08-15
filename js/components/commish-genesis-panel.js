// ══════════════════════════════════════════════════════════════════
// js/components/commish-genesis-panel.js
//   window.WrCommishGenesisPanel — SEASON GENESIS: Opening-Day readiness,
//     every commissioned league on one wall, neediest first.
//   window.WrCommishRenewalPanel — RENEWAL FORECAST: who re-signs next
//     season, riskiest first, for the People wall.
//
//   <WrCommishGenesisPanel readiness onToggle />
//     readiness  App.Commish.Genesis.buildAll() → [{ leagueId, leagueName,
//                pct, items:[{id,label,kind:'auto'|'manual',done,detail}],
//                blockers:[labels worst-first] }] — ALREADY sorted lowest
//                pct first; this panel renders the order it is given.
//     onToggle(leagueId, itemId) — manual-checklist tap. The office owns
//                the Genesis.toggleManual call + rebuild; the panel never
//                writes storage and holds no done-state of its own.
//
//   <WrCommishRenewalPanel forecast />
//     forecast   App.Commish.Renewal.buildForecast() → { people:[...
//                riskiest first], summary:{safe,watch,atRisk},
//                forecastBasis:'activity_only'|'behavior+season' }
//
// Pure presentation — props + callbacks only, no fetching. Calm monochrome:
// gold for structure/active only. Each panel gets ONE decision column —
// the readiness pct (green ≥85 / gold ≥60 / amber below) on the Genesis
// wall, the probability percent (SAFE muted / WATCH amber / AT_RISK red)
// on the forecast. Everything else stays silver.
// ══════════════════════════════════════════════════════════════════

// ── SEASON GENESIS ───────────────────────────────────────────────────
function WrCommishGenesisPanel({ readiness, onToggle }) {
    const GOLD = 'var(--gold, #d4af37)', SILVER = 'var(--silver, #9aa0a6)', TEXT = 'var(--text, #e8e8ea)';
    const GREEN = 'var(--k-2ecc71, #2ecc71)', AMBER = 'var(--k-f0a500, #f0a500)';
    const MUTED = 'var(--text-muted, #8D887E)';
    const PANEL = 'var(--panel, #15151b)', LINE = 'var(--ov-4, rgba(255,255,255,0.08))';
    const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
    const mono = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' };
    const microHdr = { font: '600 var(--text-micro, 0.6875rem) ' + MONO, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase' };

    // Expansion is the panel's only state; done-state always comes back
    // down through `readiness` after the office re-runs the engine.
    const [open, setOpen] = React.useState({});
    const flip = lid => setOpen(o => ({ ...o, [lid]: !o[lid] }));

    const Section = ({ title, meta, children }) => (
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.72rem', letterSpacing: '0.08em', color: TEXT, fontWeight: 600, textTransform: 'uppercase' }}>{title}</span>
                {meta ? <span style={{ ...microHdr, textTransform: 'none', letterSpacing: 0 }}>{meta}</span> : null}
            </div>
            {children}
        </div>
    );

    // The engine's blocker labels are checklist-precise ("Settings ratified
    // (no unacknowledged drift)") — the Needs line wants terse. Known labels
    // map to short forms; anything unrecognized falls back to the label.
    const SHORT = {
        'Draft scheduled': 'draft date',
        'Settings ratified (no unacknowledged drift)': 'settings sign-off',
        'All seats filled': 'open seats',
        'Trade deadline set': 'trade deadline',
        'Rosters present': 'rosters',
        'Constitution on file': 'constitution',
        'Constitution re-ratified for the season': 're-ratification',
        'Dues noted (tracked outside DHQ)': 'dues note',
        'Welcome broadcast drafted': 'welcome post',
    };
    const needsLine = (blockers) => {
        const b = Array.isArray(blockers) ? blockers : [];
        if (!b.length) return null;
        const shown = b.slice(0, 3).map(l => SHORT[l] || l);
        const more = b.length - shown.length;
        return 'Needs: ' + shown.join(', ') + (more > 0 ? ' +' + more + ' more' : '');
    };
    // The one decision column on this wall — everything else is silver.
    const pctColor = pct => pct >= 85 ? GREEN : pct >= 60 ? GOLD : AMBER;

    const list = Array.isArray(readiness) ? readiness : null;
    const allReady = !!(list && list.length && list.every(r => r && r.pct === 100));
    const meta = list && list.length
        ? list.length + ' league' + (list.length === 1 ? '' : 's') + ' · ' + list.filter(r => r.pct === 100).length + ' ready'
        : null;

    return (
        <Section title="Season Setup" meta={meta}>
            <div style={{ color: TEXT, fontSize: '0.76rem', fontStyle: 'italic', lineHeight: 1.5, marginBottom: '10px' }}>
                Opening-Day readiness — the six weeks before the draft, on one wall.
            </div>
            {!list ? (
                <div style={{ color: TEXT, fontSize: '0.78rem' }}>The readiness scan hasn't run yet — it fills in once your commissioned leagues sync.</div>
            ) : !list.length ? (
                <div style={{ color: TEXT, fontSize: '0.78rem' }}>No commissioned leagues to score — connect a league you run and the wall lights up.</div>
            ) : allReady ? (
                <div style={{ background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.3)', borderRadius: '6px', padding: '9px 12px', color: GREEN, fontSize: '0.78rem' }}>
                    Every league is opening-day ready.
                </div>
            ) : list.map((r, i) => {
                const isOpen = !!open[r.leagueId];
                const needs = needsLine(r.blockers);
                const items = Array.isArray(r.items) ? r.items : [];
                return (
                    <div key={r.leagueId} style={{ background: 'var(--black, #121217)', border: `1px solid ${LINE}`, borderRadius: '6px', marginBottom: i === list.length - 1 ? 0 : '10px' }}>
                        <button onClick={() => flip(r.leagueId)} aria-expanded={isOpen}
                            style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', background: 'transparent', border: 'none', padding: '10px 12px', cursor: 'pointer', textAlign: 'left' }}>
                            <span style={{ ...mono, fontSize: '1.3rem', fontWeight: 700, color: pctColor(r.pct), minWidth: '58px' }}>{r.pct}%</span>
                            <span style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ display: 'block', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: '0.82rem', color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.leagueName}</span>
                                {needs ? (
                                    <span style={{ display: 'block', fontSize: '0.7rem', color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' }}>{needs}</span>
                                ) : (
                                    <span style={{ display: 'block', fontSize: '0.7rem', color: MUTED, marginTop: '1px' }}>Opening-day ready.</span>
                                )}
                            </span>
                            <span style={{ ...mono, fontSize: '0.72rem', color: MUTED, flexShrink: 0 }}>{isOpen ? '▾' : '▸'}</span>
                        </button>
                        {isOpen ? (
                            <div style={{ borderTop: `1px solid ${LINE}`, padding: '4px 12px 10px' }}>
                                {items.map((it, ii) => (
                                    <div key={it.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '9px', padding: '7px 0', borderBottom: ii === items.length - 1 ? 'none' : `1px solid ${LINE}` }}>
                                        {it.kind === 'manual' ? (
                                            <button onClick={() => { if (typeof onToggle === 'function') onToggle(r.leagueId, it.id); }}
                                                aria-pressed={it.done} title={it.done ? 'Mark not done' : 'Mark done'}
                                                style={{ width: '15px', height: '15px', flexShrink: 0, marginTop: '1px', background: 'transparent', border: '1px solid ' + (it.done ? 'rgba(212,175,55,0.7)' : LINE), borderRadius: '3px', color: GOLD, font: '700 0.6rem ' + MONO, lineHeight: '13px', padding: 0, cursor: 'pointer' }}>
                                                {it.done ? '✓' : ''}
                                            </button>
                                        ) : (
                                            // Auto item: read-only status dot — filled green when done,
                                            // hollow when the engine says this is still open.
                                            <i style={{ width: '9px', height: '9px', flexShrink: 0, marginTop: '4px', marginLeft: '3px', marginRight: '3px', borderRadius: '50%', display: 'inline-block', background: it.done ? GREEN : 'transparent', border: it.done ? 'none' : `1px solid ${SILVER}` }} />
                                        )}
                                        <span style={{ flex: 1, minWidth: 0 }}>
                                            <span style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'var(--font-body)', color: it.done ? SILVER : TEXT }}>{it.label}</span>
                                            {it.detail ? <span style={{ display: 'block', fontSize: '0.7rem', color: MUTED, lineHeight: 1.45, marginTop: '1px' }}>{it.detail}</span> : null}
                                        </span>
                                        {it.kind === 'manual' ? <span style={{ ...microHdr, flexShrink: 0, marginTop: '2px' }}>manual</span> : null}
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                );
            })}
        </Section>
    );
}

// ── RENEWAL FORECAST ─────────────────────────────────────────────────
function WrCommishRenewalPanel({ forecast }) {
    const GOLD = 'var(--gold, #d4af37)', SILVER = 'var(--silver, #9aa0a6)', TEXT = 'var(--text, #e8e8ea)';
    const RED = 'var(--k-e74c3c, #e74c3c)', AMBER = 'var(--k-f0a500, #f0a500)';
    const MUTED = 'var(--text-muted, #8D887E)';
    const PANEL = 'var(--panel, #15151b)', LINE = 'var(--ov-4, rgba(255,255,255,0.08))';
    const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
    const mono = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' };
    const microHdr = { font: '600 var(--text-micro, 0.6875rem) ' + MONO, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase' };

    // Transient "Copied" flash per play button (same idiom as the People wall).
    const [copiedKey, setCopiedKey] = React.useState(null);
    const copyTimer = React.useRef(null);
    React.useEffect(() => () => clearTimeout(copyTimer.current), []);
    const doCopy = (key, text) => {
        try { navigator.clipboard?.writeText(text).catch(() => { /* no clipboard on this surface — the text stays visible to copy by hand */ }); } catch (_) { /* same */ }
        setCopiedKey(key);
        clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopiedKey(k => (k === key ? null : k)), 1500);
    };

    const Section = ({ title, meta, children }) => (
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.72rem', letterSpacing: '0.08em', color: TEXT, fontWeight: 600, textTransform: 'uppercase' }}>{title}</span>
                {meta ? <span style={{ ...microHdr, textTransform: 'none', letterSpacing: 0 }}>{meta}</span> : null}
            </div>
            {children}
        </div>
    );
    const Kpi = ({ label, value, sub }) => (
        <div style={{ background: 'var(--black, #121217)', border: `1px solid ${LINE}`, borderRadius: '6px', padding: '9px 11px', minWidth: '104px', flex: 1 }}>
            <div style={{ ...microHdr }}>{label}</div>
            <div style={{ ...mono, fontSize: '1.3rem', fontWeight: 700, color: TEXT, marginTop: '2px' }}>{value}</div>
            {sub ? <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '1px' }}>{sub}</div> : null}
        </div>
    );

    // The one decision column: SAFE stays muted on purpose — a green wall of
    // "fine" is noise; only the people slipping away get color.
    const bandColor = b => b === 'AT_RISK' ? RED : b === 'WATCH' ? AMBER : MUTED;
    const bandLabel = b => b === 'AT_RISK' ? 'AT RISK' : (b || '');

    const people = Array.isArray(forecast?.people) ? forecast.people : null;
    const sum = forecast?.summary || {};
    const offseason = forecast?.forecastBasis === 'activity_only';
    // The engine prepends this exact honesty factor to EVERY person when the
    // read is activity-only; the lead caption already says it once, so the
    // per-row chip would be nine copies of the same sentence.
    const OFFSEASON_FACTOR = 'offseason read — behavior signals only';

    return (
        <Section title="Renewal Forecast" meta={forecast ? (offseason ? 'behavior signals' : 'behavior + season arc') : null}>
            {!forecast || !people ? (
                <div style={{ color: TEXT, fontSize: '0.78rem' }}>The forecast hasn't run yet — it builds from the member graph and the radar sweep.</div>
            ) : !people.length ? (
                <div style={{ color: TEXT, fontSize: '0.78rem' }}>Nobody to forecast — the member graph only has you in it so far.</div>
            ) : (
                <React.Fragment>
                    {offseason ? (
                        <div style={{ color: TEXT, fontSize: '0.76rem', fontStyle: 'italic', lineHeight: 1.5, marginBottom: '10px' }}>
                            Offseason read — behavior signals only. Season-arc factors arrive with Week 1.
                        </div>
                    ) : null}
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                        <Kpi label="Safe" value={sum.safe ?? 0} sub="75%+" />
                        <Kpi label="Watch" value={sum.watch ?? 0} sub="50–74%" />
                        <Kpi label="At risk" value={sum.atRisk ?? 0} sub="under 50%" />
                    </div>
                    {people.map((p, i) => {
                        const factors = (p.factors || []).filter(f => f !== OFFSEASON_FACTOR);
                        const plays = Array.isArray(p.plays) ? p.plays : [];
                        const col = bandColor(p.band);
                        return (
                            <div key={p.userId} style={{ padding: '9px 0', borderBottom: i === people.length - 1 ? 'none' : `1px solid ${LINE}` }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                    <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: '0.82rem', color: TEXT }}>{p.name}</span>
                                    {p.leagueCount ? <span style={{ ...mono, fontSize: '0.68rem', color: MUTED }}>{p.leagueCount} league{p.leagueCount === 1 ? '' : 's'}</span> : null}
                                    <span style={{ marginLeft: 'auto', textAlign: 'right', flexShrink: 0 }}>
                                        <span style={{ ...mono, display: 'block', fontSize: '1.05rem', fontWeight: 700, color: col }}>{Math.round((p.probability || 0) * 100)}%</span>
                                        <span style={{ ...mono, display: 'block', fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: col }}>{bandLabel(p.band)}</span>
                                    </span>
                                </div>
                                {factors.length ? (
                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                                        {factors.map((f, fi) => (
                                            <span key={fi} style={{ fontSize: '0.62rem', color: MUTED, border: `1px solid ${LINE}`, borderRadius: '4px', padding: '1px 6px' }}>{f}</span>
                                        ))}
                                    </div>
                                ) : null}
                                {plays.map((play, pi) => (
                                    <div key={pi} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginTop: '8px' }}>
                                        <div style={{ flex: 1, minWidth: 0, background: 'var(--black, #121217)', border: `1px solid ${LINE}`, borderLeft: `3px solid ${GOLD}`, borderRadius: '0 6px 6px 0', padding: '8px 11px', fontStyle: 'italic', fontSize: '0.78rem', color: '#C9C9D2', lineHeight: 1.5 }}>
                                            “{play}”
                                        </div>
                                        <button onClick={() => doCopy('play:' + p.userId + ':' + pi, play)}
                                            style={{ padding: '4px 10px', background: 'transparent', color: GOLD, border: '1px solid rgba(212,175,55,0.5)', borderRadius: '5px', font: '700 0.62rem ' + MONO, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer', flexShrink: 0 }}>
                                            {copiedKey === 'play:' + p.userId + ':' + pi ? 'Copied' : 'Copy'}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </React.Fragment>
            )}
        </Section>
    );
}

window.WrCommishGenesisPanel = WrCommishGenesisPanel;
window.WrCommishRenewalPanel = WrCommishRenewalPanel;
