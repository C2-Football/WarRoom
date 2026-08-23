// ══════════════════════════════════════════════════════════════════
// js/components/commish-network-panel.js
//   window.WrCommishCoefficientPanel — THE COEFFICIENT table
//   window.WrCommishProgrammePanel   — the Matchday Programme card grid
//
// The Commissioner's Office network surfaces. Both are pure render layers:
// every number arrives via props (App.Commish.Coefficient.buildCoefficient /
// App.Commish.Programme.buildAll outputs) — no fetching, no engine calls, so
// the panels stay testable and the container owns load order. The only
// side effects are the export buttons (wrExport screenshot capture) and the
// onExportAll callback, both explicitly interaction-driven.
//
//   <WrCommishCoefficientPanel coefficient={buildCoefficient(...)} graph={g} />
//   <WrCommishProgrammePanel programmes={buildAll(...)} onExportAll={fn} />
//
// Ships as type="text/babel" alongside season-odds-panel.js and mirrors its
// idiom: CSS-var color consts, local Section shell, mono + tabular-nums for
// every number column, calm monochrome tables (gold marks structure and the
// active/me row only; semantic green/red is reserved for the ONE decision
// column — Δ movement here). Honest empty states throughout: offseason shows
// the network without ratings, a dead league prints an empty programme page
// rather than vanishing from the broadcast.
// ══════════════════════════════════════════════════════════════════

// ── THE COEFFICIENT ─────────────────────────────────────────────────
// One rating per HUMAN, every league counted. Rows come pre-sorted and
// pre-computed by the engine; this component only decides how they read.
function WrCommishCoefficientPanel({ coefficient, graph }) {
    const GOLD = 'var(--gold, #d4af37)', SILVER = 'var(--silver, #9aa0a6)', TEXT = 'var(--text, #e8e8ea)';
    const GREEN = 'var(--k-2ecc71, #2ecc71)', RED = 'var(--k-e74c3c, #e74c3c)';
    const PANEL = 'var(--panel, #15151b)', LINE = 'var(--ov-4, rgba(255,255,255,0.08))';
    const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
    const MUTED = 'var(--text-muted, #8D887E)';
    const mono = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' };
    const microHdr = { font: '600 var(--text-micro, 0.6875rem) ' + MONO, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase' };

    // Expansion is per-person, additive (opening one row shouldn't close
    // another — a commissioner comparing two humans wants both open).
    const [open, setOpen] = React.useState({});

    const rows = (coefficient && coefficient.rows) || [];
    const gamesTotal = (coefficient && coefficient.gamesTotal) || 0;
    const overlap = (graph && graph.overlap) || [];
    const hasRatings = rows.some(r => r.rating != null);

    const Section = ({ title, meta, children }) => (
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.72rem', letterSpacing: '0.08em', color: TEXT, fontWeight: 600, textTransform: 'uppercase' }}>{title}</span>
                {meta ? <span style={{ ...microHdr, textTransform: 'none', letterSpacing: 0 }}>{meta}</span> : null}
            </div>
            {children}
        </div>
    );

    // Name | Rating | Δ | All-Play | Lgs — Δ is the single semantic-color
    // column; everything else stays monochrome so movement is what pops.
    const coefGrid = { display: 'grid', gridTemplateColumns: 'minmax(0,1.8fr) 0.8fr 0.6fr 0.9fr 0.5fr', gap: '8px', alignItems: 'center', padding: '6px 10px', minWidth: 0 };
    const rowLine = { borderBottom: `1px solid ${LINE}`, color: TEXT, fontSize: '0.75rem', ...mono };
    const myRowStyle = { background: 'rgba(212,175,55,0.07)', boxShadow: `inset 3px 0 0 ${GOLD}`, color: TEXT };

    const meta = rows.length
        ? rows.length + ' human' + (rows.length === 1 ? '' : 's') + ' · ' + gamesTotal.toLocaleString() + ' all-play games counted'
        : null;

    const h2h = rec => rec ? (rec.w + '-' + rec.l + (rec.t ? '-' + rec.t : '')) : '—';

    const delta = r => {
        if (r.delta == null) return <span style={{ color: MUTED }}>—</span>;
        if (r.delta > 0) return <span style={{ color: GREEN, fontWeight: 700 }}>▲{r.delta}</span>;
        if (r.delta < 0) return <span style={{ color: RED, fontWeight: 700 }}>▼{Math.abs(r.delta)}</span>;
        return <span style={{ color: TEXT }}>—</span>;
    };

    if (!rows.length) {
        return (
            <Section title="The Coefficient">
                <div style={{ color: TEXT, fontSize: '0.78rem', lineHeight: 1.5 }}>
                    No members on the graph yet — The Coefficient builds itself from the leagues you commission once their rosters and scores load.
                </div>
            </Section>
        );
    }

    return (
        <Section title="The Coefficient" meta={meta}>
            {/* Hero framing: the one-line thesis, then the scale so 500 reads. */}
            <div style={{ marginBottom: '10px' }}>
                <div style={{ color: TEXT, fontSize: '0.9rem', fontWeight: 600 }}>One rating per human — every league counted.</div>
                <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '2px' }}>All-play win rate on a 0–1000 scale · 500 = league-average human</div>
            </div>

            {/* Overlap strip: the cross-league network, real even in offseason. */}
            {overlap.length ? (
                <div style={{ marginBottom: '12px' }}>
                    <div style={{ ...microHdr, marginBottom: '6px' }}>
                        {overlap.length + ' human' + (overlap.length === 1 ? ' plays' : 's play') + ' in 2+ of your leagues'}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {overlap.map(o => (
                            <span key={o.userId} style={{ ...mono, fontSize: '0.68rem', color: TEXT, background: 'var(--black, #121217)', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-xs, 5px)', padding: '3px 8px', whiteSpace: 'nowrap' }}>
                                {o.name} <span style={{ color: GOLD }}>×{o.leagueCount}</span>
                            </span>
                        ))}
                    </div>
                </div>
            ) : (
                <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginBottom: '12px' }}>No cross-league overlap discovered yet — the chips light up when the same Sleeper account shows up in two of your leagues.</div>
            )}

            {hasRatings ? (
                <div style={{ overflowX: 'auto' }}>
                    <div style={{ minWidth: '480px' }}>
                        <div style={{ ...coefGrid, ...microHdr, borderBottom: `1px solid ${LINE}` }}>
                            <span>Human</span>
                            <span style={{ textAlign: 'right' }}>Rating</span>
                            <span style={{ textAlign: 'right' }}>Δ</span>
                            <span style={{ textAlign: 'right' }}>All-Play</span>
                            <span style={{ textAlign: 'right' }}>Lgs</span>
                        </div>
                        {rows.map(r => (
                            <React.Fragment key={r.userId}>
                                <div
                                    onClick={() => setOpen(o => ({ ...o, [r.userId]: !o[r.userId] }))}
                                    style={{ ...coefGrid, ...rowLine, cursor: 'pointer', ...(r.isMe ? myRowStyle : {}) }}>
                                    <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        <span style={{ color: MUTED, marginRight: '6px' }}>{open[r.userId] ? '▾' : '▸'}</span>
                                        {r.name}{r.isMe ? <span style={{ color: GOLD, fontWeight: 400 }}> (you)</span> : null}
                                    </span>
                                    <span style={{ textAlign: 'right', fontWeight: 700, color: r.rating != null ? TEXT : MUTED }}>
                                        {r.rating != null ? r.rating : '—'}
                                        {r.provisional && r.rating != null ? <span style={{ color: MUTED, fontWeight: 400, fontSize: '0.62rem' }}> (prov)</span> : null}
                                    </span>
                                    <span style={{ textAlign: 'right' }}>{delta(r)}</span>
                                    {/* apGames guards the record: 0 counted games prints '—', never a fake 0-0. */}
                                    <span style={{ textAlign: 'right' }}>{r.apGames ? r.apRecord : '—'}</span>
                                    <span style={{ textAlign: 'right', opacity: 0.8 }}>{r.leagueCount}</span>
                                </div>
                                {open[r.userId] ? (r.perLeague || []).map(pl => (
                                    <div key={pl.leagueId} style={{ padding: '4px 10px 4px 26px', borderBottom: `1px solid ${LINE}`, fontSize: '0.7rem', color: MUTED, ...mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        ↳ <span style={{ color: TEXT }}>{pl.leagueName}</span>
                                        {pl.rating != null
                                            ? <span> — rating {pl.rating} · all-play {pl.apRecord} · h2h {h2h(pl.record)}</span>
                                            : <span> — no scored weeks yet · h2h {h2h(pl.record)}</span>}
                                    </div>
                                )) : null}
                            </React.Fragment>
                        ))}
                    </div>
                </div>
            ) : (
                // Offseason honesty: the network above is real, the table isn't
                // until games count — never print a column of dashes as data.
                <div style={{ color: TEXT, fontSize: '0.78rem', lineHeight: 1.5, padding: '10px 0' }}>
                    No all-play games counted yet — The Coefficient starts rating humans from the first scored week of the season.
                </div>
            )}

            <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '10px' }}>
                Discovered automatically from shared Sleeper accounts — all-play based, honest across different scoring.
            </div>
        </Section>
    );
}

// ── MATCHDAY PROGRAMME ──────────────────────────────────────────────
// One card per commissioned league, each a self-contained page the export
// capture can screenshot into a group chat. The card DOM id is the export
// contract: 'wr-programme-<leagueId>' wraps exactly what should ship.
function WrCommishProgrammePanel({ programmes, onExportAll }) {
    const GOLD = 'var(--gold, #d4af37)', SILVER = 'var(--silver, #9aa0a6)', TEXT = 'var(--text, #e8e8ea)';
    const PANEL = 'var(--panel, #15151b)', LINE = 'var(--ov-4, rgba(255,255,255,0.08))';
    const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
    const MUTED = 'var(--text-muted, #8D887E)';
    const mono = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' };
    const microHdr = { font: '600 var(--text-micro, 0.6875rem) ' + MONO, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase' };
    const goldBtn = { padding: '6px 12px', background: 'transparent', color: GOLD, border: '1px solid rgba(212,175,55,0.5)', borderRadius: 'var(--card-radius-xs, 5px)', font: '700 0.66rem ' + MONO, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer' };

    const list = Array.isArray(programmes) ? programmes : [];

    const EMPTY_REASON = {
        no_ledger: 'Weekly scores could not be loaded for this league.',
        no_counted_weeks: 'No weeks in the books yet — this page prints after the first scored week.',
        no_scores: 'No scores posted for the latest counted week yet.',
    };

    const fmtRec = (w, l, t) => w + '-' + l + (t ? '-' + t : '');
    const num = n => Number(n || 0).toFixed(1); // toFixed(1) everywhere — mono columns misalign when 100 sits beside 98.4

    const Card = ({ p }) => (
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {/* The captured region: everything inside this id ships as the PNG. */}
            <div id={'wr-programme-' + p.leagueId} style={{ background: 'var(--black, #121217)', padding: '12px 14px', flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px', borderBottom: `1px solid ${LINE}`, paddingBottom: '8px', marginBottom: '10px' }}>
                    <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: '0.85rem', color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.leagueName}</span>
                    {!p.empty ? <span style={{ ...mono, fontSize: '0.7rem', fontWeight: 700, color: GOLD, whiteSpace: 'nowrap' }}>WK {p.week}</span> : null}
                </div>

                {p.empty ? (
                    <div style={{ color: TEXT, fontSize: '0.76rem', lineHeight: 1.5 }}>
                        {EMPTY_REASON[p.reason] || 'Nothing to print for this league yet.'}
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ color: TEXT, fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.4 }}>{p.headline}</div>

                        {p.results && p.results.length ? (
                            <div>
                                <div style={{ ...microHdr, marginBottom: '4px' }}>Results</div>
                                {p.results.slice(0, 3).map((r, i) => (
                                    <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '10px', alignItems: 'baseline', padding: '2px 0', fontSize: '0.73rem', color: TEXT, ...mono }}>
                                        {/* margin 0 keeps the first row in the winner slot — check tie before crowning */}
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {r.tie ? r.winnerName + ' ties ' + r.loserName : r.winnerName + ' def. ' + r.loserName}
                                        </span>
                                        <span style={{ color: TEXT }}>{num(r.wPts)}–{num(r.lPts)}</span>
                                    </div>
                                ))}
                                {p.results.length > 3 ? <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '2px' }}>+{p.results.length - 3} more result{p.results.length - 3 === 1 ? '' : 's'}</div> : null}
                            </div>
                        ) : null}

                        {p.topScore ? (
                            <div style={{ fontSize: '0.73rem', color: TEXT, ...mono }}>
                                <span style={{ ...microHdr }}>Top score</span>{' '}
                                <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, color: TEXT }}>{p.topScore.name}</span>{' '}
                                <span style={{ color: GOLD, fontWeight: 700 }}>{num(p.topScore.pts)}</span>
                            </div>
                        ) : null}

                        {p.luckNote ? (
                            <div style={{ fontSize: '0.72rem', color: TEXT, lineHeight: 1.5, borderLeft: `2px solid ${LINE}`, paddingLeft: '8px' }}>
                                <span style={{ ...microHdr }}>Luck</span> {p.luckNote.text}
                            </div>
                        ) : null}

                        {p.standingsTop3 && p.standingsTop3.length ? (
                            <div>
                                <div style={{ ...microHdr, marginBottom: '4px' }}>Standings</div>
                                {p.standingsTop3.map((s, i) => (
                                    <div key={s.rosterId} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0,1fr) auto', gap: '8px', alignItems: 'baseline', padding: '2px 0', fontSize: '0.73rem', color: TEXT, ...mono }}>
                                        <span style={{ color: MUTED }}>{i + 1}.</span>
                                        <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                                        <span>{fmtRec(s.wins, s.losses, s.ties)} · {num(s.pf)}</span>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                )}
            </div>

            {/* Export sits OUTSIDE the captured id — a button in the PNG would
                read like a broken screenshot in the group chat. */}
            {window.wrExport && !p.empty ? (
                <div style={{ padding: '8px 14px', borderTop: `1px solid ${LINE}` }}>
                    <button onClick={() => window.wrExport.capture(document.getElementById('wr-programme-' + p.leagueId), 'programme-' + p.leagueId)} style={goldBtn}>
                        Export
                    </button>
                </div>
            ) : null}
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                    <div style={{ fontSize: '0.72rem', letterSpacing: '0.08em', color: TEXT, fontWeight: 600, textTransform: 'uppercase' }}>Matchday Programme</div>
                    <div style={{ color: TEXT, fontSize: '0.9rem', fontWeight: 600, marginTop: '2px' }}>One button. Every group chat.</div>
                </div>
                {typeof onExportAll === 'function' && list.some(p => !p.empty) ? (
                    <button onClick={() => onExportAll()} style={goldBtn}>Export All</button>
                ) : null}
            </div>

            {list.length ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
                    {list.map((p, i) => <Card key={p.leagueId || i} p={p} />)}
                </div>
            ) : (
                <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '14px 16px', color: TEXT, fontSize: '0.78rem', lineHeight: 1.5 }}>
                    No commissioned leagues to print — the programme composes one page per league you run, from its latest scored week.
                </div>
            )}
        </div>
    );
}

window.WrCommishCoefficientPanel = WrCommishCoefficientPanel;
window.WrCommishProgrammePanel = WrCommishProgrammePanel;
